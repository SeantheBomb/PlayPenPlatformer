# PlayPen — Handoff / Session Log

*Written 2026-07-20, for moving work to a new machine. `CLAUDE.md` carries the durable
"don't regress this" conventions that load automatically every session — this file is
the fuller narrative: what's been built, in what order, why, and what a fresh
Claude Code session (or Sean) needs to redo locally to keep working. Nothing here is
secret except where explicitly noted as "ask Sean."*

## Start here on a new computer

1. `git clone` the repo, `npm install`.
2. `npx wrangler login` — Cloudflare auth is per-machine; the project (`playpen`) and
   both KV namespace IDs are already in `wrangler.toml` (committed), so no Cloudflare
   *setup* is needed, just re-authenticating this machine to the account.
3. GitHub auth (`gh auth login` or your usual git credential setup) is also
   per-machine.
4. Ask Sean for the `EDITOR_PASSWORD` value (a Cloudflare Pages secret, gates the
   editor's publish tab) if you need to publish content — it's already set on
   Cloudflare's side, nothing to configure, just something only Sean should tell you.
5. `npm run dev` for local dev, `npm run app` for the Electron shell, `npm run deploy`
   (or the manual `build` + `wrangler pages deploy` pair — see `package.json`) to ship.
6. Read `CLAUDE.md` in full — it has the conventions that are easy to accidentally
   regress (mobile control scheme, content-merge safety, craft-UI coordinate space,
   editor pause behavior, the brazier/fire and coil/spring visual-language rules).

Live at **https://playpen.pages.dev**. Repo: SeantheBomb/PlayPenPlatformer (public).

## What this game is

Comedic-menace escape platformer. You're "Subject #67" in a facility run by a
Portal-style overseer (**the Warden**), scavenging materials, discovering crafting
combinations (Little Alchemy-style combine-two), and escaping room by room. Full
vision/pillars/tone in `docs/DESIGN.md`; the elemental kernel (7 elements + ~10
data-driven rules, the systemic core that replaced early arbitrary key-gates) in
`docs/ELEMENTS.md`; level-design taxonomy in `docs/OPPORTUNITY_MATRIX.md`.

Architecture in one line: **everything gameplay-affecting lives in `content/*.json`**;
`src/engine/` is a game-agnostic Canvas2D engine, `src/game/` is PlayPen-specific,
`src/editor/` is a hidden in-app content editor (Ctrl+Shift+E). No image/audio assets —
art is procedural (`renderer.ts`), sound is synthesized WebAudio (`audio.ts`).

## Locked design decisions (interview-derived, don't re-ask)

- Tone: comedic menace, Portal-school. Warden is bureaucratic/petty/never sincerely
  helpful, addresses you only as "Subject #67," nursery vocabulary on a prison setting.
- Crafting: hybrid — free combine-two experimentation *and* found recipe notes. Every
  successful craft auto-records its recipe (`tryCraft` → `knownRecipes`), so a recipe
  discovered by guessing is never lost even if you never find its note.
- Death: respawn at last checkpoint, drop carried *materials* as a recoverable bundle
  (tools/consumables are kept); enemies reset to their posts.
- Confiscation: the Warden empties your entire inventory between rooms
  (`rules.resetInventoryBetweenRooms`) — knowledge/recipes persist, items don't. Every
  room must supply everything its own gates need; nothing carries a required item
  across a room boundary.
- Shell: **Electron-first** (Sean's explicit pick), but every build stays
  Cloudflare-deployable (same codebase, `ContentStore` branches on `isElectron()`).
- Systemic over arbitrary (Sean's standing direction, restated often): no
  object-specific keys ("door X opens for key Y"). Gates resolve through element
  interactions and should admit ≥2 solutions. Tools are element *carriers*
  (torch=fire, bucket=water, hammer=force...), not player stat powerups — this is why
  spring **boots** were cut in favor of a placeable/reclaimable spring item.
  New gameplay should be expressible as a new rule/tile/item before new code; new
  code verbs only when a rule genuinely can't express it.
- Chase/pressure sequences (the Warden's boss chase, idle-too-long punishment) must
  **never** require crafting mid-sequence — every needed tool is pre-staged along the
  route. Enemies are introduced late (room 7 of 10) so crafting teaches clean first.
- Achievements are editor-configurable content (`content/achievements.json`), each
  with a Warden reaction; hidden ones are counted-but-never-named on the win screen.
- Mobile controls (**locked after two reversals** — see `CLAUDE.md`'s Mobile section
  for the current, correct scheme): discrete movement buttons not a joystick, separate
  E/F not a combined smart-action button.

## Build order (condensed; git log has the granular commits)

Rounds are grouped by theme, oldest first. Skimming this saves re-deriving *why*
something looks the way it does from the diff alone.

1. **Foundation** — Vite/TS/Electron scaffold, serialized content schemas, custom
   engine (fixed 60Hz timestep + hidden-tab fallback so the loop survives
   backgrounding), room runtime, hidden editor, design docs, first playtest pass.
2. **Elemental core redirect** (Sean's biggest steer) — replaced arbitrary key-gates
   with the 7-element kernel: `content/elements.json` + `rules.json` wire actor→effect
   verbs (ignite/melt/extinguish/dissolve/freeze/shatter/energize/ignite_self/fizzle);
   tiles/items/enemies all carry an element; all 7 rooms re-authored around it.
3. **Multi-scheme input + deploy** — gamepad auto-detection, first mobile touch pass,
   Cloudflare Pages deploy.
4. **Systems depth** — waterfalls (douse carried flames, block fire crossing),
   passive torch auto-ignite/auto-extinguish, spotter AI + line-of-sight stealth,
   fire-spread rules, drag-drop craft UI with a materials/equipment split and an
   icon-based journal, NPC trade confirmation modals, the Warden as an idle-pressure
   presence *and* a scripted boss chase, the full 10-room achievements system and
   campaign pacing rework.
5. **Polish + systems fixes** — torch icon fix (unlit ≠ hammer-shaped), swim-under
   vault passage + submerged-water rendering, Minecraft-style water flow physics
   (falls into shafts, spreads sideways with falloff), bug-report pipeline
   (`/api/report` → KV → `npm run reports`), editor-configurable HUD layout, item
   scattering redesign (materials read as exploration rewards, not entrance freebies).
6. **Mobile prototype → v4** — first pass was a floating joystick + combined
   smart-action button; **Sean reversed both** after playtesting: discrete ◀▶
   buttons, separate E/F. Fixed the "holding CRAFT" bug (a touch that starts on a
   button now stays a button interaction through release, whatever overlay opens
   mid-press). Added dismantle-a-tool-back-into-materials (softlock escape) and a
   reset-room button. Added anonymous telemetry (room attempts/completions/durations,
   crafts/collects) → `TELEMETRY` KV → `npm run analytics`.
7. **Craft UI redesign** — moved the whole workbench into raw canvas-pixel space
   (see `CLAUDE.md`) so it can be physically large on a phone; added success/mismatch
   juice (pop, sparks, ring, slot-shake), a NEW RECIPE banner, and a glowing journal
   badge for recipes discovered by experimenting.
8. **Content-merge crash fix** — traced a "choppy framerate that locks up near a
   dialog" report to a stale `game.json`/content array silently dropping a newer
   field and crashing the render loop on the next frame that read it. Fixed with a
   deep-merge-against-bundled-defaults pass (`assemble()` in `content.ts`) — see
   `CLAUDE.md`'s Content-schema safety section, this is the single most
   easy-to-accidentally-revert fix in the codebase.
9. **NPC sprite editor + visual-language fixes** — NPCs got a body-sprite slot
   (previously only had a dialog portrait); distinguished the brazier (safe) from
   hazard fire (dangerous) with opposite visual languages; gave the raw Spring Coil
   material its own icon instead of sharing the placeable Spring's.
10. **Editor UX round** — pausing the game while the editor's open, copy/paste
    entities (every field including sprite overrides), reference-field dropdowns,
    draggable patrol-range gizmos, box-select + group move/copy/paste for tiles *and*
    entities together, tile brush shape/size + rectangle paint mode, and safe room
    resizing (warns before a shrink cuts anything off, plus size presets).
11. **Latest bug round** — torch-douse hitbox was reusing the (deliberately oversized)
    hazard-scan box, so a water tile diagonally adjacent could douse a carried torch;
    gave water its own exclusive-edge check. Ice melted mid-air became water but never
    joined the water-flow sim (only flow/pour-created water was registered), so it sat
    inert instead of falling/spreading — any tile transform landing on "water" style
    now registers. Added a **Drain** tile (content-only + one render case) that
    consumes any touching water, draining a whole connected body over time — the
    contain-a-flood release valve.

## Ops / infrastructure notes

- **Cloudflare**: Pages project `playpen`, account already referenced in
  `wrangler.toml`. Three KV namespaces, all bound + committed: `CONTENT`, `REPORTS`,
  `TELEMETRY`. Wrangler must be 4.112+ (pinned devDependency) — 4.54 silently fails to
  attach KV-bound Functions on deploy. `kv key list/get` need `--remote` or they read
  an always-empty local simulated store.
- **Content publishing**: editor's publish tab pushes the *entire* current content
  bundle to KV, gated by `EDITOR_PASSWORD` (a Pages secret — ask Sean, never commit
  it, the repo is public). Version history + restore-to-a-prior-version both live
  there too.
- **Reports / telemetry**: no public read endpoint for either — always pulled via the
  owner's authenticated `wrangler` session (`npm run reports`, `npm run analytics`).
  Both scripts accept `-- --clear` to delete what they just pulled from KV.
- **AI-playtest workflow**: `window.PP` debug handle (`PP.state()`, `PP.give(id)`,
  `PP.warp(roomId)`) plus synthetic `KeyboardEvent`/`Touch` dispatch make fully
  scripted headless playtests possible — the engine has a hidden-tab `setInterval`
  fallback specifically so this works in a backgrounded browser tab. Screenshot via
  `npm run dev-receiver` (see `CLAUDE.md`'s testing section) since the Browser-pane
  screenshot tool times out on this page.

## Session-replay telemetry (shipped 2026-07-23)

The deterministic input-replay system described in `docs/TELEMETRY_REPLAY_HANDOFF.md`
(originally attempted by a cloud session that hung; rebuilt from scratch here) is now
live. Every real playsession records the content-as-played, the run's RNG seed, and
every input tagged by fixed-step index; chunks upload to `/api/sessions` → `SESSIONS`
KV. The editor's **sessions** tab lists sessions (filters, completion + outlier
badges) and rewatches any of them by re-running the actual simulation in a modal —
play/pause/speed/seek, live held-input readout, depth-first (whole session) and
breadth-first (all sessions in one room) modes, and a drift indicator that proves
determinism (verified 0px on the end-to-end test). The determinism ground rules this
imposes on all future gameplay code (sim clock, seeded RNG, input-capture surfaces)
are documented in `CLAUDE.md`'s "Session replay" section — read them before adding
any new timer, randomness, or input path.

## Fluids/lava/braziers round (2026-07-23)

Git `content/` was first synced to the live published bundle (the web editor
publishes straight to KV without writing back to the repo — after an incident where
republishing from stale git content reverted Sean's level design, git is now the
snapshot of live truth; keep them in step when publishing). Then, per Sean's spec:
waterfalls (and new lavafalls) became self-sustaining sources — one authored tile
grows the whole fall and floods uncapped until walls or a drain contain it
(greenhouse + vault got drains under their falls); braziers gained a lit/unlit
state (water douses, fire or carried-lit-torch contact relights, `lit: false`
authorable as a puzzle); and lava arrived as its own element — made from
fire + cracked stone, quenched back to cracked by water, flows like water, damages
like fire, and melts metal blocks into dropped scrap via the new generic `dropsItem`
tile field. Details and don't-regress notes in `CLAUDE.md`'s "Fluids, falls, lava,
braziers" section. Verified by scripted playtest: 21-tile fall from one tile,
wall-to-wall sourced pool, drain equilibrium, fire→lava→quench cycle, 9 metal
blocks → 9 scrap bundles, ice-melt → water → lava-hardening cascade.

## Swimming + flow-ordering round (2026-07-23, same day as fluids)

Two Sean requests landed together. **Swimming**: water columns ≥3 tiles deep put
the player in a Mario-style swim state — slow sink, jump-press strokes, hold-jump
lift, floaty horizontals, full-strength jump out at the surface — with a 3-blip air
meter under the hearts (blip per 3s submerged, then a heart per 3s at zero, refill
at surface/respawn; all tunable in game.json). **Flow ordering**: fluid never
widens until fully fallen — falls move instead of duplicating, settling columns
wait their turn, bases squeeze out under pressure, and drains run as a pre-pass —
so drains flanking a melting ice tower fully contain the runoff (verified: 9-tile
burst melt, zero horizontal escape; fire tiles also became repelling barriers you
can't invuln-tank through, earlier the same day). Conventions in `CLAUDE.md`.

**Smoke bomb redesign v2** (same day, twice): first a timed invisibility buff,
then reworked to Sean's real intent — the bomb is THROWN (arc, bursts on solid
impact) and lays a positional smoke VEIL, radius 10 tiles (`smokeBombRadius`
160px), lasting `smokeCloudSeconds` (10s). Sight connects only when both the
player and the spotter stand in clear air: in-veil players are unseeable,
in-veil spotters can't see out, and stepping outside makes you instantly
visible again. Sight-hunters do no contact damage to an in-smoke player;
crawlers bite regardless. Veil state lives per-room-instance (transient), the
player draws half-faded inside it, and the Warden is deliberately not fooled.
Throwables charge on press-and-hold: hold Use for a higher/longer arc (dotted
preview while charging, throwChargeSeconds to full, tap = throwMinPower).

Also that day: a deliberately quiet **level select** on the main menu — dim
"L · rooms" tag in the corner (L / Y-button / tap), room list with keyboard,
gamepad, and touch nav. Intentionally subtle so the default flow still funnels
players into room one; don't promote it to a big menu button.

## 2026-07-31 — The behavior grammar (content-scripted behaviors round)

**Sean's ask**: an editor expansion so tile/entity/enemy/tool behavior is
configurable and scriptable from content, not engine code — compose existing
behaviors onto new entities, modify/create behaviors, and self-serve tuning of
two specific bugs (water "sloshing" indecisively; lava chain-melting ALL
touching metal "like wood"). Interview locked: trigger→condition→action rules
(not a full DSL), port existing behaviors now, fluid sim core stays engine
with lifted tunables, forms-first editor authoring. Explicit constraint:
nothing functionally changes in the game this round.

**What shipped**:
- `content/behaviors.json` — a library of named behavior docs (rules:
  `on` trigger, `if` conditions, `do` actions; `params` with `$name` /
  `$host.field` / `$data.field` refs; optional per-instance `vars`).
  Interpreter: `src/game/behavior.ts` (`BehaviorSystem`), verb registries in
  `room.ts` (enemy/entity verbs) and `game.ts` (item verbs, static block).
- **Enemy AI fully ported**: patrol/chase/return/stun/traps/hazards/reactions
  all run as docs (`hazard_reactions`, `element_reactions`, `stun_cycle`,
  `chase_on_sight`, `patrol_route`, `return_home`, `grounded_move`,
  `trappable`). `enemies.json` carries explicit `behaviors` arrays; defs
  without one get the legacy-derived set (`enemyAttachments`). The sight cone
  drawing + smoke immunity key on the `"sight"` behavior TAG, not the old
  `behavior: "chase"` enum (which remains only as the legacy fallback).
- **Item use ported**: swing/splash/place/burst + passive douse/ignite/brazier
  lighting are `use_*`/`doused_in_liquid`/`ignites_near_fire`/`lights_braziers`
  docs (derived from `useMode` etc. via `itemAttachments` unless an item has
  an explicit list). Brazier douse/relight is the `brazier_flame` entity doc
  (auto-attached via `attachTo.entities`).
- **Global tunable docs** (code consts are fallbacks; content wins):
  `fluid_flow` (`intervalSec`, **`sideBias`** alternate/left/right — the slosh
  knob, `recedeMs`, `toyblockPushSec`), `heat_spread` (`intervalSec`,
  **`chainMeltRange`** — -1 unlimited (shipped default = old behavior), 0 =
  direct-contact only, N = chain cap; the lava-melts-all-metal knob),
  `element_effects` (`energizeMs`, freeze/energize flood caps).
- **Editor**: new **behaviors** tab (list + auto-form + per-rule builder with
  trigger dropdown and validated-JSON if/do rows + verb legend generated live
  from the registries) and a behavior-attachments widget on the enemy/item
  inspectors (derived-list display with "customize" to materialize, ordered
  rows, add-with-datalist, revert-to-derived).
- **Tests**: `tests/enemy-behaviors.test.ts` (26 characterization tests
  written against the OLD engine loop first, kept green through the port),
  `tests/behaviors.test.ts` (customization contract: custom docs override
  engine behavior, attachment params override defaults, chainMeltRange 0/1/-1,
  sideBias left/right). All content-bearing test harnesses now include
  behaviors.json. 105 tests green.

**Deliberate scope cuts** (talk to Sean before "fixing"): tile player-physics
flags (`damage`/`repels`/`bounce`/`slow`/`wade`/`slippery`) stay direct-read
TileDef fields — they're already per-tile content tunables and live in the hot
collision path; `TileDef.behaviors` exists in the schema but no tile-host docs
ship yet. Water/lava contact outcome (who hardens) stays engine (it already
reads tile `extinguishesTo`). The burst CHARGING input flow still keys on
`useMode === "burst"` (input pacing), only the throw itself is a doc. Old
recorded sessions replay through the same merged-bundled behaviors.json, so
drift should stay 0px — worth eyeballing one old session in the sessions tab.

## 2026-07-31 (same day, round 2) — penscript replaces the JSON grammar

Sean reviewed the JSON trigger/condition/action grammar in the editor and
rejected it structurally (see the locked principles in CLAUDE.md's editor
rules): instance-shape-derived forms are an illusion of control, attachment
must live on the def, no form-wrapped-JSON half-UIs, and JSON-encoded logic is
too opaque to read. After a workshop (PuzzleScript / ZZT-OOP / Bedrock JSON /
Factorio Lua / event sheets), he picked: a custom DSL (braces, TS/C#-light,
`var`-only — Unity public-field mental model), pattern-line element rules, and
the structural editor fixes. Same-day replacement, all on this branch, nothing
of the JSON grammar shipped:

- **penscript** (`src/game/penscript.ts` lexer/parser/AST + evaluator in
  `behavior.ts`): scripts live in behaviors.json as line arrays; top-level
  `var`s = tweakable fields (per-attachment overrides via `params`); handlers
  `on tick { ... }` etc.; engine capability only via registered functions
  (deterministic by construction). All 19 docs ported; the enemy/item/brazier
  behavior itself is byte-for-byte the same sim (26 characterization tests
  unchanged and green through BOTH ports).
- **rules.json** rows became pattern lines: `"lava + metal -> melt"`
  (legacy split-field rows still parse — stale-save safe).
- **entities.json + entities tab**: EntityTypeDef (footprints + default
  behaviors) replaces hardcoded ENTITY_SIZES + the doc-side attachTo.
- **Schema-driven forms**: tiles/items/enemies/entities render the FULL field
  schema (fire shows `fluid`, water shows `repels`); empty optional fields
  delete their key. Schemas live in editor.ts.
- **Behaviors tab**: metadata form + monospace script pane with live compile
  errors (line-numbered) + legend generated from the function registry.
  Parser recovery has no-stall guards — it compiles per keystroke and an
  infinite recovery loop froze the page once in testing (regression-tested).
- 111 tests green; sideBias/chainMeltRange knobs verified at multiple values.

**2026-08-01 — script editor polish** (Sean's ask after first hands-on): the
behaviors tab pane is now a real code editor (`src/editor/scripteditor.ts`,
zero deps): VS Code-ish syntax colors via a token-highlight layer rendered
behind a transparent-text textarea (both layers must share the exact font/
padding — see the .pp-code* CSS), a large resizable pane in a wider panel,
and hover tooltips computed from monospace math (mouse -> row/col -> token):
keywords/events/builtins have doc tables, engine functions show the doc
string they were registered with (registerFn's 3rd arg — annotate new
functions or their tooltip is generic) plus which other behaviors use them,
and a behavior's own fields report where they're defined, which lines use
them, and which attachments override them. The panel header also shows
"attached by: ..." per doc (derived attachments included).

**2026-08-01 (same day, round 3) — conditional field-group reveal, enemy
schema pruning.** Sean's next ask, after seeing the tiles-schema screenshot
again: group related toggle-gated fields so an unused parameter never sits
visible-but-inert. First instinct was to reuse the behaviors[] attachment
mechanism for tiles/items too — Sean pushed back: tile/item properties are
plain data with no shared defaults another entry overrides (every tile's
`burnTime` is already bespoke), so the "shared default + per-attachment
override" machinery the behavior system exists for doesn't fit. Landed on a
lighter mechanism instead:

- **`FieldSpec.reveals?: string[]`** (`src/editor/forms.ts`): a gate field
  (bool: checked; string/color: non-empty; number: defined) shows its
  dependents nested underneath itself, and DELETES them the instant the gate
  turns off — same "empty optional field deletes its key" rule schemaForm
  already applied per-field, now applied to a whole dependent group at once.
  `schemaForm` internally rebuilds its row list (`renderRows()`) whenever a
  `reveals`-bearing field changes; every other field is unaffected (cheap
  no-op check). Two tile groups (`flammable`→burnTime/burnsTo, `brittle`→
  shattersTo — both audited against every real `content/tiles.json` entry;
  everything else in TileDef turned out to be already self-gating by value
  presence, like `meltsTo`, or genuinely independent, like `damage`/`repels`
  — lava has damage without repel, fire has both, confirmed NOT a group).
  One item group (`dousedBy`→dousesTo/douseOnDeselect).
- **EnemyDef pruned**, since enemies DO run real logic through behaviors[]
  and several flat fields were pure duplicates of what an attached behavior
  already read: `reactions` moved into `elementReactions`'s own `params`
  (`reactFromTable` now takes the table as an argument instead of reading
  `en.def.reactions`); `chaseSpeed`/`sightRange`/`loseTargetMs`/`returnsHome`
  moved into `chaseOnSight`'s own script defaults + params (it no longer
  does `host.sightRange ?? 120`, just `120`, overridable via the attachment
  same as `giveUpTo` already was). `trappable` (flat bool) and `turnAtEdges`
  deleted outright — confirmed dead via grep (turnAtEdges was never read
  anywhere; trappable's only reader was the pre-behaviors[] legacy fallback).
  `behavior` (legacy patrol/chase enum) is now optional and hidden from the
  form — every real enemy has an explicit `behaviors` list, so it's dead for
  anything authored going forward; `enemyAttachments()`'s fallback derivation
  in `behavior.ts` still reads it (via an `as unknown as Record<string,
  unknown>` cast, same pattern `enemyResetState` already used) purely as a
  safety net for hypothetical pre-behaviors[] stale saves. `stunnable`
  stayed a flat field — Sean's explicit call — since its only reader
  (`stunEnemiesNear`, the smoke-bomb stun radius) sits outside the
  behavior-dispatch system entirely, unlike everything else on this list.
- **attachmentsWidget rewrite**: each attached behavior is now an id-dropdown
  (reference-field style — wrapped in `.pp-form` so it inherits the exact
  same input styling as every other reference dropdown, which is what "add
  behavior" was missing before) plus a SEPARATE small params-only JSON row,
  instead of one combined raw-JSON blob you had to hand-edit to change which
  behavior a row even referenced.
- **Caught mid-migration**: `var reactions = {};` in `elementReactions`
  doesn't compile — **penscript has no object-literal syntax at all**
  (`parsePrimary` has no `{` case). A field meant to be set only via
  attachment `params` still needs a syntactically valid literal default;
  used `null` instead (`reactFromTable`'s null/undefined guard already
  handled it). This silently disabled the ENTIRE `elementReactions` behavior
  for every enemy (a script that fails to compile sets `doc.script = null`,
  and `fire()` just skips docs with no script) — no crash, just every
  element reaction going quietly to "none". Caught by the characterization
  suite (6 failures, all reaction-shaped), not by static analysis. **If you
  need an object-shaped default in a behavior script, `null` is currently
  the only valid literal — object/array literals aren't implemented.**
- 114 tests green — `enemy-behaviors.test.ts`'s chaseSpeed assertion updated
  to read the value from content (128, spotter's `chaseOnSight` param)
  instead of the now-deleted `en.def.chaseSpeed`.

## 2026-08-04 — `fluidFlow.sideBias: "lower"`

Sean asked, off the `sideBias` var's doc comment: where do valid values for
a tunable like this actually live (nowhere formally — it's a plain string,
the comment is a hint, the real meaning is whatever `room.ts` checks it
against), and could he add a fourth mode ("falls toward whichever side is
connected to the lowest tile, alternate on a tie") himself. Answer was no —
this needed real comparison logic the sim didn't have, not just a new
tunable value — so built it:

- **`RoomRuntime.dropDepth(tx, ty)`** (room.ts): straight-down scan from
  `(tx,ty)` to the first REAL solid tile, walking through platforms (same
  as the rest of the sim) and through existing fluid (a spot that already
  has a pool sitting in it shouldn't read as shallower than its actual
  floor — that's what "connected to the lowest tile" means). Off the map
  or open all the way to the floor reads as maximally deep.
- **`sideXs(tx, ty)`** — signature gained `ty` (every one of its 5 call
  sites updated to pass it, one as `baseTy` in `tickFalls`). When
  `sideBias === "lower"`, compares `dropDepth(tx-1,ty)` vs
  `dropDepth(tx+1,ty)` and returns the deeper one first; an equal-depth tie
  falls through to the existing flip-based order unchanged.
- `flowFlipEff`'s computation (`tickWaterFlow`) restructured from a
  `sideBias==="alternate" ? flip : sideBias==="right"` ternary to explicit
  left/right/else branches, so the "else" (alternate flip) fallback now
  correctly covers `"lower"`'s tie-break too — byte-identical behavior for
  the three pre-existing values, verified by the full `fluids.test.ts`
  suite staying green untouched.
- Three new tests in `tests/behaviors.test.ts` (asymmetric-depth rooms,
  both directions, plus the tie-falls-back-to-alternate case reusing the
  existing slosh-knob test's symmetric room shape). 117 tests green.

## 2026-08-04 (round 2) — fluid/heat policy hooks (decisions move into scripts)

Sean's `sideBias: "lower"` test showed nothing, and his diagnosis of WHY cut
deeper than the bug: the global docs were var-lists with all the actual logic
invisible in engine code — "you have too much hidden inside engine code...
break the engine functions down into more elemental pieces and let these
behavior scripts handle more of the actual integration and logic." (The
specific failures: sourced/fall-fed spreading replicated to BOTH sides so a
side preference was meaningless there; the depth compare only looked one tile
out; and globals only load at room construction.)

Confirmed split with Sean: engine keeps the MECHANICS (iteration order,
conservation, grate transparency — the locked fluids-test invariants, which
penscript couldn't express anyway with no loops); every DECISION becomes an
`on <hook>` handler on the global doc, called via `RoomRuntime.fireGlobalHook`
with decision functions writing the answer into ctx.data:

- `on pickSide` — prefer("left"/"right"/"alternate"); terrain queried with
  `sideDepth(dir, lookahead)` (slope-following: deepest floor reachable
  within lookahead tiles, walls stop the scan, sees through platforms and
  existing fluid).
- `on sourcedSpread` — spreadBoth/spreadLeft/spreadRight/spreadNone; governs
  case-4 sourced widening AND tickFalls' base emit (both sites).
- `on fluidContact(mover, other)` — destroyMover/keepMover ×
  hardenOther(tileId?)/destroyOther/keepOther; governs resolveFluidContact
  and the fall-landing case (the passive lava-adjacent fallback stays
  engine). keepMover lets fluids coexist side by side.
- `on recede(ratio)` — setDelay(ms).
- heatSpread `on meltChain(depth)` — keepHot() chains the melt onward.

**The sentinel lesson (cost one debug round):** "handler ran but stayed
silent" is a real decision (meltChain not calling keepHot = stop the chain)
and is indistinguishable from "no handler" if you only inspect ctx.data —
added `BehaviorSystem.hasHandler(docId, trigger)` and the call sites branch
on it explicitly. No-handler = full legacy fallback, INCLUDING the retired
sideBias/chainMeltRange vars, so stale localStorage drafts / old publishes
keep working (tested).

Shipped default handlers reproduce classic behavior exactly — fluids.test.ts
and melt-chain.test.ts pass untouched. 126 tests green (hook coverage: capped
melt chains, pinned sides, script-authored "lower" both directions + tie,
one-sided sourced fill, inverted contact outcome, both legacy fallbacks).
Verified live with a synthetic stepped-terrain room: waterfall pool committed
entirely toward the deep basin, far shelf bone dry — the "lower" policy Sean
asked for, authored as ~8 lines in the fluidFlow script pane.

## 2026-08-05 — Published-content sync architecture + two fluid bug fixes

**The pseudo-regression class, killed architecturally.** Sean: "The published
content is always the primary source of truth... you should be aware of the
authored content that's published, not just the generic content you've
bundled." The failure mode: the published KV bundle wholesale-wins per array
entry over bundled (`mergeArrayById`), so any repo-side change to an entry
Sean has published (e.g. the fluidFlow behavior doc) is silently masked for
every player and for Sean himself even after clearing his local draft. New
tooling: `npm run content:pull` (tools/pull-content.mjs — live published
bundle → `content/`, provenance in `.content-base.json`) and
`npm run content:push` (tools/publish-content.mjs — `content/` → a new KV
version via `npx wrangler`, prunes past 30). `npm run deploy` now chains
content:push so code and content always ship together. Repo `content/` now
carries Sean's authored rooms/game.json (pulled), reconciled against the
5 code-coupled files which had zero authored deltas.

**mess_hall report ("lava shouldn't be on top of the metal grate"):** lava
released onto a full pool under a flush walkway grate came to rest one tile
ABOVE the visibly dry grate. `fluidOccupied`'s fluid-below branch now offers
the grate cell's dry overlay (`grateY`) as the resting spot — the pool's
surface rising through the walkway.

**greenhouse report ("water on the ice oscillates back and forth instead of
falling"):** period-2 scans found nothing; a whole-room perpetual-motion scan
(flag seeds still emitting flow events every tick after 40 settle ticks)
caught it — a two-tile body atop a one-wide column shuffles sideways forever:
the pillar tile's case-4 move hops to the SAME ROW beside the hole, vacate's
grab-chain drags the neighbor back onto the pillar, and the intra-row
processing order (alternating with flowSideFlip) reaches the pillar tile
first both ticks, so the overhang never takes its fall turn. Fix: case-4
moves and case-2 diagonal slides now land IN the hole (one diagonal step
down) — motion is monotonically downward, the cycle can't form. Five
behaviors.test.ts landing-row assertions updated (design intent unchanged);
both bugs got permanent regression tests in fluids.test.ts. 128 tests green.

## Known non-blocking follow-ups (mentioned to Sean, not yet requested as work)

- Group-clipboard paste (box-select tool) always offsets +1 tile from the current
  selection rather than pasting at the mouse cursor — fine for nudge-then-drag, would
  need a real drop-target if Sean wants cursor-relative paste.
- The reference-field dropdown feature covers scalar string fields only; array
  reference fields (a recipe's two inputs, an NPC's reward-recipe list) still use the
  older text/JSON editors — would need a multi-select UI, not requested yet.
- `docs/DESIGN.md` / `docs/OPPORTUNITY_MATRIX.md` describe the vision and haven't been
  revised alongside every implementation round above — treat them as the *intent*
  doc, this file + `CLAUDE.md` as the *current state* doc, and git log/diffs as ground
  truth for exact behavior.
