/**
 * The budget card, shared by the three result pages.
 *
 * The gold field, its presets and the hint were identical on every page; the
 * world-hop, max-worlds and travel-speed fields were identical on the two shop
 * pages; the processing page adds its own actions-per-hour cap. So the card owns
 * the gold control and the hint, and the page passes in whichever extra fields
 * it actually uses.
 */

import type { ReactNode } from "react";

import { compact } from "./format";
import { GoldInput } from "./GoldInput";

const PRESETS = [100_000, 1_000_000, 10_000_000, 100_000_000] as const;

export function BudgetPanel(props: {
  gold: number;
  onGold: (gold: number) => void;
  hint: ReactNode;
  /** Extra fields beside the gold control, left to right. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <section className="toolbar budget">
      <div className="budget-inputs">
        <div className="gold-compartment">
          <label className="toggle">
            <span className="label">Gold available</span>
            <span className="field-control">
              <GoldInput value={props.gold} onChange={props.onGold} />
              <span className="field-unit">gp</span>
            </span>
          </label>

          <div className="presets">
            {PRESETS.map((amount) => (
              <button
                key={amount}
                type="button"
                className={props.gold === amount ? "preset active" : "preset"}
                onClick={() => props.onGold(amount)}
              >
                {compact(amount)}
              </button>
            ))}
            <button
              type="button"
              className="preset"
              onClick={() => props.onGold(0)}
            >
              Clear
            </button>
          </div>
        </div>

        {props.children}
      </div>

      <p className="hint">{props.hint}</p>
    </section>
  );
}

/** The hop / max-worlds / travel-speed trio used by both shop pages. */
export function TravelFields(props: {
  hopSeconds: number;
  onHopSeconds: (seconds: number) => void;
  maxWorlds: number;
  onMaxWorlds: (worlds: number) => void;
  secondsPerTile: number;
  onSecondsPerTile: (seconds: number) => void;
}): JSX.Element {
  return (
    <>
      <label className="toggle">
        <span className="label">World hop</span>
        <span className="field-control">
          <input
            className="num"
            type="number"
            min={0}
            step={1}
            value={props.hopSeconds}
            onChange={(event) =>
              props.onHopSeconds(Math.max(0, Number(event.target.value) || 0))
            }
            aria-label="World hop time in seconds"
          />
          <span className="field-unit">s</span>
        </span>
      </label>

      <label
        className="toggle"
        title="Maximum worlds you are willing to hop. The shop is assumed available on each one."
      >
        <span className="label">Max worlds</span>
        <span className="field-control">
          <input
            className="num"
            type="number"
            min={1}
            step={1}
            value={props.maxWorlds}
            onChange={(event) =>
              props.onMaxWorlds(
                Math.max(1, Math.floor(Number(event.target.value) || 1)),
              )
            }
            aria-label="Maximum worlds to hop"
          />
          <span className="field-unit">worlds</span>
        </span>
      </label>

      <label className="toggle">
        <span className="label">Travel speed</span>
        <span className="field-control">
          <input
            className="num"
            type="number"
            min={0}
            step={0.05}
            value={props.secondsPerTile}
            onChange={(event) =>
              props.onSecondsPerTile(
                Math.max(0, Number(event.target.value) || 0),
              )
            }
            aria-label="Seconds per game tile"
          />
          <span className="field-unit">s / tile</span>
        </span>
      </label>
    </>
  );
}

