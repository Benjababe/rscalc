/**
 * Overnight shop runs: shop for one session, then let the GE offers rest.
 *
 * The normal shop-run model sizes the plan against the **4-hour** window that the
 * GE buy limit and the volume snapshot share, so a run stops at what the market
 * absorbs in 4h. An overnight run asks the other question: *"I will shop for an
 * hour and then go to bed — how much can I put on the GE, and what is that hour
 * worth?"*
 *
 * Two sourced numbers define it, and neither is invented here:
 *
 *  - **The rest window** (default 12 hours) replaces the 4h window. The units the
 *    market can absorb in it are the same 24h traded volume the engine already
 *    reads, scaled: `floor(volume24h * hours / 24)`. A row whose 24h volume is
 *    tiny therefore stays tiny — the window is longer, not ignored, because
 *    claiming an offer filled when the market trades twice a day would be a wrong
 *    number presented confidently.
 *  - **The session** (default 60 minutes) is the time you actually spend: world
 *    hops plus the bank trips your loads need. The plan is trimmed so it fits.
 *
 * Both are sourced. The one switch that is not is **unlimited buyers**: it removes
 * the cap entirely and charges no fill time, on the player's explicit instruction
 * that the GE has infinite buyers. It is labelled in the UI, and it is the only
 * way this model produces a rate that cannot be repeated.
 *
 * https://oldschool.runescape.wiki/w/Grand_Exchange/Buying_limits (4h window)
 * https://oldschool.runescape.wiki/w/Grand_Exchange (offer slots and filling)
 */

import type { BudgetOptions } from './budget.js';

/** Hours the GE offers may rest before the player looks again. */
export const DEFAULT_REST_WINDOW_HOURS = 12;

/** Minutes the player is willing to shop for. */
export const DEFAULT_SESSION_MINUTES = 60;

/** Longest rest window we will price: a day of volume is already generous. */
export const MAX_REST_WINDOW_HOURS = 24;

/** Longest session we will price, in minutes (a full working day). */
export const MAX_SESSION_MINUTES = 24 * 60;

/** The knobs, shared by the leaderboard and the shop pages. */
export interface OvernightPlanOptions {
  /** Hours the offers rest; defaults to `DEFAULT_REST_WINDOW_HOURS`. */
  restWindowHours?: number;
  /**
   * Minutes you shop; defaults to `DEFAULT_SESSION_MINUTES`. 0 means "no session
   * limit", which the planner reads as `undefined`.
   */
  sessionMinutes?: number;
  /**
   * Assume the Grand Exchange has **unlimited buyers**: no 4h buy limit and no
   * volume ceiling at all, so a run is bounded only by gold, shop stock, worlds
   * and the session.
   *
   * This is an explicit assumption, not a source. The 24h traded volume is the
   * only guard against a stale, illiquid GE price (see `docs/shop-mechanics.md`
   * §9), so switching it off prices rows that did not trade at all in the last
   * day: their "market price" may be one old trade. It is also the assumption
   * that makes overnight rates explode — with no fill time, a 500 gp item that
   * trades twice a day reads 49.5M gp/hour. The UI labels it and says both.
   */
  unlimitedBuyers?: boolean;
}

/**
 * The rest window in seconds, clamped to `[0, 24h]`.
 *
 * A non-finite value falls back to the default rather than becoming zero: zero
 * would silently mean "nothing is sellable".
 */
export function restWindowSeconds(hours: number | undefined): number {
  if (hours === undefined || !Number.isFinite(hours)) {
    return DEFAULT_REST_WINDOW_HOURS * 3600;
  }
  const clamped = Math.min(MAX_REST_WINDOW_HOURS, Math.max(0, hours));
  return clamped * 3600;
}

/**
 * Units the market absorbs in the rest window.
 *
 * Floored to whole units for the same reason `volume4h` is: a fractional unit
 * count manufactures profit for an item you cannot actually sell.
 */
export function sellWindowUnits(
  volume24h: number,
  hours: number | undefined,
): number {
  if (!Number.isFinite(volume24h) || volume24h <= 0) return 0;
  const windowHours =
    hours === undefined || !Number.isFinite(hours)
      ? DEFAULT_REST_WINDOW_HOURS
      : Math.min(MAX_REST_WINDOW_HOURS, Math.max(0, hours));
  return Math.max(0, Math.floor((volume24h * windowHours) / 24));
}

/**
 * The session cap in seconds, or `undefined` for "no session limit".
 *
 * 0 minutes and junk both mean unlimited. That direction is deliberate: an
 * explicit zero in the UI must read as "off", never as "you may buy nothing".
 */
export function sessionSecondsFor(minutes: number | undefined): number | undefined {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }
  return Math.min(MAX_SESSION_MINUTES, minutes) * 60;
}

/**
 * The unit cap one shop run may use.
 *
 * Normal runs use the engine's floored 4h slice (`Opportunity.volume4h`); an
 * overnight run uses what the same 24h volume absorbs in the rest window. Both
 * come from the artifact, so the leaderboard and the shop pages cannot disagree
 * about which cap a run had.
 */
export function shopRunUnits(
  volumes: { volume24h: number; volume4h: number },
  options: OvernightPlanOptions | undefined,
): number {
  if (options === undefined) return Math.max(0, volumes.volume4h);
  if (options.unlimitedBuyers === true) return Number.POSITIVE_INFINITY;
  return sellWindowUnits(volumes.volume24h, options.restWindowHours);
}

/**
 * The budget-planner options an overnight run passes, from the same two knobs the
 * leaderboard takes. `sessionSeconds` is omitted entirely when the session is
 * unlimited, rather than being set to a value the planner would have to guess at.
 *
 * The fill is deliberately *not* made free: see `planWithBudget`'s header for why
 * a free sell leg puts a twice-a-day market at the top of the leaderboard. The one
 * exception is `unlimitedBuyers`, which the player switches on themselves: there is
 * no cap to fill against, so no sell window is passed and no fill time is charged.
 */
export function overnightBudgetOptions(
  options: OvernightPlanOptions,
): Pick<BudgetOptions, 'sellWindowSeconds' | 'sessionSeconds'> {
  const sessionSeconds = sessionSecondsFor(options.sessionMinutes);
  return {
    ...(options.unlimitedBuyers === true
      ? {}
      : { sellWindowSeconds: restWindowSeconds(options.restWindowHours) }),
    ...(sessionSeconds === undefined ? {} : { sessionSeconds }),
  };
}
