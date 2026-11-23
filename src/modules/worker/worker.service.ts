import {
  WORKER,
  JOB_ERROR,
  JOB_STATUS,
} from '../../constants/worker.constant.js';

import type {
  IJobResult,
  IJobOutcome,
  WorkerJobType,
  IJobTransport,
} from '../../interfaces/worker.interface.js';

import {
  quotationPdfCorrelation,
  validateQuotationPdfJobPayload,
} from '../../utilities/quotation-pdf-job.utility.js';

import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JobService } from './job.service.js';
import { JobDto } from '../../dto/job.dto.js';
import { JobError } from '../../errors/job.error.js';
import { setTimeout as delay } from 'node:timers/promises';
import { TypedLogger } from '../../logger/logger.service.js';
import { parseJob, classifyJobError } from '../../utilities/job.utility.js';
import { QuotationPdfRenderService } from './quotation-pdf-render.service.js';
import type { IQuotationPdfJobResult } from '../../interfaces/quotation-pdf.interface.js';

@Injectable()
export class WorkerService {
  private readonly logger = new TypedLogger(WorkerService.name);

  constructor(
    private readonly jobs: JobService,
    private readonly pdf: QuotationPdfRenderService,
  ) {}

  process = async (
    content: Buffer,
    transport: IJobTransport,
    expectedType: WorkerJobType | null = null,
  ): Promise<void> => {
    const job = this.readJob(content, expectedType);
    if (!job) {
      await transport.publishFailure({
        version: WORKER.VERSION,
        error: JOB_ERROR.INVALID,
        contentSha256: createHash('sha256').update(content).digest('hex'),
      });
      transport.acknowledge();
      this.logger.warn({ message: 'Invalid job quarantined' });
      return;
    }

    this.logger.info({
      message: 'Job started',
      jobId: job.jobId,
      attempt: job.attempt,
    });
    const result = await this.execute(job);
    if (result.error && result.retryable && job.attempt < WORKER.MAX_ATTEMPTS) {
      await delay(WORKER.RETRY_DELAY_MS * job.attempt);
      await transport.publishRetry({ ...job, attempt: job.attempt + 1 });
      transport.acknowledge();
      this.logger.warn({
        message: 'Job retry scheduled',
        jobId: job.jobId,
        attempt: job.attempt,
      });
      return;
    }

    const correlation = this.correlation(job);
    const terminal: IJobResult = {
      ...correlation,
      version: WORKER.VERSION,
      jobId: job.jobId,
      tenantId: job.tenantId,
      jobType: job.jobType,
      attempt: job.attempt,
      completedAt: new Date().toISOString(),
      status: result.error ? JOB_STATUS.FAILED : JOB_STATUS.SUCCEEDED,
      output: result.output,
      error: result.error,
    };
    await transport.publishResult(terminal);
    if (result.error) {
      await transport.publishFailure({ job, result: terminal });
    }

    transport.acknowledge();
    this.logger.info({
      message: 'Job completed',
      jobId: job.jobId,
      status: terminal.status,
    });
  };

  private readJob = (
    content: Buffer,
    expectedType: WorkerJobType | null,
  ): JobDto | null => {
    try {
      const job = parseJob(content);
      const isWrongQueue =
        expectedType !== null && job.jobType !== expectedType;
      return isWrongQueue ? null : job;
    } catch {
      return null;
    }
  };

  private correlation = (job: JobDto): Pick<IJobResult, 'correlation'> => {
    if (job.jobType !== WORKER.PDF_JOB_TYPE) {
      return {};
    }

    return {
      correlation: quotationPdfCorrelation(
        validateQuotationPdfJobPayload(job.payload),
      ),
    };
  };

  private executePdf = async (job: JobDto): Promise<IQuotationPdfJobResult> => {
    const payload = validateQuotationPdfJobPayload(job.payload);
    const bytes = await this.pdf.render(payload.document);
    const output: IQuotationPdfJobResult = {
      ...quotationPdfCorrelation(payload),
      pdfBase64: bytes.toString('base64'),
      contentType: WORKER.PDF_CONTENT_TYPE,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const outputBytes = Buffer.byteLength(JSON.stringify(output));
    const isTooLarge =
      bytes.length > WORKER.MAX_PDF_BYTES ||
      outputBytes >
        WORKER.MAX_PDF_RESULT_BYTES - WORKER.PDF_RESULT_ENVELOPE_BYTES;
    if (isTooLarge) {
      throw new JobError(JOB_ERROR.RESULT_TOO_LARGE, false);
    }

    return output;
  };

  private execute = async (job: JobDto): Promise<IJobOutcome> => {
    try {
      const execute = {
        [WORKER.JOB_TYPE]: (): Promise<IJobOutcome['output']> =>
          this.jobs.execute(job.payload),
        [WORKER.PDF_JOB_TYPE]: (): Promise<IJobOutcome['output']> =>
          this.executePdf(job),
      };
      const renderer = execute[job.jobType];
      if (!renderer) {
        throw new Error('Unsupported job type');
      }

      const output = await renderer();
      return { output, error: null, retryable: false };
    } catch (error) {
      const failure = classifyJobError(error);
      return {
        output: null,
        error: failure.code,
        retryable: failure.retryable,
      };
    }
  };
}
