/**
 * Search-box matching, shared by the three result pages.
 *
 * Fields are joined and matched as one lowercased haystack. Matching the joined
 * text (rather than field by field) means "rune shop" still finds a row whose
 * item is "Astral rune" and whose shop is "Baba Yaga's Magic Shop", which is how
 * the shop pages already behaved; the processing page now matches the same way.
 */

export function matchesQuery(
  needle: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  if (needle === "") return true;
  const haystack = fields.map((field) => field ?? "").join(" ").toLowerCase();
  return haystack.includes(needle);
}

/** Normalise a raw search box value once, before the per-row comparisons. */
export function normaliseQuery(raw: string): string {
  return raw.trim().toLowerCase();
}
