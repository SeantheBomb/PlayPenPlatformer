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
impact) and lays a positional smoke VEIL, radius 10 tiles (160px), lasting  (10s). Sight connects only when both the
player and the spotter stand in clear air: in-veil players are unseeable,
in-veil spotters can't see out, and stepping outside makes you instantly
visible again. Sight-hunters do no contact damage to an in-smoke player;
crawlers bite regardless. Veil state lives per-room-instance (transient), the
player draws half-faded inside it, and the Warden is deliberately not fooled.

Also that day: a deliberately quiet **level select** on the main menu — dim
"L · rooms" tag in the corner (L / Y-button / tap), room list with keyboard,
gamepad, and touch nav. Intentionally subtle so the default flow still funnels
players into room one; don't promote it to a big menu button.

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
