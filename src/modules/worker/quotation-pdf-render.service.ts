import { JobError } from '../../errors/job.error.js';
import { JOB_ERROR, WORKER } from '../../constants/worker.constant.js';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { renderQuotationPdf } from '../../handlers/quotation-pdf.handler.js';
import type { IQuotationPdfPayload } from '../../interfaces/quotation-pdf.interface.js';

@Injectable()
export class QuotationPdfRenderService {
  private rendering = false;

  render = async (payload: IQuotationPdfPayload): Promise<Buffer> => {
    if (this.rendering) {
      throw new ServiceUnavailableException('Quotation PDF renderer is busy');
    }

    this.rendering = true;
    const controller = new AbortController();
    const timeout = setTimeout(
      (): void => controller.abort(),
      WORKER.PDF_TIMEOUT_MS,
    );
    try {
      const result = await renderQuotationPdf(payload, controller.signal);
      controller.signal.throwIfAborted();
      return Buffer.from(result.pdfBase64, 'base64');
    } catch (error) {
      if (controller.signal.aborted) {
        throw new JobError(JOB_ERROR.TIMEOUT, true);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
      this.rendering = false;
    }
  };
}
