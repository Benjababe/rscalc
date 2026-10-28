/** Small display helpers shared by the table and the shop-basket panel. */

export function formatGp(value: number): string {
  return value.toLocaleString("en-US");
}

export function compact(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}m`;
  if (value >= 1_000) return `${value / 1_000}k`;
  return String(value);
}

export function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
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
