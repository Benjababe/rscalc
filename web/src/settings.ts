/**
 * Planner settings shared by the three pages.
 *
 * `useBudgetSettings` owns the gold amount and the budget/shop view, and is the
 * only writer of the shared `rscalc.budget` key — the pages used to each carry
 * their own copy of that read/modify/write dance. `useTravelSettings` owns the
 * hop, world and travel inputs, which are deliberately session-only: they are
 * assumptions about the player's route, not a saved preference.
 */

import { useEffect, useState } from "react";

import {
  DEFAULT_HOP_SECONDS,
  DEFAULT_MAX_WORLDS,
  DEFAULT_SECONDS_PER_TILE,
} from "../../src/domain/budget";
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
