/**
 * Build `data/shop-access.json` from the catalogue and the curated access rules.
 *
 *   pnpm run access
 *
 * This script makes **no network calls**. It reads `data/shops.json`, applies
 * `scripts/shopAccessRules.ts`, and writes one entry per shop page with a known
 * access requirement. Shops that match no rule stay unknown (absent). See
 * `docs/shop-access.md` for the source policy.
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { buildAccessEntries } from '../src/domain/shopAccess.js';
import { readJsonFile } from '../src/util/json.js';
import {
  ShopAccessCatalogSchema,
  ShopCatalogSchema,
} from '../src/types.js';
import { ACCESS_RULES, SHOP_ACCESS_OVERRIDES } from './shopAccessRules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOPS = join(ROOT, 'data', 'shops.json');
const OUT = join(ROOT, 'data', 'shop-access.json');

async function main(): Promise<void> {
  const catalog = await readJsonFile(SHOPS, ShopCatalogSchema);
  const entries = buildAccessEntries(
    catalog.entries,
    ACCESS_RULES,
    SHOP_ACCESS_OVERRIDES,
  );

  const payload = ShopAccessCatalogSchema.parse({
    generatedAt: new Date().toISOString(),
    source:
      'Curated from OSRS Wiki shop and location pages; see docs/shop-access.md',
    entries,
  });

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const byKind = new Map<string, number>();
  for (const entry of entries) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  }

  process.stdout.write(`\nwrote ${relative(OUT)}\n`);
  process.stdout.write(
    `  ${entries.length} shop pages with a known access requirement\n`,
  );
  process.stdout.write(
    `  ${[...byKind]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${kind} ${count}`)
      .join(' | ')}\n`,
  );
  process.stdout.write(
    `  ${catalog.shopCount - entries.length} shop pages left unknown (absent, not "accessible")\n`,
  );
}

function relative(absolute: string): string {
  return absolute.slice(ROOT.length + 1).replace(/\\/g, '/');
}

main().catch((error: unknown) => {
  process.stderr.write(`refresh-access failed: ${String(error)}\n`);
  process.exitCode = 1;
});
