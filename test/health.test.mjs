import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Module, ServiceUnavailableException } from '@nestjs/common';
import { QueueService } from '../dist/modules/worker/queue.service.js';
import { WorkerController } from '../dist/modules/worker/worker.controller.js';
import { QuotationPdfRenderService } from '../dist/modules/worker/quotation-pdf-render.service.js';

test('HTTP health routes report liveness and broker readiness independently', async (context) => {
  const state = { ready: false };
  const renderer = { render: async () => Buffer.from('%PDF-1.7') };
  class HealthTestModule {}
  Module({
    controllers: [WorkerController],
    providers: [
      { provide: QueueService, useValue: { isReady: () => state.ready } },
      { provide: QuotationPdfRenderService, useValue: renderer },
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: () => 'test-token-with-more-than-32-characters',
        },
      },
    ],
  })(HealthTestModule);
  const app = await NestFactory.create(HealthTestModule, { logger: false });
  context.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const live = await fetch(`${baseUrl}/health/live`);
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok' });
  assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  state.ready = true;
  const ready = await fetch(`${baseUrl}/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
  state.ready = false;
  assert.equal((await fetch(`${baseUrl}/health/ready`)).status, 503);
  assert.equal(
    (
      await fetch(`${baseUrl}/render/quotation-pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/render/quotation-pdf`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token-with-more-than-32-characters',
          'content-type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    400,
  );
  const party = {
    name: 'לקוח',
    address: null,
    city: null,
    email: null,
    phone: null,
  };
  const payload = {
    number: 'Q1',
    title: 'הצעת מחיר',
    quotationDate: '10/11/2026',
    printDate: '10/11/2026',
    issuerName: 'דנה כהן',
    company: { ...party, businessNumber: '123', vatFileNumber: '123' },
    recipient: { ...party, customerNumber: null },
    project: { name: null, address: null },
    metadata: {
      validUntil: null,
      salesAgent: null,
      customerTaxId: null,
      customerTaxLabel: 'מס׳ חברה:',
      vatFileNumber: '123',
      revision: 1,
    },
    sections: [],
    totals: {
      subtotal: '100',
      discount: '0',
      pretax: '100',
      vatRate: '18',
      vat: '18',
      total: '118',
    },
    terms: {
      general: [],
      payment: [],
      paymentStages: [],
      delivery: [],
      warranty: [],
      additional: [],
      approval: 'אישור',
    },
  };
  const options = {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token-with-more-than-32-characters',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
  const generated = await fetch(`${baseUrl}/render/quotation-pdf`, options);
  assert.equal(generated.status, 200);
  assert.equal(generated.headers.get('content-type'), 'application/pdf');
  assert.equal(
    Buffer.from(await generated.arrayBuffer()).toString(),
    '%PDF-1.7',
  );
  renderer.render = async () => {
    throw new ServiceUnavailableException('busy');
  };
  assert.equal(
    (await fetch(`${baseUrl}/render/quotation-pdf`, options)).status,
    503,
  );
});
