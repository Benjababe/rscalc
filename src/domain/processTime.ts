/**
 * Processing time helpers, pure and shared by the engine, the CLI and the UI.
 *
 * The wiki publishes ticks per action in the recipe template:
 *   https://oldschool.runescape.wiki/w/Module:Recipe
 *
 * One tick is 0.6 seconds. A zero-tick action is not instant: Module:Recipe
 * treats it as 1/8 tick because eight actions can be performed per tick. We
 * follow the wiki's own calculator rather than inventing a different speed.
 *
 * `maxActionsPerHour` is a player-entered ceiling for inefficient play. It can
 * only lower the recipe's published rate; a slow recipe is never sped up by a
 * high cap.
 */

export const SECONDS_PER_TICK = 0.6;
export const ZERO_TICK_ACTIONS_PER_TICK = 8;

/** How long one action takes, or null when the wiki publishes no tick count. */
export function secondsPerAction(ticks: number | null): number | null {
  if (ticks === null || !Number.isFinite(ticks) || ticks < 0) return null;
  if (ticks === 0) return SECONDS_PER_TICK / ZERO_TICK_ACTIONS_PER_TICK;
  return ticks * SECONDS_PER_TICK;
}

/** The recipe's raw action rate, or null when the action time is unknown. */
export function actionsPerHour(
  seconds: number | null,
): number | null {
  return seconds === null ? null : 3600 / seconds;
}

/**
 * Apply a player-entered actions/hour cap.
 *
 * `0` (or any non-positive value) means "use the recipe rate". A positive cap
 * is a ceiling: `min(recipeRate, cap)`, so it models slower play without
 * letting the input claim a recipe can be performed faster than the wiki says.
 */
export function capActionsPerHour(
  rate: number | null,
  maxActionsPerHour = 0,
): number | null {
  if (rate === null) return null;
  if (!Number.isFinite(maxActionsPerHour) || maxActionsPerHour <= 0) return rate;
  return Math.min(rate, maxActionsPerHour);
}

/** Actions the effective rate allows in a 4h window, floored to whole units. */
export function actions4hForRate(rate: number | null): number | null {
  return rate === null ? null : Math.floor(rate * 4);
}
