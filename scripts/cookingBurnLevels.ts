/**
 * Curated no-burn Cooking levels.
 *
 * Source: <https://oldschool.runescape.wiki/w/Cooking/Burn_level>
 * Mechanic: <https://oldschool.runescape.wiki/w/Cooking>
 *
 * Cooking is the one skill whose profit a recipe cannot answer on its own: a raw
 * food can burn, and burning destroys the input. The wiki publishes, per food and
 * per cooking source, the level at which it **stops burning** — above that level
 * the action is deterministic, so "buy raw, sell cooked" is an exact margin and no
 * probability is needed. Below it we price nothing: inventing a burn chance is the
 * failure mode this project exists to avoid.
 *
 * This table is curated rather than parsed. The source page is wikitext with a
 * two-row header (`Food` spans two columns, `Hosidius` and `Gauntlets` span
 * several) and body rows that sometimes write the food as two cells, so a
 * header-addressed parser cannot line up its columns without guessing — the one
 * thing the house rules forbid. The numbers below are read straight off that page.
 *
 * `level` is the lowest level at which the food never burns on a **plain fire or
 * plain range**. Where the source shows `-` in both of those columns, the food
 * never stops burning on a plain source (Shark, Anglerfish, Manta ray) and is
 * listed with `level: null` so the reason is explicit rather than "missing".
 * Hosidius, the Lumbridge Castle range and cooking gauntlets lower these further;
 * a level safe on a plain range is safe on all of them, so we take the plainest
 * source that publishes one.
 */

import type { CookingBurnLevel } from '../src/domain/cooking.js';

export const COOKING_BURN_SOURCE =
  'https://oldschool.runescape.wiki/w/Cooking/Burn_level';

/** `level: null` = the source says it still burns at 99 on a plain fire/range. */
export const COOKING_NO_BURN_LEVELS: readonly CookingBurnLevel[] = [
  // Lumbridge Castle / meats / other foods / baked goods / gnome cooking.
  { item: 'Shrimps', level: 34, source: 'fire' },
  { item: 'Anchovies', level: 34, source: 'fire' },
  { item: 'Cooked meat', level: 34, source: 'fire' },
  { item: 'Cooked chicken', level: 34, source: 'fire' },
  { item: 'Cooked rabbit', level: 34, source: 'fire' },
  { item: 'Sardine', level: 38, source: 'fire' },
  { item: 'Bread', level: 38, source: 'range' },
  { item: 'Pitta bread', level: 38, source: 'range' },
  { item: 'Herring', level: 41, source: 'fire' },
  { item: 'Baked potato', level: 41, source: 'fire' },
  { item: 'Giant carp', level: 45, source: 'fire' },
  { item: 'Mackerel', level: 45, source: 'fire' },
  { item: 'Redberry pie', level: 45, source: 'range' },
  { item: 'Thin snail meat', level: 47, source: 'fire' },
  { item: 'Lean snail meat', level: 47, source: 'fire' },
  { item: 'Spider on shaft', level: 48, source: 'fire' },
  { item: 'Spider on stick', level: 48, source: 'fire' },
  { item: 'Paddlefish', level: 48, source: 'range' },
  { item: 'Scrambled egg', level: 48, source: 'fire' },
  { item: 'Cooked t-bone steak', level: 49, source: 'fire' },
  { item: 'Trout', level: 49, source: 'fire' },
  { item: 'Cod', level: 49, source: 'range' },
  { item: 'Cooked wild kebbit', level: 50, source: 'fire' },
  { item: 'Pike', level: 54, source: 'fire' },
  { item: 'Meat pie', level: 54, source: 'range' },
  { item: 'Cooked sweetcorn', level: 54, source: 'fire' },
  { item: 'Nettle tea', level: 54, source: 'fire' },
  { item: 'Red crab meat', level: 51, source: 'range' },
  { item: 'Fat snail meat', level: 56, source: 'fire' },
  { item: 'Stew', level: 58, source: 'fire' },
  { item: 'Salmon', level: 58, source: 'fire' },
  { item: 'Cooked larupia', level: 59, source: 'fire' },
  { item: 'Cooked slimy eel', level: 61, source: 'fire' },
  { item: 'Cooked giant crab meat', level: 62, source: 'fire' },
  { item: 'Cooked fishcake', level: 62, source: 'fire' },
  { item: 'Tuna', level: 63, source: 'fire' },
  { item: 'Cooked barb-tailed kebbit', level: 63, source: 'fire' },
  { item: 'Apple pie', level: 63, source: 'range' },
  { item: 'Mud pie', level: 63, source: 'range' },
  { item: 'Rainbow fish', level: 64, source: 'fire' },
  { item: 'Plain pizza', level: 68, source: 'range' },
  { item: 'Garden pie', level: 68, source: 'range' },
  { item: 'Cake', level: 74, source: 'range' },
  { item: 'Fish pie', level: 74, source: 'range' },
  { item: 'Cave eel', level: 74, source: 'fire' },
  { item: 'Lobster', level: 74, source: 'range' },
  { item: 'Curry', level: 74, source: 'fire' },
  { item: 'Cooked graahk', level: 75, source: 'fire' },
  { item: 'Fried onions', level: 77, source: 'fire' },
  { item: 'Bass', level: 79, source: 'fire' },
  { item: 'Swordfish', level: 80, source: 'range' },
  { item: 'Cooked kyatt', level: 80, source: 'range' },
  { item: 'Blue crab meat', level: 77, source: 'range' },
  { item: 'Botanical pie', level: 84, source: 'range' },
  { item: 'Swordtip squid', level: 85, source: 'range' },
  { item: 'Mushroom pie', level: 89, source: 'range' },
  { item: 'Monkfish', level: 90, source: 'range' },
  { item: 'Fried mushrooms', level: 90, source: 'fire' },
  { item: 'Cooked pyre fox', level: 92, source: 'fire' },
  { item: 'Admiral pie', level: 94, source: 'range' },
  { item: 'Cooked sunlight antelope', level: 95, source: 'range' },
  { item: 'Roqed fish (5)', level: 95, source: 'fire' },
  { item: 'Cooked chompy', level: 99, source: 'fire' },
  { item: 'Cooked karambwan', level: 99, source: 'fire' },
  { item: 'Poison karambwan', level: 99, source: 'fire' },
  { item: 'Roast beast meat', level: 99, source: 'fire' },
  { item: 'Roast bird meat', level: 99, source: 'fire' },
  { item: 'Roast rabbit', level: 99, source: 'fire' },
  { item: 'Kyren fish (6)', level: 99, source: 'fire' },
  // Gnome cooking (range only).
  { item: 'Toad crunchies', level: 38, source: 'range' },
  { item: 'Spicy crunchies', level: 38, source: 'range' },
  { item: 'Worm crunchies', level: 38, source: 'range' },
  { item: 'Chocchip crunchies', level: 38, source: 'range' },
  { item: 'Fruit batta', level: 38, source: 'range' },
  { item: 'Toad batta', level: 38, source: 'range' },
  { item: 'Worm batta', level: 38, source: 'range' },
  { item: 'Vegetable batta', level: 38, source: 'range' },
  { item: 'Cheese+tom batta', level: 38, source: 'range' },
  { item: 'Worm hole', level: 38, source: 'range' },
  { item: 'Veg ball', level: 38, source: 'range' },
  { item: "Tangled toad's legs", level: 38, source: 'range' },
  { item: 'Chocolate bomb', level: 38, source: 'range' },
  // Never safe on a plain fire or range: the source shows `-` in both columns.
  { item: 'Shark', level: null, source: 'range' },
  { item: 'Anglerfish', level: null, source: 'range' },
  { item: 'Sea turtle', level: null, source: 'range' },
  { item: 'Dark crab', level: null, source: 'range' },
  { item: 'Manta ray', level: null, source: 'range' },
  { item: 'Cooked jubbly', level: null, source: 'range' },
  { item: 'Wild pie', level: null, source: 'range' },
  { item: 'Summer pie', level: null, source: 'range' },
  { item: 'Dragonfruit pie', level: null, source: 'range' },
  { item: 'Cooked dashing kebbit', level: null, source: 'range' },
  { item: 'Cooked moonlight antelope', level: null, source: 'range' },
  { item: 'Ugthanki meat', level: null, source: 'range' },
  { item: 'Giant krill', level: null, source: 'range' },
  { item: 'Jumbo squid', level: null, source: 'range' },
  { item: 'Haddock', level: null, source: 'range' },
  { item: 'Rainbow crab meat', level: null, source: 'range' },
  { item: 'Yellowfin', level: null, source: 'range' },
  { item: 'Halibut', level: null, source: 'range' },
  { item: 'Bluefin', level: null, source: 'range' },
  { item: 'Marlin', level: null, source: 'range' },
];
