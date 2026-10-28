import { describe, expect, it } from 'vitest';
import { cleanHtmlText } from '../src/api/storeBucket.js';

/**
 * The wiki renders floor numbers through a template that emits *both* the UK
 * and US conventions, hiding one with CSS. Without a stylesheet both would show,
 * so the US variant is dropped and the annotation removed.
 */
const FLOOR =
  '<span class="floornumber"><span class="floornumber-gb">1<sup class="floornumber-ordinal-suffix">st</sup>&nbsp;floor<sup class="floornumber-help noexcerpt">&#91;<span class="fact-text floor-convention" title="British convention; floor 2 in the US">UK</span>&#93;</sup></span><span class="floornumber-us noexcerpt">2<sup class="floornumber-ordinal-suffix">nd</sup>&nbsp;floor<sup class="floornumber-help noexcerpt">&#91;<span class="fact-text floor-convention" title="US convention; floor 1 in the UK">US</span>&#93;</sup></span></span>';

describe('cleanHtmlText', () => {
  it('collapses the floor-number template to the UK wording', () => {
    expect(cleanHtmlText(`${FLOOR} of Champions' Guild`)).toBe(
      "1st floor of Champions' Guild",
    );
  });

  it('removes bullet spans and turns line breaks into separators', () => {
    expect(
      cleanHtmlText(
        `<span style="user-select:none;">'''&bull;'''</span> The ${FLOOR} of the Grand Tree. <br/> <span style="user-select:none;">'''&bull;'''</span> East of the Gnomeball Field`,
      ),
    ).toBe('The 1st floor of the Grand Tree. · East of the Gnomeball Field');
  });

  it('decodes entities and strips wiki links', () => {
    expect(
      cleanHtmlText("East of [[Dark Warriors&#039; Fortress]] &amp; more"),
    ).toBe("East of Dark Warriors' Fortress & more");
  });

  it('strips plain HTML tags and wiki emphasis', () => {
    expect(cleanHtmlText("<b>Lumbridge</b> '''Castle'''")).toBe(
      'Lumbridge Castle',
    );
  });

  it('leaves ordinary text untouched', () => {
    expect(cleanHtmlText('Lumbridge')).toBe('Lumbridge');
    expect(cleanHtmlText('  Tree Gnome Village  ')).toBe('Tree Gnome Village');
  });

  it('does not truncate malformed markup', () => {
    // An unclosed span must be stripped as a tag, not swallow the text.
    expect(cleanHtmlText('<span class="floornumber-us">2nd floor')).toBe(
      '2nd floor',
    );
  });
});
