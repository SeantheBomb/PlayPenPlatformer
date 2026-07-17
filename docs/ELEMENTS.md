# PlayPen — Elemental Core (v2 engine — IMPLEMENTED)

*Status: shipped 2026-07-16. Sean's scope calls: SPARK included in this build;
all-elemental gates (locks/lockpick cut); enemies in the element system.
Implementation notes beyond the proposal: freeze propagates across a connected body
of water (one vial = one bridge); charge propagates through connected conductive
tiles the same way; any metal-element swing carries force (yes, the bucket can
shatter ice — discovered in playtest, kept on purpose); placed springs trigger on
landing, not walking. Rules live in `content/rules.json`, elements in
`content/elements.json`, both editor-editable.*

*The systemic layer under everything. Replaces object-specific rules ("hammer breaks
cracked wall") with element-level rules ("force shatters brittle things") so gameplay
emerges from a small kernel the player can learn once and apply everywhere.*

## The problem with v1

Every gate had one arbitrary key: hammer→cracked, lockpick→lock, boots→gap. Players
learn each rule in isolation; knowledge doesn't transfer; play is linear
(learn recipe → build item → use item → repeat).

## Design goal

**A small kernel of elemental rules, a wide derived matrix.** The player who learns
"fire consumes wood" in room 1 *invents* "burn the goo off the floor" in room 3 without
being taught. Most gates accept 2+ elemental solutions.

---

## The elements (core six + neutral)

| Element | Carried by (tiles) | Carried by (tools/items) | Properties |
| --- | --- | --- | --- |
| **FIRE** | brazier, burning tiles, fire door | lit torch | spreads to flammable neighbors, hurts on touch, light source (later) |
| **WATER** | pools, puddles | filled bucket (refillable) | liquid, extinguishes, conductive (future spark), wading slows |
| **ICE** | ice wall, ice block, frozen pool | frost vial (consumable) | brittle, slippery, walkable when frozen from water |
| **WOOD** | wooden barrier/door, plank platform, crate | plank, unlit torch | flammable, structural |
| **METAL** | grate, plate, cracked stone (force target) | hammer (kinetic), bucket, lockpick | force carrier, fireproof, conductive (future) |
| **GOO** | goo strips (slow) | goo blob, sticky trap | sticky, flammable (burns long), dissolves in water |
| *stone* (neutral) | walls, floors | — | inert; the canvas everything else plays on |

**SPARK (electricity) is the first expansion element** — conducts through metal and
water, powers facility machinery, stuns. Speced but not in this build; the facility
theme is begging for it once the kernel is proven.

## The rule kernel (~8 rules, data-driven)

Rules live in `content/elements.json` as `{ actor, target, effect }` triples. Code
implements a small set of effect *verbs*; data wires the pairs. Editor gets an
elements tab like everything else.

1. FIRE + flammable (wood, goo, cloth) → **ignite**: burns for N sec, then tile
   becomes its `burnsTo` (ash/empty). Fire spreads to adjacent flammable tiles.
2. FIRE + ICE → **melt**: becomes `meltsTo` (water puddle / empty).
3. WATER + FIRE → **extinguish** (burning tile reverts; fire tiles quench to their base).
4. ICE + WATER → **freeze**: pool becomes walkable ice (`freezesTo`).
5. FORCE (metal/kinetic) + brittle (ice, cracked stone) → **shatter**.
6. WATER + GOO → **dissolve**: washes the goo away.
7. FIRE + WATER (fire applied to water) → fizzle/steam, fire source spent.
8. Property rules (not pairs): ice is *slippery* (low friction), goo is *sticky*
   (slow), water *wading* slows, fire *hurts*.

That's the whole kernel. Everything below is derived.

## The derived matrix (why small × small = wide)

Applying any element-carrier to any tile resolves through the kernel:

| apply ↓ on → | wood door | ice wall | water pool | goo strip | cracked stone | metal grate | brazier (fire) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **lit torch** (fire) | burns down | melts → puddle | fizzles (torch survives) | ignites → spreading fire | — | — | (already lit) |
| **bucket of water** | — | — | refill point | dissolves | — | — | extinguishes |
| **frost vial** (ice) | — | — | freezes → ice bridge | stiffens? (v2.1) | — | — | extinguishes |
| **hammer** (force) | — | shatters | — | — | shatters | clang (nothing) | — |
| **unlit torch** (wood) | — | — | — | — | — | — | **lights the torch** |

...and the same matrix applies to **enemies** (each has an element + weaknesses):

| | Crawler (goo creature) | Spotter (metal drone) |
| --- | --- | --- |
| fire | *burns it away* (kill) | nothing (fireproof) |
| water | nothing | short-circuit (long stun) |
| ice | frozen (stun) | frozen (stun) |
| force | knockback | knockback |

Environmental chains fall out for free: burning a goo strip sends fire crawling along
it — into the crawler standing on it, or dangerously toward the wooden platform you
needed. Dumping water on spreading fire saves the platform. **The player is doing
chemistry, not keyring management.**

## Items & recipes (v2 set)

Carriers, not powerups — per design decision, no direct player stat modifiers.

| Item | Recipe | Element | Use |
| --- | --- | --- | --- |
| Hammer | scrap + plank | force | swing: shatter brittle |
| Torch (unlit) | plank + cloth | wood | touch any fire source to light it |
| Torch (lit) | *torch + fire in world* | fire | apply fire ahead; environmental crafting! |
| Bucket | scrap + rope | metal | scoop from pools; splash ahead; refillable |
| Frost vial | glow mushroom + goo blob | ice | freeze pools/enemies; consumable |
| **Spring (placeable)** | spring coil + plank | force | F places it, bounces anyone; E picks it back up — replaces spring boots; self-scaffolding climbs |
| Smoke bomb | glow mushroom + cloth | — | stun cloud (unchanged behavior, new recipe) |
| Sticky trap | goo + plank | goo | unchanged |
| Lockpick | scrap + cog | metal | kept as mechanical seasoning alongside elemental gates |
| Sock puppet | cloth + rope | — | he remains perfect and useless |

The lit-torch step is the flagship: **the world is part of the crafting system.**
Rope now earns its keep (bucket handle). Spring boots are cut.

## Demo rework (same 7 rooms, systemic gates)

Where possible, gates get ≥2 elemental answers:

1. **Orientation** — brazier burning in the corner; wooden barrier gates the exit;
   cracked floor pocket keeps the hammer beat. Teach: craft torch → light it → burn
   the door. (Alt: none yet — this is the Introduce room.)
2. **Storage** — a fire-door blocks the exit; water pool mid-room. Craft bucket,
   scoop, splash. Alt: frost vial also quenches it, if you somehow have one.
3. **Vents** — goo strips + spotter + lockers, plus mushrooms. New wrinkle: burning
   the goo clears the slow zones (and can cook the crawler) but fire creeping toward
   the mushroom patch you still need is your problem.
4. **Cell Block** — Marla + locked gate (lockpick) + the note pocket now sealed
   behind an **ice wall**: melt it (torch) or shatter it (hammer) — first two-solution
   gate.
5. **The Gap** — re-authored around **placeable springs**: craft one spring, place,
   bounce, pick it up, carry it up, re-place. One tool, player-authored route. Bounce
   pads remain as fixed terrain accents.
6. **Mess Hall** — kitchen fire hazards, a water pool, both enemies. Freeze the pool
   into a bridge (frost vial) or wade it slowly under spotter pressure; douse the
   fire path or spring over it.
7. **Exit Wing** — the exam: two full routes to the exit, one wood-and-fire, one
   water-and-ice, enemies on both. No single required item.

## Engine changes required

- **Tile transformation system**: replace the `broken` set with a general
  `overrides: Map<tileIndex, tileId>` in room mutations; tiles declare
  `burnsTo / meltsTo / freezesTo / shattersTo` + `burnTime`.
- **Fire propagation**: burning tiles tick, spread to adjacent flammable tiles,
  resolve to `burnsTo` on burnout.
- **Element application**: one code path — `applyElement(element, tiles/entities in
  area)` — used by tool swings, splashes, spreading fire, and hazard contact.
- **Carriers**: item state (torch lit/unlit, bucket empty/full) — inventory entries
  get a state dimension.
- **Placeable entities**: generalize the sticky-trap placement into "placeable items"
  (spring, trap) with pickup-back support.
- **Enemy elements**: element + weakTo/resistTo on EnemyDef; hazard tiles hurt
  enemies too (fire kills the crawler, spikes don't care).
- **Content**: new `elements.json` (defs + rules), reworked tiles/items/recipes/rooms,
  editor tab for elements & rules; tile `element` fields appear in existing forms
  automatically.

## What this buys the opportunity matrix

v1 matrix rows were *mechanics* (one per arbitrary rule). v2 rows are
*element × element interactions* — 6 elements yield ~15 meaningful pairs from 8 rules,
each pair authorable as Introduce/Exercise/Twist/Combine, before counting enemy
interactions, chains (fire→goo→spread), and player-authored tools (springs). Wing B
then adds SPARK and the matrix widens again without new kernel complexity.
