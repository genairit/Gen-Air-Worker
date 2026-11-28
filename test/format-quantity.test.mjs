import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantity } from '../dist/utilities/format-quantity.utility.js';

test('whole quantities render as integers', () => {
  assert.equal(formatQuantity('50.0000'), '50');
  assert.equal(formatQuantity('100'), '100');
  assert.equal(formatQuantity('0.0000'), '0');
});

test('genuine fractions keep only their significant digits', () => {
  assert.equal(formatQuantity('21.6000'), '21.6');
  assert.equal(formatQuantity('2.5'), '2.5');
});

test('non-numeric text is left untouched', () => {
  assert.equal(formatQuantity('abc'), 'abc');
  assert.equal(formatQuantity(''), '');
});
