import 'reflect-metadata';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { payload } from './fixtures/quotation-pdf.mjs';
import { WORKER, JOB_ERROR } from '../dist/constants/worker.constant.js';
import { QuotationPdfRenderService } from '../dist/modules/worker/quotation-pdf-render.service.js';

const renderer = (context) => {
  const started = Promise.withResolvers();
  const completed = Promise.withResolvers();
  const state = { kills: 0, closed: 0 };
  const page = {
    setDefaultTimeout: () => {},
    setRequestInterception: async () => {},
    on: () => {},
    setContent: async () => {},
    evaluate: async () => {},
    pdf: () => {
      started.resolve();
      return completed.promise;
    },
  };
  const browser = {
    process: () => ({
      kill: () => {
        state.kills += 1;
        completed.reject(new Error('Chromium killed'));
      },
    }),
    newPage: async () => page,
    close: async () => {
      state.closed += 1;
    },
  };
  const launch = context.mock.method(puppeteer, 'launch', async () => browser);
  return { state, launch, started, completed };
};

test('one shared renderer bounds HTTP and broker Chromium concurrency and recovers after completion', async (context) => {
  const fixture = renderer(context);
  const service = new QuotationPdfRenderService();
  const first = service.render(payload);
  await fixture.started.promise;
  assert.equal(fixture.launch.mock.calls[0].arguments[0].handleSIGTERM, false);
  await assert.rejects(service.render(payload), /renderer is busy/);
  fixture.completed.resolve(Buffer.from('%PDF-1.7'));
  assert.equal((await first).toString(), '%PDF-1.7');
  assert.equal(fixture.state.closed, 1);
  assert.equal((await service.render(payload)).toString(), '%PDF-1.7');
});

test('PDF deadline kills actual Chromium process before releasing renderer slot', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = renderer(context);
  const service = new QuotationPdfRenderService();
  const execution = service.render(payload);
  const rejected = assert.rejects(execution, {
    code: JOB_ERROR.TIMEOUT,
    retryable: true,
  });
  await fixture.started.promise;
  context.mock.timers.tick(WORKER.PDF_TIMEOUT_MS);
  await rejected;
  assert.equal(fixture.state.kills, 1);
  assert.equal(fixture.state.closed, 1);
});
