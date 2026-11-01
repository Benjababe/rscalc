/**
 * Curated `upgrade` recipes: work that converts one finished item into a better
 * version of itself, rather than building a thing.
 *
 * Why this category exists. A row's `kind` used to be a single question — *can the
 * output be sold?* — so `Necklace of rupture` (anguish + fang, 144M a go, eight
 * conversions a day) and `Blood rune` (two gold of essence, 24,000 actions a 4h
 * window) were both `transform`. They sat at opposite ends of one gp/hour ranking
 * while having nothing in common: one is a one-off re-work of a finished item, the
 * other is repeatable training. `upgrade` is the missing distinction.
 *
 * Definition used here, and the test for a new entry:
 *   the recipe consumes a **finished, tradeable item** and produces a different
 *   item that **is that same item upgraded**, by attaching a unique component
 *   (a kit, crystal, fang, visage, essence or plate).
 *
 * Deliberately *not* upgrades, even when the capital is large:
 *   - regular enchantments and stringing (`Tormented bracelet`, `Dragon crossbow`)
 *     — repeatable, thousands of them a day;
 *   - assembly of a unique drop into a new weapon (`Toxic blowpipe (empty)`,
 *     `Serpentine helm (uncharged)`) — nothing is being upgraded, a component is
 *     becoming the item;
 *   - combining two halves (`Dragon sq shield`), smelting (`Chromium ingot`),
 *     cutting (`Onyx`, `Onyx bolt tips`) and tanning.
 *
 * Curated, never inferred. The repo has been burned by positional parsing of wiki
 * tables (see `docs/skilling-plan.md` §8.10), and this distinction is a game
 * semantic, not a number: a threshold like "an input costs >50% of the output"
 * labels a basket as an upgrade and misses Masori, so there is no formula to lean
 * on. Each entry cites the item's own page, and the engine matches on
 * `skill|output` so an entry cannot silently apply to a different recipe.
 */

export interface SkillUpgrade {
  skill: string;
  /** The upgraded item, as the recipe's output page names it. */
  item: string;
  /** Wiki page that documents the conversion. */
  source: string;
}

const wiki = (page: string): string =>
  `https://oldschool.runescape.wiki/w/${encodeURIComponent(page.replace(/ /g, '_'))}`;

const entry = (skill: string, item: string): SkillUpgrade => ({
  skill,
  item,
  source: wiki(item),
});

/** The attachment family: an existing item plus a unique component. */
export const SKILL_UPGRADES: readonly SkillUpgrade[] = [
  // Araxyte fangs re-work jewellery (Varlamore / Araxxor).
  entry('Crafting', 'Necklace of rupture'),
  entry('Crafting', 'Amulet of rancour'),
  // Masori fortification: each piece plus an Armadylean plate.
  entry('Crafting', 'Masori mask (f)'),
  entry('Crafting', 'Masori body (f)'),
  entry('Crafting', 'Masori chaps (f)'),
  // A unique essence fused into an existing item.
  entry('Magic', 'Saturated heart'),
  entry('Crafting', "Bryophyta's staff (uncharged)"),
  entry('Crafting', 'Toxic staff (uncharged)'),
  entry('Crafting', 'Uncharged toxic trident'),
  entry('Crafting', 'Accursed sceptre (u)'),
  entry('Fletching', 'Webweaver bow (u)'),
  entry('Smithing', 'Ursine chainmace (u)'),
  // Boots plus their respective crystal. The bucket files these recipes under
  // Runecraft and Magic, not Crafting, so those are the only keys that can match.
  entry('Runecraft', 'Pegasian boots'),
  entry('Magic', 'Pegasian boots'),
  entry('Runecraft', 'Primordial boots'),
  entry('Magic', 'Primordial boots'),
  entry('Runecraft', 'Eternal boots'),
  entry('Magic', 'Eternal boots'),
  // Spirit shields: a sigil fused into an existing blessed shield. The bucket
  // tags this recipe with more than one skill, so each tag needs its own key or
  // the row prices as a Prayer "money maker", which it is not.
  entry('Smithing', 'Arcane spirit shield'),
  entry('Prayer', 'Arcane spirit shield'),
  // Dragonic visages attached to a shield.
  entry('Smithing', 'Dragonfire shield'),
  entry('Smithing', 'Dragonfire ward'),
  // An axe head re-hafted.
  entry('Smithing', 'Dragon felling axe'),
  entry('Smithing', 'Rune felling axe'),
];

/** `skill|output` keys, lower-cased for a case-insensitive match. */
export function upgradeKeys(
  upgrades: readonly SkillUpgrade[] = SKILL_UPGRADES,
): ReadonlySet<string> {
  return new Set(
    upgrades.map((row) => `${row.skill}|${row.item}`.toLowerCase()),
  );
}
