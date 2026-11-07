/**
 * Planner settings shared by the three pages.
 *
 * `useBudgetSettings` owns the gold amount and the budget/shop view, and is the
 * only writer of the shared `rscalc.budget` key — the pages used to each carry
 * their own copy of that read/modify/write dance. `useTravelSettings` owns the
 * hop, world and travel inputs, which are deliberately session-only: they are
 * assumptions about the player's route, not a saved preference.
 * `useOvernightSettings` owns the overnight session and rest-window knobs, also
 * session-only, seeded from a shared link.
 */

import { useEffect, useState } from "react";

import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
} from "../../src/domain/budget";
import {
  DEFAULT_REST_WINDOW_HOURS,
  DEFAULT_SESSION_MINUTES,
  MAX_REST_WINDOW_HOURS,
} from "../../src/domain/overnight";
import {
  browserStore,
  readStoredBudget,
  writeStoredBudget,
  type BudgetState,
  type BudgetView,
} from "./storage";

export interface BudgetSettings {
  gold: number;
  setGold: (value: number) => void;
  view: BudgetView;
  setView: (view: BudgetView) => void;
}

export function useBudgetSettings(): BudgetSettings {
  const [initial] = useState<BudgetState>(() =>
    readStoredBudget(browserStore()),
  );
  const [gold, setGold] = useState(initial.gold);
  const [view, setView] = useState<BudgetView>(initial.view);

  useEffect(() => {
    writeStoredBudget({ gold, view }, browserStore());
  }, [gold, view]);

  return { gold, setGold, view, setView };
}

export interface TravelSettings {
  hopSeconds: number;
  setHopSeconds: (seconds: number) => void;
  maxWorlds: number;
  setMaxWorlds: (worlds: number) => void;
  secondsPerTile: number;
  setSecondsPerTile: (seconds: number) => void;
}

export function useTravelSettings(): TravelSettings {
  const [hopSeconds, setHopSeconds] = useState(DEFAULT_HOP_SECONDS);
  const [maxWorlds, setMaxWorlds] = useState(DEFAULT_MAX_WORLDS);
  const [secondsPerTile, setSecondsPerTile] = useState(
    DEFAULT_SECONDS_PER_TILE,
  );

  return {
    hopSeconds,
    setHopSeconds,
    maxWorlds,
    setMaxWorlds,
    secondsPerTile,
    setSecondsPerTile,
  };
}

export interface OvernightSettings {
  /** True when the GE offers rest instead of being sold inside 4h. */
  overnight: boolean;
  setOvernight: (on: boolean) => void;
  /** Hours the offers rest: the window the unit cap is measured over. */
  restWindowHours: number;
  setRestWindowHours: (hours: number) => void;
  /** Minutes spent shopping; 0 means "no session limit". */
  sessionMinutes: number;
  setSessionMinutes: (minutes: number) => void;
  /**
   * Assume the GE has unlimited buyers: no buy limit and no volume ceiling. An
   * explicit assumption, so it is a checkbox and never a default.
   */
  unlimitedBuyers: boolean;
  setUnlimitedBuyers: (on: boolean) => void;
}

/**
 * The overnight knobs, seeded from a shared link so a link that was copied in
 * overnight mode reopens on the same numbers. Session-only like the travel
 * fields: they are assumptions about the run, not a saved preference.
 */
export function useOvernightSettings(shared: {
  overnight?: boolean;
  restHours?: number;
  sessionMinutes?: number;
  unlimited?: boolean;
} = {}): OvernightSettings {
  const [overnight, setOvernight] = useState(shared.overnight === true);
  const [restWindowHours, setRestWindowHours] = useState(
    shared.restHours !== undefined && shared.restHours > 0
      ? Math.min(MAX_REST_WINDOW_HOURS, shared.restHours)
      : DEFAULT_REST_WINDOW_HOURS,
  );
  const [sessionMinutes, setSessionMinutes] = useState(
    shared.sessionMinutes !== undefined && shared.sessionMinutes >= 0
      ? shared.sessionMinutes
      : DEFAULT_SESSION_MINUTES,
  );
  const [unlimitedBuyers, setUnlimitedBuyers] = useState(
    shared.unlimited === true,
  );

  return {
    overnight,
    setOvernight,
    restWindowHours,
    setRestWindowHours,
    sessionMinutes,
    setSessionMinutes,
    unlimitedBuyers,
    setUnlimitedBuyers,
  };
}
