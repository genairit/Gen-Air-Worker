import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { renderQuotationPdf } from '../../handlers/quotation-pdf.handler.js';
import type { IQuotationPdfPayload } from '../../interfaces/quotation-pdf.interface.js';

@Injectable()
export class QuotationPdfRenderService {
  private rendering = false;

  async render(payload: IQuotationPdfPayload): Promise<Buffer> {
    if (this.rendering) {
      throw new ServiceUnavailableException('Quotation PDF renderer is busy');
    }

    this.rendering = true;
    try {
      const result = await renderQuotationPdf(payload);
      return Buffer.from(result.pdfBase64, 'base64');
    } finally {
      this.rendering = false;
    }
  }
}
