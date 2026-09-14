const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatPrice(priceCents: number, currency: string): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(priceCents / 100);
}
