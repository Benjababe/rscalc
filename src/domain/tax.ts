/**
 * Grand Exchange tax.
 *
 * Source: https://oldschool.runescape.wiki/w/Tax
 *
 *  - 2% of the sale price
 *  - capped at 5,000,000 gp per item
 *  - items selling for under 50 gp are exempt
 *  - rounded down to the nearest gp
 *
 * Introduced 26 January 2022.
 */

export const GE_TAX_RATE = 0.02;
export const GE_TAX_CAP = 5_000_000;
export const GE_TAX_EXEMPT_BELOW = 50;

/** Tax owed on a single item sold at `price`. */
export function geTax(price: number): number {
  if (!Number.isFinite(price) || price < GE_TAX_EXEMPT_BELOW) return 0;
  return Math.min(GE_TAX_CAP, Math.floor(price * GE_TAX_RATE));
}

/** What the seller actually receives for one item listed at `price`. */
export function netProceeds(price: number): number {
  return price - geTax(price);
}
