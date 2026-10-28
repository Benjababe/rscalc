/**
 * Typed client for https://prices.runescape.wiki/api/v2/osrs/
 *
 * Docs: https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices
 * No API key required. A descriptive User-Agent is required (see http.ts).
 *
 * Verified live on 2026-07: `/mapping` returned 4674 items, 4157 with a GE
 * `limit` and 4655 with a `value`.
 */

import { z } from 'zod';
import { fetchJson } from './http.js';

const BASE = 'https://prices.runescape.wiki/api/v2/osrs';

// --- schemas ---------------------------------------------------------------

/** Item metadata. `limit` is the GE 4-hour buy limit; `value` is the item's
 *  base value, which is the input to every shop price formula.
 *
 *  `value` is genuinely absent for a handful of items (19 of 4674 when
 *  measured), so it is modelled as nullable rather than defaulted to 0 — a
 *  0 base value would silently price those shop rows at nothing. */
export const MappingItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  examine: z.string().default(''),
  members: z.boolean(),
  lowalch: z.number().int().nullable().optional(),
  highalch: z.number().int().nullable().optional(),
  limit: z.number().int().nullable().optional(),
  value: z.number().int().nullable().default(null),
  icon: z.string(),
});
export type MappingItem = z.infer<typeof MappingItemSchema>;

const MappingSchema = z.array(MappingItemSchema);

const LatestEntrySchema = z.object({
  high: z.number().int().nullable(),
  highTime: z.number().int().nullable(),
  low: z.number().int().nullable(),
  lowTime: z.number().int().nullable(),
});
export type LatestEntry = z.infer<typeof LatestEntrySchema>;

const LatestSchema = z.object({
  data: z.record(z.string(), LatestEntrySchema),
});

const VolumeEntrySchema = z.object({
  avgHighPrice: z.number().nullable(),
  avgLowPrice: z.number().nullable(),
  highPriceVolume: z.number(),
  lowPriceVolume: z.number(),
});
export type VolumeEntry = z.infer<typeof VolumeEntrySchema>;

const VolumeSchema = z.object({
  data: z.record(z.string(), VolumeEntrySchema),
});

const TimeseriesSchema = z.object({
  data: z.array(
    z.object({
      timestamp: z.number().int(),
      avgHighPrice: z.number().nullable(),
      avgLowPrice: z.number().nullable(),
      highPriceVolume: z.number(),
      lowPriceVolume: z.number(),
    }),
  ),
});

export type Timestep = '5m' | '1h' | '6h' | '24h';

// --- endpoints -------------------------------------------------------------

/** All tradeable items with metadata. TTL 24h: it changes rarely. */
export async function fetchMapping(): Promise<{
  items: MappingItem[];
  fetchedAt: number;
}> {
  const { body, fetchedAt } = await fetchJson(`${BASE}/mapping`, {
    ttlMs: 24 * 60 * 60 * 1000,
  });
  return { items: MappingSchema.parse(body), fetchedAt };
}

/** Latest instantaneous guide prices. TTL 60s. */
export async function fetchLatest(): Promise<{
  data: Record<string, LatestEntry>;
  fetchedAt: number;
}> {
  const { body, fetchedAt } = await fetchJson(`${BASE}/latest`, { ttlMs: 60_000 });
  return { data: LatestSchema.parse(body).data, fetchedAt };
}

/** Rolling 24h averages and volumes. TTL 1h. */
export async function fetch24h(): Promise<{
  data: Record<string, VolumeEntry>;
  fetchedAt: number;
}> {
  const { body, fetchedAt } = await fetchJson(`${BASE}/24h`, {
    ttlMs: 60 * 60 * 1000,
  });
  return { data: VolumeSchema.parse(body).data, fetchedAt };
}

/** Price history for one item. TTL 1h. */
export async function fetchTimeseries(
  id: number,
  timestep: Timestep = '24h',
): Promise<z.infer<typeof TimeseriesSchema>['data']> {
  const { body } = await fetchJson(`${BASE}/timeseries?timestep=${timestep}&id=${id}`, {
    ttlMs: 60 * 60 * 1000,
  });
  return TimeseriesSchema.parse(body).data;
}
