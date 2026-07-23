# Telemetry Replay System — Interrupted Session Handoff

*Transcribed 2026-07-20 from screenshots of a stuck cloud/web session (Claude Code
web interface, model "Fable 5" at "High" effort, branch `master`, repo
`PlayPenPlatformer`). That session hung mid-task ("Request failed · retrying (2/10)
· 28m 38s" while creating `recorder.ts`) and its work is **not** in this local repo or
any commit — `rng.ts` and `recorder.ts` don't exist here, and `input.ts` doesn't have
the described changes. Whatever it built (+138/−22 lines per its own diff counter) is
stranded in that other session's workspace. Before redoing this from scratch, it's
worth going back to that session/browser tab to see if it's actually still alive, or
if a PR/diff can be recovered from it — re-deriving is the fallback, not the first move.*

## The original request (verbatim)

> I want a full telemetry system built into the editor. For every playsession that
> occurs (that isn't bot driven) it should be able to capture and record the game
> state and all user input in such a way that the player can perfectly reproduce the
> recorded session by replaying the level as capture and the input of the user.
>
> From this telemetry page I should be able to view a filterable list of all the
> captured sessions, including any metadata or PID tied to the player in the session.
> For each session, I should see a window in window modal which allows me to rewatch
> the session as if I was watching it in realtime when it happened.
>
> The list should also help measure the engagement/success of the player. I should be
> able to quickly spot sessions which were completed or incomplete and also any kind
> of outliers which may make a particular session worth watching.
>
> If a player played more than one level, I should be able to watch that entire
> session play out across all of the levels (depth first) OR I should be allowed to
> watch all of the sessions which occurred within a particular level (breadth first).

Note: this is a **different, bigger system** than the existing anonymous
attempt/completion/duration telemetry already shipped (`/api/telemetry` →
`TELEMETRY` KV → `npm run analytics`, see `docs/HANDOFF.md`). This request is for
**full deterministic input-replay** — capture every real (non-bot) playsession
precisely enough to reconstruct and rewatch it frame-by-frame, plus a whole new
editor page/tab to browse and replay sessions. It would very likely reuse the
existing `TELEMETRY` KV namespace and event-batching plumbing as a foundation, but
needs a fundamentally different payload (full input traces, not aggregate counters)
and a new editor-side viewer.

## What the other session had figured out and built before it got stuck

Its own stated plan: **"This breaks into seven work packages."** Only the first
three (of seven) are confirmed done from the visible log; the rest were never
reached or never described on-screen.

1. **Explored the codebase first** (its own words): *"Before writing anything I need
   to understand the game loop, input handling, randomness usage, room/state
   transitions, editor tab structure, and the existing KV/API plumbing, since perfect
   replay hinges on determinism."* It ran an agent that read 15 files before writing
   any code — the determinism angle (see below) is clearly what shaped its plan.
2. **Work package 1 — `rng.ts`** (new file, +24/−0): a seeded RNG module. This is the
   textbook prerequisite for deterministic replay — anywhere the game currently calls
   `Math.random()` for gameplay-affecting outcomes needs to go through a seedable RNG
   instead, or a replay would diverge from the original run the instant randomness is
   involved.
3. **Work package 2 — input capture/drive layer** (`src/engine/input.ts`, +80/−2):
   extended the `Input` class to either *record* every input event (for a live
   session) or *drive* input from a pre-recorded trace (for replay playback) —
   consistent with the existing `Input` API this project already leans on for
   scripted/headless playtesting (see `CLAUDE.md`'s testing-workflow section: synthetic
   `KeyboardEvent`/`Touch` dispatch already works because input is centralized there).
4. **Work package 3 — taunt manager: sim clock + seeded RNG** (3 files, +34/−20): the
   `TauntManager` (`src/game/taunts.ts`) has its own cooldown/chance timing that
   depends on wall-clock time (`performance.now()`) and `Math.random()` for its
   `chance` field (see `content/taunts.json` — every taunt has a `chance`) — both are
   sources of nondeterminism a replay would need pinned to a simulated clock and the
   new seeded RNG from work package 1, not real time / real randomness.
5. **Work package 4 — recorder module, "the heart of the system"**: creating
   `recorder.ts` (new file) — this is where it got stuck, mid-file-creation, with a
   request that failed and kept retrying for 28+ minutes. **Nothing in this file is
   known to exist or be salvageable; treat it as not started.**
6–7. Never reached. Given the request's own shape, the remaining work packages almost
   certainly cover: the actual capture/serialization format (game-state snapshot +
   input trace, batched and uploaded similarly to the existing telemetry pipeline),
   the new editor "sessions" tab/page (filterable list with completion/outlier
   signals, per-session watch modal, depth-first vs. breadth-first multi-level
   viewing), and the playback engine that feeds a recorded trace back through the
   input-drive layer from work package 2 while rendering in real time.

## Constraints and existing patterns to respect when resuming

- **Determinism is the crux of the whole feature.** Anywhere gameplay reads
  `Math.random()`, `performance.now()`, or `Date.now()` directly needs auditing —
  the room runtime, enemy AI, particle system, and taunt manager are the likely
  offenders beyond what's already been touched. `src/game/room.ts`'s water-flow and
  fire-spread sims in particular tick on real elapsed `dt`, not a resumable simulated
  clock — check whether those need the same sim-clock treatment as taunts got.
- **"Not bot driven"** — the capture must distinguish real play from the AI-playtest
  / synthetic-input workflow this project already relies on heavily (`window.PP`
  debug handle, synthetic `KeyboardEvent`/`Touch` dispatch — see `CLAUDE.md`). Don't
  record or surface bot-driven sessions as if they were real players; the existing
  scripted-playtest workflow should keep working *unrecorded*, not break.
- **Existing telemetry plumbing to reuse, not duplicate**: `functions/api/telemetry.js`
  → `TELEMETRY` KV (90-day TTL) → `tools/analytics.mjs`. A full-replay payload is much
  larger than the current aggregate-counter one — check whether it needs its own KV
  namespace/endpoint (a new `functions/api/*.js` + KV binding in `wrangler.toml`,
  following the exact pattern the `CONTENT`/`REPORTS`/`TELEMETRY` namespaces already
  set) rather than overloading the existing lightweight one. `npm run analytics`'s
  `--clear`/`--local` flag convention is worth mirroring for a `npm run sessions`-style
  puller if the viewer ends up needing pulled-to-disk data rather than a live API.
- **Editor integration**: new tab following the existing pattern in `src/editor/`
  (see `editor.ts`'s tab list and `CLAUDE.md`'s Editor section) — a "sessions" or
  "telemetry" tab alongside rooms/items/enemies/etc. The "window in window modal" the
  request describes for rewatching a session is a new UI surface; nothing like it
  exists in the editor yet (closest precedent: the room editor's own canvas + the
  pixel editor's modal, `src/editor/pixeleditor.ts`, for how modals are built here).
- **Depth-first vs. breadth-first replay** (a player's whole multi-level session, vs.
  all sessions within one level) is a data-modeling question as much as a UI one —
  the capture format needs a stable session ID that spans room transitions (the
  existing `RunState`/`checkpoint` model already tracks a run across rooms; a
  session recording likely needs to key off something equivalent) plus a way to
  query "all sessions touching room X" for the breadth-first view.

## Suggested next step

Don't start writing code from a cold read of this doc alone — re-run the same
exploration pass (or read this repo's `CLAUDE.md` + `docs/HANDOFF.md` first, they
cover everything the other session had to discover from scratch about the game loop,
input, and content conventions), confirm the `Math.random()`/`performance.now()` audit
scope directly against current source before trusting the summary above, and pick up
at work package 4 (the recorder module) if work packages 1–3 turn out to be genuinely
unrecoverable from the original session and need rebuilding.
