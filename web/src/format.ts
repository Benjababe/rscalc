/** Small display helpers shared by the table and the shop-basket panel. */

import { formatLocalTime } from "../../src/util/time";

export { formatSourceDateTime } from "../../src/util/time";

export function formatGp(value: number): string {
  return value.toLocaleString("en-US");
}

export function compact(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}m`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

export function formatTime(iso: string): string {
  return formatLocalTime(iso);
}

/**
 * A snapshot older than this is called out in the toolbar. The artifacts are
 * committed, so `pricesAsOf` can genuinely be days old; a stale price presented
 * without a warning is exactly the confident-but-wrong number this project
 * exists to avoid.
 */
export const STALE_SNAPSHOT_HOURS = 24;

/** Age of a snapshot in whole hours, or null when the timestamp is unusable. */
export function hoursSince(
  iso: string,
  now: number = Date.now(),
): number | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const hours = Math.floor((now - then) / 3_600_000);
  if (!Number.isFinite(hours)) return null;
  return hours;
}

/** Human-readable duration for hop/bank/sell times. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}
