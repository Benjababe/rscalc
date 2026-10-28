import { describe, expect, it } from 'vitest';
import { wikiUrl } from '../src/util/wiki.js';

describe('wikiUrl', () => {
  it('uses underscores for spaces', () => {
    expect(wikiUrl('Varrock General Store')).toBe(
      'https://oldschool.runescape.wiki/w/Varrock_General_Store',
    );
  });

  it("preserves the trailing full stop that is part of the page name", () => {
    // "Bob's Brilliant Axes." really is the page title, full stop included.
    expect(wikiUrl("Bob's Brilliant Axes.")).toBe(
      "https://oldschool.runescape.wiki/w/Bob's_Brilliant_Axes.",
    );
  });

  it('leaves apostrophes unencoded', () => {
    expect(wikiUrl("Aubury's Rune Shop.")).toContain("Aubury's_Rune_Shop.");
  });

  it('preserves ~ decorations used by some shops', () => {
    expect(wikiUrl("~ Uglug's stuffsies ~")).toBe(
      "https://oldschool.runescape.wiki/w/~_Uglug's_stuffsies_~",
    );
  });

  it('encodes characters that would break the URL path', () => {
    const url = wikiUrl('Shop & Bar / #1?');
    expect(url).toContain('%26'); // &
    expect(url).toContain('%2F'); // /
    expect(url).toContain('%23'); // #
    expect(url).toContain('%3F'); // ?
    // Critically, the path must not gain a second path segment or query.
    const path = url.slice('https://oldschool.runescape.wiki/w/'.length);
    expect(path).not.toContain('/');
    expect(path).not.toContain('?');
  });

  it('encodes parentheses-free titles unchanged and trims stray whitespace', () => {
    expect(wikiUrl('  General Store (Canifis)  ')).toBe(
      'https://oldschool.runescape.wiki/w/General_Store_(Canifis)',
    );
  });

  it('always produces an absolute wiki URL', () => {
    expect(wikiUrl('Anything')).toMatch(/^https:\/\/oldschool\.runescape\.wiki\/w\/\S+$/);
  });
});
