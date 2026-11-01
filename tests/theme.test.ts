/**
 * Structural checks on the palette.
 *
 * The light theme only works if both blocks define exactly the same tokens: a
 * token missing from the light block silently keeps its dark value, which is the
 * kind of bug nobody notices until something looks wrong on a white page. The
 * same gap lets a stray literal bypass theming entirely.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');

/** Token declarations between a selector and its closing brace. */
function tokensFrom(source: string, selector: string): Map<string, string> {
  const start = source.indexOf(selector);
  expect(start, `${selector} missing`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}', start);
  const body = source.slice(start, end);
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) tokens.set(name, value.trim());
  }
  return tokens;
}

const DARK = tokensFrom(CSS, ':root {');
const LIGHT = tokensFrom(CSS, ':root[data-theme="light"] {');

describe('the palette', () => {
  it('keys the light theme off the attribute, not the OS preference', () => {
    // The site opens dark whatever the operating system says; the header toggle
    // decides. A stray media query would quietly override that.
    expect(CSS).toContain(':root[data-theme="light"]');
    expect(CSS).not.toMatch(/@media[^{]*prefers-color-scheme/);
  });

  it('defines a real set of tokens', () => {
    expect(DARK.size).toBeGreaterThan(20);
  });

  it('defines the same tokens in both themes', () => {
    expect([...LIGHT.keys()].sort()).toEqual([...DARK.keys()].sort());
  });

  it('gives every token its own light value', () => {
    // A token copied unchanged into the light block is a dark colour leaking
    // onto a white page, so none may be shared.
    const shared = [...DARK.keys()].filter(
      (name) => DARK.get(name) === LIGHT.get(name),
    );
    expect(shared).toEqual([]);
  });

  it('uses only variables outside the two token blocks', () => {
    const withoutTokens = CSS.replace(/:root(\[[^\]]*\])? \{[\s\S]*?\n\}/g, '');
    const literals = [
      ...withoutTokens.matchAll(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g),
    ].map((match) => match[0]);
    expect(literals).toEqual([]);
  });

  it('never references a token it does not define', () => {
    const used = new Set(
      [...CSS.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]),
    );
    for (const name of used) {
      expect(DARK.has(name as string), `${String(name)} is undefined`).toBe(true);
    }
  });

  it('never defines a token it does not use', () => {
    const used = new Set(
      [...CSS.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]),
    );
    for (const name of DARK.keys()) {
      expect(used.has(name), `${name} is unused`).toBe(true);
    }
  });

  it('keeps the readable accent for text and the fill for surfaces', () => {
    // `--accent-text` exists because gold text fails contrast on white. Using it
    // as a background would put near-black gold behind dark text.
    for (const match of CSS.matchAll(/([a-z-]+):\s*var\(--accent-text\);/g)) {
      expect(match[1], 'accent-text used as a non-text colour').toBe('color');
    }
  });
});
