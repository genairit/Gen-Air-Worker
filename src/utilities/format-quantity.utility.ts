const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;

export const formatQuantity = (value: string): string =>
  PLAIN_DECIMAL.test(value) && value.includes('.')
    ? value.replace(/0+$/, '').replace(/\.$/, '')
    : value;
