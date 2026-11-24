import type {
  IQuotationPdfJobPayload,
  IQuotationPdfCorrelation,
} from '../interfaces/quotation-pdf.interface.js';

import { JobError } from '../errors/job.error.js';
import { JOB_ERROR } from '../constants/worker.constant.js';
import { isQuotationPdfPayload } from './quotation-pdf.utility.js';

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export const isQuotationPdfJobPayload = (
  value: unknown,
): value is IQuotationPdfJobPayload => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const hasIdentifiers =
    'operationId' in value &&
    identifier(value.operationId) &&
    'cycleId' in value &&
    identifier(value.cycleId);
  const hasSourceHash =
    'sourceHash' in value &&
    typeof value.sourceHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sourceHash);
  const hasGeneration =
    'generation' in value &&
    typeof value.generation === 'number' &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1;
  const hasDocument =
    'document' in value && isQuotationPdfPayload(value.document);
  const allowedKeys = [
    'operationId',
    'cycleId',
    'sourceHash',
    'generation',
    'document',
  ];
  const hasOnlyKnownKeys = Object.keys(value).every((key): boolean =>
    allowedKeys.includes(key),
  );
  return (
    hasIdentifiers &&
    hasSourceHash &&
    hasGeneration &&
    hasDocument &&
    hasOnlyKnownKeys
  );
};

export const validateQuotationPdfJobPayload = (
  value: unknown,
): IQuotationPdfJobPayload => {
  if (!isQuotationPdfJobPayload(value)) {
    throw new JobError(JOB_ERROR.INVALID, false);
  }

  return value;
};

export const quotationPdfCorrelation = (
  payload: IQuotationPdfJobPayload,
): IQuotationPdfCorrelation => ({
  cycleId: payload.cycleId,
  sourceHash: payload.sourceHash,
  generation: payload.generation,
  operationId: payload.operationId,
});
