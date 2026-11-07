import { useEffect, useMemo, useRef } from "react";

import {
  planShopBasket,
  type ShopBasketItem,
} from "../../src/domain/basket";
import {
  overnightBudgetOptions,
  shopRunUnits,
} from "../../src/domain/overnight";
import type { Opportunity, SellMode } from "../../src/types";
import { wikiUrl } from "../../src/util/wiki";
import { accessFor } from "./access";
import { formatDuration, formatGp } from "./format";
import { toShopRow } from "./opportunity";

interface ShopBasketPanelProps {
  shopPage: string;
  /** Every ranked opportunity, not just the currently filtered rows. */
  opportunities: Opportunity[];
  mode: SellMode;
  gold: number;
  hopSeconds: number;
  maxWorlds: number;
  secondsPerTile: number;
  /**
   * Overnight mode: the GE offers rest instead of filling inside the 4h window.
   * Passed as plain values so the basket's memos stay stable across renders.
   */
  overnight: boolean;
  restWindowHours: number;
  sessionMinutes: number;
  /** Assume the GE has unlimited buyers: no cap and no fill time. */
  unlimitedBuyers: boolean;
  onClose: () => void;
}

/**
 * One shop's multi-item basket.
 *
 * The main table ranks items as if you bought only that item. This panel answers
 * the other question: what if you buy every profitable item in the shop during
 * the same visits? World hops and bank loads are then paid once for the basket,
 * and the GE sell schedule is spread across the available offer slots.
 */
export function ShopBasketPanel({
  shopPage,
  opportunities,
  mode,
  gold,
  hopSeconds,
  maxWorlds,
  secondsPerTile,
  overnight,
  restWindowHours,
  sessionMinutes,
  unlimitedBuyers,
  onClose,
}: ShopBasketPanelProps): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const access = accessFor(shopPage);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [shopPage]);

  const shopOpportunities = useMemo(
    () => opportunities.filter((opp) => opp.shopPage === shopPage),
    [opportunities, shopPage],
  );

  const items: ShopBasketItem[] = useMemo(
    () =>
      shopOpportunities.map((opp, index) => ({
        id: `${opp.itemId}:${index}`,
        name: opp.itemName,
        row: toShopRow(opp),
        netSellPerUnit: opp.netSellPerUnit,
        maxUnits: shopRunUnits(
          opp,
          overnight
            ? { restWindowHours, sessionMinutes, unlimitedBuyers }
            : undefined,
        ),
        stackable: opp.stackable,
        // The payload's `members` is the shop's flag; a members shop requires a
        // members account, which also gives 8 GE offer slots.
        members: opp.members,
      })),
    [
      shopOpportunities,
      overnight,
      restWindowHours,
      sessionMinutes,
      unlimitedBuyers,
    ],
  );

  const bankTiles =
    shopOpportunities.find((opp) => opp.bankTiles !== null)?.bankTiles ?? null;
  const nearestBank =
    shopOpportunities.find((opp) => opp.nearestBank !== null)?.nearestBank ??
    null;
  const plan = useMemo(
    () =>
      planShopBasket(items, gold, {
        hopSeconds,
        maxWorlds,
        bankTiles,
        secondsPerTile,
        ...(overnight
          ? overnightBudgetOptions({
              restWindowHours,
              sessionMinutes,
              unlimitedBuyers,
            })
          : {}),
      }),
    [
      items,
      gold,
      hopSeconds,
      maxWorlds,
      bankTiles,
      secondsPerTile,
      overnight,
      restWindowHours,
      sessionMinutes,
      unlimitedBuyers,
    ],
  );

  const shopName = shopOpportunities[0]?.shopName ?? shopPage;
  const location =
    shopOpportunities.find((opp) => opp.location !== null)?.location ?? null;
  const membersShop = shopOpportunities.some((opp) => opp.members);
  const modeLabel =
    mode === "pessimistic"
      ? "instant sell at GE low"
      : "patient sell at GE high";
  const gpPerHour =
    plan.gpPerHour === null ? "—" : formatGp(Math.round(plan.gpPerHour));
  const unknownBank = plan.bankTimeKnown === false;

  return (
    <section
      ref={panelRef}
      className="basket-panel"
      aria-label={`Shop basket for ${shopName}`}
    >
      <div className="basket-head">
        <div>
          <div className="basket-title">
            Shop basket:{" "}
            <a
              className="wiki-link"
              href={wikiUrl(shopPage)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {shopName}
            </a>
          </div>
          <p className="basket-sub">
            {location !== null ? `${location} · ` : ""}
            {membersShop ? "members shop" : "free-to-play shop"} ·{" "}
            {modeLabel}
            {overnight ? ` · overnight, ${restWindowHours}h rest` : ""} ·{" "}
            {bankTiles === null
              ? "no bank on this shop's map"
              : `bank: ${nearestBank ?? "bank"} (${Math.round(bankTiles)} tiles)`}
          </p>
        </div>
        <button
          type="button"
          className="basket-close"
          onClick={onClose}
          aria-label="Close shop basket"
          title="Close shop basket"
        >
          ×
        </button>
      </div>

      {access !== undefined && (
        <p className="basket-note">
          <span className="flag warn">locked</span> Access:{" "}
          <strong>{access.requirement}</strong> ·{" "}
          <a
            className="wiki-link"
            href={access.source}
            target="_blank"
            rel="noopener noreferrer"
          >
            wiki source
          </a>
        </p>
      )}

      {gold <= 0 ? (
        <p className="basket-hint">
          Enter <strong>Gold available</strong> above to size the basket. Buying
          these items in the same visits shares world hops and bank loads.
        </p>
      ) : items.length === 0 ? (
        <p className="basket-hint">
          No profitable items for this shop in the current sell mode. Items
          excluded from the ranking (unpriced, illiquid, or negative margin) are
          not in the basket.
        </p>
      ) : (
        <>
          <div className="basket-stats">
            <BasketStat label="Units" value={plan.units.toLocaleString("en-US")} />
            <BasketStat
              label="Spend"
              value={`${formatGp(Math.round(plan.totalCost))} gp`}
            />
            <BasketStat
              label="Leftover"
              value={`${formatGp(Math.round(plan.leftover))} gp`}
            />
            <BasketStat
              label="Profit"
              value={`${formatGp(Math.round(plan.profit))} gp`}
              accent
            />
            <BasketStat
              label="gp / hour"
              value={gpPerHour}
              accent={plan.gpPerHour !== null}
              title={
                unknownBank
                  ? "Bank distance is unknown for the non-stackable part, so travel time and gp/hour cannot be computed"
                  : undefined
              }
            />
            <BasketStat label="Worlds" value={String(plan.worlds)} />
            <BasketStat label="Bank trips" value={String(plan.bankTrips)} />
            <BasketStat
              label={overnight ? "Fill (resting)" : "Sell time"}
              value={formatDuration(plan.sellSeconds)}
              title={
                overnight
                  ? `Estimated time for the resting offers to fill at the 24h traded volume, inside a ${restWindowHours}h window. Your capital is committed for it, so it counts toward the plan's clock.`
                  : undefined
              }
            />
            <BasketStat
              label={overnight ? "Your time" : "Total time"}
              value={formatDuration(plan.timeSeconds)}
            />
          </div>

          <div className="basket-tablewrap">
            <table className="basket-table">
              <caption className="visually-hidden">
                Items in this shop basket
              </caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="right">Buy</th>
                  <th scope="col" className="right">Unit cost</th>
                  <th scope="col" className="right">Sell</th>
                  <th scope="col" className="right">Margin</th>
                  <th scope="col" className="right">Spend</th>
                  <th scope="col" className="right">Profit</th>
                  <th scope="col" className="right">/ world</th>
                  <th scope="col">Slots</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((planItem, index) => {
                  const opp = shopOpportunities[index];
                  if (opp === undefined) return null;
                  const margin =
                    planItem.units > 0
                      ? opp.netSellPerUnit - planItem.avgCost
                      : 0;
                  return (
                    <tr
                      key={planItem.id}
                      className={planItem.units === 0 ? "dim-row" : undefined}
                    >
                      <td>
                        <a
                          className="wiki-link"
                          href={wikiUrl(opp.itemName)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {opp.itemName}
                        </a>
                      </td>
                      <td className="right mono strong">
                        {planItem.units.toLocaleString("en-US")}
                      </td>
                      <td className="right mono">
                        {planItem.units > 0
                          ? formatGp(Math.round(planItem.avgCost))
                          : "—"}
                      </td>
                      <td className="right mono">
                        {formatGp(opp.sellPrice)}
                      </td>
                      <td className="right mono pos">
                        {planItem.units > 0
                          ? formatGp(Math.round(margin))
                          : "—"}
                      </td>
                      <td className="right mono">
                        {formatGp(Math.round(planItem.totalCost))}
                      </td>
                      <td className="right mono pos">
                        {formatGp(Math.round(planItem.profit))}
                      </td>
                      <td className="right mono dim">
                        {planItem.unitsPerWorld}
                      </td>
                      <td className="dim">
                        {planItem.stackable === true
                          ? "stack"
                          : planItem.stackable === false
                            ? "loose"
                            : "?"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="basket-flags">
            <span className="flag">worlds shared</span>
            <span className="flag">
              {plan.bankTrips === 0
                ? "no bank trips"
                : `${plan.bankTrips} bank trip${plan.bankTrips === 1 ? "" : "s"} shared`}
            </span>
            <span className="flag">
              {plan.offerSlots} GE slot{plan.offerSlots === 1 ? "" : "s"}
            </span>
            {overnight && (
              <span className="flag">
                overnight ·{" "}
                {unlimitedBuyers
                  ? "unlimited buyers"
                  : `${restWindowHours}h rest`}{" "}
                ·{" "}
                {sessionMinutes > 0 ? `${sessionMinutes} min session` : "no session limit"}
              </span>
            )}
            {plan.sessionLimited && (
              <span className="flag warn">session limit reached</span>
            )}
            {plan.budgetLimited && <span className="flag warn">budget limited</span>}
            {plan.worldLimited && (
              <span className="flag warn">world limit reached</span>
            )}
            {plan.marginLimited && (
              <span className="flag warn">margin floor hit</span>
            )}
            {unknownBank && (
              <span className="flag warn">bank distance unknown</span>
            )}
          </div>

          <p className="basket-note">
            <strong>Buy</strong> is the basket's allocation for this shop, not
            the per-item table's gp/hour. World hops and bank loads are paid
            once: {plan.worlds} world{plan.worlds === 1 ? "" : "s"} and{" "}
            {plan.bankTrips} bank trip{plan.bankTrips === 1 ? "" : "s"} (capped
            at your <strong>Max worlds</strong> setting of {maxWorlds}).{" "}
            {plan.nonStackableUnits > 0 ? (
              <>
                {plan.stackableSlots} stackable item type
                {plan.stackableSlots === 1 ? "" : "s"} reserve a slot each, so a
                load carries {plan.unitsPerLoad} non-stackable units.
              </>
            ) : (
              <>All purchased goods stack, so no banking is needed.</>
            )}{" "}
            {overnight && unlimitedBuyers ? (
              <>
                <strong>Unlimited buyers</strong> is on: nothing caps the sale and
                no fill time is charged, so gp / hour is the basket&apos;s buying
                time alone. The rate is a one-off — the same night cannot absorb a
                second run — and items with no recent trades are included at their
                last quoted price.
              </>
            ) : overnight ? (
              <>
                Each item&apos;s fill is scheduled across {plan.offerSlots} GE
                offer{plan.offerSlots === 1 ? "" : "s"} over the {restWindowHours}h
                rest window, and the longer of your buying time and that fill
                counts toward gp / hour
                {plan.sessionLimited
                  ? " — the session clock stopped the basket before the budget did."
                  : "."}
              </>
            ) : (
              <>
                Sell time schedules each item&apos;s 4h fill across{" "}
                {plan.offerSlots} GE offer{plan.offerSlots === 1 ? "" : "s"}.
              </>
            )}
          </p>
          <p className="basket-note">
            The allocator takes the next marginal unit with the best profit per
            coin; a budget that covers a full world buys every profitable unit
            in it. Each world is assumed to be at full default stock. Restock
            timers and travel to the shop are not modelled.
            {unknownBank
              ? " Because the shop's bank distance is unknown, gp/hour is shown as —."
              : ""}
          </p>
        </>
      )}
    </section>
  );
}

function BasketStat(props: {
  label: string;
  value: string;
  accent?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <div
      className={props.accent ? "basket-stat accent" : "basket-stat"}
      title={props.title}
    >
      <span className="label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
