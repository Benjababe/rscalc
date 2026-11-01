/**
 * `{{Skilling success chart}}` from a page's wikitext.
 *
 * Source: <https://oldschool.runescape.wiki/w/Template:Skilling_success_chart>,
 * documented at <https://oldschool.runescape.wiki/w/Skilling_success_chart>.
 * The template carries one numbered group of parameters per option:
 *
 *   {{Skilling success chart|label=Monkfish fishing chance|showbefore=no
 *    |label1=Raw monkfish|low1=48|high1=90|req1=62|color1=saddlebrown
 *    |image1=Raw monkfish.png}}
 *
 * So the parameters are addressed **by key** (`label`, `low`, `high`, `req` plus
 * an index) and never by position. A group missing any of the three numbers is
 * not a chart option and is dropped rather than defaulted: `low`/`high` are the
 * whole content of the formula, and a default would be an invented probability.
 *
 * `cascade=yes` is passed straight through to `chartDistribution`, because on a
 * cascading chart the options are rolled in order rather than being alternatives.
 */

import type { SuccessChart, SuccessChartOption } from '../domain/successChance.js';
import { firstTemplateParams } from './wikiParams.js';

/** Strip the link/file markup a label may carry. */
function cleanLabel(raw: string): string {
  let text = raw.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]*)\]\]/g, '$1');
  text = text.replace(/\{\{[^}]*\|([^}|]*)\}\}/g, '$1');
  text = text.replace(/\{\{[^}]*\}\}/g, '');
  text = text.replace(/<[^>]*>/g, '');
  return text.replace(/[[\]']/g, '').trim();
}

/** Parse the first success chart on the page, or null when there is none. */
export function parseSuccessChart(text: string): SuccessChart | null {
  const params = firstTemplateParams(text, ['Skilling success chart']);
  if (params === null) return null;
  const options: SuccessChartOption[] = [];
  // The template is a numbered group per option; stop at the first index with no
  // usable numbers rather than assuming a count.
  for (let index = 1; index <= 24; index += 1) {
    const low = Number.parseFloat(params.get(`low${index}`) ?? '');
    const high = Number.parseFloat(params.get(`high${index}`) ?? '');
    const required = Number.parseFloat(params.get(`req${index}`) ?? '');
    if (!Number.isFinite(low) || !Number.isFinite(high)) break;
    const label = cleanLabel(params.get(`label${index}`) ?? '');
    options.push({
      label,
      low,
      high,
      // A chart may omit `req`; 1 is the level every account has, which is the
      // only unconditional value. It is not a gate the row relies on.
      requiredLevel: Number.isFinite(required) ? required : 1,
    });
  }

  if (options.length === 0) return null;
  const label = cleanLabel(params.get('label') ?? '');
  return {
    label: label === '' ? null : label,
    cascade: (params.get('cascade') ?? '').toLowerCase() === 'yes',
    options,
  };
}

/** The first option — the plain, no-gear case a chart lists first. */
export function primaryOption(chart: SuccessChart): SuccessChartOption | null {
  return chart.options[0] ?? null;
}
