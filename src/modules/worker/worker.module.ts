import { Module } from '@nestjs/common';
import { JobService } from './job.service.js';
import { QueueService } from './queue.service.js';
import { WorkerService } from './worker.service.js';
import { WorkerController } from './worker.controller.js';
import { QuotationPdfRenderService } from './quotation-pdf-render.service.js';

@Module({
  controllers: [WorkerController],
  providers: [
    JobService,
    WorkerService,
    QueueService,
    QuotationPdfRenderService,
  ],
  exports: [QueueService],
})
export class WorkerModule {}
