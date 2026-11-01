/**
 * Coin amounts, as a player types them.
 *
 * The gold field is the one input where a typo silently changes every number on
 * the page: typing one zero too many turns a 1M plan into a 10M plan that the
 * player cannot actually fund. It accepts the shorthand players already use in
 * chat ("100k", "2.5m", "1b"), thousands separators, and a trailing "gp", then
 * floors to whole coins like every other money value in this project.
 */

/** Multipliers for the OSRS shorthand suffixes. */
const SUFFIX_SCALE = new Map<string, number>([
  ["k", 1_000],
  ["m", 1_000_000],
  ["b", 1_000_000_000],
]);

/**
 * Parse a typed coin amount into whole gp.
 *
 * Returns `null` for anything that is not a non-negative number, so callers can
 * leave the previous value in place rather than committing a guess. An empty
 * field means 0, which every page already treats as "no budget cap".
 */
export function parseGoldInput(raw: string): number | null {
  const cleaned = raw
    .replace(/[\s,_]/g, "")
    .replace(/gp$/i, "")
    .replace(/coins?$/i, "");
  if (cleaned === "") return 0;

  const match = /^(\d+(?:\.\d*)?|\.\d+)([kmb])?$/i.exec(cleaned);
  if (match === null) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const suffix = match[2];
  const scale = suffix === undefined ? 1 : (SUFFIX_SCALE.get(suffix.toLowerCase()) ?? 1);
  const gp = Math.floor(amount * scale);
  if (!Number.isSafeInteger(gp) || gp < 0) return null;

  return gp;
}

/** Render an amount back into the field, with thousands separators. */
export function formatGoldInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.floor(value).toLocaleString("en-US");
}
