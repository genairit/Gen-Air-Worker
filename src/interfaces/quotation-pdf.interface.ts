export interface IQuotationPdfLine {
  sku: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  description: string;
  capacityBtu: number | null;
}

export interface IQuotationPdfSection {
  title: string;
  brand: string | null;
  lines: IQuotationPdfLine[];
}

export interface IQuotationPdfParty {
  name: string;
  city: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
}

export interface IQuotationPdfTerms {
  approval: string;
  general: string[];
  payment: string[];
  delivery: string[];
  warranty: string[];
  additional: string[];
  paymentStages: string[];
}

export interface IQuotationPdfPayload {
  title: string;
  number: string;
  printDate: string;
  issuerName: string;
  quotationDate: string;
  terms: IQuotationPdfTerms;
  sections: IQuotationPdfSection[];
  project: { name: string | null; address: string | null };
  recipient: IQuotationPdfParty & { customerNumber: string | null };
  company: IQuotationPdfParty & {
    businessNumber: string;
    vatFileNumber: string;
  };
  totals: {
    subtotal: string;
    discount: string;
    pretax: string;
    vatRate: string;
    vat: string;
    total: string;
  };
  metadata: {
    validUntil: string | null;
    salesAgent: string | null;
    customerTaxId: string | null;
    customerTaxLabel: string;
    vatFileNumber: string;
    revision: number;
  };
}

export interface IQuotationPdfResult {
  pdfBase64: string;
  contentType: 'application/pdf';
}
