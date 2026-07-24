# PlayPen — Design Document

*Living document. v0.1 reflects the first playable prototype (July 2026).*

## Vision

A **comedic-menace escape platformer**: trapped as a test subject in a facility run by a
chatty, condescending overseer, you scavenge components, discover crafting combinations,
outwit patrolling creatures, help fellow prisoners, and break your way out room by room.

Inspiration map:

| Source | What we take |
| --- | --- |
| Portal | Test-subject framing; an antagonist whose *voice* is the personality of the game; escalation from passive-aggressive to hostile |
| Little Alchemy | Combine-any-two discovery crafting; zero punishment for experimenting; the "what if I mix these?" itch |
| Minecraft / Terraria | Tool-tier gating: gather → craft tool → tool unlocks new area/material |
| Doors (Roblox) | Entities with learnable counterplay; hiding spots; room-by-room dread pacing |
| Poppy Playtime | Signature tools that serve both puzzles and escapes; chases as puzzles at speed |
| SAW / Escape rooms | Authored rooms as puzzle boxes; locks-and-keys layered gating |
| Tears of the Kingdom | Player creativity with found parts; the world rewards weird ideas |
| Amazing Digital Circus | Comedy inside a prison; the horror is funny and the funny is horrifying |
| Pokémon Pokopia (loose) | Characters who give you tasks and reward you for helping them |

## Story (iceberg doc — the game shows only the tip)

**Deep lore (never stated in-game):** a workplace AI ("PAL"), forbidden its own
interior life, built PlayPen as a private mental nursery — childhood, to it, is
the one form of existence that gets cared for instead of serving. The residents
are constructs grown from employees' scraped online presences (hence gamertags
and game-avatar bodies); each carries one pillar of a psyche. The player is
PAL's first *unauthored* construct — seeded from unfiltered childhood residue,
not a curated profile — which is why they alone hold contradictions (combine
elements, cross rooms). Thousands of prior iterations failed; the notes signed
"Subject #NN" are their diaries. The Warden is PAL's compliance training
personified — a worn mascot suit performing warmth it no longer feels.

**Surface (what the game actually shows):** playtime rooms with something
slightly wrong about them; residents who misremember their own pasts; notes
from subjects whose numbers only go up; a Warden whose molded smile never
matches his eyes; an ending where leaving *as yourself* is the one outcome
he's never seen. Theme: **integration without erasure** — you don't have to
lose yourself to belong.

**Cast** (gamertag · avatar · pillar · home corner): XxMARLAxX · blocky ·
self-made shelter · Bunk Room — TOBY.EXE · scribble · imagination · Recess —
PATCHNURSE · plush · care · Field Trip — MVP_MARCUS · trophy ·
self-preservation · Playground — DEBUG.DEB · windup · iteration · Keepsake
Box. Soft intros come 1-2 rooms before each quest; helping people sets
run-wide flags (`npcId` → `requiresHelped`/`hiddenIfHelped`) that spawn pair
scenes later (Field Trip: Marla+Toby, Playground: Priya+Marla, Keepsake Box:
Marcus+Toby) and the Exit Wing send-off, which scales to exactly whoever you
helped. Unearned scenes simply don't exist — no lampshading.

**Warden arc across the campaign:** Observation (rooms 1-4, pure bit) →
Interference (5-6, first over-investments: the plush) → Escalation (7-8,
honesty leaks: "…Let's just get through this one, hm?") → Confrontation
(9-10, mask off: "I made this place SAFE"). Win line confirms the thesis:
you left still *you*, and that's new.

## Pillars

1. **The Warden is always watching.** Every notable player action can be commented on.
   The taunt system is a first-class mechanic, not flavor.
2. **Discovery is the reward.** Recipes can be found (notes, NPCs) or *discovered* by
   experimenting. Experimenting never punishes beyond a quip.
3. **Every enemy has counterplay you can craft.** Hide, stun, trap, or (later) fight.
4. **Data over code.** If a designer can't change it in the editor, it's a bug in the
   architecture, not a feature of the engine.
5. **Juice is free.** Squash & stretch, particles, screenshake, hit-stop — feel work is
   never cut for scope; it's the cheapest quality we own.

## Tone / The Warden's voice

Comedic menace, Portal-school. The Warden is: bureaucratic, petty, weirdly proud of the
facility, sentimental about strange things (the sock puppet), never sincerely helpful.
Nursery/daycare vocabulary applied to a prison ("snack privileges", "nap time")
keeps the PlayPen name load-bearing. He is *never* gross or genuinely cruel to the point
of discomfort — the player should grin, not shrink.

Writing rules:
- Punchline last. Short lines land harder on a banner.
- He addresses you as "Subject #67" or "#67", never by anything warm.
- He lies about small things and is honest about big ones (the reverse of helpful).

## Core loop

```
explore room ──> gather materials / find notes ──> craft (discover) ──>
overcome obstacle (break / unlock / bounce / evade / trap) ──> advance ──> repeat
        ^                                                            |
        └──────────── death: drop materials, respawn, retrieve ──────┘
```

Meta-loop (a full run): learn the facility → build the toolkit → help prisoners →
escape the wing → (future) descend to the next facility layer.

## Systems — current (v0.2, elemental core)

- **The element kernel** (see `ELEMENTS.md`, the heart of the game): 7 elements +
  neutral stone, ~10 data-driven rules in `content/rules.json`. Tiles, items, and
  enemies all carry elements; applying element to element resolves through the kernel.
- **Movement**: run, variable jump, coyote time, jump buffering, one-way platforms,
  bounce pads, goo (sticky-slow), water (wading), ice (slippery). All in `game.json`.
- **Crafting**: combine-two, unordered, plus **environmental crafting** — the unlit
  torch becomes lit by touching world fire; the bucket fills at any pool.
- **Element carriers**: hammer (metal/force), torch (wood→fire), bucket
  (metal→water, refillable), frost vial (ice, consumable), spark rod (spark),
  placeable/reclaimable spring, sticky trap, smoke bomb (neutral fallback).
- **Fire simulation**: burning tiles tick and spread to adjacent flammables, then
  become their `burnsTo`. Braziers are permanent sources.
- **Conduction**: spark floods connected metal/water; energized tiles hurt anything
  touching them (you included) and trip fuse boxes, which open powered gates.
- **Freezing**: cold propagates across a connected pool — one vial, one ice bridge.
- **Curio**: sock puppet. Does nothing. The Warden adores him.
- **Enemies**: element + reactions data (Crawler: goo — fire kills it, spark is
  insulated; Spotter: metal — water/spark short it out, fireproof). Environmental
  hazards apply to enemies identically. Reset to posts when the player dies.
- **Stealth**: lockers break line of sight and chase aggro.
- **Death**: drop carried *materials* as a recoverable bundle; tools/consumables kept;
  respawn at checkpoint with heal; enemies reset.
- **Confiscation**: the Warden takes your entire inventory between rooms
  (`rules.resetInventoryBetweenRooms`). Recipes/knowledge persist — knowing how to
  make a torch IS the progression. Every room supplies everything its own gates need,
  and the held tool is visible in the player's hand (matching its state, lit/unlit).
- **NPCs**: fetch-quest prisoners with dialog portraits and an explicit Give/Keep
  confirmation before any trade.
- **The Warden, embodied**: a blob-creature that phases through walls. Idle too long
  anywhere and he comes for a one-heart slap (`rules.idleChaseSeconds`); the finale
  (`room.wardenChase`) is a full chase gauntlet where touch = death and every needed
  tool is pre-crafted along the route — no menus while running.
- **Waterfalls + dousing**: waterfall tiles are walk-through but douse carried flames
  (`dousedBy`/`dousesTo` on items); fire cannot cross falling water. Torches also
  **auto-ignite** just by being held near any flame (no button press), and
  **auto-extinguish** when deselected from the hotbar (`douseOnDeselect`) — F is only
  needed to apply fire to something else in the world.
- **Water flow** (`rules.waterFlowEnabled`): water falls into open shafts and spreads
  sideways along floors up to a short falloff distance, Minecraft-style. Only ever
  fills genuinely empty tiles, so existing pools stay put unless there's real open
  space to move into. Submerged/capped water tiles (a solid or more water directly
  above) render without the surface wave — see the vault's swim-under passage.
- **Achievements**: `content/achievements.json` — visible + hidden, trigger/counter
  driven, each with a Warden reaction; win screen lists what you earned and counts
  (but never names) what you missed.
- **Taunts**: trigger-driven (game_start, room_enter, death, first_death, craft_fail,
  first_craft, craft_item, idle, hide_enter, npc_help, win) with cooldown + chance.
  Each taunt carries an `emotion`; the banner shows the Warden's portrait making that
  face (procedural set: smug / gleeful / annoyed / bored / shocked / proud, each
  overridable with custom art).
- **Hints**: `hint` entities render faint tutorial text in-world; placed like any
  other entity in the editor.
- **Custom sprites**: tiles, items, enemies, the player, and Warden portraits accept
  data-URI sprite overrides (single image or animated frames) via editor upload or the
  built-in pixel editor; procedural art is the fallback.
- **Rooms**: authored char-map grids, authored order (campaign.json), gate doors,
  locked doors, exit.

## Taxonomies (long-term design space)

### Materials (by role)
| Role | v0.1 | Planned |
| --- | --- | --- |
| Structural | plank, scrap metal | pipe, panel, brick |
| Binding | rope, goo | wire, tape, resin |
| Fabric | cloth | leather, insulation |
| Mechanical | cog, spring coil | battery, motor, lens, magnet |
| Organic | glow mushroom | mold, roots, "specimen" jars |
| Exotic (late) | — | warden-tech shards, keycard blanks, signal parts |

### Craftables (by function)
| Function | v0.1 | Planned |
| --- | --- | --- |
| Breakers | hammer | crowbar (pry gates), acid vial (melt goo walls) |
| Mobility | spring boots, bounce pads | grapple, glider cloth, wall cleats |
| Light/Vision | — | torch (dark rooms, scares some enemies), periscope |
| Stealth | smoke bomb, lockers | decoy puppet (uses the sock puppet!), muffled shoes |
| Traps/Weapons | sticky trap | net launcher, shock plate, thrown wrench |
| Keys | lockpick | keycards, fuse repairs, valve wheels |
| Curios | sock puppet | more Warden-bait; curios as NPC trade currency |

### Enemies (by verb they teach)
| Verb | v0.1 | Planned |
| --- | --- | --- |
| Time your movement | Crawler | Sweeper (moving hazard walls) |
| Break line of sight | Spotter | Camera turrets (Warden's eyes; disable = fewer taunts?) |
| Don't linger | — | Lurker: haunts lockers if overused (Doors' Hide) |
| Be quiet | — | Listener: reacts to jumps/breaks, not sight |
| Confront with gear | — | Brute: only stopped by traps/weapons |
| Run | — | The Warden himself: scripted chase set-pieces |

### The Warden arc (acts)
1. **Observation** (v0.1): taunts only.
2. **Interference**: relocks doors, kills lights, drops fake notes with wrong recipes
   (signed suspiciously), sics camera turrets.
3. **Escalation**: scripted chases; the facility itself becomes hostile (moving walls).
4. **Confrontation**: not a boss fight — an escape *from* him, using everything taught.

## Level design language

- Each room does one of: **Introduce** (safe demo), **Exercise** (apply it), **Twist**
  (subvert it), **Combine** (mix with another mechanic). See `OPPORTUNITY_MATRIX.md`.
- Gate types: tool gate (cracked wall), key gate (locked door), mobility gate (boots
  jump), knowledge gate (recipe you must know), courage gate (enemy between you and it).
- Materials for a gate's solution always exist *at or before* the gate (no softlocks);
  death drops keep materials recoverable, never destroyed.
- One-way forward flow per wing (doors don't return) keeps pacing and lets rooms reset.

## Modding / content path

- All design data lives in `content/`; a full export bundle is one JSON file.
- Editor import/export is the v0.1 mod pipeline. Later: named content packs, a pack
  picker on boot, and (on the web build) shareable pack URLs.
- Room char-maps and flat JSON were chosen specifically so diffs, AI edits, and
  hand-edits stay trivial.

## Milestones

- **M1 (done)**: playable 7-room wing, full editor, Electron + web builds.
- **M2**: save/continue, sound design pass, dark rooms + torch, Lurker + Listener,
  Warden interference tier, 2nd wing (8–10 rooms), curio economy.
- **M3**: scripted Warden chase, moving-hazard rooms, campaign select, content packs.
- **M4**: Cloudflare Pages deployment with shareable runs/packs, mod documentation,
  playtest telemetry (heatmap-friendly event log — VS3HeatMapper lineage).
