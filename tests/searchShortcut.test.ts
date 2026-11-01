import { describe, expect, it } from 'vitest';

import { isSearchShortcut, isTypingTarget } from '../web/src/searchShortcut.js';

/** A keydown shaped the way `isSearchShortcut` reads it. */
function key(
  pressed: string,
  options: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
    target: unknown;
  }> = {},
) {
  return {
    key: pressed,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: { tagName: 'BODY' },
    ...options,
  };
}

describe('isTypingTarget', () => {
  it('treats text-entry elements as already typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
  });

  it('handles a lowercase tagName and contenteditable', () => {
    expect(isTypingTarget({ tagName: 'input' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('does not claim the page body is a typing target', () => {
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('survives a missing or exotic target', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget('body')).toBe(false);
    expect(isTypingTarget(42)).toBe(false);
    expect(isTypingTarget({})).toBe(false);
  });
});

describe('isSearchShortcut', () => {
  it('fires on a bare slash', () => {
    expect(isSearchShortcut(key('/'))).toBe(true);
  });

  it('still fires on shift+slash, which is how "/" is typed on most layouts', () => {
    expect(isSearchShortcut(key('/', { shiftKey: true }))).toBe(true);
  });

  it('fires on ctrl+k and cmd+k in either case', () => {
    expect(isSearchShortcut(key('k', { ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key('K', { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it('ignores a bare k', () => {
    expect(isSearchShortcut(key('k'))).toBe(false);
    expect(isSearchShortcut(key('K', { shiftKey: true }))).toBe(false);
  });

  it('leaves modified slashes alone', () => {
    expect(isSearchShortcut(key('/', { ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { metaKey: true }))).toBe(false);
    expect(isSearchShortcut(key('/', { altKey: true }))).toBe(false);
  });

  it('leaves ctrl+alt+k to the window manager', () => {
    expect(isSearchShortcut(key('k', { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('never steals keys from a field the player is typing in', () => {
    expect(isSearchShortcut(key('/', { target: { tagName: 'INPUT' } }))).toBe(false);
    expect(
      isSearchShortcut(key('k', { ctrlKey: true, target: { tagName: 'INPUT' } })),
    ).toBe(false);
    expect(isSearchShortcut(key('/', { target: { tagName: 'SELECT' } }))).toBe(false);
  });

  it('does not fight another handler that already claimed the key', () => {
    expect(isSearchShortcut(key('/', { defaultPrevented: true }))).toBe(false);
  });

  it('ignores every other key', () => {
    for (const pressed of ['a', 'Escape', 'Enter', '?', 'ArrowDown', 'F5']) {
      expect(isSearchShortcut(key(pressed))).toBe(false);
    }
  });
});
