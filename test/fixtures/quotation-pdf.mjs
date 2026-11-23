const party = {
  name: 'לקוח',
  address: null,
  city: null,
  email: null,
  phone: null,
};
export const payload = {
  number: 'Q1',
  title: 'הצעת מחיר',
  quotationDate: '10/11/2026',
  printDate: '10/11/2026',
  issuerName: 'דנה כהן',
  company: { ...party, businessNumber: '123', vatFileNumber: '123' },
  recipient: { ...party, customerNumber: null },
  project: { name: null, address: null },
  metadata: {
    validUntil: null,
    salesAgent: null,
    customerTaxId: null,
    customerTaxLabel: 'מס׳ חברה:',
    vatFileNumber: '123',
    revision: 1,
  },
  sections: [
    {
      title: 'מיזוג',
      brand: null,
      lines: [
        {
          sku: 'A',
          unit: 'יח׳',
          quantity: '1',
          description: 'מזגן',
          unitPrice: '100',
          totalPrice: '100',
          capacityBtu: null,
        },
      ],
    },
  ],
  totals: {
    subtotal: '100',
    discount: '0',
    pretax: '100',
    vatRate: '18',
    vat: '18',
    total: '118',
  },
  terms: {
    general: [],
    payment: [],
    paymentStages: [],
    delivery: [],
    warranty: [],
    additional: [],
    approval: 'אישור',
  },
};
