import type {
  IQuotationPdfJobResult,
  IQuotationPdfCorrelation,
} from './quotation-pdf.interface.js';

import type { JobDto } from '../dto/job.dto.js';
import type { WORKER, JOB_STATUS } from '../constants/worker.constant.js';

export interface IReportPayload {
  rows: string[][];
  headers: string[];
}

export interface IReportResult {
  csv: string;
  rowCount: number;
  contentType: string;
}

export interface IJobResult {
  jobId: string;
  version: number;
  jobType: string;
  attempt: number;
  tenantId: string;
  completedAt: string;
  error: string | null;
  correlation?: IQuotationPdfCorrelation;
  status: (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
  output: IReportResult | IQuotationPdfJobResult | null;
}

export interface IJobTransport {
  acknowledge: () => void;
  publishRetry: (job: JobDto) => Promise<void>;
  publishFailure: (failure: object) => Promise<void>;
  publishResult: (result: IJobResult) => Promise<void>;
}

export interface IJobOutcome {
  retryable: boolean;
  error: string | null;
  output: IReportResult | IQuotationPdfJobResult | null;
}

export interface IHealthResponse {
  status: 'ok' | 'ready';
}

export interface IQueueNames {
  jobs: string;
  results: string;
  pdfJobs: string;
  failures: string;
  pdfResults: string;
}

export type WorkerJobType = typeof WORKER.JOB_TYPE | typeof WORKER.PDF_JOB_TYPE;
