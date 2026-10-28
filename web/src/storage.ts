/**
 * Persisted budget UI state.
 *
 * `localStorage` is user-writable and survives schema changes, so every value is
 * validated on read. A corrupt entry falls back to the defaults instead of
 * feeding `NaN` or a negative gold amount into the planner.
 */

export type BudgetView = "budget" | "shop";

export interface BudgetState {
  gold: number;
  view: BudgetView;
}

export const BUDGET_STORAGE_KEY = "rscalc.budget";
export const DEFAULT_GOLD = 1_000_000;
export const DEFAULT_VIEW: BudgetView = "budget";

function defaults(): BudgetState {
  return { gold: DEFAULT_GOLD, view: DEFAULT_VIEW };
}

/**
 * Parse a stored entry. Returns defaults for missing, malformed or out-of-range
 * values; never throws.
 */
export function parseBudgetState(raw: string | null): BudgetState {
  if (raw === null) return defaults();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults();
  }

  if (typeof parsed !== "object" || parsed === null) return defaults();

  const fields = new Map(Object.entries(parsed));
  const rawGold = fields.get("gold");
  const rawView = fields.get("view");

  const gold =
    typeof rawGold === "number" && Number.isFinite(rawGold) && rawGold >= 0
      ? Math.floor(rawGold)
      : DEFAULT_GOLD;
  const view: BudgetView =
    rawView === "budget" || rawView === "shop" ? rawView : DEFAULT_VIEW;

  return { gold, view };
}

export function serialiseBudgetState(state: BudgetState): string {
  return JSON.stringify({ gold: state.gold, view: state.view });
}
