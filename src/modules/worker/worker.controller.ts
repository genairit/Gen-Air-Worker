import {
  Get,
  Body,
  Post,
  Headers,
  HttpCode,
  Controller,
  StreamableFile,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service.js';
import { WORKER } from '../../constants/worker.constant.js';
import type { IHealthResponse } from '../../interfaces/worker.interface.js';
import { QuotationPdfRenderService } from './quotation-pdf-render.service.js';
import { isQuotationPdfPayload } from '../../utilities/quotation-pdf.utility.js';
import { isEstimatePdfPayload } from '../../handlers/engineering-estimate-pdf.handler.js';

@Controller()
export class WorkerController {
  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService,
    private readonly pdf: QuotationPdfRenderService,
  ) {}

  @Get('health/live')
  live(): IHealthResponse {
    return { status: 'ok' };
  }

  @Get('health/ready')
  ready(): IHealthResponse {
    if (!this.queue.isReady()) {
      throw new ServiceUnavailableException('Queue consumer is not ready');
    }

    return { status: 'ready' };
  }

  @Post('render/quotation-pdf')
  @HttpCode(200)
  async quotationPdf(
    @Headers('authorization') authorization: string | null,
    @Body() payload: unknown,
  ): Promise<StreamableFile> {
    this.requirePdfAuthorization(authorization);

    if (!isQuotationPdfPayload(payload)) {
      throw new BadRequestException('Invalid quotation PDF payload');
    }

    const pdf = await this.pdf.render(payload);
    return new StreamableFile(pdf, { type: WORKER.PDF_CONTENT_TYPE });
  }

  @Post('render/engineering-estimate-pdf')
  @HttpCode(200)
  async engineeringEstimatePdf(
    @Headers('authorization') authorization: string | null,
    @Body() payload: unknown,
  ): Promise<StreamableFile> {
    this.requirePdfAuthorization(authorization);

    if (!isEstimatePdfPayload(payload)) {
      throw new BadRequestException('Invalid engineering estimate PDF payload');
    }

    const pdf = await this.pdf.renderEstimate(payload);
    return new StreamableFile(pdf, { type: WORKER.PDF_CONTENT_TYPE });
  }

  private requirePdfAuthorization(authorization: string | null): void {
    const expected = Buffer.from(
      `Bearer ${this.config.getOrThrow<string>('WORKER_API_TOKEN')}`,
    );
    const received = Buffer.from(authorization ?? '');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException();
    }
  }
}
