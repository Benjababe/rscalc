import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  PAGE_LABELS,
  PAGES,
  pageHash,
  parsePageHash,
} from '../web/src/route.js';

describe('parsePageHash', () => {
  it('defaults to the shop -> GE page', () => {
    for (const hash of ['', '#', '#/', '#nonsense', '#/not-a-page']) {
      expect(parsePageHash(hash)).toBe(DEFAULT_PAGE);
    }
  });

  it('recognises the GE -> shop page with or without the slash', () => {
    for (const hash of [
      '#/ge-to-shop',
      '#ge-to-shop',
      '#/ge-to-shop/',
      '#/GE-TO-SHOP',
      '  #/ge-to-shop  ',
    ]) {
      expect(parsePageHash(hash)).toBe('ge-to-shop');
    }
  });

  it('ignores the view query string that follows the page', () => {
    expect(parsePageHash('#/ge-to-shop?mode=patient&q=rune')).toBe('ge-to-shop');
    expect(parsePageHash('#/processing?sort=profit&desc=0')).toBe('processing');
    expect(parsePageHash('#/shop-to-ge?q=runite')).toBe('shop-to-ge');
  });

  it('recognises an explicit shop -> GE hash', () => {
    expect(parsePageHash('#/shop-to-ge')).toBe('shop-to-ge');
  });

  it('recognises the item processing page', () => {
    for (const hash of [
      '#/processing',
      '#processing',
      '#/processing/',
      '#/PROCESSING',
    ]) {
      expect(parsePageHash(hash)).toBe('processing');
    }
  });
});

describe('pageHash', () => {
  it('round-trips every page', () => {
    for (const page of PAGES) {
      expect(parsePageHash(pageHash(page))).toBe(page);
    }
  });

  it('names every page', () => {
    for (const page of PAGES) {
      expect(PAGE_LABELS[page].length).toBeGreaterThan(0);
    }
  });
});
