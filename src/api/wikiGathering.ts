/**
 * Gathering rates for skilling nodes, read from the wiki's per-item skill infobox.
 *
 * Source: each ore/log page carries a `{{Mining info}}` or `{{Woodcutting info}}`
 * template with the node's requirement and **respawn time**, e.g.
 *
 *   {{Mining info|name = Runite rocks|level = 85|xp = 125|rock = [[Runite rocks]]
 *    |tool = [[Pickaxe]]|time = 12 minutes<br/>6 minutes in Mining Guild}}
 *
 *   <https://oldschool.runescape.wiki/w/Runite_ore>
 *   <https://oldschool.runescape.wiki/w/Yew_logs>
 *
 * That `time` is what the prose above the template states: "after runite rocks are
 * mined, it will take twelve minutes until it reappears". So one node yields **one
 * unit per respawn**, which is a sustainable single-node rate and the only
 * gathering number the wiki actually publishes as a constant.
 *
 * What this deliberately does *not* model:
 *   - **competition** (another player mining the same rock) — excluded, so the rate
 *     is an upper bound, exactly like the "banking not modelled" caveat elsewhere;
 *   - **mining time itself** — the prose publishes a *deplation* probability curve
 *     ("19/256 every 3 ticks at 99"), which is level- and pickaxe-dependent. The
 *     respawn already bounds a single node, so a row does not need it; adding both
 *     would double-count the same wait;
 *   - **multi-node rotations** (world-hop mining runs), which beat the respawn and
 *     need a run model, not a row.
 *
 * Durations are read as text ("12 minutes", "59.4 seconds", "1 minute 30 seconds")
 * and the **longest** one wins, because a template that offers a faster variant
 * ("6 minutes in Mining Guild") must not be priced at the player's convenience.
 */

import { fetchPageWikitext } from './wikiPages.js';

/** The two templates we understand, and the skill each one belongs to. */
const TEMPLATES: Record<string, { skill: 'Mining' | 'Woodcutting' }> = {
  'Mining info': { skill: 'Mining' },
  'Woodcutting info': { skill: 'Woodcutting' },
};

export interface GatheringNode {
  /** Item page name, e.g. `Runite ore`. */
  item: string;
  skill: 'Mining' | 'Woodcutting';
  /** Level to gather it, or null when the template omits it. */
  level: number | null;
  /** Experience per unit, or null when omitted. */
  xp: number | null;
  /** Seconds until the node gives another unit. Never invented. */
  respawnSeconds: number;
  /** Wiki page the numbers came from. */
  source: string;
}

export interface GatheringResult {
  nodes: GatheringNode[];
  /** Pages requested, so the caller can log the cost. */
  requested: number;
  /** Pages with no `Mining info` / `Woodcutting info` block. */
  missing: number;
  /** Blocks whose `time` could not be read as a duration. */
  unreadable: number;
  fetchedAt: number;
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  seconds: 1,
  sec: 1,
  secs: 1,
  minute: 60,
  minutes: 60,
  min: 60,
  mins: 60,
  hour: 3600,
  hours: 3600,
  hr: 3600,
  hrs: 3600,
  tick: 0.6,
  ticks: 0.6,
};

/**
 * Seconds in one written duration.
 *
 * `time` appears in two shapes and they mean opposite things:
 *
 *   - **alternatives**, separated by `<br>`: `12 minutes<br/>6 minutes in Mining
 *     Guild` — the guild variant is faster, so the *slowest* branch is the one to
 *     price;
 *   - **a compound**, inside one branch: `1 minute 30 seconds` — those add up.
 *
 * So each `<br>` segment is summed on its own, and the largest segment wins.
 * Returns null when nothing readable is present: a rate is never invented.
 */
export function parseDurationSeconds(raw: string): number | null {
  let best: number | null = null;
  for (const segment of raw.split(/<br\s*\/?>/i)) {
    const seconds = sumDurations(segment);
    if (seconds === null) continue;
    if (best === null || seconds > best) best = seconds;
  }
  return best === null ? null : Math.round(best * 10) / 10;
}

/** Total of every `N unit` in one segment, or null when there are none. */
function sumDurations(segment: string): number | null {
  const text = segment.replace(/\[\[|\]\]/g, '');
  // No trailing word boundary: the unit alternation already takes the longest
  // match, and a regex escape written through a shell pipeline was silently
  // mangled into a control character once already.
  const pattern =
    /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|ticks?)/gi;
  let total = 0;
  let found = false;
  for (const match of text.matchAll(pattern)) {
    const value = Number.parseFloat(match[1] ?? '');
    const unit = UNIT_SECONDS[(match[2] ?? '').toLowerCase()];
    if (!Number.isFinite(value) || unit === undefined) continue;
    total += value * unit;
    found = true;
  }
  return found ? total : null;
}

/**
 * Where each template starts, as literals.
 *
 * A pattern built from a name is the kind of `new RegExp` this repo avoids, and
 * there are only ever two templates.
 */
const TEMPLATE_START: Record<string, RegExp> = {
  'Mining info': /\{\{\s*Mining info\b/i,
  'Woodcutting info': /\{\{\s*Woodcutting info\b/i,
};

/** One template's parameters, keyed by parameter name (lower-cased). */
function templateParams(text: string, name: string): Map<string, string> | null {
  const start = TEMPLATE_START[name]?.exec(text)?.index ?? -1;
  if (start < 0) return null;
  // Walk braces so a nested template inside the block cannot end it early.
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === '}}') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;

  const body = text.slice(start + name.length + 2, end - 2);
  const params = new Map<string, string>();
  for (const line of body.split('\n')) {
    const match = /^\s*\|\s*([a-z0-9_ ]+)\s*=\s*([\s\S]*)$/i.exec(line);
    if (match === null) continue;
    const key = (match[1] ?? '').trim().toLowerCase();
    if (!params.has(key)) params.set(key, (match[2] ?? '').trim());
  }
  return params;
}

/** Page name -> the node it describes, when the page has a known template. */
export function extractGatheringNode(
  item: string,
  wikitext: string,
): GatheringNode | null {
  for (const [template, meta] of Object.entries(TEMPLATES)) {
    const params = templateParams(wikitext, template);
    if (params === null) continue;
    const respawn = parseDurationSeconds(params.get('time') ?? '');
    if (respawn === null || respawn <= 0) return null;
    const level = Number.parseInt(params.get('level') ?? '', 10);
    const xp = Number.parseFloat(params.get('xp') ?? '');
    return {
      item,
      skill: meta.skill,
      level: Number.isFinite(level) ? level : null,
      xp: Number.isFinite(xp) ? xp : null,
      respawnSeconds: respawn,
      source: `https://oldschool.runescape.wiki/w/${encodeURIComponent(
        item.replace(/ /g, '_'),
      )}`,
    };
  }
  return null;
}

/** Batch-fetch and parse the given item pages. 24h cache, one request per 50. */
export async function fetchGatheringNodes(
  items: readonly string[],
): Promise<GatheringResult> {
  const page = await fetchPageWikitext([...items]);
  const nodes: GatheringNode[] = [];
  let missing = 0;
  let unreadable = 0;

  for (const item of items) {
    const wikitext = page.pages.get(item) ?? null;
    if (wikitext === null) {
      missing += 1;
      continue;
    }
    const node = extractGatheringNode(item, wikitext);
    if (node === null) {
      unreadable += 1;
      continue;
    }
    nodes.push(node);
  }

  return {
    nodes,
    requested: items.length,
    missing,
    unreadable,
    fetchedAt: page.fetchedAt,
  };
}
