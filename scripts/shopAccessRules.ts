/**
 * Curated shop access rules.
 *
 * Every rule is backed by a wiki page that states the requirement. The rules
 * are applied to `data/shops.json` by `scripts/refresh-access.ts`, which emits
 * the per-shop `data/shop-access.json` consumed by the UI.
 *
 * This is deliberately not automatic. `Infobox Shop` has no requirement field;
 * some location pages carry a structured `|requirement =`, others only explain
 * it in prose. Only high-confidence, sourced requirements belong here. A shop
 * missing from the artifact is *unknown*, not accessible.
 *
 * Matching is against the catalogue's `location` string, case-insensitively.
 * `excludeShops` handles locations where the requirement does not apply (for
 * example, the Master fisher stands outside the Fishing Guild, and the Blast
 * Furnace shops are reachable by minigame teleport).
 */

import type {
  AccessRule,
  ShopAccessOverride,
} from '../src/domain/shopAccess.js';

export const ACCESS_RULES: readonly AccessRule[] = [
  {
    match: ['Fishing Guild'],
    requirement: '68 Fishing (boostable)',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Fishing_Guild',
    // The Master fisher is outside the guild.
    excludeShops: ['Master fisher'],
  },
  {
    match: ['Ranging Guild'],
    requirement: '40 Ranged (boostable)',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Ranging_Guild',
    // The Shield master stands outside the guild.
    excludeShops: ['Shield master'],
  },
  {
    match: ["Warriors' Guild", 'Warriors Guild'],
    requirement: '130 combined Attack+Strength, or 99 in either',
    kind: 'skill',
    source: "https://oldschool.runescape.wiki/w/Warriors%27_Guild",
  },
  {
    match: ["Wizards' Guild", 'Wizards Guild'],
    requirement: '66 Magic (boostable)',
    kind: 'skill',
    source: "https://oldschool.runescape.wiki/w/Wizards%27_Guild",
  },
  {
    match: ["Cooks' Guild", 'Cooks Guild'],
    requirement: "32 Cooking + chef's hat/cape or Varrock armour 3/4",
    kind: 'skill',
    source: "https://oldschool.runescape.wiki/w/Cooks%27_Guild",
  },
  {
    match: ['Crafting Guild'],
    requirement: '40 Crafting + brown apron or Crafting cape',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Crafting_Guild',
  },
  {
    match: ['Mining Guild'],
    requirement: '60 Mining',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Mining_Guild',
  },
  {
    match: ['Woodcutting Guild'],
    requirement: '60 Woodcutting (boostable)',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Woodcutting_Guild',
  },
  {
    match: ['Farming Guild'],
    requirement: '45 Farming (65/85 for the higher tiers)',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Farming_Guild',
  },
  {
    match: ['Hunter Guild'],
    requirement: '46 Hunter (not boostable)',
    kind: 'skill',
    source: 'https://oldschool.runescape.wiki/w/Hunter_Guild',
  },
  {
    match: ["Champions' Guild", 'Champions Guild'],
    requirement: '32 Quest Points',
    kind: 'other',
    source: "https://oldschool.runescape.wiki/w/Champions%27_Guild",
  },
  {
    match: ["Heroes' Guild", 'Heroes Guild'],
    requirement: "Heroes' Quest (completed)",
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Heroes%27_Guild",
  },
  {
    match: ["Legends' Guild", 'Legends Guild'],
    requirement: "Legends' Quest (completed for the shops inside)",
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Legends%27_Guild",
  },
  {
    match: ["Myths' Guild", 'Myths Guild'],
    requirement: 'Dragon Slayer II (completed)',
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Myths%27_Guild",
  },
  {
    match: ['Keldagrim'],
    requirement: 'The Giant Dwarf (started)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Keldagrim',
    // The Blast Furnace has its own minigame teleport and its shops are
    // reachable without the city entrance.
    excludeShops: ['Armour store.', 'Ore seller.'],
  },
  {
    match: ['Zanaris'],
    requirement: 'Lost City (completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Zanaris',
  },
  {
    match: ['Ape Atoll', 'Marim'],
    requirement: 'Monkey Madness I (partially completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Ape_Atoll',
  },
  {
    match: ['Lletya'],
    requirement: "Mourning's End Part I",
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Mourning%27s_End_Part_I",
  },
  {
    match: ['Prifddinas'],
    requirement: 'Song of the Elves (completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Prifddinas',
  },
  {
    match: ['Dorgesh-Kaan'],
    requirement: 'Death to the Dorgeshuun (completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Dorgesh-Kaan',
  },
  {
    match: ['Darkmeyer'],
    requirement: 'Sins of the Father (partial; full access needs completion)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Darkmeyer',
  },
  {
    match: ['Burgh de Rott'],
    requirement: 'In Aid of the Myreque (started)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Burgh_de_Rott',
  },
  {
    match: ["Mos Le'Harmless", 'Mos Le Harmless'],
    requirement: 'Cabin Fever (completed)',
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Mos_Le%27Harmless",
  },
  {
    match: ['Shilo Village'],
    requirement: 'Shilo Village (completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Shilo_Village',
  },
  {
    match: ['Lunar Isle'],
    requirement: 'Lunar Diplomacy (progressed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Lunar_Isle',
  },
  {
    match: ['Neitiznot'],
    requirement: 'The Fremennik Trials; started The Fremennik Isles',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Neitiznot',
  },
  {
    match: ['Jatizso'],
    requirement: 'The Fremennik Trials',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Jatizso',
  },
  {
    match: ['Piscatoris Fishing Colony'],
    requirement: 'Swan Song (partially completed)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Piscatoris_Fishing_Colony',
  },
  {
    match: ['Sophanem'],
    requirement: "Icthlarin's Little Helper (partially progressed)",
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Sophanem',
  },
  {
    match: ["Gu'Tanoth", 'Gu Tanoth'],
    requirement: 'Watchtower (progressed)',
    kind: 'quest',
    source: "https://oldschool.runescape.wiki/w/Gu%27Tanoth",
  },
  {
    match: ['Miscellania'],
    requirement: 'The Fremennik Trials',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Miscellania',
  },
  {
    match: ['Etceteria'],
    requirement: 'The Fremennik Trials',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Etceteria',
  },
  {
    match: ['Mor Ul Rek'],
    requirement: 'Fire cape (or fire max cape) to enter the interior',
    kind: 'item',
    source: 'https://oldschool.runescape.wiki/w/Mor_Ul_Rek',
  },
  {
    match: ['Troll Stronghold'],
    requirement: 'Troll Stronghold quest (progress)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Troll_Stronghold',
  },
];

/** Per-shop exceptions, applied before the area rules. */
export const SHOP_ACCESS_OVERRIDES: Readonly<
  Record<string, ShopAccessOverride>
> = {
  "Culinaromancer's Chest": {
    requirement: 'Recipe for Disaster (subquest progress unlocks stock)',
    kind: 'quest',
    source:
      "https://oldschool.runescape.wiki/w/Culinaromancer%27s_Chest",
  },
  Eblis: {
    requirement: 'Desert Treasure I (completed; his shop exists afterwards)',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Eblis',
  },
  "Oobapohk's Javelin Store": {
    requirement: 'Monkey Madness II (completed)',
    kind: 'quest',
    source:
      "https://oldschool.runescape.wiki/w/Oobapohk%27s_Javelin_Store",
  },
  // The Zanaris market gate also costs a cut diamond.
  'Irksol (shop)': {
    requirement: 'Lost City; market entry also costs a cut diamond',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Zanaris',
  },
  'Jukat (shop)': {
    requirement: 'Lost City; market entry also costs a cut diamond',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Zanaris',
  },
  Lunderwin: {
    requirement: 'Lost City; market entry also costs a cut diamond',
    kind: 'quest',
    source: 'https://oldschool.runescape.wiki/w/Zanaris',
  },
};
