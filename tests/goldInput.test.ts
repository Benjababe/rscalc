import { describe, expect, it } from 'vitest';

import { formatGoldInput, parseGoldInput } from '../web/src/money.js';

describe('parseGoldInput', () => {
  it('reads plain digits', () => {
    expect(parseGoldInput('150')).toBe(150);
    expect(parseGoldInput('1000000')).toBe(1_000_000);
  });

  it('reads thousands separators and stray whitespace', () => {
    expect(parseGoldInput('1,000,000')).toBe(1_000_000);
    expect(parseGoldInput(' 1 000 000 ')).toBe(1_000_000);
    expect(parseGoldInput('1_000_000')).toBe(1_000_000);
  });

  it('expands the k/m/b shorthand in either case', () => {
    expect(parseGoldInput('100k')).toBe(100_000);
    expect(parseGoldInput('2.5m')).toBe(2_500_000);
    expect(parseGoldInput('2.5M')).toBe(2_500_000);
    expect(parseGoldInput('1b')).toBe(1_000_000_000);
    expect(parseGoldInput('1.25k')).toBe(1_250);
  });

  it('accepts a trailing gp or coins word', () => {
    expect(parseGoldInput('250k gp')).toBe(250_000);
    expect(parseGoldInput('1500000 coins')).toBe(1_500_000);
  });

  it('floors fractional coins, like every other money value', () => {
    expect(parseGoldInput('99.9')).toBe(99);
    expect(parseGoldInput('0.5k')).toBe(500);
    expect(parseGoldInput('.5k')).toBe(500);
  });

  it('treats an empty field as no budget', () => {
    expect(parseGoldInput('')).toBe(0);
    expect(parseGoldInput('   ')).toBe(0);
  });

  it('rejects anything that is not a non-negative amount', () => {
    expect(parseGoldInput('-1')).toBeNull();
    expect(parseGoldInput('abc')).toBeNull();
    expect(parseGoldInput('1.2.3')).toBeNull();
    expect(parseGoldInput('k')).toBeNull();
    expect(parseGoldInput('1kk')).toBeNull();
    expect(parseGoldInput('1,2,3.4.5')).toBeNull();
  });

  it('rejects amounts beyond safe integer precision', () => {
    expect(parseGoldInput('999999999999999b')).toBeNull();
  });
});

describe('formatGoldInput', () => {
  it('groups thousands', () => {
    expect(formatGoldInput(1_000_000)).toBe('1,000,000');
    expect(formatGoldInput(150)).toBe('150');
  });

  it('shows zero as zero, never as a blank field', () => {
    expect(formatGoldInput(0)).toBe('0');
    expect(formatGoldInput(-5)).toBe('0');
  });

  it('round-trips through the parser', () => {
    for (const value of [0, 1, 999, 1_000_000, 123_456_789]) {
      expect(parseGoldInput(formatGoldInput(value))).toBe(value);
    }
  });
});
