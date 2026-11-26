import Joi from 'joi';
import { join } from 'node:path';
import { imageSize } from 'image-size';
import { readFile } from 'node:fs/promises';
import { renderPdfDocument } from '../utilities/render-pdf-document.utility.js';
import type { IQuotationPdfResult } from '../interfaces/quotation-pdf.interface.js';

const DOCUMENT_KIND = { SKETCH: 'sketch', PROPOSAL: 'proposal' } as const;
const IMAGE_FORMAT = { 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
const MAX_PLAN_PIXELS = 16_000_000;

interface IEstimatePdfLine {
  sku: string;
  unit: string;
  total: string;
  areaName: string;
  quantity: string;
  unitPrice: string;
  description: string;
}

interface IEstimatePdfPlan {
  name: string;
  base64: string;
  areaName: string;
  mimeType: keyof typeof IMAGE_FORMAT;
}

export interface IEstimatePdfPayload {
  vat: string;
  name: string;
  total: string;
  subtotal: string;
  revision: number;
  adjustment?: string;
  documentDate?: string;
  paymentTerms?: string[];
  lines: IEstimatePdfLine[];
  projectName: string | null;
  scopeLabel?: string | null;
  customerName: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  markedPlans: IEstimatePdfPlan[];
  kind: (typeof DOCUMENT_KIND)[keyof typeof DOCUMENT_KIND];
}

const label = Joi.string().max(500).required();
const numberText = Joi.string()
  .max(24)
  .pattern(/^\d+(?:\.\d{1,6})?$/)
  .required();
const plan = Joi.object({
  areaName: label,
  mimeType: Joi.string()
    .valid(...Object.keys(IMAGE_FORMAT))
    .required(),
  base64: Joi.string().max(1_400_000).base64().required(),
  name: label,
});
const estimatePdfSchema = Joi.object<IEstimatePdfPayload>({
  kind: Joi.string()
    .valid(...Object.values(DOCUMENT_KIND))
    .required(),
  name: label,
  projectName: label.allow(null),
  customerName: label.allow(null),
  contactName: label.optional().allow(null),
  contactPhone: label.optional().allow(null),
  scopeLabel: label.optional().allow(null),
  paymentTerms: Joi.array().max(32).items(Joi.string().max(1200)).optional(),
  lines: Joi.array()
    .max(1500)
    .min(1)
    .items(
      Joi.object({
        areaName: label,
        sku: label,
        description: label,
        unit: label,
        quantity: numberText,
        unitPrice: numberText,
        total: numberText,
      }),
    )
    .required(),
  adjustment: Joi.string()
    .max(24)
    .pattern(/^-?\d+(?:\.\d{1,6})?$/)
    .optional(),
  documentDate: label.optional(),
  subtotal: numberText,
  vat: numberText,
  total: numberText,
  revision: Joi.number().integer().min(1).required(),
  markedPlans: Joi.array()
    .max(4)
    .items(plan)
    .required()
    .when('kind', {
      is: DOCUMENT_KIND.SKETCH,
      then: Joi.array().min(1),
      otherwise: Joi.array().max(0),
    }),
}).required();

const hasBoundedDimensions = (plan: IEstimatePdfPlan): boolean => {
  try {
    const { type, width, height } = imageSize(
      Buffer.from(plan.base64, 'base64'),
    );
    return (
      type === IMAGE_FORMAT[plan.mimeType] &&
      width > 0 &&
      height > 0 &&
      width * height <= MAX_PLAN_PIXELS
    );
  } catch {
    return false;
  }
};

export const isEstimatePdfPayload = (
  input: unknown,
): input is IEstimatePdfPayload => {
  const result = estimatePdfSchema.validate(input, { convert: false });
  return (
    result.error == null && result.value.markedPlans.every(hasBoundedDimensions)
  );
};

const escape = (value: string | null): string =>
  (value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? '',
  );

const estimateRow = (line: IEstimatePdfLine): string => `
  <tr><td>${escape(line.areaName)}</td><td><bdi>${escape(line.sku)}</bdi></td>
  <td>${escape(line.description)}</td><td><bdi>${escape(line.quantity)}</bdi> ${escape(line.unit)}</td>
  <td><bdi>${escape(line.unitPrice)} ₪</bdi></td><td><bdi>${escape(line.total)} ₪</bdi></td></tr>`;

const sketchPlan = (plan: IEstimatePdfPlan): string => `
  <figure><figcaption>${escape(plan.areaName)} · ${escape(plan.name)}</figcaption>
  <img src="data:${plan.mimeType};base64,${plan.base64}" alt=""/></figure>`;

export const renderEngineeringEstimatePdf = async (
  payload: IEstimatePdfPayload,
  signal: AbortSignal,
): Promise<IQuotationPdfResult> => {
  const isSketch = payload.kind === DOCUMENT_KIND.SKETCH;
  const [font, logo] = await Promise.all([
    readFile(
      join(
        process.cwd(),
        'node_modules/@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff2',
      ),
    ),
    readFile(join(process.cwd(), 'assets/genair-logo.png')),
  ]);
  const heading = isSketch ? 'סקיצה לאישור' : 'הצעת מחיר מיזוג אוויר';
  const plans = isSketch ? payload.markedPlans.map(sketchPlan).join('') : '';
  const metadata = [
    payload.customerName,
    payload.projectName,
    payload.documentDate ?? null,
    `מהדורה ${payload.revision}`,
  ]
    .filter((part): part is string => part !== null)
    .map(escape)
    .join(' · ');
  const contact = [payload.contactName, payload.contactPhone]
    .filter((part): part is string => typeof part === 'string')
    .map(escape)
    .join(' · ');
  const scope = escape(payload.scopeLabel ?? null);
  const paymentTerms = (payload.paymentTerms ?? [])
    .map((term) => `<li>${escape(term)}</li>`)
    .join('');
  const terms = paymentTerms
    ? `<section><h2>תנאי תשלום</h2><ul>${paymentTerms}</ul></section>`
    : '';
  const adjustmentAmount = payload.adjustment ?? '0';
  const adjustmentValue = Number(adjustmentAmount);
  const adjustmentLabel = adjustmentValue < 0 ? 'תוספת' : 'הנחה';
  const adjustment =
    adjustmentValue === 0
      ? ''
      : `<br>${adjustmentLabel} <bdi>${escape(adjustmentAmount.replace(/^-/, ''))} ₪</bdi>`;
  const signature = isSketch
    ? ''
    : '<p>אישור הלקוח וחתימה ____________________</p>';
  const html = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><style>
    @font-face{font-family:Hebrew;src:url(data:font/woff2;base64,${font.toString('base64')})}
    body{font:10pt Hebrew,Arial,sans-serif;color:#0f172a}
    header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d7e6fb}
    header img{width:43mm} h1{font-size:18pt} table{width:100%;border-collapse:collapse}
    th,td{text-align:right;padding:2mm;border-bottom:1px solid #d7e6fb}
    th{background:#e1edfa} tr{break-inside:avoid} figure{margin:3mm 0;break-inside:avoid}
    figure img{max-width:100%;max-height:100mm;object-fit:contain} aside{margin-block:5mm}
  </style><body><header><h1>${heading}</h1><img src="data:image/png;base64,${logo.toString('base64')}" alt="GenAir"></header>
  <h2>${escape(payload.name)}</h2><p>${metadata}</p>${contact ? `<p>${contact}</p>` : ''}${scope ? `<p>${scope}</p>` : ''}
  ${plans}<table><thead><tr><th>אזור</th><th>מק״ט</th><th>תיאור</th><th>כמות</th><th>מחיר ליחידה</th><th>סה״כ</th></tr></thead>
  <tbody>${payload.lines.map(estimateRow).join('')}</tbody></table>
  <aside>סכום שורות <bdi>${escape(payload.subtotal)} ₪</bdi>${adjustment}<br>מע״מ <bdi>${escape(payload.vat)} ₪</bdi><br>
  <strong>סה״כ כולל מע״מ <bdi>${escape(payload.total)} ₪</bdi></strong></aside>${isSketch ? '' : terms}${signature}</body></html>`;
  return renderPdfDocument(
    {
      html,
      header: null,
      footer:
        '<div style="margin:0 auto;font-size:8px" dir="rtl">עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>',
    },
    signal,
  );
};
