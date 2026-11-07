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

import { MAX_REST_WINDOW_HOURS } from "../../src/domain/overnight";
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


/**
 * The overnight trio: the toggle, the session you are willing to shop and the
 * window the GE offers are allowed to rest in.
 *
 * Both numbers are visible even while the mode is off — they are disabled, not
 * hidden, so switching the mode on never reveals an assumption the player has
 * not seen.
 */
export function OvernightFields(props: {
  overnight: boolean;
  onOvernight: (on: boolean) => void;
  restWindowHours: number;
  onRestWindowHours: (hours: number) => void;
  sessionMinutes: number;
  onSessionMinutes: (minutes: number) => void;
  unlimitedBuyers: boolean;
  onUnlimitedBuyers: (on: boolean) => void;
}): JSX.Element {
  return (
    <>
      <label
        className="toggle inline"
        title="Sell into a rest window instead of the 4h slice: the unit cap becomes what the 24h volume absorbs in the window, and buying stops when the session is up. The fill is still counted, because the capital is committed until it fills."
      >
        <input
          type="checkbox"
          checked={props.overnight}
          onChange={(event) => props.onOvernight(event.target.checked)}
        />
        Overnight
      </label>

      <label
        className="toggle"
        title="Minutes you are willing to shop for: world hops plus the bank trips your loads need. 0 means no session limit."
      >
        <span className="label">Session</span>
        <span className="field-control">
          <input
            className="num"
            type="number"
            min={0}
            step={15}
            disabled={!props.overnight}
            value={props.sessionMinutes}
            onChange={(event) =>
              props.onSessionMinutes(
                Math.max(0, Math.floor(Number(event.target.value) || 0)),
              )
            }
            aria-label="Shopping session in minutes"
          />
          <span className="field-unit">min</span>
        </span>
      </label>

      <label
        className="toggle"
        title="Hours the GE offers may rest before you look again. The unit cap is what the 24h traded volume absorbs in this window."
      >
        <span className="label">Rest window</span>
        <span className="field-control">
          <input
            className="num"
            type="number"
            min={1}
            max={MAX_REST_WINDOW_HOURS}
            step={1}
            disabled={!props.overnight || props.unlimitedBuyers}
            value={props.restWindowHours}
            onChange={(event) =>
              props.onRestWindowHours(
                Math.min(
                  MAX_REST_WINDOW_HOURS,
                  Math.max(1, Math.floor(Number(event.target.value) || 1)),
                ),
              )
            }
            aria-label="Rest window in hours"
          />
          <span className="field-unit">h</span>
        </span>
      </label>

      <label
        className="toggle inline"
        title="Assume the GE has infinite buyers: no 4h buy limit and no volume ceiling, so the rest window stops capping the run and no fill time is charged. This prices items that have not traded recently — their GE price may be one stale trade — and the resulting gp / hour cannot be repeated the same night."
      >
        <input
          type="checkbox"
          checked={props.unlimitedBuyers}
          disabled={!props.overnight}
          onChange={(event) => props.onUnlimitedBuyers(event.target.checked)}
        />
        Unlimited buyers
      </label>
    </>
  );
}
