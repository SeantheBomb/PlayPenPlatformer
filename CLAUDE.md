# PlayPen — project conventions

Comedic-menace escape platformer. Custom TS engine, Canvas2D, Vite + Electron shell.
Docs: `docs/DESIGN.md` (vision/systems), `docs/OPPORTUNITY_MATRIX.md` (level design),
`docs/ELEMENTS.md` (the elemental kernel), `docs/HANDOFF.md` (chronological build log +
locked decisions + new-machine setup — read this first if you're picking this project
up cold).

## The one rule

**All design data is serialized in `content/` — never hardcode gameplay values in
`src/`.** Code implements the element kernel's effect verbs (ignite, melt, extinguish,
dissolve, freeze, shatter, energize, ignite_self, fizzle — see `docs/ELEMENTS.md`);
`content/rules.json` wires which element does what to which. New gameplay should be a
new rule, tile, or item first — new code verbs only when a rule genuinely can't
express it. Every tunable gets editor coverage (usually free via the auto-forms).

## The second rule

Prefer systemic over arbitrary (Sean's explicit direction): no object-specific keys
("X opens Y"). Gates should resolve through element interactions and admit ≥2
solutions where possible. Tools are element carriers, not player stat powerups.

## Where things live

- `content/` — game.json, tiles.json, items.json, recipes.json, enemies.json,
  taunts.json, campaign.json, rooms/*.json. Schemas: `src/data/types.ts`.
- Rooms are char-map grids; chars are defined in tiles.json. Entities use tile coords
  where `y` = the tile the entity's *feet* occupy (bottom at `(y+1)*16`).
- `src/engine/` is game-agnostic; `src/game/` is PlayPen; `src/editor/` is the hidden
  editor (Ctrl+Shift+E, or `?editor`).
- ContentStore precedence: Electron = disk `content/`; browser = localStorage overlay
  over bundled JSON.

## Physics numbers that matter (at defaults)

- Jump clears **3 tiles** up (never author 4-tile jumps without spring boots, which
  clear ~6) and ~5 tiles across.
- Player is 12×14 px, fits through 1-tile gaps.

## Cloud content + reports + telemetry

- Published content lives in Cloudflare KV (`CONTENT` binding): players load it via
  GET `/api/content` on boot (precedence bundled < published < local draft). Publish /
  history / restore via the editor's **publish** tab, gated by the `EDITOR_PASSWORD`
  Pages secret (never hardcode it — the repo is public; ask Sean for the value).
- Player bug reports: `REPORTS` KV via `/api/report`; pull with `npm run reports`
  (add `-- --clear` to delete pulled reports from KV once they're fixed).
- Anonymous gameplay telemetry (room attempts/completions/durations, deaths,
  crafts/collects per item): batches POST to `/api/telemetry` → `TELEMETRY` KV
  (90-day TTL) → `npm run analytics` aggregates a report (`-- --clear` / `-- --local`
  work the same as reports). Client posts cross-origin from Electron's `file://`
  origin too — the function answers the CORS preflight for that.
- Wrangler: use the pinned local version (4.112+, devDependency — `npx wrangler`, not
  a stray global; 4.54 silently no-ops on KV-bound Function deploys). `kv key`
  commands need `--remote` or they read an always-empty local simulated store.
  `wrangler login` and the GitHub auth (`gh`/git credentials) are per-machine —
  redo both on a new computer; the KV namespace IDs themselves are already in
  `wrangler.toml` (committed) and need no changes.

## Session replay (deterministic input-replay telemetry)

- Every real (non-bot) playsession records automatically: the content bundle as
  played, the run's RNG seed, and every input tagged by fixed-step index —
  chunk-uploaded to `/api/sessions` → `SESSIONS` KV (90-day TTL). The editor's
  **sessions** tab lists them (filters, completion/outlier badges) and rewatches
  any of them in a modal by re-running the actual simulation (`src/game/replay.ts`
  drives a second `Game` in replay mode). Depth-first = one session across all
  its rooms; breadth-first = every session's segment within one room (needs a
  room filter). A drift indicator at the end proves determinism (0px = exact).
- **Determinism rules this imposes on all future gameplay code**: never read
  `performance.now()` or `Math.random()` for anything state-affecting. Use
  `simNow()` (`src/engine/simclock.ts` — advances one fixed step per update,
  frozen while paused) and the seeded RNG (taunts use it; add new gameplay
  randomness there too). Wall clock + `Math.random` stay fine for pure cosmetics
  (particles, blinks, shake, craft FX) and for pacing (loop hit-stop, touch tap
  timing). New *input surfaces* must be captured: keys/virtual buttons flow
  through `Input.onTransition` automatically; pointer-driven UI actions need
  semantic recording (see `CraftUI.onPointerOp`) or logical-space taps
  (`Game.handleTap`); blocking dialogs go through `Game.askConfirm`.
- Bot detection: synthetic events (`isTrusted: false` — the scripted-playtest
  workflow) and `PP.give`/`PP.warp` taint the session; tainted sessions are
  dropped (set `PP.recorder.uploadTainted = true` to test the pipeline; they
  arrive flagged bot and stay hidden behind the "show bot/dev sessions" toggle).

## Mobile (locked — Sean reversed the first two picks, don't re-litigate)

- Compact screens (short side < 500 CSS px) get a zoomed world view (worldZoom 4/3),
  up-biased camera, and 1.4x touch UI.
- Controls are **discrete ◀ ▶ buttons + a ▼ drop-through**, NOT a joystick. **Separate
  E (interact) and F (use) buttons**, NOT a combined smart-action button. E lights up
  gold with a context verb when something's in reach; F shows the held item's icon.
  Big branded gold CRAFT toggle + small pause chip, top-right. All in `src/game/touch.ts`.
- Touch-button routing rule: a touch that **starts** on a button stays a button
  interaction until release, regardless of what overlay opens mid-press — this is what
  fixes "holding CRAFT" bugs where a release outside the panel reads as a close-tap.
- Touch button drawing happens in raw canvas-pixel space AFTER resetting the transform
  to identity — `restore()` alone rewinds only to the post-viewTransform save point.
- The craft workbench (`src/game/craftui.ts`) *also* draws and hit-tests in raw
  canvas-pixel space, not the logical 640×360 view — that's what lets it be physically
  large on a phone (logical-space UI downscales to ~60% there). Desktop maps the
  classic layout 1:1 through the view scale; compact+touch gets a full-bleed
  side-by-side layout via fixed vertical bands. Don't revert to logical-space drawing.

## Testing / verification workflow

- `npm run typecheck` then `npm run dev`; drive the game via the `window.PP` debug
  handle (`PP.state()`, `PP.give(id)`, `PP.warp(roomId)`).
- Synthetic keys work (`new KeyboardEvent('keydown', {code})` on window) and the loop
  keeps running in hidden tabs, so fully scripted playtests are possible headlessly.
  Synthetic `Touch`/`TouchEvent` objects work the same way for mobile-input tests.
- The Browser-pane `screenshot` tool times out on this page (and a hidden/background
  tab won't render a fresh frame anyway). Instead run `npm run dev-receiver` (writes to
  `./shots/`, gitignored) and from the page:
  `fetch("http://localhost:5199/some_name", { method: "POST", body: canvas.toDataURL("image/png") })`,
  then Read the PNG it wrote.
- When testing multiple sequential `javascript_exec` calls in the same devtools
  session, wrap each in an `(() => { ... })()` IIFE — top-level `const`/`let` persist
  across separate calls and a repeated name throws `SyntaxError: already declared`.

## Content-schema safety (don't regress this)

`src/data/content.ts` `assemble()` deep-merges every content file against the freshly
bundled default instead of taking it wholesale from whichever source loaded last
(bundled < published KV < localStorage draft in browser; disk entirely in Electron).
This matters because a stale save from *before* a schema field existed (an old
localStorage editor draft, an old published bundle, an old on-disk copy) would
otherwise silently drop that whole field/entry — and since most render code reads
content fields unconditionally every frame, a missing one throws on every tick and
kills the game loop outright (an uncaught exception in a rAF callback stops it from
rescheduling). `game.json` merges by nested key (`deepDefaults`); id-keyed arrays
(items/tiles/enemies/recipes/achievements/elements/rules/taunts) merge per-entry by id
and keep any bundled-only entries a stale array predates (`mergeArrayById`). **If you
add a new field to any content schema, this merge is what keeps old saves from
crashing on it — don't revert to a flat `files[...] as Content[...]` assignment.**
This only recovers *missing* fields, not values a stale save explicitly wrote —
republishing/re-saving from the editor is still the fix for those.

## Editor (src/editor/)

- Opening the editor **pauses the game** (`game.pause()`/`resume()` in `main.ts`):
  stops the loop and gates keyboard input entirely, so gameplay doesn't keep running
  (sfx firing) behind it and keystrokes meant for editor text fields (Space, Tab,
  arrows) don't leak through as jump/craft-toggle/movement. Keep this wired if you
  touch the editor-toggle path.
- `forms.ts` `autoForm()` renders string fields that reference other content (item,
  enemy, room, element, tile ids, or a closed schema enum like kind/shape/style/
  trigger) as filterable dropdowns via `fieldOptionsFor(content)` — a plain
  `<input list>`/`<datalist>` combo, keyed by field *name* (not schema), so it stays
  free text and never blocks an unusual value. Add new reference field names to the
  map in `fieldOptionsFor` rather than hand-rolling a new widget.
- Room editor (`roomeditor.ts`) has a **box-select ("▭ box select") tool**: drag to
  select a tile region + the entities inside it, drag inside the box to translate the
  whole group, Ctrl+C/Ctrl+V/Ctrl+D to copy/paste/duplicate it, Delete to clear it —
  separate from the single-entity "select" tool's click/drag. Tile painting has
  brush shape/size (square/circle, adjustable radius) and a rectangle paint mode
  (drag out a rect, release to fill). Room width/height are **not** live-bound number
  fields — they go through `resizeRoom()`, which warns (with a tile/entity count)
  before any shrink that would cut something off, plus a preset dropdown. Don't
  reintroduce a raw editable width/height field; that's the exact bug it fixed.
- Selecting an enemy shows its patrol range as a draggable gizmo (dashed line +
  handles at minX/maxX) on the canvas, not just two raw tile-index number fields.
- NPCs have **two** separate custom-art slots: `portrait` (single-frame dialog-box
  face) and `sprite`/`spriteFrames` (animated in-room body, `RoomEntity extends
  SpriteFields`) — don't conflate them, they're edited in different inspector rows.

## Regenerating rooms

Rooms were originally generated by a script (grid helpers + entity lists) rather than
hand-typed strings — if making broad geometry changes across rooms, prefer writing a
small generator script again; for local tweaks use the in-game editor or edit the JSON.

## Visual-language rules (already fixed once — don't reintroduce the confusion)

- **Brazier vs. hazard fire**: braziers are a safe, always-on ignition source (never
  damages the player) and get a rounded, warm gold/amber, slow-breathing look. Fire
  hazard tiles and dynamically-burning tiles (both deal damage) get a jagged, fast,
  hot-white-tip look. If you add another fire-adjacent visual, pick a side rather than
  reusing whichever `drawFlames`-style helper is closest — the two need to read as
  opposite temperatures at a glance.
- **Spring Coil vs. Spring**: the raw crafting material (`spring_coil`) and the
  placeable bounce pad it crafts into (`spring`) must NOT share an icon shape/color —
  they did once and were indistinguishable. Coil uses shape `"coil"` (stacked wire
  rings, silver-grey); the pad keeps shape `"spring"` (the "boing" zigzag, green).
- **Drain tile** (`content/tiles.json`, style `"drain"`, char `'D'`): any fluid tile
  orthogonally touching it is removed every flow tick. A connected body drains
  completely over time (draining a tile lets its neighbor flow in and reach the drain
  next), not just the one tile against the grate — that's intentional, it's the
  contain-a-flood escape valve. Only affects fluid registered with the flow sim
  (`waterFlowEnabled` must be on); see `tickWaterFlow`/`tileTouchesDrain` in `room.ts`.

## Fluids, falls, lava, braziers (the 2026-07-23 systemic round)

- **Falls are sources** (`fallSpawns` tile field: waterfall spawns `"water"`, lavafall
  `"lava"`): one authored fall tile grows the whole column downward one tile per flow
  tick, and the base (first non-empty tile below) emits its fluid into open side
  tiles. Fall-fed fluid is **sourced** — it spreads with NO distance cap until side
  walls contain it or a drain eats it; bucket-poured/melted fluid keeps the old
  4-tile falloff. **A drain directly beneath a fall absorbs it entirely** (nothing
  pools) — every authored fall now needs either walls that genuinely contain the
  flood or a drain below it; greenhouse and the vault got drains for exactly this.
  A fall only spills sideways the FIRST time it lands on solid ground (that's what
  starts the pool); once the tile directly below is already fluid — the pool has
  risen to meet the fall — it stops there instead of continuing to spill over the
  top every tick (that repeated top-of-pool injection was the bug: don't remove
  the `continue` right after the `isFluid(below)` top-off check in `tickFalls`).
- **Fluid never widens until it has fully fallen, and finite fluid is CONSERVED**
  (Sean's explicit rules): falling MOVES the tile (no duplication trail), tiles
  resting on other fluid wait (at most one diagonal slide into an open hole once
  their support column is grounded), a column's base squeezes out sideways as a
  move under pressure — and a surface tile of melted/poured fluid never
  replicates: it only MOVES toward an adjacent hole it can fall into, so when a
  neighbor drops away the grounded body follows it down ("the whole body slushes
  downhill"). ONLY fall-fed (SOURCED) fluid replicates — falls are the one
  infinite source. Drains run as a PRE-pass each tick so queued water vanishes
  before anything can overflow around it. Verified: a 32-tile melted tower+shelves
  body fully funneled into floor drains, zero left perched. Don't reorder these.
- **Lava** (element `"lava"`, NOT `"fire"` — deliberately, so lava-only rules exist):
  flows exactly like water (`fluid: true`), damages like fire (tile `damage`, crawler
  reaction kill). Made by fire melting cracked stone (`cracked.meltsTo: "lava"`).
  Lava melts metal blocks into a dropped scrap (`metal.dropsItem: "scrap_metal"` via
  the generic `dropsItem` field — any destructive transform pays it out as a bundle).
  The **melt effect no-ops on tiles without `meltsTo`** — that guard is what lets melt
  rules target a whole element (fire→stone) without erasing plain walls. Don't remove it.
- **Water/lava contact destroys BOTH, leaving cracked stone only at the STATIONARY
  side** (Sean's explicit rule — not "lava always hardens, water always survives").
  `resolveFluidContact` in `room.ts` finds whichever of the two just tried to
  move/replicate into contact (fall, diagonal slide, column-pressure squeeze, or
  SOURCED replication) and destroys THAT one outright (no tile placed); the
  neighbor it touched — which wasn't moving this tick — hardens into cracked stone.
  Whichever side happens to be moving determines the outcome, not the element. A
  passive fallback (top of the main tick loop) covers rare non-move-caused adjacency
  (e.g. authored placement) by defaulting to lava-hardens/water-destroyed.
- **Metal grates (`platform` style) and fluid occupy the SAME cell** (Sean's
  explicit call — grates must never be destroyed/replaced by fluid, even when
  fluid genuinely needs to be "at" a grate's position): `realTileBelow` walks
  through consecutive platform tiles, vertically for falling and (via
  `fluidOccupied`, `realTileBelow` called sideways) horizontally for every
  spread/replicate target, and returns a 4-field result — `def`/`solid` for the
  first REAL (non-platform) cell reached, plus a separate `grateY` reporting
  the last grate tile passed through, if any. A **suspended** grate (real open
  space beneath it) is untouched and irrelevant to the result — fluid falls
  straight through to the floor below, `grateY` never enters it. A grate
  **flush against solid ground with no gap** has no empty cell of its own, so
  callers fall back to `grateY` as the resting spot — but instead of
  overwriting the tile grid there, `placeFluid`/`clearFluid` route that
  specific placement through `grateFluid` (a `Map<index, TileDef>` overlay,
  exactly like `burning`): the grate tile stays the grate (still walkable,
  still drawn every frame by `drawMap`), the fluid rides underneath as a
  translucent tint drawn in `drawElementOverlays` (`ctx.globalAlpha ≈ 0.55`
  over the normal fluid tile render). `fluidDefAt(tx,ty)` is the single
  source of truth for "what fluid is logically here" — checks `grateFluid`
  first, falls back to the real tile — and EVERY fluid-identity read in the
  sim (the main tick's per-cell dispatch, the pre-pass drain sweep, contact
  resolution, the passive lava/water fallback, the "fluid above" pressure
  check) goes through it instead of raw `map.at(...)`, or a grate-carried
  cell silently falls out of the simulation the instant it's flooded.
  **`realTileBelow`'s `def`/`solid` describe the real blocking tile ITSELF,
  never the grate fallback** — this is what lets `tickFalls` still tell "a
  matching fall segment already occupies the cell below" (continue growing
  elsewhere) apart from "a grate sits over a dead-end wall" (fall back to
  `grateY`) apart from "the opposite fluid is right there" (quench). Collapsing
  those into one flattened result was the exact bug that broke a suspended
  grate the OTHER fall growth had already grown past — don't re-flatten it.
  Closed gates always fully block regardless of any grate before them (force
  `grateY: -1` in that branch) — don't let flooding route around a shut door.
- **Closed gates (doors AND trapdoors) block fluid** the same way they block the
  player — open gates and plain (non-gated) teleport doors don't. `doorBlocksFluid`
  in `room.ts` checks entity rects, not tiles (doors/trapdoors aren't part of the
  tile grid); `realTileBelow`'s `solid` flag folds this in for the vertical fall
  path, and `fluidOccupied` folds it in for every horizontal spread/replicate
  check. A closed gate over otherwise-open space reads as solid to fluid even
  though the tile underneath is `null` — don't go back to bare `map.at(...) !==
  null` checks or fluid will leak straight through shut doors again.
- **Trapdoor** (new entity type, `ENTITY_SIZES.trapdoor = [16,16]`, one tile):
  the vertical counterpart to `door` — same `gate`/`fuseId`/`to` fields and the
  same `useDoor` interact logic, but a closed one blocks the player's vertical
  passage (push out along Y) instead of horizontal (push out along X), drawn as
  a horizontal hatch instead of a vertical panel. Reuses every door mechanism
  (fusebox wiring, interactableNear, prompts) via `e.kind === "door" ||
  e.kind === "trapdoor"` checks — extend that pattern, don't fork a parallel path.
- **Fire is a wall, not a damage floor**: the fire tile has `repels: true` — a new
  generic tile flag that shoves the player back out on every overlapping frame,
  including invuln frames, so you can never tank through it; extinguish it instead.
  Damage still applies on vulnerable contact, with knockback away from the tile
  (`ev.repelFromX`), not the old always-rightward spike shove. Lava deliberately
  does NOT repel — it's a wadeable damaging fluid.
- **Braziers have a `lit` state** (entity field, default true; author `lit: false`
  for a bring-fire-here puzzle). Water contact (splash or flowing/fallen water tiles)
  douses; fire element or passive lit-torch contact relights. Unlit braziers don't
  ignite neighbors, don't light torches (`boxTouchesFire` gates on it), and draw as
  cold dark coals — keep that read unambiguous vs. the lit warm-gold breathing look.
- **Swimming** engages only in water-style columns **≥3 tiles deep** (`Player.
  swimState`: "surface"/"under"; shallower stays plain wading — don't lower that
  threshold, puddles aren't pools). Tunables in `game.json` `player.swim` (slow-sink
  gravity, stroke impulse per jump press, hold-jump lift, floaty accel/friction) and
  `rules.airBlips/airLossSeconds/drownSeconds`. Submerged: jump = stroke, air drains
  a blip per `airLossSeconds`; at zero air a heart per `drownSeconds` (ignores invuln
  frames deliberately). At the surface: full normal-strength jump out, instant air
  refill. Air also refills on respawn — a checkpoint inside floodwater would
  otherwise re-drown on an empty meter. HUD bubbles sit under the hearts (`hud.air*`),
  drawn only while underwater or not-full.
- Sim caveat: these changed simulation code, so **replay of sessions recorded before
  this round will show drift** — expected; sessions record content but not code.

## Style

- No image/audio assets: art is procedural primitives (renderer.ts), SFX is WebAudio
  synth (audio.ts). Keep it that way until Sean says otherwise.
- The Warden's voice: see "Tone" in docs/DESIGN.md before writing new taunt lines.
- Commit messages: descriptive Title-Case noun phrases.
