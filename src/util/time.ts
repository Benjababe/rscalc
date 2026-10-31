/**
 * Timestamp formatting.
 *
 * All artifacts store ISO-8601 UTC strings (`2026-10-31T16:22:58.328Z`). The
 * UI and CLI should display them in the viewer's local timezone, with the
 * timezone abbreviation, rather than slicing the raw ISO string.
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

  return date.toLocaleString(options.locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  });
}
