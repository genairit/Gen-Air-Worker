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
  return { state, launch, browser, started, completed };
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

test('PDF deadline requests process termination before releasing renderer slot', async (context) => {
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

test('deadline during stalled browser close terminates only the owned child and releases shared slot', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const closing = Promise.withResolvers();
  const stalled = Promise.withResolvers();
  const state = { ownedKills: 0 };
  const owned = {
    kill: () => {
      state.ownedKills += 1;
    },
  };
  const page = {
    setDefaultTimeout: () => {},
    setRequestInterception: async () => {},
    on: () => {},
    setContent: async () => {},
    evaluate: async () => {},
    pdf: async () => Buffer.from('%PDF-1.7'),
  };
  const launch = context.mock.method(puppeteer, 'launch', async () => ({
    process: () => owned,
    newPage: async () => page,
    close: async () => {
      closing.resolve();
      await stalled.promise;
    },
  }));
  context.mock.method(process, 'kill', () =>
    assert.fail('global process termination is forbidden'),
  );
  const service = new QuotationPdfRenderService();
  const execution = service.render(payload);
  const rejected = assert.rejects(execution, {
    code: JOB_ERROR.TIMEOUT,
    retryable: true,
  });
  await closing.promise;
  context.mock.timers.tick(WORKER.PDF_TIMEOUT_MS);
  await rejected;
  assert.equal(state.ownedKills, 1);
  launch.mock.mockImplementation(async () => ({
    process: () => ({ kill: () => assert.fail('completed render was killed') }),
    newPage: async () => page,
    close: async () => {},
  }));
  assert.equal((await service.render(payload)).toString(), '%PDF-1.7');
  const { WorkerController } =
    await import('../dist/modules/worker/worker.controller.js');
  const controller = new WorkerController(
    { isReady: () => true },
    { getOrThrow: () => 'local-unit-token' },
    service,
  );
  const response = await controller.quotationPdf(
    'Bearer local-unit-token',
    payload,
  );
  assert.equal(response.getHeaders().type, WORKER.PDF_CONTENT_TYPE);
  const { JobService } = await import('../dist/modules/worker/job.service.js');
  assert.equal(
    (await new JobService().execute({ headers: ['Name'], rows: [['Alice']] }))
      .rowCount,
    1,
  );
});

test('browser close rejection requests owned child cleanup without dropping valid PDF bytes', async (context) => {
  const fixture = renderer(context);
  fixture.browser.close = async () => {
    throw new Error('Browser close failed');
  };
  fixture.completed.resolve(Buffer.from('%PDF-1.7'));
  const result = await new QuotationPdfRenderService().render(payload);
  assert.equal(result.toString(), '%PDF-1.7');
  assert.equal(fixture.state.kills, 1);
});
