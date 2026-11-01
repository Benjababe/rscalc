import { describe, expect, it } from 'vitest';

import {
  buildViewHash,
  parseViewState,
  pickOne,
} from '../web/src/viewState.js';

describe('parseViewState', () => {
  it('reads an empty view from a plain page hash', () => {
    expect(parseViewState('')).toEqual({});
    expect(parseViewState('#/ge-to-shop')).toEqual({});
    expect(parseViewState('#/')).toEqual({});
  });

  it('reads every field', () => {
    expect(
      parseViewState(
        '#/ge-to-shop?mode=patient&sort=profit&desc=0&q=rune+plate&members=1&locked=0&minvol=250&minprofit=1000&skill=runecraft',
      ),
    ).toEqual({
      mode: 'patient',
      sort: 'profit',
      desc: false,
      q: 'rune plate',
      members: true,
      hideLocked: true,
      minVolume: 250,
      minProfit: 1000,
      skill: 'runecraft',
    });
  });

  it('treats locked=0 as "hide locked" and locked=1 as showing them', () => {
    expect(parseViewState('#/x?locked=0').hideLocked).toBe(true);
    expect(parseViewState('#/x?locked=1').hideLocked).toBe(false);
  });

  it('ignores booleans that are not 1 or 0', () => {
    expect(parseViewState('#/x?members=true')).toEqual({});
    expect(parseViewState('#/x?members=yes')).toEqual({});
    expect(parseViewState('#/x?desc=2')).toEqual({});
  });

  it('drops numbers that are negative, fractional-free junk or missing', () => {
    expect(parseViewState('#/x?minvol=-5')).toEqual({});
    expect(parseViewState('#/x?minvol=abc')).toEqual({});
    expect(parseViewState('#/x?minvol=')).toEqual({});
    expect(parseViewState('#/x?minvol=12.7')).toEqual({ minVolume: 12 });
  });

  it('ignores unknown parameters rather than guessing', () => {
    expect(parseViewState('#/x?gold=100m&nonsense=1&q=ok')).toEqual({ q: 'ok' });
  });

  it('survives a malformed query string without throwing', () => {
    expect(parseViewState('#/x?%%%')).toEqual({});
    // URLSearchParams decodes leniently rather than throwing: a broken escape
    // becomes U+FFFD, which filters to nothing like any other nonsense query.
    expect(parseViewState('#/x?q=%E0%A4%A').q).toBe('�%A');
  });
});

describe('buildViewHash', () => {
  it('keeps a clean page hash for a default view', () => {
    expect(buildViewHash('ge-to-shop', {})).toBe('#/ge-to-shop');
    expect(
      buildViewHash('shop-to-ge', {
        mode: 'pessimistic',
        q: '',
        members: false,
        hideLocked: false,
        minVolume: 0,
        minProfit: 0,
        desc: true,
        skill: 'all',
      }),
    ).toBe('#/shop-to-ge');
  });

  it('writes only the values that differ from the defaults', () => {
    expect(
      buildViewHash('ge-to-shop', { mode: 'patient', q: 'rune', members: true }),
    ).toBe('#/ge-to-shop?mode=patient&q=rune&members=1');
  });

  it('omits the default sort and records an ascending one', () => {
    expect(buildViewHash('processing', { sort: 'gpPerHour', desc: true })).toBe(
      '#/processing',
    );
  });

  it('records an ascending sort explicitly', () => {
    expect(buildViewHash('processing', { sort: 'profit', desc: false })).toBe(
      '#/processing?sort=profit&desc=0',
    );
  });

  it('trims the search text and drops whitespace-only queries', () => {
    expect(buildViewHash('ge-to-shop', { q: '  rune  ' })).toBe(
      '#/ge-to-shop?q=rune',
    );
    expect(buildViewHash('ge-to-shop', { q: '   ' })).toBe('#/ge-to-shop');
  });

  it('encodes reserved characters so the hash survives a copy and paste', () => {
    const hash = buildViewHash('shop-to-ge', { q: 'a&b=c d' });
    expect(parseViewState(hash).q).toBe('a&b=c d');
  });
});

describe('round trip', () => {
  it('parse(build(x)) returns x for a busy view', () => {
    const view = {
      mode: 'patient',
      sort: 'profit',
      desc: false,
      q: 'astral',
      members: true,
      hideLocked: true,
      minVolume: 40,
      minProfit: 5000,
      skill: 'crafting',
    } as const;
    expect(parseViewState(buildViewHash('processing', view))).toEqual(view);
  });

  it('keeps the page when only the view differs', () => {
    for (const page of ['shop-to-ge', 'ge-to-shop', 'processing'] as const) {
      expect(buildViewHash(page, { q: 'x' }).startsWith(`#/${page}?`)).toBe(true);
    }
  });
});

describe('pickOne', () => {
  const KEYS = ['gpPerHour', 'profit'] as const;

  it('returns the requested key when the page knows it', () => {
    expect(pickOne('profit', KEYS, 'gpPerHour')).toBe('profit');
  });

  it('falls back for a missing or unknown key', () => {
    expect(pickOne(undefined, KEYS, 'gpPerHour')).toBe('gpPerHour');
    expect(pickOne('bogus', KEYS, 'gpPerHour')).toBe('gpPerHour');
    expect(pickOne('', KEYS, 'gpPerHour')).toBe('gpPerHour');
  });
});
