/**
 * Curated gathering nodes: the item pages whose `{{Mining info}}` /
 * `{{Woodcutting info}}` template publishes a level, an xp value and a **respawn
 * time**. The parser is `src/api/wikiGathering.ts`; this file only says *which*
 * items to read, because the wiki has no category that means "an ore a rock
 * yields".
 *
 * Every page listed here was checked to carry the template. Four candidates were
 * dropped because they do not: `Amethyst`, `Pure essence`, `Sandstone (1kg)` and
 * `Lunar ore` use a different infobox or publish no respawn, so they have no
 * gathering rate to price.
 *
 * What stays out on purpose: fishing (catch rate is not published as a constant),
 * Hunter traps (catch chance), Thieving (success chance and loot tables). Those
 * need an expected value over a published distribution, which is a different
 * feature — see `docs/skilling-plan.md` §8.14.
 */

export interface GatheringNodePage {
  /** Item page on the wiki, which is also the artifact's source link. */
  item: string;
}

/** Ores a rock yields, one unit per respawn. */
export const MINING_NODES: readonly GatheringNodePage[] = [
  { item: 'Clay' },
  { item: 'Copper ore' },
  { item: 'Tin ore' },
  { item: 'Iron ore' },
  { item: 'Silver ore' },
  { item: 'Coal' },
  { item: 'Gold ore' },
  { item: 'Mithril ore' },
  { item: 'Adamantite ore' },
  { item: 'Runite ore' },
  { item: 'Blurite ore' },
  { item: 'Lovakite ore' },
  { item: 'Volcanic ash' },
];

/** Logs a tree yields, one unit per respawn. */
export const WOODCUTTING_NODES: readonly GatheringNodePage[] = [
  { item: 'Logs' },
  { item: 'Achey tree logs' },
  { item: 'Oak logs' },
  { item: 'Willow logs' },
  { item: 'Teak logs' },
  { item: 'Maple logs' },
  { item: 'Mahogany logs' },
  { item: 'Arctic pine logs' },
  { item: 'Yew logs' },
  { item: 'Magic logs' },
  { item: 'Redwood logs' },
  { item: 'Camphor logs' },
  { item: 'Ironwood logs' },
  { item: 'Rosewood logs' },
];

/** Which curated list belongs to which scanned skill. */
export const GATHERING_NODE_SOURCES: Readonly<
  Record<string, readonly GatheringNodePage[]>
> = {
  Mining: MINING_NODES,
  Woodcutting: WOODCUTTING_NODES,
};
