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
- **NPCs**: fetch-quest prisoners (give item → receive items + recipes + dialog).
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
