import { JobError } from '../errors/job.error.js';
import { JOB_ERROR } from '../constants/worker.constant.js';
import type { IQuotationPdfPayload } from '../interfaces/quotation-pdf.interface.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 5000;
const optionalString = (value: unknown): value is string | null =>
  value === null || string(value);
const party = (value: unknown): boolean =>
  record(value) &&
  string(value.name) &&
  optionalString(value.address) &&
  optionalString(value.city) &&
  optionalString(value.email) &&
  optionalString(value.phone);
const paragraphs = (value: unknown): boolean =>
  Array.isArray(value) && value.length <= 100 && value.every(string);
const line = (value: unknown): boolean =>
  record(value) &&
  string(value.sku) &&
  string(value.unit) &&
  string(value.quantity) &&
  string(value.description) &&
  string(value.unitPrice) &&
  string(value.totalPrice) &&
  (value.capacityBtu === null || typeof value.capacityBtu === 'number');
const section = (value: unknown): boolean =>
  record(value) &&
  string(value.title) &&
  optionalString(value.brand) &&
  Array.isArray(value.lines) &&
  value.lines.length <= 200 &&
  value.lines.every(line);

export const isQuotationPdfPayload = (
  value: unknown,
): value is IQuotationPdfPayload => {
  if (
    !record(value) ||
    !record(value.project) ||
    !record(value.metadata) ||
    !record(value.totals) ||
    !record(value.terms)
  ) {
    return false;
  }

  const { project, metadata, totals, terms } = value;
  return (
    string(value.number) &&
    value.number.length > 0 &&
    string(value.title) &&
    string(value.quotationDate) &&
    string(value.printDate) &&
    string(value.issuerName) &&
    value.issuerName.length > 0 &&
    party(value.company) &&
    record(value.company) &&
    string(value.company.businessNumber) &&
    string(value.company.vatFileNumber) &&
    party(value.recipient) &&
    record(value.recipient) &&
    optionalString(value.recipient.customerNumber) &&
    optionalString(project.name) &&
    optionalString(project.address) &&
    optionalString(metadata.validUntil) &&
    optionalString(metadata.salesAgent) &&
    optionalString(metadata.customerTaxId) &&
    string(metadata.customerTaxLabel) &&
    string(metadata.vatFileNumber) &&
    Number.isInteger(metadata.revision) &&
    string(totals.subtotal) &&
    string(totals.discount) &&
    string(totals.pretax) &&
    string(totals.vatRate) &&
    string(totals.vat) &&
    string(totals.total) &&
    paragraphs(terms.general) &&
    paragraphs(terms.payment) &&
    paragraphs(terms.paymentStages) &&
    paragraphs(terms.delivery) &&
    paragraphs(terms.warranty) &&
    paragraphs(terms.additional) &&
    string(terms.approval) &&
    Array.isArray(value.sections) &&
    value.sections.length <= 50 &&
    value.sections.every(section)
  );
};

export const validateQuotationPdfPayload = (
  value: unknown,
): IQuotationPdfPayload => {
  if (!isQuotationPdfPayload(value)) {
    throw new JobError(JOB_ERROR.INVALID, false);
  }

  return value;
};
