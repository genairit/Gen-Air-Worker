import {
  isQuotationPdfPayload,
  validateQuotationPdfPayload,
} from '../dist/utilities/quotation-pdf.utility.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { payload } from './fixtures/quotation-pdf.mjs';
import { renderQuotationSections } from '../dist/handlers/quotation-pdf.handler.js';

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

test('prints floor, company, and system once per group and preserves legacy no-floor lines', () => {
  const section = payload.sections[0];
  const floor = { floorId: 'floor1', floorName: 'North & West' };
  const sections = [
    { ...section, brand: 'Electra', title: 'Lobby', ...floor },
    { ...section, brand: 'Electra', title: 'Meeting room', ...floor },
    { ...section, brand: 'Tadiran', title: 'Offices', ...floor },
    { ...section, brand: 'Electra', title: 'Plant' },
    { ...section, title: 'כללי' },
    { ...section, title: 'Delivery <local>' },
  ];
  assert.equal(isQuotationPdfPayload({ ...payload, sections }), true);
  const rows = renderQuotationSections(sections);
  const headings = Array.from(
    rows.matchAll(/class="section-row (\w+)"><td colspan="6">([^<]*)/g),
    (match) => [match[1], match[2]],
  );
  assert.deepEqual(headings, [
    ['floor', 'North &amp; West'],
    ['company', 'Electra'],
    ['system', 'Lobby'],
    ['system', 'Meeting room'],
    ['company', 'Tadiran'],
    ['system', 'Offices'],
    ['company', 'Electra'],
    ['system', 'Plant'],
    ['company', 'כללי'],
    ['system', 'Delivery &lt;local&gt;'],
  ]);
  assert.equal(rows.split('<bdi>A</bdi>').length - 1, sections.length);
  assert.equal(
    isQuotationPdfPayload({ ...payload, sections: [{ ...section, ...floor }] }),
    false,
  );
});
