/**
 * Rank GE -> shop flips and write `data/shop-sinks.json` for the UI.
 *
 *   pnpm sinks                        # top 25, pessimistic (instant buy at high)
 *   pnpm sinks --mode=patient         # buy offers at the GE low and wait
 *   pnpm sinks --include-general-stores
 *   pnpm sinks --hop=8 --max-worlds=150
 *   pnpm sinks --write                # emit both modes for the UI
 *
 * Items are collected from the GE as banknotes, so there are no inventory
 * loads or banking trips. Each world resets the shop's stock, so the plan is
 * one GE <-> shop trip plus one hop per extra world.
 *
 * This script makes **no network calls**: it reads the catalogue
 * (`data/shops.json`, which carries the GE distance per shop) and the market
 * snapshot (`data/market.json`). Run `pnpm shops && pnpm market` first.
 *
 * Direction and mode names:
 *   pessimistic = instant buy at GE `high` (guaranteed fill, worst price)
 *   patient     = buy offer at GE `low`   (better price, may not fill)
 * See `src/engine/sinkRank.ts` and docs/shop-mechanics.md §12.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { rankSinks, type SinkRankOptions } from '../src/engine/sinkRank.js';
import { DEFAULT_HOP_SECONDS, DEFAULT_MAX_WORLDS } from '../src/domain/budget.js';
import { readJsonFile } from '../src/util/json.js';
import {
  MarketSnapshotSchema,
  ShopCatalogSchema,
  ShopSinkRankingSchema,
  ShopSinksPayloadSchema,
  type MarketSnapshot,
  type SellMode,
  type ShopCatalog,
  type ShopSinkRanking,
} from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOPS = join(ROOT, 'data', 'shops.json');
const MARKET = join(ROOT, 'data', 'market.json');
const OUT = join(ROOT, 'data', 'shop-sinks.json');

interface Cli {
  mode: SellMode;
  limit: number;
  members: boolean;
  minProfit: number;
  minVolume4h: number;
  includeInfinite: boolean;
  excludeGeneralStores: boolean;
  secondsPerTile: number;
  hopSeconds: number;
  maxWorlds: number;
  write: boolean;
}

function nonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number, got "${value}"`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    mode: 'pessimistic',
    limit: 25,
    members: false,
    minProfit: 1,
    minVolume4h: 0,
    includeInfinite: false,
    excludeGeneralStores: true,
    secondsPerTile: 0.6,
    hopSeconds: DEFAULT_HOP_SECONDS,
    maxWorlds: DEFAULT_MAX_WORLDS,
    write: false,
  };

  for (const arg of argv) {
    if (arg === '--members') cli.members = true;
    else if (arg === '--write') cli.write = true;
    else if (arg === '--infinite') cli.includeInfinite = true;
    else if (arg === '--include-general-stores') cli.excludeGeneralStores = false;
    else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'pessimistic' && value !== 'patient') {
        throw new Error(`--mode must be pessimistic or patient, got "${value}"`);
      }
      cli.mode = value;
    } else if (arg.startsWith('--limit=')) {
      cli.limit = Math.max(0, Math.floor(Number(arg.slice('--limit='.length)) || 0));
    } else if (arg.startsWith('--min-profit=')) {
      cli.minProfit = nonNegativeNumber(
        arg.slice('--min-profit='.length),
        '--min-profit',
      );
    } else if (arg.startsWith('--min-volume4h=')) {
      cli.minVolume4h = nonNegativeNumber(
        arg.slice('--min-volume4h='.length),
        '--min-volume4h',
      );
    } else if (arg.startsWith('--speed=')) {
      cli.secondsPerTile = nonNegativeNumber(
        arg.slice('--speed='.length),
        '--speed',
      );
    } else if (arg.startsWith('--hop=')) {
      cli.hopSeconds = nonNegativeNumber(arg.slice('--hop='.length), '--hop');
    } else if (arg.startsWith('--max-worlds=')) {
      cli.maxWorlds = Math.max(
        1,
        Math.floor(nonNegativeNumber(arg.slice('--max-worlds='.length), '--max-worlds')),
      );
    } else {
      throw new Error(`Unknown argument "${arg}". See the header of this file.`);
    }
  }

  return cli;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const catalog = await readJsonFile(SHOPS, ShopCatalogSchema);
  const market = await readJsonFile(MARKET, MarketSnapshotSchema);

  const base: SinkRankOptions = {
    mode: cli.mode,
    excludeGeneralStores: cli.excludeGeneralStores,
    includeInfiniteStock: cli.includeInfinite,
    membersOnly: cli.members,
    minProfit: cli.minProfit,
    minVolume4h: cli.minVolume4h,
    secondsPerTile: cli.secondsPerTile,
    hopSeconds: cli.hopSeconds,
    maxWorlds: cli.maxWorlds,
  };

  const ranking = rankSinks(catalog, market, { ...base, limit: cli.limit });

  const direction =
    cli.mode === 'pessimistic'
      ? 'instant buy at GE high'
      : 'patient buy at GE low';

  process.stdout.write(
    `\nGE -> SHOP — ${cli.mode.toUpperCase()} mode (${direction})\n`,
  );
  process.stdout.write(
    `prices as of ${formatTime(market.pricesAsOf)} | ${catalog.shopCount} shops | ` +
      `${Object.keys(market.quotes).length} priced items\n`,
  );
  process.stdout.write(
    `general stores: ${cli.excludeGeneralStores ? 'excluded' : 'included'} | ` +
      `hop ${cli.hopSeconds}s | worlds ≤ ${cli.maxWorlds} | ` +
      `GE origin: ${catalog.gePoint === null ? 'unknown' : `${catalog.gePoint.x},${catalog.gePoint.y} (mapID ${catalog.gePoint.mapID})`}\n`,
  );
  process.stdout.write(`${'='.repeat(132)}\n`);
  process.stdout.write(
    pad('#', 3) +
      pad('Item', 22) +
      pad('Shop', 20) +
      pad('GE buy', 8) +
      pad('Shop pays', 13) +
      pad('Qty', 7) +
      pad('Batch', 6) +
      pad('Wrlds', 6) +
      pad('Spend', 11) +
      pad('Profit', 11) +
      pad('gp/hour', 11) +
      pad('Loc', 12) +
      '\n',
  );
  process.stdout.write(`${'-'.repeat(130)}\n`);

  if (ranking.opportunities.length === 0) {
    process.stdout.write('No profitable flips found with these filters.\n');
  }

  ranking.opportunities.forEach((opp, index) => {
    const shopPays =
      opp.shopFirstUnitPrice === opp.shopLastUnitPrice
        ? formatGp(opp.shopFirstUnitPrice)
        : `${formatGp(opp.shopFirstUnitPrice)}→${formatGp(opp.shopLastUnitPrice)}`;
    process.stdout.write(
      pad(String(index + 1), 3) +
        pad(truncate(opp.itemName, 21), 22) +
        pad(truncate(opp.shopName, 19), 20) +
        pad(formatGp(opp.geBuyPrice), 8) +
        pad(shopPays, 13) +
        pad(String(opp.units), 7) +
        pad(String(opp.unitsPerWorld), 6) +
        pad(`${opp.worlds}${opp.worldLimited ? '*' : ''}`, 6) +
        pad(formatGp(Math.round(opp.totalCost)), 11) +
        pad(formatGp(Math.round(opp.profit)), 11) +
        pad(
          opp.gpPerHour === null
            ? '—'
            : formatGp(Math.round(opp.gpPerHour)),
          11,
        ) +
        pad(truncate(opp.location ?? '-', 11), 12) +
        '\n',
    );
  });

  process.stdout.write(`${'-'.repeat(130)}\n`);
  process.stdout.write(
    'GE buy = price paid per unit (no tax on purchases). Shop pays = first→last unit of\n' +
      'one world batch; each extra unit lowers the offer by delta% of value. Items are\n' +
      'noted, so there are no banking trips: one GE↔shop trip plus one hop per world.\n' +
      'Qty totals all worlds, Batch is one fresh world, and Wrlds * means the world\n' +
      'ceiling bound before the GE purchase cap. gp/hour is — when the GE distance is\n' +
      'unknown. Rows without a published shop buy price are excluded.\n',
  );

  if (cli.write) {
    const payload = ShopSinksPayloadSchema.parse({
      generatedAt: new Date().toISOString(),
      pricesAsOf: market.pricesAsOf,
      gePoint: catalog.gePoint,
      pessimistic: buildFull(catalog, market, base, 'pessimistic'),
      patient: buildFull(catalog, market, base, 'patient'),
    });
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(
      `\nwrote ${relative(OUT)} (both modes, ${payload.pessimistic.count} + ${payload.patient.count} rows)\n`,
    );
  }
}

function buildFull(
  catalog: ShopCatalog,
  market: MarketSnapshot,
  base: SinkRankOptions,
  mode: SellMode,
): ShopSinkRanking {
  return ShopSinkRankingSchema.parse(
    rankSinks(catalog, market, { ...base, mode }),
  );
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatGp(value: number): string {
  return Math.trunc(value).toLocaleString('en-US');
}

function formatTime(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-sinks failed: ${String(error)}\n`);
  process.exitCode = 1;
});
