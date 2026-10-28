import { describe, expect, it } from 'vitest';
import { geTax, netProceeds } from '../src/domain/tax.js';

describe('GE tax', () => {
  it('exempts items below 50 gp', () => {
    expect(geTax(0)).toBe(0);
    expect(geTax(1)).toBe(0);
    expect(geTax(49)).toBe(0);
  });

  it('charges 2% from exactly 50 gp', () => {
    expect(geTax(50)).toBe(1); // floor(1.0)
    expect(geTax(51)).toBe(1); // floor(1.02)
    expect(geTax(100)).toBe(2);
    expect(geTax(1234)).toBe(24); // floor(24.68)
  });

  it('caps at 5,000,000 gp per item', () => {
    // 250m * 2% is exactly the cap.
    expect(geTax(250_000_000)).toBe(5_000_000);
    // Above the cap it stays capped.
    expect(geTax(300_000_000)).toBe(5_000_000);
    expect(geTax(2_147_483_647)).toBe(5_000_000);
  });

  it('rounds down, never up', () => {
    // 99 * 2% = 1.98 -> 1
    expect(geTax(99)).toBe(1);
    // 149 * 2% = 2.98 -> 2
    expect(geTax(149)).toBe(2);
  });

  it('nets proceeds after tax', () => {
    expect(netProceeds(1000)).toBe(980);
    expect(netProceeds(49)).toBe(49);
    expect(netProceeds(300_000_000)).toBe(295_000_000);
  });

  it('handles non-finite input defensively', () => {
    expect(geTax(Number.NaN)).toBe(0);
    expect(geTax(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
