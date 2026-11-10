import type {
  IQuotationPdfLine,
  IQuotationPdfParty,
  IQuotationPdfResult,
  IQuotationPdfPayload,
} from '../interfaces/quotation-pdf.interface.js';

import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
import { JobError } from '../errors/job.error.js';
import { JOB_ERROR, WORKER } from '../constants/worker.constant.js';
import { validateQuotationPdfPayload } from '../utilities/quotation-pdf.utility.js';

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );

const text = (value: string | null): string => escapeHtml(value ?? '');

const detail = (label: string, value: string | null): string =>
  value
    ? `<div><strong>${escapeHtml(label)}</strong> ${text(value)}</div>`
    : '';

const party = (value: IQuotationPdfParty): string =>
  [
    `<strong>${text(value.name)}</strong>`,
    text(value.address),
    text(value.city),
    text(value.email),
    detail('טלפון:', value.phone),
  ]
    .filter(Boolean)
    .map((line) => `<div>${line}</div>`)
    .join('');

const companyDetails = (payload: IQuotationPdfPayload): string =>
  [
    `<strong>${text(payload.company.name)}</strong>`,
    text(payload.company.address),
    text(payload.company.city),
    detail('טלפון:', payload.company.phone),
    detail('עוסק מורשה:', payload.company.businessNumber),
    detail('מספר תיק במע״מ:', payload.company.vatFileNumber),
  ]
    .filter(Boolean)
    .map((line) => `<div>${line}</div>`)
    .join('');

const row = (line: IQuotationPdfLine): string => `
  <tr><td><bdi>${text(line.sku)}</bdi></td><td>${text(line.description)}</td>
  <td><bdi>${line.capacityBtu === null ? '' : `${line.capacityBtu.toLocaleString('en-US')} BTU`}</bdi></td>
  <td><bdi>${text(line.quantity)} ${text(line.unit)}</bdi></td>
  <td><bdi>${text(line.unitPrice)} ₪</bdi></td><td><bdi>${text(line.totalPrice)} ₪</bdi></td></tr>`;

const terms = (title: string, paragraphs: string[]): string =>
  paragraphs.length === 0
    ? ''
    : `<section class="term"><h2>${title}</h2>${paragraphs.map((paragraph) => `<p>${text(paragraph)}</p>`).join('')}</section>`;

const renderSections = (payload: IQuotationPdfPayload): string =>
  payload.sections
    .map(
      (section) => `
    <tr class="section-row"><td colspan="6">${text([section.brand, section.title].filter(Boolean).join(' · '))}</td></tr>
    ${section.lines.map(row).join('')}`,
    )
    .join('');

const renderMetadata = (payload: IQuotationPdfPayload): string =>
  [
    detail('בתוקף עד:', payload.metadata.validUntil),
    detail('סוכן:', payload.metadata.salesAgent),
    detail('מס. לקוח:', payload.recipient.customerNumber),
    detail(payload.metadata.customerTaxLabel, payload.metadata.customerTaxId),
    detail('מספר תיק במע״מ:', payload.metadata.vatFileNumber),
    detail('מהדורה נוכחית:', String(payload.metadata.revision)),
  ].join('');

const renderSummary = (payload: IQuotationPdfPayload): string => `
  <div class="summary"><div class="metadata">${renderMetadata(payload)}</div><div class="totals">
    <div><span>סכום ביניים</span><bdi>${text(payload.totals.subtotal)} ₪</bdi></div>
    <div><span>הנחה / התאמה</span><bdi>${text(payload.totals.discount)} ₪</bdi></div>
    <div><span>מחיר לפני מע״מ</span><bdi>${text(payload.totals.pretax)} ₪</bdi></div>
    <div><span>מע״מ (${text(payload.totals.vatRate)}%)</span><bdi>${text(payload.totals.vat)} ₪</bdi></div>
    <div><span>סה״כ מחיר</span><bdi>${text(payload.totals.total)} ₪</bdi></div>
  </div></div>`;

const renderPayment = (payload: IQuotationPdfPayload): string => `
  <section class="term"><h2>תנאי תשלום</h2><ul class="payment-stages">${payload.terms.paymentStages.map((stage) => `<li>${text(stage)}</li>`).join('')}</ul>
  ${payload.terms.payment.map((paragraph) => `<p>${text(paragraph)}</p>`).join('')}</section>`;

const renderTerms = (payload: IQuotationPdfPayload): string =>
  [
    terms('תנאים כלליים', payload.terms.general),
    renderPayment(payload),
    terms('מסירה', payload.terms.delivery),
    terms('אחריות', payload.terms.warranty),
    terms('תנאים נוספים', payload.terms.additional),
  ].join('');

const renderApproval = (payload: IQuotationPdfPayload): string => `
  <section class="approval"><h2>אישור הזמנה</h2><p>${text(payload.terms.approval)}</p>
  <div class="approval-grid"><span>שם המזמין: _____________________</span><span>תאריך אישור הזמנה: _____________________</span>
  <span>מס׳ ת״ז (ח.פ.) המזמין: _____________________</span><span>חתימה: _____________________</span></div></section>`;

const renderIdentifiers = (payload: IQuotationPdfPayload): string => `
  <div class="identifiers"><div>לכבוד:<br/>${party(payload.recipient)}</div>
  <div>${text(payload.project.name)}<br/>${text(payload.project.address)}</div>
  <div>${detail('תאריך ההצעה:', payload.quotationDate)}${detail('תאריך הדפסה:', payload.printDate)}</div></div>`;

const renderHtml = (
  payload: IQuotationPdfPayload,
  hebrewFont: string,
  latinFont: string,
  styles: string,
): string => {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"/><style>
    @font-face{font-family:NotoHebrew;src:url(data:font/woff2;base64,${hebrewFont}) format('woff2');font-weight:400}
    @font-face{font-family:NotoLatin;src:url(data:font/woff2;base64,${latinFont}) format('woff2');font-weight:400}
    ${styles}
  </style></head><body>
    <table><thead><tr><th>מק״ט</th><th>תיאור מוצר</th><th>BTU</th><th>כמות</th><th>מחיר ליחידה</th><th>סה״כ מחיר</th></tr></thead><tbody>${renderSections(payload)}</tbody></table>
    ${renderSummary(payload)}${renderTerms(payload)}${renderApproval(payload)}
    <div class="signature">בברכה: ${text(payload.issuerName)}<strong>${text(payload.company.name)}</strong></div>
  </body></html>`;
};

const renderHeader = (payload: IQuotationPdfPayload, logo: string): string => `
  <style>
    .header{width:100%;margin:0 10mm;color:#111;font:7pt Arial,sans-serif;direction:rtl}
    .header *{box-sizing:border-box}.header-top{display:flex;justify-content:space-between;height:22mm}
    .company{text-align:right;line-height:1.15}.brand{text-align:left;direction:ltr}
    .brand img{display:block;width:48mm;height:auto}.brand small{font-size:6pt}
    .quotation-title{text-align:center;text-decoration:underline;font-weight:bold;font-size:10pt;white-space:nowrap}
    .identifiers{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm;height:24mm;border-top:1px solid #d7e6fb;padding-top:2mm}
    .identifiers>div:nth-child(2){text-align:center}.identifiers>div:last-child{text-align:left}
    .header bdi{direction:ltr;unicode-bidi:isolate}
  </style><div class="header"><div class="quotation-title">${text(payload.title)} מספר <bdi>${text(payload.number)}</bdi></div><div class="header-top"><div class="company">${companyDetails(payload)}</div>
  <div class="brand"><img src="data:image/png;base64,${logo}"/><small>e-mail: ${text(payload.company.email)}</small></div></div>${renderIdentifiers(payload)}</div>`;

export const renderQuotationPdf = async (
  payload: IQuotationPdfPayload,
): Promise<IQuotationPdfResult> => {
  validateQuotationPdfPayload(payload);

  const assets = join(process.cwd(), 'assets');
  const [logo, hebrewFont, latinFont, styles] = await Promise.all([
    readFile(join(assets, 'genair-logo.png')),
    readFile(
      join(
        process.cwd(),
        'node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff2',
      ),
    ),
    readFile(
      join(
        process.cwd(),
        'node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-latin-400-normal.woff2',
      ),
    ),
    readFile(join(assets, 'quotation-pdf.css'), 'utf8'),
  ]);
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
    timeout: 10_000,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.setRequestInterception(true);
    page.on('request', (request) => request.abort());
    await page.setContent(
      renderHtml(
        payload,
        hebrewFont.toString('base64'),
        latinFont.toString('base64'),
        styles,
      ),
    );
    await page.evaluate('document.fonts.ready');
    const pdf = await page.pdf({
      timeout: 80_000,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: renderHeader(payload, logo.toString('base64')),
      footerTemplate: '<span></span>',
      margin: { top: '60mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    if (pdf.length > WORKER.MAX_RESULT_BYTES) {
      throw new JobError(JOB_ERROR.RESULT_TOO_LARGE, false);
    }

    return {
      pdfBase64: Buffer.from(pdf).toString('base64'),
      contentType: 'application/pdf',
    };
  } finally {
    await browser.close();
  }
};
