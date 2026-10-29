/**
 * Shop access metadata.
 *
 * The OSRS Wiki has no single structured field for "can I enter this shop":
 * `Infobox Shop` has no requirement parameter, some location pages publish a
 * structured `|requirement =` (guilds, for example), and many quest areas state
 * it only in prose. `scripts/shopAccessRules.ts` therefore holds a curated,
 * cited set of area rules. This module applies those rules to the catalogue and
 * produces the per-shop artifact the UI consumes.
 *
 * Absence from the artifact means **unknown**, not accessible. The UI filter
 * hides only shops with a known requirement.
 */

import type {
  ShopAccessEntry,
  ShopAccessKind,
} from '../types.js';

/** A requirement that applies to every shop whose location matches. */
export interface AccessRule {
  /** Location substrings, matched case-insensitively. */
  match: string[];
  requirement: string;
  kind: ShopAccessKind;
  /** Wiki page that states the requirement. */
  source: string;
  /** Shop pages in this area that are reachable without the requirement. */
  excludeShops?: string[];
}

/** A per-shop exception that overrides any area rule. */
export type ShopAccessOverride = Omit<AccessRule, 'match' | 'excludeShops'>;

export interface AccessShop {
  shopPage: string;
  location: string | null;
}

/**
 * Build the per-shop access entries.
 *
 * Overrides win. Otherwise the first matching rule applies, unless the shop is
 * explicitly excluded. Shops with no location and no override stay unknown.
 * The result is sorted by shopPage so the artifact is deterministic.
 */
export function buildAccessEntries(
  shops: readonly AccessShop[],
  rules: readonly AccessRule[],
  overrides: Readonly<Record<string, ShopAccessOverride>>,
): ShopAccessEntry[] {
  // One row per shop page; prefer a non-null location if duplicate rows differ.
  const locations = new Map<string, string | null>();
  for (const shop of shops) {
    const current = locations.get(shop.shopPage);
    if (current === undefined || (current === null && shop.location !== null)) {
      locations.set(shop.shopPage, shop.location);
    }
  }

  const entries: ShopAccessEntry[] = [];
  for (const [shopPage, location] of locations) {
    const override = overrides[shopPage];
    if (override !== undefined) {
      entries.push({ shopPage, ...override });
      continue;
    }
    if (location === null) continue;

    const haystack = location.toLowerCase();
    for (const rule of rules) {
      if (rule.excludeShops?.includes(shopPage) === true) continue;
      const matches = rule.match.some((needle) =>
        haystack.includes(needle.toLowerCase()),
      );
      if (!matches) continue;
      entries.push({
        shopPage,
        requirement: rule.requirement,
        kind: rule.kind,
        source: rule.source,
      });
      break;
    }
  }

  return entries.sort((a, b) => a.shopPage.localeCompare(b.shopPage));
}

/** One lookup per use, for callers that join many rows. */
export function toAccessMap(
  entries: readonly ShopAccessEntry[],
): Map<string, ShopAccessEntry> {
  return new Map(entries.map((entry) => [entry.shopPage, entry]));
}

/** True when a shop has a known access requirement. */
export function isKnownLocked(
  entries: ReadonlyMap<string, ShopAccessEntry>,
  shopPage: string,
): boolean {
  return entries.has(shopPage);
}
