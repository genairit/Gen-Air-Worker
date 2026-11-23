import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JobError } from '../dist/errors/job.error.js';
import { payload } from './fixtures/quotation-pdf.mjs';
import { parseJob } from '../dist/utilities/job.utility.js';
import { WORKER, JOB_ERROR } from '../dist/constants/worker.constant.js';
import { WorkerService } from '../dist/modules/worker/worker.service.js';

const correlation = {
  cycleId: 'cycle-1',
  operationId: 'operation-1',
  generation: 1,
  sourceHash: 'a'.repeat(64),
};
const job = {
  attempt: 1,
  version: 1,
  jobId: 'pdf-1',
  tenantId: 'tenant-1',
  jobType: WORKER.PDF_JOB_TYPE,
  payload: { ...correlation, document: payload },
};
const encode = (value) => Buffer.from(JSON.stringify(value));
const csv = { execute: async () => assert.fail('PDF used CSV executor') };
const transport = () => {
  const events = [];
  return {
    events,
    acknowledge: () => events.push({ type: 'ack' }),
    publishRetry: async (value) => {
      events.push({ type: 'retry', value });
    },
    publishResult: async (value) => {
      events.push({ type: 'result', value });
    },
    publishFailure: async (value) => {
      events.push({ type: 'failure', value });
    },
  };
};

test('PDF envelopes validate frozen correlation and complete renderer payload', () => {
  assert.deepEqual({ ...parseJob(encode(job)) }, job);
  const patches = [
    { sourceHash: 'not-a-hash' },
    { generation: 0 },
    { generation: 1.5 },
    { operationId: '../external' },
    { cycleId: '' },
    { document: {} },
    { replyQueue: 'external' },
  ];
  patches.forEach((patch) =>
    assert.throws(
      () => parseJob(encode({ ...job, payload: { ...job.payload, ...patch } })),
      { code: JOB_ERROR.INVALID },
    ),
  );
});

test('PDF success includes verified byte metadata and correlation before acknowledgment', async () => {
  const bytes = Buffer.from('%PDF-1.7\nsaved document');
  const confirmation = Promise.withResolvers();
  const target = transport();
  const publish = target.publishResult;
  target.publishResult = async (value) => {
    await publish(value);
    await confirmation.promise;
  };
  const worker = new WorkerService(csv, {
    render: async (document) => {
      assert.deepEqual(document, payload);
      return bytes;
    },
  });
  const operation = worker.process(encode(job), target);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    target.events.map(({ type }) => type),
    ['result'],
  );
  confirmation.resolve();
  await operation;
  assert.deepEqual(
    target.events.map(({ type }) => type),
    ['result', 'ack'],
  );
  assert.deepEqual(target.events[0].value.correlation, correlation);
  assert.deepEqual(target.events[0].value.output, {
    ...correlation,
    pdfBase64: bytes.toString('base64'),
    contentType: 'application/pdf',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.length,
  });
});

test('PDF terminal failure retains correlation and never reports success bytes', async () => {
  const target = transport();
  const worker = new WorkerService(csv, {
    render: async () => {
      throw new JobError(JOB_ERROR.TIMEOUT, true);
    },
  });
  await worker.process(
    encode({ ...job, attempt: WORKER.MAX_ATTEMPTS }),
    target,
  );
  assert.deepEqual(
    target.events.map(({ type }) => type),
    ['result', 'failure', 'ack'],
  );
  assert.equal(target.events[0].value.error, JOB_ERROR.TIMEOUT);
  assert.deepEqual(target.events[0].value.correlation, correlation);
  assert.equal(target.events[0].value.output, null);
});

test('PDF raw cap rejects before attempting oversized broker publication', async () => {
  const target = transport();
  const worker = new WorkerService(csv, {
    render: async () => Buffer.alloc(WORKER.MAX_PDF_BYTES + 1),
  });
  await worker.process(encode(job), target);
  assert.equal(target.events[0].value.error, JOB_ERROR.RESULT_TOO_LARGE);
  assert.equal(target.events[0].value.output, null);
});

test('maximum PDF bytes fit base64-expanded result budget without reducing CSV limits', async () => {
  const target = transport();
  const bytes = Buffer.alloc(WORKER.MAX_PDF_BYTES, 65);
  const worker = new WorkerService(csv, { render: async () => bytes });
  await worker.process(encode(job), target);
  const result = target.events[0].value;
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.byteLength, WORKER.MAX_PDF_BYTES);
  assert.ok(
    Buffer.byteLength(JSON.stringify(result)) < WORKER.MAX_PDF_RESULT_BYTES,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(result)) > WORKER.MAX_RESULT_BYTES,
  );
});

test('typed queue mismatch is quarantined instead of crossing result ownership', async () => {
  const target = transport();
  const worker = new WorkerService(csv, {
    render: async () => assert.fail('wrong queue executed'),
  });
  await worker.process(encode(job), target, WORKER.JOB_TYPE);
  assert.deepEqual(
    target.events.map(({ type }) => type),
    ['failure', 'ack'],
  );
  assert.equal(target.events[0].value.error, JOB_ERROR.INVALID);
});
