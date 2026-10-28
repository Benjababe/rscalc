import { useMemo, useState } from "react";
import type { Opportunity, Ranking, SellMode } from "../../src/types";

import payload from "../../data/opportunities.json";

type SortKey =
  | "gpPer4h"
  | "margin"
  | "marginPct"
  | "avgCost"
  | "sellPrice"
  | "units"
  | "totalProfit"
  | "itemName";

interface OpportunitiesPayload {
  generatedAt: string;
  pessimistic: Ranking;
  patient: Ranking;
}

/**
 * The bundle is a static snapshot. There are no network calls in this component,
 * by design: `pnpm build:data` produces the JSON and the browser only reads it.
 */
const DATA = payload as OpportunitiesPayload;

const MODE_LABEL: Record<SellMode, string> = {
  pessimistic: "Instant sell (GE low)",
  patient: "Patient (GE high)",
};

export function App(): JSX.Element {
  const [mode, setMode] = useState<SellMode>("pessimistic");
  const [query, setQuery] = useState("");
  const [membersOnly, setMembersOnly] = useState(false);
  const [minVolume, setMinVolume] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("gpPer4h");
  const [descending, setDescending] = useState(true);

  const ranking = DATA[mode];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = ranking.opportunities.filter((opp) => {
      if (membersOnly && !opp.members) return false;
      if (opp.sellablePer4h < minVolume) return false;
      if (needle === "") return true;
      return (
        opp.itemName.toLowerCase().includes(needle) ||
        opp.shopName.toLowerCase().includes(needle) ||
        (opp.location ?? "").toLowerCase().includes(needle)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "itemName") {
        return descending
          ? b.itemName.localeCompare(a.itemName)
          : a.itemName.localeCompare(b.itemName);
      }
      return descending ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey];
    });

    return sorted;
  }, [ranking, query, membersOnly, minVolume, sortKey, descending]);

  const bestGp = rows.length > 0 ? Math.max(...rows.map((r) => r.gpPer4h)) : 0;
  const medianMargin =
    rows.length > 0
      ? [...rows].map((r) => r.margin).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0
      : 0;

  function toggleSort(key: SortKey): void {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>rscalc</h1>
          <p className="sub">
            Buy from a shop, sell on the Grand Exchange. Prices from the OSRS Wiki
            real-time API.
          </p>
        </div>
        <div className="asof">
          <span className="label">GE prices as of</span>
          <strong>{formatTime(DATA[mode === "patient" ? "patient" : "pessimistic"].pricesAsOf)}</strong>
          <span className="label">built {formatTime(DATA.generatedAt)}</span>
        </div>
      </header>

      <section className="controls">
        <div className="modes" role="group" aria-label="Sell mode">
          {(["pessimistic", "patient"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "mode active" : "mode"}
              onClick={() => setMode(m)}
              aria-pressed={m === mode}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <input
          className="search"
          type="search"
          placeholder="Filter by item, shop or location…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter"
        />

        <label className="toggle">
          <input
            type="checkbox"
            checked={membersOnly}
            onChange={(event) => setMembersOnly(event.target.checked)}
          />
          Members only
        </label>

        <label className="toggle">
          Min units / 4h
          <input
            className="num"
            type="number"
            min={0}
            step={1}
            value={minVolume}
            onChange={(event) => setMinVolume(Number(event.target.value) || 0)}
          />
        </label>
      </section>

      <section className="stats">
        <Stat label="Opportunities" value={rows.length.toLocaleString()} />
        <Stat label="Best gp / 4h" value={formatGp(bestGp)} accent />
        <Stat label="Median margin" value={`${formatGp(medianMargin)} gp`} />
        <Stat label="Shops scanned" value="593" />
      </section>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="num-col">#</th>
              <Th label="Item" onClick={() => toggleSort("itemName")} active={sortKey === "itemName"} desc={descending} />
              <th>Shop</th>
              <th>Location</th>
              <Th label="Buy" onClick={() => toggleSort("avgCost")} active={sortKey === "avgCost"} desc={descending} right />
              <Th label="Sell" onClick={() => toggleSort("sellPrice")} active={sortKey === "sellPrice"} desc={descending} right />
              <th className="right">Tax</th>
              <Th label="Margin" onClick={() => toggleSort("margin")} active={sortKey === "margin"} desc={descending} right />
              <Th label="Qty" onClick={() => toggleSort("units")} active={sortKey === "units"} desc={descending} right />
              <Th label="Units / 4h" onClick={() => toggleSort("units")} active={false} desc={descending} right />
              <Th label="gp / 4h" onClick={() => toggleSort("gpPer4h")} active={sortKey === "gpPer4h"} desc={descending} right />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((opp, index) => (
              <Row key={`${opp.itemId}-${opp.shopPage}`} opp={opp} rank={index + 1} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No opportunities match these filters.</p>}
        {rows.length > 300 && (
          <p className="empty">Showing the top 300 of {rows.length.toLocaleString()}.</p>
        )}
      </div>

      <footer className="footer">
        <p>
          <strong>Buy</strong> is the average cost per unit across the quantity you
          would take; shop prices rise with every unit bought. <strong>Qty</strong> is
          what one shop visit yields before the next unit stops being profitable.
          <strong> Units / 4h</strong> is capped by the GE buy limit and 24h traded
          volume.
        </p>
        <p>
          Gross margin is net of the 2% GE tax (capped at 5,000,000 gp, items under
          50 gp exempt). Shop stock is per-world; restock times are not modelled.
          Item names and icons are © Jagex; wiki data is CC BY-SA.
        </p>
      </footer>
    </div>
  );
}

function Row({ opp, rank }: { opp: Opportunity; rank: number }): JSX.Element {
  return (
    <tr>
      <td className="num-col">{rank}</td>
      <td className="item">
        <span className="name">{opp.itemName}</span>
        {opp.members && <span className="badge">P2P</span>}
      </td>
      <td className="shop" title={opp.shopPage}>
        {opp.shopName}
        {opp.soldBy !== null && <span className="vendor"> · {opp.soldBy}</span>}
      </td>
      <td className="loc">{opp.location ?? "—"}</td>
      <td className="right mono">{formatGp(Math.round(opp.avgCost))}</td>
      <td className="right mono">{formatGp(opp.sellPrice)}</td>
      <td className="right mono dim">{formatGp(opp.taxPerUnit)}</td>
      <td className="right mono pos">{formatGp(Math.round(opp.margin))}</td>
      <td className="right mono">{opp.units}</td>
      <td className="right mono dim">{opp.sellablePer4h.toLocaleString()}</td>
      <td className="right mono strong">{formatGp(Math.round(opp.gpPer4h))}</td>
    </tr>
  );
}

function Th(props: {
  label: string;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  right?: boolean;
}): JSX.Element {
  return (
    <th className={props.right ? "right sortable" : "sortable"}>
      <button type="button" onClick={props.onClick}>
        {props.label}
        {props.active && <span className="arrow">{props.desc ? "▾" : "▴"}</span>}
      </button>
    </th>
  );
}

function Stat(props: { label: string; value: string; accent?: boolean }): JSX.Element {
  return (
    <div className={props.accent ? "stat accent" : "stat"}>
      <span className="label">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatGp(value: number): string {
  return value.toLocaleString("en-US");
}

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}
