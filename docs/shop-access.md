# Shop access requirements

Some shops sit behind a quest, skill, item or area requirement. The calculator
flags the ones with a **known** requirement and offers a **Hide locked** filter
on the Shop → GE and GE → shop pages.

This is not an account check. A shop without a badge has **unknown** access, not
guaranteed access. The filter hides only shops whose requirement is in the
curated table.

## Why this is curated

The OSRS Wiki does not publish a single structured "access requirement" field:

- `Template:Infobox Shop` has no requirement parameter.
- `Template:Infobox Location` sometimes has `|requirement =` (for example Fishing
  Guild: `{{SCP|Fishing|68}}`, Legends' Guild: `[[Legends' Quest]]`), but many
  quest areas only explain it in prose (Keldagrim, Zanaris, Ape Atoll, Lletya).
- The storeline `store_notes` column has per-row hints such as `(post-quest)` and
  `(8 Subquests)`, not a shop-level requirement or quest name.

Guessing would violate the project's no-fabricated-data rule. The table therefore
contains only high-confidence requirements, each with the wiki page that states it.

## Data and generation

- Rules live in [`scripts/shopAccessRules.ts`](../scripts/shopAccessRules.ts).
- `pnpm run access` applies them to `data/shops.json` and writes
  `data/shop-access.json` (no network). Use the `run` prefix: bare `pnpm access`
  is pnpm's built-in package-access command.
- `pnpm refresh` runs `pnpm run access` as part of the full data refresh.

Each rule matches the catalogue's `location` text, case-insensitively, and can
name `excludeShops` for outliers (the Master fisher stands outside the Fishing
Guild; the Shield master stands outside the Ranging Guild; the Blast Furnace
shops have their own minigame teleport). Per-shop `SHOP_ACCESS_OVERRIDES` win
over area rules (Culinaromancer's Chest, Eblis, Oobapohk's Javelin Store, and the
Zanaris market shops).

The artifact schema is `ShopAccessCatalogSchema` in `src/types.ts`; every entry
must carry a non-empty requirement and a wiki `source` URL. `pnpm run access` fails
the build if the payload does not validate.

## What is included

Current rules cover, among others:

- **Skill guilds:** Fishing (68), Ranging (40), Warriors (130 combined/99),
  Wizards (66), Cooking (32 + outfit), Crafting (40 + apron), Mining (60),
  Woodcutting (60), Farming (45/65/85), Hunter (46).
- **Quest guilds:** Champions (32 QP), Heroes, Legends, Myths (Dragon Slayer II).
- **Quest areas:** Keldagrim, Zanaris, Ape Atoll, Lletya, Prifddinas,
  Dorgesh-Kaan, Darkmeyer, Burgh de Rott, Mos Le'Harmless, Shilo Village, Lunar
  Isle, Neitiznot, Jatizso, Piscatoris, Sophanem, Gu'Tanoth, Miscellania,
  Etceteria, Troll Stronghold.
- **Varlamore:** the whole continent is one gate, not one area per town —
  <https://oldschool.runescape.wiki/w/Varlamore> states that Varlamore "can only
  be accessed upon completion of Children of the Sun", and every later route
  (quetzal, fairy ring, charter ship, Pendant of Ates) only unlocks after the
  first trip via Regulus Cento. One rule therefore covers Civitas illa Fortis,
  Outer Fortis, Aldarin, Kastori, Tal Teklan, Auburnvale, Nemus Retreat,
  Quetzacalli Gorge, Ortus Farm, Colossal Wyrm Remains, Locus Oasis, Sunset
  Coast, Salvager Overlook, Stonecutter Outpost and Moonrise Brewery.
  Cam Torum has a second gate (Perilous Moons progress) and Mastering Mixology a
  skill gate (60 Herblore), so both carry their own rule.
- **Sailing (19 November 2025):** ocean destinations publish their docking level
  in the location infobox (`|requirement = {{SCP|Sailing|N}}`), so the shop
  rows inherit it: Port Roberts 50, Anglers' Retreat 51, Wyrmscraig 62 (and
  Auchrie, which is a settlement on Wyrmscraig), Deepfin Point and Deepfin Mine
  67. The Great Conch also needs Troubled Tortugans, The Summer Shore needs the
  same quest, Coral Nurseries needs diving apparatus and a fishbowl helmet, and
  The Pandemonium needs the Pandemonium quest progressed to the first visit.
- **Item-locked:** Mor Ul Rek (fire cape for the interior).
- **Other:** Mac's island sells only the max cape (2,376 total level), and
  Daimon's Crater exists only on Bounty Hunter worlds (318, 319, 569).
- **Per-shop:** Culinaromancer's Chest, Eblis, Oobapohk's Javelin Store, and the
  three Zanaris market shops (the market gate also costs a cut diamond).

The generated artifact currently has 265 shop pages with a requirement and
leaves 331 pages unknown. The counts move as the catalogue and rules change.

## What is deliberately not included

- **Soft gates** such as Port Phasmatys's ecto-token entry (a charter ship
  bypasses it) are not in the table.
- **Rogues' Den** has no entry requirements; its maze does, but the den and its
  shops are reachable.
- Areas where the wiki does not state access clearly (for example Giants'
  Foundry's reward shop, Temple of the Eye and the Fractured Archive) stay
  unknown rather than guessed. So do places that are only *softly* gated: the
  Sunset Coast, Tal Teklan, Auburnvale and Nemus Retreat are all reachable on
  foot or by quetzal with no level requirement, so they carry only the
  continent-wide Children of the Sun rule.
- General stores, membership and GE/back-travel assumptions remain separate.

## Adding or correcting an entry

1. Add or adjust a rule/override in `scripts/shopAccessRules.ts`, citing the wiki
   page that states the requirement.
2. Run `pnpm run access`.
3. Run `pnpm test` and commit the rule change with the regenerated
   `data/shop-access.json`.

If the requirement depends on account state (quests completed, skill levels),
the calculator still only displays the note. It does not evaluate your account.
A profile-aware check would be a separate feature.
