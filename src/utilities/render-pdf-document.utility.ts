import puppeteer from 'puppeteer-core';
import { JobError } from '../errors/job.error.js';
import { TIME } from '../constants/time.constant.js';
import { TypedLogger } from '../logger/logger.service.js';
import { JOB_ERROR, WORKER } from '../constants/worker.constant.js';
import type { IQuotationPdfResult } from '../interfaces/quotation-pdf.interface.js';

interface IPdfDocument {
  html: string;
  header: string | null;
}

export const renderPdfDocument = async (
  document: IPdfDocument,
  signal: AbortSignal,
): Promise<IQuotationPdfResult> => {
  signal.throwIfAborted();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
    handleSIGINT: false,
    handleSIGHUP: false,
    handleSIGTERM: false,
    timeout: 10 * TIME.SECOND_MS,
  });
  const child = browser.process();
  const terminated = Promise.withResolvers<void>();
  const logger = new TypedLogger('QuotationPdfRenderer');
  const terminate = (): void => {
    try {
      child?.kill('SIGKILL');
    } catch {
      logger.warn({
        message:
          'Owned Chromium process was already unavailable during termination',
      });
    } finally {
      terminated.resolve();
    }
  };
  signal.addEventListener('abort', terminate, { once: true });
  if (signal.aborted) {
    terminate();
  }

  try {
    signal.throwIfAborted();
    const page = await browser.newPage();
    page.setDefaultTimeout(10 * TIME.SECOND_MS);
    await page.setRequestInterception(true);
    page.on('request', (request) => request.abort());
    await page.setContent(document.html);
    await page.evaluate('document.fonts.ready');
    const pdf = await page.pdf({
      timeout: 80 * TIME.SECOND_MS,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: document.header !== null,
      headerTemplate: document.header ?? '',
      footerTemplate: '<span></span>',
      margin: {
        top: document.header === null ? '12mm' : '60mm',
        bottom: '12mm',
        left: '10mm',
        right: '10mm',
      },
    });
    if (pdf.length > WORKER.MAX_PDF_BYTES) {
      throw new JobError(JOB_ERROR.RESULT_TOO_LARGE, false);
    }

    return {
      pdfBase64: Buffer.from(pdf).toString('base64'),
      contentType: WORKER.PDF_CONTENT_TYPE,
    };
  } finally {
    try {
      await Promise.race([browser.close(), terminated.promise]);
    } catch {
      if (!signal.aborted) {
        terminate();
      }

      logger.warn({
        message: 'Chromium cleanup failed; owned process termination requested',
      });
    } finally {
      signal.removeEventListener('abort', terminate);
    }
  }
};
