import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  clampPage,
  pageBounds,
  pageCountFor,
  pageWindow,
} from '../web/src/paging.js';

describe('pageCountFor', () => {
  it('always reports at least one page', () => {
    expect(pageCountFor(0, 100)).toBe(1);
    expect(pageCountFor(-5, 100)).toBe(1);
    expect(pageCountFor(100, 0)).toBe(1);
  });

  it('rounds a partial page up', () => {
    expect(pageCountFor(100, 100)).toBe(1);
    expect(pageCountFor(101, 100)).toBe(2);
    expect(pageCountFor(1909, 100)).toBe(20);
    expect(pageCountFor(2151, 100)).toBe(22);
  });
});

describe('clampPage', () => {
  it('keeps the page inside the list', () => {
    expect(clampPage(1, 20)).toBe(1);
    expect(clampPage(20, 20)).toBe(20);
    expect(clampPage(0, 20)).toBe(1);
    expect(clampPage(99, 20)).toBe(20);
    expect(clampPage(-3, 20)).toBe(1);
  });

  it('survives a NaN page', () => {
    expect(clampPage(Number.NaN, 20)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 20)).toBe(20);
  });
});

describe('pageBounds', () => {
  it('covers every row exactly once across the pages', () => {
    const total = 1909;
    const seen: number[] = [];
    for (let page = 1; page <= pageCountFor(total, 100); page += 1) {
      const bounds = pageBounds(total, page, 100);
      for (let index = bounds.start; index <= bounds.end; index += 1) {
        seen.push(index);
      }
    }
    expect(seen).toHaveLength(total);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(total);
    expect(new Set(seen).size).toBe(total);
  });

  it('reports the first and last page ranges', () => {
    expect(pageBounds(1909, 1, 100)).toEqual({
      page: 1,
      pageCount: 20,
      start: 1,
      end: 100,
    });
    expect(pageBounds(1909, 20, 100)).toEqual({
      page: 20,
      pageCount: 20,
      start: 1901,
      end: 1909,
    });
  });

  it('clamps a page past the end instead of showing nothing', () => {
    expect(pageBounds(1909, 99, 100)).toEqual({
      page: 20,
      pageCount: 20,
      start: 1901,
      end: 1909,
    });
  });

  it('reports an empty range for an empty result set', () => {
    expect(pageBounds(0, 1, 100)).toEqual({
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
    });
  });

  it('handles a list shorter than one page', () => {
    expect(pageBounds(7, 1, 100)).toEqual({
      page: 1,
      pageCount: 1,
      start: 1,
      end: 7,
    });
  });
});

describe('pageWindow', () => {
  it('lists every page when they all fit', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('always shows the first and last page', () => {
    const middle = pageWindow(10, 20);
    expect(middle[0]).toBe(1);
    expect(middle.at(-1)).toBe(20);
    expect(middle).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('keeps the window near the start', () => {
    expect(pageWindow(2, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
  });

  it('keeps the window near the end', () => {
    expect(pageWindow(19, 20)).toEqual([1, 'gap', 17, 18, 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 17, 18, 19, 20]);
  });

  it('clamps an out-of-range page before selecting the window', () => {
    expect(pageWindow(999, 20)).toEqual([1, 'gap', 17, 18, 19, 20]);
    expect(pageWindow(0, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
  });
});

describe('page sizes', () => {
  it('offers 50, 100 and 250 rows and defaults to 100', () => {
    expect([...PAGE_SIZES]).toEqual([50, 100, 250]);
    expect(DEFAULT_PAGE_SIZE).toBe(100);
    expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
  });
});
