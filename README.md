# PlayPen

A comedic-menace escape platformer. You are Subject #47, locked in a facility run by
**The Warden**, who watches everything you do and has opinions about it. Explore, scavenge,
craft, evade, and escape — while every parameter of the game lives in editable JSON.

## Running it

```bash
npm install
npm run dev        # browser dev server at http://localhost:5173
npm run app        # build + launch the Electron app
npm run app:dev    # Electron pointed at the running dev server (run `npm run dev` first)
npm run typecheck  # tsc --noEmit
npm run build      # production bundle in dist/ (deployable to Cloudflare Pages as-is)
```

## Controls

| Key | Action |
| --- | --- |
| A/D or ←/→ | move |
| Space / W / ↑ | jump (hold for higher, tap for shorter) |
| S / ↓ | drop through one-way platforms |
| E | interact: read notes, talk, hide in lockers, doors |
| Tab | crafting (combine any two items) |
| Q / F | cycle / use hotbar item (hammer swings, bombs throw, traps place) |
| Esc | pause (full control listing lives here) |

## The Editor

The Player and the Editor ship in the same executable. The editor is deliberately
low-key: press **Ctrl+Shift+E** in-game, or open the app with `?editor` in the URL.

- **rooms** — tile painter, entity placement + inspector, room properties, test-play,
  undo/redo (Ctrl+Z / Ctrl+Y)
- **tiles / items / recipes / enemies / taunts** — full CRUD with live thumbnails
- **game** — every tunable, plus the player sprite and the Warden's portrait set
- **campaign** — room order

**Custom art**: every tile, item, enemy, the player, and each Warden emotion accepts a
custom sprite — upload a PNG or draw one in the built-in pixel editor (multi-frame
animation supported). Sprites are stored as data-URIs inside the content JSON, so an
exported bundle carries its art with it. Anything without a sprite falls back to the
procedural primitives.

Saving in **Electron writes straight to `content/` on disk**. In a browser it writes to a
localStorage overlay (bundled files stay untouched) — use **Export JSON / Import JSON** to
move content between machines or hand a bundle to someone else. This is also the seed of
the modding story: a content bundle *is* a mod.

## Architecture

Everything gameplay-related is serialized in `content/` — code implements *capabilities*,
data decides everything else:

```
content/
  game.json        global tuning (physics, camera, juice, rules, antagonist, audio)
  tiles.json       tile types (chars used by room maps; solidity, damage, bounce, slow...)
  items.json       materials / tools / consumables / curios
  recipes.json     combine-two recipes
  enemies.json     enemy archetypes (patrol / chase params)
  taunts.json      The Warden's trigger-driven voice lines
  campaign.json    room order
  rooms/*.json     char-map tile grids + entity lists
src/
  engine/          generic 2D engine (loop, input, tilemap physics, renderer, particles, synth SFX)
  game/            game runtime (player, enemies, crafting, taunts, HUD, scenes)
  editor/          the hidden editor
  data/            content schemas + ContentStore (disk / localStorage / bundled)
electron/          Electron main + preload (content disk I/O)
docs/              design docs + opportunity matrix
```

## Debug / AI-playtest handle

`window.PP` is exposed in every build:

```js
PP.state()                  // scene, room, position, health, inventory, recipes
PP.give("hammer")           // grant items
PP.warp("mess_hall")        // jump to a room
PP.game / PP.store          // full access
```

The engine keeps simulating when the tab is hidden, so automated (or AI-driven)
playtests work headlessly.
