import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { WorkerController } from '../dist/modules/worker/worker.controller.js';
import { isEstimatePdfPayload } from '../dist/handlers/engineering-estimate-pdf.handler.js';

const plan = {
  areaName: 'קומה ראשונה',
  name: 'תוכנית מסומנת',
  mimeType: 'image/png',
  base64: readFileSync(
    new URL('../assets/genair-logo.png', import.meta.url),
  ).toString('base64'),
};
const payload = {
  kind: 'sketch',
  name: 'כתב כמויות',
  projectName: null,
  customerName: null,
  lines: [
    {
      areaName: plan.areaName,
      sku: 'IN-PI',
      description: 'צנרת',
      unit: 'מטר',
      quantity: '12',
      unitPrice: '10',
      total: '120',
    },
  ],
  subtotal: '120',
  vat: '21.60',
  total: '141.60',
  revision: 1,
  markedPlans: [plan],
};

test('estimate PDF accepts a marked sketch and excludes marked plans from proposal inputs', () => {
  assert.equal(isEstimatePdfPayload(payload), true);
  assert.equal(isEstimatePdfPayload({ ...payload, markedPlans: [] }), false);
  assert.equal(isEstimatePdfPayload({ ...payload, kind: 'proposal' }), false);
  assert.equal(
    isEstimatePdfPayload({ ...payload, kind: 'proposal', markedPlans: [] }),
    true,
  );
  assert.equal(
    isEstimatePdfPayload({
      ...payload,
      markedPlans: [{ ...plan, mimeType: 'image/jpeg' }],
    }),
    false,
  );
  assert.equal(
    isEstimatePdfPayload({
      ...payload,
      markedPlans: [{ ...plan, base64: 'aGVsbG8=' }],
    }),
    false,
  );
});

test('estimate PDF endpoint checks the worker token and request before rendering', async () => {
  const bytes = Buffer.from('%PDF-fixture');
  const calls = [];
  const controller = new WorkerController(
    {},
    { getOrThrow: () => 'test-token' },
    {
      renderEstimate: async (data) => {
        calls.push(data);
        return bytes;
      },
    },
  );
  await assert.rejects(
    controller.engineeringEstimatePdf('Bearer wrong', payload),
    { status: 401 },
  );
  await assert.rejects(
    controller.engineeringEstimatePdf('Bearer test-token', {}),
    { status: 400 },
  );
  assert.equal(calls.length, 0);
  const result = await controller.engineeringEstimatePdf(
    'Bearer test-token',
    payload,
  );
  assert.equal(result.getHeaders().type, 'application/pdf');
  assert.deepEqual(calls, [payload]);
});

test('proposal accepts a surcharge and the full quotation payment schedule', () => {
  const proposal = {
    ...payload,
    kind: 'proposal',
    markedPlans: [],
    adjustment: '-20.00',
    paymentTerms: [...Array(30).fill('שלב תשלום'), 'א'.repeat(1000)],
  };
  assert.equal(isEstimatePdfPayload(proposal), true);
  assert.equal(
    isEstimatePdfPayload({ ...proposal, adjustment: 'Infinity' }),
    false,
  );
});
