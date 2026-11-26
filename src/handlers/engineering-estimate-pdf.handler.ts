import Joi from 'joi';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { renderPdfDocument } from '../utilities/render-pdf-document.utility.js';
import type { IQuotationPdfResult } from '../interfaces/quotation-pdf.interface.js';

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
  mimeType: 'image/png' | 'image/jpeg';
}

export interface IEstimatePdfPayload {
  vat: string;
  name: string;
  total: string;
  subtotal: string;
  revision: number;
  lines: IEstimatePdfLine[];
  projectName: string | null;
  kind: 'sketch' | 'proposal';
  customerName: string | null;
  markedPlans: IEstimatePdfPlan[];
}

const label = Joi.string().max(500).required();
const numberText = Joi.string()
  .max(24)
  .pattern(/^\d+(?:\.\d{1,6})?$/)
  .required();
const plan = Joi.object({
  mimeType: Joi.string().valid('image/png', 'image/jpeg').required(),
  base64: Joi.string().max(1_400_000).base64().required(),
  name: label,
});
const estimatePdfSchema = Joi.object<IEstimatePdfPayload>({
  kind: Joi.string().valid('sketch', 'proposal').required(),
  name: label,
  projectName: label.allow(null),
  customerName: label.allow(null),
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
  subtotal: numberText,
  vat: numberText,
  total: numberText,
  revision: Joi.number().integer().min(1).required(),
  markedPlans: Joi.array().max(4).items(plan).required(),
}).required();

export const isEstimatePdfPayload = (
  input: unknown,
): input is IEstimatePdfPayload =>
  estimatePdfSchema.validate(input, { convert: false }).error === undefined;

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
  <figure><figcaption>${escape(plan.name)}</figcaption>
  <img src="data:${plan.mimeType};base64,${plan.base64}" alt=""/></figure>`;

export const renderEngineeringEstimatePdf = async (
  payload: IEstimatePdfPayload,
  signal: AbortSignal,
): Promise<IQuotationPdfResult> => {
  const isSketch = payload.kind === 'sketch';
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
    `מהדורה ${payload.revision}`,
  ]
    .filter((part): part is string => part !== null)
    .map(escape)
    .join(' · ');
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
  <h2>${escape(payload.name)}</h2><p>${metadata}</p>
  ${plans}<table><thead><tr><th>אזור</th><th>מק״ט</th><th>תיאור</th><th>כמות</th><th>מחיר ליחידה</th><th>סה״כ</th></tr></thead>
  <tbody>${payload.lines.map(estimateRow).join('')}</tbody></table>
  <aside>סה״כ לפני מע״מ <bdi>${escape(payload.subtotal)} ₪</bdi><br>מע״מ <bdi>${escape(payload.vat)} ₪</bdi><br>
  <strong>סה״כ כולל מע״מ <bdi>${escape(payload.total)} ₪</bdi></strong></aside>${signature}</body></html>`;
  return renderPdfDocument({ html, header: null }, signal);
};
