/**
 * Rank GE -> shop flips and write `data/shop-sinks.json` for the UI.
 *
 *   pnpm sinks                        # top 25, pessimistic (instant buy at high)
 *   pnpm sinks --mode=patient         # buy offers at the GE low and wait
 *   pnpm sinks --include-general-stores
 *   pnpm sinks --write                # emit both modes for the UI
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
      `GE origin: ${catalog.gePoint === null ? 'unknown' : `${catalog.gePoint.x},${catalog.gePoint.y} (mapID ${catalog.gePoint.mapID})`}\n`,
  );
  process.stdout.write(`${'='.repeat(132)}\n`);
  process.stdout.write(
    pad('#', 3) +
      pad('Item', 24) +
      pad('Shop', 22) +
      pad('GE buy', 9) +
      pad('Shop pays', 14) +
      pad('Qty', 6) +
      pad('Spend', 11) +
      pad('Profit', 11) +
      pad('gp/hour', 12) +
      pad('Loc', 18) +
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
        pad(truncate(opp.itemName, 23), 24) +
        pad(truncate(opp.shopName, 21), 22) +
        pad(formatGp(opp.geBuyPrice), 9) +
        pad(shopPays, 14) +
        pad(String(opp.units), 6) +
        pad(formatGp(Math.round(opp.totalCost)), 11) +
        pad(formatGp(Math.round(opp.profit)), 11) +
        pad(
          opp.gpPerHour === null
            ? '—'
            : formatGp(Math.round(opp.gpPerHour)),
          12,
        ) +
        pad(truncate(opp.location ?? '-', 17), 18) +
        '\n',
    );
  });

  process.stdout.write(`${'-'.repeat(130)}\n`);
  process.stdout.write(
    'GE buy = price paid per unit (no tax on purchases). Shop pays = first→last unit,\n' +
      'falling as the shop fills. Qty is bounded by the shop price curve and the GE\n' +
      '4h buy limit/volume. Rows without a published shop buy price are excluded,\n' +
      'and gp/hour is — when the shop has no known distance from the Grand Exchange.\n',
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
