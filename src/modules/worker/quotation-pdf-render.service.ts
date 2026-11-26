import {
  type IEstimatePdfPayload,
  renderEngineeringEstimatePdf,
} from '../../handlers/engineering-estimate-pdf.handler.js';

import { JobError } from '../../errors/job.error.js';
import { JOB_ERROR, WORKER } from '../../constants/worker.constant.js';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { renderQuotationPdf } from '../../handlers/quotation-pdf.handler.js';
import type { IQuotationPdfResult } from '../../interfaces/quotation-pdf.interface.js';
import type { IQuotationPdfPayload } from '../../interfaces/quotation-pdf.interface.js';

@Injectable()
export class QuotationPdfRenderService {
  private rendering = false;

  render = (payload: IQuotationPdfPayload): Promise<Buffer> =>
    this.renderBounded((signal) => renderQuotationPdf(payload, signal));

  renderEstimate = (payload: IEstimatePdfPayload): Promise<Buffer> =>
    this.renderBounded((signal) =>
      renderEngineeringEstimatePdf(payload, signal),
    );

  private async renderBounded(
    render: (signal: AbortSignal) => Promise<IQuotationPdfResult>,
  ): Promise<Buffer> {
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
      const result = await render(controller.signal);
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
  }
}
