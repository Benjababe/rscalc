/**
 * Timestamp formatting.
 *
 * All artifacts store ISO-8601 UTC strings (`2026-10-31T16:22:58.328Z`). The
 * UI and CLI display them in the viewer's local timezone without a zone label;
 * the raw source timestamp is available for hover tooltips via
 * `formatSourceDateTime`.
 *
 * `locale` and `timeZone` are optional so tests can pin a deterministic zone;
 * production callers pass neither and get the host's local zone.
 */

export interface LocalTimeOptions {
  locale?: string;
  timeZone?: string;
}

export function formatLocalTime(
  iso: string,
  options: LocalTimeOptions = {},
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  // Same reason as `profit.ts`: an explicit object beats a conditional empty spread.
  const zone = options.timeZone === undefined ? {} : { timeZone: options.timeZone };
  return date.toLocaleString(options.locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...zone,
  });
}

/**
 * The stored timestamp without its timezone marker, e.g.
 * `2026-10-31 16:22:58`. Used for the hover tooltip so the exact source time
 * is visible without repeating the local zone label.
 */
export function formatSourceDateTime(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "");
}
