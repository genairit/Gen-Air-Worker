import {
  isQuotationPdfPayload,
  validateQuotationPdfPayload,
} from '../dist/utilities/quotation-pdf.utility.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { payload } from './fixtures/quotation-pdf.mjs';

test('quotation PDF contract accepts a complete saved snapshot', () => {
  assert.equal(isQuotationPdfPayload(payload), true);
  assert.equal(validateQuotationPdfPayload(payload), payload);
});

test('quotation PDF contract rejects malformed and oversized nested data', () => {
  assert.equal(
    isQuotationPdfPayload({
      ...payload,
      sections: [{ ...payload.sections[0], lines: [{}] }],
    }),
    false,
  );
  assert.equal(isQuotationPdfPayload({ ...payload, issuerName: '' }), false);
  assert.equal(
    isQuotationPdfPayload({
      ...payload,
      terms: { ...payload.terms, general: Array(101).fill('x') },
    }),
    false,
  );
  assert.throws(() =>
    validateQuotationPdfPayload({ ...payload, company: null }),
  );
});
