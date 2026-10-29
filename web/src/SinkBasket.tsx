import { useEffect, useMemo, useRef } from "react";

import {
  planShopSinkBasket,
  type ShopSinkBasketItem,
} from "../../src/domain/sinkBasket";
import type { ShopSinkOpportunity } from "../../src/types";
import { wikiUrl } from "../../src/util/wiki";
import { accessFor } from "./access";
import { formatDuration, formatGp } from "./format";
import { toSinkShopRow } from "./opportunity";

interface SinkBasketPanelProps {
  shopPage: string;
  /** Every GE -> shop row for the current mode, not just the filtered table. */
  opportunities: ShopSinkOpportunity[];
  gold: number;
  hopSeconds: number;
  secondsPerTile: number;
  onClose: () => void;
}

/**
 * One shop's GE -> shop basket.
 *
 * The main table ranks items as if you sold only that item. This panel answers
 * the other question: what if you buy every profitable item for that shop and
 * sell them during the same world visits? The GE trip and world hops are then
 * shared, and one gold budget is allocated across the items.
 */
export function SinkBasketPanel({
  shopPage,
  opportunities,
  gold,
  hopSeconds,
  secondsPerTile,
  onClose,
}: SinkBasketPanelProps): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const access = accessFor(shopPage);

  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [shopPage]);

  const shopRows = useMemo(
    () => opportunities.filter((opp) => opp.shopPage === shopPage),
    [opportunities, shopPage],
  );

  const items: ShopSinkBasketItem[] = useMemo(
    () =>
      shopRows.map((opp, index) => ({
        id: `${opp.itemId}:${index}`,
        name: opp.itemName,
        row: toSinkShopRow(opp),
        geCostPerUnit: opp.geBuyPrice,
        purchaseCap4h: opp.purchaseCap4h,
        members: opp.members,
      })),
    [shopRows],
  );

  const geTiles =
    shopRows.find((opp) => opp.geTiles !== null)?.geTiles ?? null;

  const plan = useMemo(
    () =>
      planShopSinkBasket(items, gold, {
        geTiles,
        hopSeconds,
        secondsPerTile,
      }),
    [items, gold, geTiles, hopSeconds, secondsPerTile],
  );

  const shopName = shopRows[0]?.shopName ?? shopPage;
  const location = shopRows[0]?.location ?? null;
  const membersShop = shopRows.some((opp) => opp.members);
  const displayItems = [...plan.items].sort(
    (a, b) => b.profit - a.profit || b.units - a.units,
  );

  const gpPerHour =
    plan.gpPerHour === null ? "—" : formatGp(Math.round(plan.gpPerHour));
  const unknownTravel = plan.gpPerHour === null;
  const priceLimited = plan.items.some((item) => item.priceLimited);

  return (
    <section
      ref={panelRef}
      className="basket-panel"
      aria-label={`GE to shop basket for ${shopName}`}
    >
      <div className="basket-head">
        <div>
          <div className="basket-title">
            GE → shop basket:{" "}
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
            {gold > 0
              ? `${formatGp(gold)} gp budget`
              : "no gold budget"}{" "}
            · {hopSeconds}s hop · {secondsPerTile}s/tile
          </p>
        </div>
        <button
          type="button"
          className="basket-close"
          onClick={onClose}
          aria-label="Close GE to shop basket"
          title="Close basket"
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
          Enter <strong>Gold available</strong> above to size the basket. The
          panel allocates one budget across every item and shares the world hops
          and the single GE↔shop trip.
        </p>
      ) : items.length === 0 ? (
        <p className="basket-hint">
          No profitable items for this shop in the current buy mode. Rows
          excluded from the catalogue (unpriced, no published shop buy price, or
          no margin) are not in the basket.
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
                unknownTravel
                  ? "The GE distance is unknown for this shop, so travel time and gp/hour cannot be computed"
                  : undefined
              }
            />
            <BasketStat label="Worlds" value={String(plan.worlds)} />
            <BasketStat label="Hop time" value={formatDuration(plan.hopSecondsTotal)} />
            <BasketStat label="GE supply" value={formatDuration(plan.buySeconds)} />
            <BasketStat label="Total time" value={formatDuration(plan.timeSeconds)} />
          </div>

          <div className="basket-tablewrap">
            <table className="basket-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Units</th>
                  <th className="right">Batch</th>
                  <th className="right">GE cost</th>
                  <th className="right">Avg shop</th>
                  <th className="right">Margin</th>
                  <th className="right">Spend</th>
                  <th className="right">Profit</th>
                  <th className="right">Shop price</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((planItem) => {
                  const opp = shopRows[planItem.index];
                  const margin = planItem.avgShopPrice - planItem.unitCost;
                  return (
                    <tr
                      key={planItem.id}
                      className={planItem.units === 0 ? "dim-row" : undefined}
                    >
                      <td>
                        {opp === undefined ? (
                          planItem.name ?? planItem.id
                        ) : (
                          <a
                            className="wiki-link"
                            href={wikiUrl(opp.itemName)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {opp.itemName}
                          </a>
                        )}
                      </td>
                      <td className="right mono strong">
                        {planItem.units.toLocaleString("en-US")}
                      </td>
                      <td className="right mono">{planItem.unitsPerWorld}</td>
                      <td className="right mono">{formatGp(planItem.unitCost)}</td>
                      <td className="right mono">
                        {planItem.units > 0
                          ? formatGp(Math.round(planItem.avgShopPrice))
                          : "—"}
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
                      <td
                        className="right mono dim"
                        title={
                          planItem.priceLimited
                            ? "The batch stopped where the shop's next price stopped beating the GE cost"
                            : "The batch was capped by the GE purchase limit"
                        }
                      >
                        {formatGp(planItem.firstUnitPrice)} →{" "}
                        {formatGp(planItem.lastUnitPrice)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="basket-flags">
            <span className="flag">worlds shared</span>
            <span className="flag">one GE trip</span>
            <span className="flag">no banking</span>
            <span className="flag">
              {plan.offerSlots} GE buy slot{plan.offerSlots === 1 ? "" : "s"}
            </span>
            {plan.budgetLimited && <span className="flag warn">budget limited</span>}
            {plan.worldLimited && <span className="flag warn">world cap</span>}
            {priceLimited && <span className="flag">price-capped batch</span>}
            {unknownTravel && (
              <span className="flag warn">GE distance unknown</span>
            )}
          </div>

          <p className="basket-note">
            <strong>Units</strong> is the allocation across all worlds,{" "}
            <strong>Batch</strong> is what one fresh world absorbs, and world
            hops are shared: the basket needs{" "}
            {plan.worlds} world{plan.worlds === 1 ? "" : "s"}, not the sum of
            each item's. Items are collected from the GE as banknotes, so there
            are no inventory loads or bank trips; the basket needs one GE↔shop
            trip. <strong>Spend</strong> never exceeds the gold you entered; the
            allocator takes the next marginal unit with the best profit per coin,
            skipping zero-margin units and unaffordable ones. A full world resets
            every item's stock.
          </p>
          <p className="basket-note">
            <strong>GE supply</strong> schedules each item's 4h buy time across{" "}
            {plan.offerSlots} concurrent offer slot
            {plan.offerSlots === 1 ? "" : "s"} (members 8, free 3);{" "}
            <strong>Total time</strong> is the slower of that and the trip plus
            hops. The shop is assumed to be at default stock on every world, and
            straight-line distance ignores obstacles and teleports. The
            200-world ceiling still applies.
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
