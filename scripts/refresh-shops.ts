/**
 * Build `data/shops.json` — the shop catalogue.
 *
 *   pnpm shops            # uses the 24h disk cache when warm
 *   pnpm shops --fresh    # ignore the cache
 *
 * Sources:
 *   - shop stock tables: Special:Bucket?bucket=storeline
 *   - shop coordinates: Special:Bucket?bucket=map
 *   - bank coordinates: Category:Banks page wikitext (`{{Map|...}}`)
 *   - item ids and base values: prices.runescape.wiki/api/v2/osrs/mapping
 *   - shop categories: the wiki's own page categories
 *
 * Rule from AGENTS.md: a field is either sourced or `null`. We never invent a
 * stock figure or a bank distance, because a fabricated one produces confident,
 * wrong profit.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { fetchMapping, type MappingItem } from '../src/api/prices.js';
import {
  displayShopName,
  fetchShopTypes,
  fetchStoreLines,
  isInfiniteStock,
  parseIntCell,
  parseStockCell,
  type RawStoreLine,
} from '../src/api/storeBucket.js';
import { fetchBankTitles, fetchMapPoints, fetchPageMapPoints } from '../src/api/wikiMap.js';
import { mapDistanceTiles, nearestBankFor } from '../src/domain/bankTrip.js';
import { isGeneralStore } from '../src/domain/shopSink.js';
import { ShopCatalogSchema, type ShopEntry } from '../src/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'shops.json');

async function main(): Promise<void> {
  const started = Date.now();
  log('fetching shop stock tables...');
  const { lines, fetchedAt, pages } = await fetchStoreLines();
  log(`  ${lines.length} stock rows from ${new Set(lines.map((l) => l.shopPage)).size} shops (${pages} pages)`);

  log('fetching item metadata (mapping)...');
  const { items } = await fetchMapping();
  log(`  ${items.length} tradeable items`);

  const byName = new Map<string, MappingItem>();
  for (const item of items) byName.set(item.name.toLowerCase(), item);

  const shopTitles = [...new Set(lines.map((line) => line.shopPage))];
  log(`fetching categories for ${shopTitles.length} shops (batched)...`);
  const shopTypes = await fetchShopTypes(shopTitles);
  log(`  ${shopTypes.size} shops annotated`);

  log('fetching shop coordinates (map bucket)...');
  const map = await fetchMapPoints();
  log(`  ${map.points.size} pages located (${map.rows} rows, ${map.pages} pages)`);

  log('fetching bank locations...');
  const bankTitles = await fetchBankTitles();
  const bankPoints = await fetchPageMapPoints(bankTitles);
  log(
    `  ${bankPoints.points.size}/${bankTitles.length} banks located (${bankPoints.requests} requests)`,
  );

  // The Grand Exchange is the origin of every GE -> shop trip. Its map template
  // is the only sourced way to get that point; if it is missing we store null
  // and the sink planner reports gp/hour as unknown rather than guessing.
  log('locating the Grand Exchange...');
  const ge = await fetchPageMapPoints(['Grand Exchange']);
  const gePoint = ge.points.get('Grand Exchange') ?? null;
  log(
    gePoint === null
      ? '  WARNING: no usable map template; GE -> shop distances will be null'
      : `  Grand Exchange at ${gePoint.x},${gePoint.y} (mapID ${gePoint.mapID})`,
  );

  // One distance per shop page, shared by every row that shop sells. Shops
  // with no map point, or with no bank in their coordinate space, stay null:
  // the budget planner then refuses to invent a bank time for them.
  const bankByShop = new Map<
    string,
    {
      bankTiles: number | null;
      nearestBank: string | null;
      geTiles: number | null;
    }
  >();
  let withoutCoordinates = 0;
  let withoutBank = 0;
  let withoutGeDistance = 0;

  for (const page of shopTitles) {
    const point = map.points.get(page);
    if (point === undefined) {
      withoutCoordinates += 1;
      bankByShop.set(page, {
        bankTiles: null,
        nearestBank: null,
        geTiles: null,
      });
      continue;
    }

    const geTiles =
      gePoint === null ? null : mapDistanceTiles(point, gePoint);
    if (geTiles === null) withoutGeDistance += 1;

    const nearest = nearestBankFor(point, bankPoints.points);
    if (nearest === null) {
      withoutBank += 1;
      bankByShop.set(page, {
        bankTiles: null,
        nearestBank: null,
        geTiles: geTiles === null ? null : round1(geTiles),
      });
      continue;
    }

    bankByShop.set(page, {
      bankTiles: round1(nearest.tiles),
      nearestBank: nearest.bankPage,
      geTiles: geTiles === null ? null : round1(geTiles),
    });
  }

  log(
    `  ${shopTitles.length - withoutCoordinates - withoutBank}/${shopTitles.length} shops have a bank distance ` +
      `(${withoutCoordinates} without coordinates, ${withoutBank} without a bank on their map)`,
  );
  log(
    gePoint === null
      ? `  ${shopTitles.length - withoutCoordinates}/${shopTitles.length} shops have a GE distance ` +
          '(0: the Grand Exchange has no usable map point)'
      : `  ${shopTitles.length - withoutCoordinates - withoutGeDistance}/${shopTitles.length} shops have a GE distance ` +
          `(${withoutCoordinates} without coordinates, ${withoutGeDistance} of the rest on another map)`,
  );

  const entries: ShopEntry[] = [];
  let unresolved = 0;

  for (const line of lines) {
    const match = byName.get(normaliseItemName(line.itemName).toLowerCase());
    if (match === undefined) unresolved += 1;
    const bank = bankByShop.get(line.shopPage) ?? {
      bankTiles: null,
      nearestBank: null,
      geTiles: null,
    };

    entries.push({
      shopPage: line.shopPage,
      shopName: displayShopName(line.shopPage),
      soldBy: line.soldBy,
      itemName: line.itemName,
      itemId: match?.id ?? null,
      itemValue: match?.value ?? null,
      members: line.members,
      location: line.location,
      shopTypes: shopTypes.get(line.shopPage) ?? [],
      sellMultiplier: line.sellMultiplier,
      buyMultiplier: line.buyMultiplier,
      delta: line.delta,
      baseStock: parseStockCell(line.stockRaw),
      infiniteStock: isInfiniteStock(line.stockRaw),
      restockTicks: parseIntCell(line.restockRaw),
      bankTiles: bank.bankTiles,
      nearestBank: bank.nearestBank,
      geTiles: bank.geTiles,
      storeSellPrice: line.storeSellPrice,
      storeBuyPrice: line.storeBuyPrice,
      currency: line.currency,
    });
  }

  const catalog = ShopCatalogSchema.parse({
    generatedAt: new Date(fetchedAt).toISOString(),
    source: 'https://oldschool.runescape.wiki/w/Special:Bucket?bucket=storeline',
    gePoint,
    shopCount: shopTitles.length,
    entries,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  const resolved = entries.filter((e) => e.itemId !== null).length;
  log('');
  log(`wrote ${relative(OUT)}`);
  log(`  shops:            ${catalog.shopCount}`);
  log(`  stock rows:       ${entries.length}`);
  log(`  resolved to GE:   ${resolved}`);
  log(`  unresolved names: ${unresolved} (kept, itemId=null)`);
  log(`  infinite stock:   ${entries.filter((e) => e.infiniteStock).length}`);
  log(`  non-Coins:        ${entries.filter((e) => e.currency.toLowerCase() !== 'coins').length}`);
  log(`  with bank distance: ${entries.filter((e) => e.bankTiles !== null).length}`);
  log(`  with GE distance:   ${entries.filter((e) => e.geTiles !== null).length}`);
  log(`  general-store rows: ${entries.filter((e) => isGeneralStore(e.shopTypes)).length}`);
  log(`  elapsed:          ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/**
 * Shop tables sometimes decorate names ("Air rune (pack)" vs the GE's
 * "Air rune pack"). Strip a trailing parenthetical qualifier only, which is the
 * one shape observed; anything else stays unresolved rather than guessed.
 */
function normaliseItemName(raw: string): string {
  return raw.replace(/\s*\((?:untrimmed|trimmed)\)\s*$/i, '').trim();
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

/** One decimal place is the precision the bank distance already uses. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-shops failed: ${String(error)}\n`);
  process.exitCode = 1;
});

export type { RawStoreLine };
