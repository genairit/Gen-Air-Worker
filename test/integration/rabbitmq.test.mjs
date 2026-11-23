import 'reflect-metadata';
import amqp from 'amqplib';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { TIME } from '../../dist/constants/time.constant.js';
import { WORKER } from '../../dist/constants/worker.constant.js';
import { payload as pdfPayload } from '../fixtures/quotation-pdf.mjs';
import { ConfirmedPublisher } from '../../dist/infrastructure/confirmed-publisher.js';

const INTEGRATION = { POLL_INTERVAL_MS: TIME.SECOND_MS / 40 };

const broker = process.env.TEST_RABBITMQ_URL;
if (
  !broker ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(broker).hostname)
) {
  throw new Error(
    'TEST_RABBITMQ_URL must point to a disposable localhost RabbitMQ 4.1+ broker',
  );
}

const receive = async (
  channel,
  queue,
  timeout = 10 * WORKER.PUBLISH_TIMEOUT_MS,
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: false });
    if (message) {
      const value = JSON.parse(message.content.toString('utf8'));
      channel.ack(message);
      return value;
    }

    await delay(INTEGRATION.POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${queue}`);
};

test('real RabbitMQ: durable jobs, duplicate-safe output, invalid jobs and health', async () => {
  const prefix = `genair.worker.integration.${randomUUID()}`;
  Object.assign(process.env, {
    RABBITMQ_URL: broker,
    WORKER_QUEUE_PREFIX: prefix,
    WORKER_PREFETCH: '1',
    PORT: '3001',
    WORKER_API_TOKEN: 'local-integration-only-token-32-characters',
  });
  const { AppModule } = await import('../../dist/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  const connection = await amqp.connect(broker);
  connection.on('error', () => assert.fail('Test broker connection failed'));
  const channel = await connection.createConfirmChannel();
  channel.on('error', () => assert.fail('Test broker channel failed'));
  try {
    await app.listen(0, '127.0.0.1');
    const address = await app.getUrl();
    const publisher = new ConfirmedPublisher(channel);
    const job = {
      version: WORKER.VERSION,
      jobId: randomUUID(),
      tenantId: 'integration-tenant',
      jobType: WORKER.JOB_TYPE,
      attempt: 1,
      payload: {
        headers: ['Apartment', 'Issue'],
        rows: [['12', 'Missing phone']],
      },
    };
    await publisher.publish(`${prefix}.jobs`, job);
    const first = await receive(channel, `${prefix}.results`);
    assert.equal(first.status, 'succeeded');
    assert.equal(first.jobId, job.jobId);
    assert.equal(first.tenantId, job.tenantId);
    assert.match(first.output.csv, /Missing phone/);
    await publisher.publish(`${prefix}.jobs`, job);
    const duplicate = await receive(channel, `${prefix}.results`);
    assert.deepEqual(duplicate.output, first.output);

    await publisher.publish(`${prefix}.jobs`, {
      ...job,
      jobId: randomUUID(),
      payload: {},
    });
    assert.equal(
      (await receive(channel, `${prefix}.results`)).status,
      'failed',
    );
    assert.equal(
      (await receive(channel, `${prefix}.failures`)).result.error,
      'INVALID_JOB',
    );
    await publisher.publish(`${prefix}.jobs`, { unexpected: 'input' });
    assert.equal(
      (await receive(channel, `${prefix}.failures`)).error,
      'INVALID_JOB',
    );

    const correlation = {
      operationId: randomUUID(),
      cycleId: randomUUID(),
      sourceHash: createHash('sha256')
        .update(JSON.stringify(pdfPayload))
        .digest('hex'),
      generation: 1,
    };
    const pdfJob = {
      ...job,
      jobId: randomUUID(),
      jobType: WORKER.PDF_JOB_TYPE,
      payload: { ...correlation, document: pdfPayload },
    };
    await publisher.publish(`${prefix}.pdf.jobs`, pdfJob);
    const pdf = await receive(channel, `${prefix}.pdf.results`);
    assert.equal(pdf.status, 'succeeded');
    assert.deepEqual(pdf.correlation, correlation);
    const bytes = Buffer.from(pdf.output.pdfBase64, 'base64');
    assert.match(bytes.subarray(0, 8).toString(), /^%PDF-/);
    assert.equal(pdf.output.byteLength, bytes.length);
    assert.equal(
      pdf.output.sha256,
      createHash('sha256').update(bytes).digest('hex'),
    );
    assert.equal(
      await channel.get(`${prefix}.results`, { noAck: false }),
      false,
      'PDF results must never enter CSV results',
    );

    await publisher.publish(`${prefix}.pdf.jobs`, pdfJob);
    const duplicatePdf = await receive(channel, `${prefix}.pdf.results`);
    assert.equal(duplicatePdf.jobId, pdfJob.jobId);
    assert.deepEqual(duplicatePdf.correlation, correlation);
    assert.match(
      Buffer.from(duplicatePdf.output.pdfBase64, 'base64')
        .subarray(0, 8)
        .toString(),
      /^%PDF-/,
    );

    const replay = await connection.createConfirmChannel();
    await new ConfirmedPublisher(replay).publish(`${prefix}.pdf.results`, pdf);
    const unacknowledged = await replay.get(`${prefix}.pdf.results`, {
      noAck: false,
    });
    assert.ok(unacknowledged);
    await replay.close();
    const redelivery = await channel.get(`${prefix}.pdf.results`, {
      noAck: false,
    });
    assert.ok(redelivery);
    assert.equal(redelivery.fields.redelivered, true);
    assert.deepEqual(JSON.parse(redelivery.content.toString()), pdf);
    channel.ack(redelivery);

    const largeJob = {
      ...job,
      jobId: randomUUID(),
      payload: {
        headers: ['Apartment', 'Issue'],
        rows: Array.from({ length: 2500 }, (_, index) => [
          String(index),
          'x'.repeat(250),
        ]),
      },
    };
    await publisher.publish(`${prefix}.jobs`, largeJob);
    const started = performance.now();
    const health = await fetch(`${address}/health/ready`);
    assert.equal(health.status, 200);
    const healthMs = performance.now() - started;
    assert.ok(
      healthMs < WORKER.PUBLISH_TIMEOUT_MS,
      'Worker health must respond during report generation',
    );
    assert.equal(
      (await receive(channel, `${prefix}.results`)).output.rowCount,
      2500,
    );
    process.stdout.write(
      `Worker readiness under 2,500-row export: ${healthMs.toFixed(1)} ms\n`,
    );
  } finally {
    await app.close();
    await Promise.all(
      ['jobs', 'pdf.jobs', 'results', 'pdf.results', 'failures'].map((name) =>
        channel.deleteQueue(`${prefix}.${name}`),
      ),
    );
    await connection.close();
  }
});

test('real process SIGTERM drains an active PDF delivery before broker disconnect', async () => {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const prefix = `genair.worker.shutdown.${randomUUID()}`;
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RABBITMQ_URL: broker,
      WORKER_QUEUE_PREFIX: prefix,
      WORKER_PREFETCH: '1',
      WORKER_API_TOKEN: 'local-integration-only-token-32-characters',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const diagnostics = { logs: '' };
  child.stdout.on('data', (chunk) => {
    diagnostics.logs = (diagnostics.logs + chunk.toString()).slice(-16384);
  });
  child.stderr.on('data', (chunk) => {
    diagnostics.logs = (diagnostics.logs + chunk.toString()).slice(-16384);
  });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const connection = await amqp.connect(broker);
  const channel = await connection.createConfirmChannel();
  const deadline = Date.now() + WORKER.PUBLISH_TIMEOUT_MS;
  try {
    const state = { ready: false };
    while (Date.now() < deadline && !state.ready) {
      try {
        state.ready = (await fetch(`http://127.0.0.1:${port}/health/ready`)).ok;
      } catch {
        state.ready = false;
      }
      await delay(INTEGRATION.POLL_INTERVAL_MS);
    }
    assert.equal(state.ready, true, 'child worker became ready');
    const job = {
      version: WORKER.VERSION,
      jobId: randomUUID(),
      tenantId: 'integration-tenant',
      jobType: WORKER.PDF_JOB_TYPE,
      attempt: 1,
      payload: {
        operationId: randomUUID(),
        cycleId: randomUUID(),
        sourceHash: 'b'.repeat(64),
        generation: 1,
        document: pdfPayload,
      },
    };
    await new ConfirmedPublisher(channel).publish(`${prefix}.pdf.jobs`, job);
    const started = { value: false };
    while (Date.now() < deadline && !started.value) {
      started.value =
        diagnostics.logs.includes(`"jobId":"${job.jobId}"`) &&
        diagnostics.logs.includes('Job started');
      await delay(INTEGRATION.POLL_INTERVAL_MS);
    }
    assert.equal(started.value, true, 'PDF execution started before SIGTERM');
    child.kill('SIGTERM');
    const result = await receive(
      channel,
      `${prefix}.pdf.results`,
      2 * WORKER.PUBLISH_TIMEOUT_MS,
    );
    assert.equal(result.jobId, job.jobId);
    assert.equal(result.status, 'succeeded');
    assert.match(
      Buffer.from(result.output.pdfBase64, 'base64').subarray(0, 8).toString(),
      /^%PDF-/,
    );
    const exitDeadline = Promise.withResolvers();
    const timeout = setTimeout(
      () => exitDeadline.reject(new Error('Worker did not exit after drain')),
      WORKER.PUBLISH_TIMEOUT_MS,
    );
    const exit = await Promise.race([closed, exitDeadline.promise]).finally(
      () => clearTimeout(timeout),
    );
    assert.ok(
      exit.code === 0 || exit.signal === 'SIGTERM',
      'graceful shutdown avoids watchdog/nonzero failure',
    );
  } finally {
    child.kill('SIGKILL');
    await closed;
    await Promise.all(
      ['jobs', 'pdf.jobs', 'results', 'pdf.results', 'failures'].map((name) =>
        channel.deleteQueue(`${prefix}.${name}`),
      ),
    );
    await connection.close();
  }
});
