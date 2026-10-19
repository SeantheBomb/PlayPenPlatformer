# PlayPen — Steam Development Plan

*Drafted 2026-10-19. Companion to `reports/PlayPen Steam go to market.md` (the GTM report).
Timeline is locked to Sean's call: Steam page live ~Feb 1 2027, Steam demo Apr 26, Next
Fest Jun 14–21 (alongside Grenade Junky), launch Mon Aug 16 2027.*

Art is out of scope (Casey + Miranda own the visual redefinition). Everything here is
engineering, content-production or tooling work that the Steam plan depends on. Items are
numbered so they can be approved or cut one at a time.

## Progress

- **2026-10-19 — Phase 0 and Phase 1 shipped** (0.1–0.4, 1.1–1.4). Deferred from 1.3:
  "solved by the other solution" reactions need per-gate solution tracking. Vertical
  crops for 1.2 go through MediaWeaver.
- **First playtime read (0.1), and the biggest finding so far.** 274 sessions, 4 full
  wins, all predating the dev/bot flag, so dev runs are mixed in. The campaign's first
  clears sum to **~18.5 min typical and ~7.5 min fast (p10)**. The longest room is
  mess_hall at ~8 min median. That is roughly a 10x gap to the 4–6 h target and far
  under the 2 h refund line. **3.1 is the critical-path content problem for an
  Aug 2027 launch**, so the length plan should be settled early rather than in Phase 3.
  Re-run `npm run analytics` once organic flagged sessions accumulate.

## Where PlayPen stood (inventory, 2026-10-19)

| Area | State | Steam gap |
|---|---|---|
| Shell | Electron 33, `electron .` from source; 67-line `main.cjs` | **No packager.** No installer/depot layout, no app icon, no single-instance lock |
| Content I/O | Electron reads/writes `app.getAppPath()/content` | **Breaks once packaged** (asar is read-only); player and editor data need `userData` |
| Content source | Browser boots bundled < published KV < local draft | A paid build that silently takes live KV publishes bypasses Valve build review |
| Progress | `RunState` lives for one run; nothing persists except recorder pid + queued reports | **No save/continue.** Achievements are evaluated per run and never stored |
| Achievements | 14 defs in `achievements.json`, triggers evaluated in `game.ts` | Not persisted, not bridged to Steam |
| Input | Keyboard + standard-mapping gamepad (polled) + touch | No glyph switching, no rebinding, no Steam Input default config |
| Menus | Main menu, quiet level select, pause (mute / quit) | **No settings menu** (volume, fullscreen, text size, controls) |
| Campaign | 11 rooms, ~40×24 → 110×24 tiles | Real playtime unknown (see 0.1); refund risk if an expert clears < 2 h |
| Telemetry / replay | Anonymous telemetry, deterministic session replay, bug reports, all working in Electron | `npm run analytics` timed out at 1,353 pending batches; no platform tag |
| Browser build | Full game free at playpen.pages.dev | No demo scope, no wishlist CTA |

## Principles

- **Data-first still applies.** Demo scope, failure taunts and settings defaults all live in
  `content/`. New code only where a rule or tile can't express it.
- **Steam calls never enter the sim.** Achievement unlocks, stats and overlay are side effects
  fired *from* sim events, suppressed in replay mode, so recorded sessions still replay exactly
  and `PP.give`/`PP.warp` tainting carries over (a tainted run never unlocks a Steam achievement).
- **One codebase, three flavors.** `browser`, `steam`, `steam-demo`, chosen at build time
  (`import.meta.env`). No forks.
- **Prove it with tests** where there's a rule: save round-trips, achievement persistence,
  demo-scope gating, content pinning.

## Phase 0 — Measure and funnel (now → Nov 30 2026)

Cheap, unblocks every later decision, no art dependency.

| # | Item | Why | Effort |
|---|---|---|---|
| 0.1 | **Fix `analytics.mjs` throughput** (parallel/batched KV reads, or a single bulk list+get) and produce per-room median + p10 clear times | We need a real number for "does an expert clear it in under 2 h?" before scoping content. The replay library can supply fast-player p10 times | S |
| 0.2 | **Platform tag on telemetry, sessions and reports** (`browser` / `electron` / `steam` / `steam-demo`) | Every funnel number after Feb has to be split by source | S |
| 0.3 | **"Wishlist on Steam" CTA** in pause menu, win screen and end-of-demo screen, with UTM-tagged store links (`shell.openExternal` in Electron; `steam://` when running under Steam) | Owned funnel. It's the #2 channel in the GTM report. Before Feb 1 it reads "Coming soon to Steam" and links Discord | S |
| 0.4 | **Demo scope as content.** `campaign.json` gains `demoRooms` + `demoEndTaunt`; the demo flavor stops after those rooms on a Warden cliffhanger card with the CTA | Same slice serves the browser demo and the Steam demo. Whether playpen.pages.dev switches to it is **Sean's call** (GTM open Q3) | S–M |

## Phase 1 — Clip and page tooling (Nov → Jan 2027, ahead of Feb 1 page)

The page needs a 30 s trailer, 8–12 screenshots and a steady supply of clips. The replay
engine makes these nearly free. This is PlayPen's unfair advantage, so build it first.

| # | Item | Why | Effort |
|---|---|---|---|
| 1.1 | **Capture mode.** A hotkey (and `PP.capture()`) renders the current frame at 1920×1080 (integer 3× of 640×360), with options to hide touch UI and debug overlays and keep Warden banners | Screenshots that obey Steam rules (in-game UI text allowed) | S |
| 1.2 | **Replay → video export.** Re-run any recorded session or segment headlessly and encode it to WebM (MediaRecorder on the canvas) at 1080p or 1080×1920 vertical crop, plus a camera-follow framing option | Trailer shots from **human-played** runs. GJ's plan found rig-captured footage caps quality at 6/10. Shorts/TikTok vertical cuts come from the same source | M |
| 1.3 | **Failure-reaction taunts.** New taunt triggers: death by element/hazard type, Nth death in the same room, a first-ever element combo, a solve by the "other" solution. Writers fill them in through the Writers Studio | Comedy lands on the player's failure, and that's what streamers clip. Store-grade lines double as screenshot captions | S code + writer time |
| 1.4 | **Chain-reaction moments.** A telemetry event when ≥3 element reactions fire within N seconds, surfaced in the editor's sessions tab as a "highlight" filter | Find clip-worthy moments in real player sessions instead of staging them | S |

## Phase 2 — Make it a Steam product (Dec 2026 → Apr 2027, demo ships Apr 26)

| # | Item | Why | Effort |
|---|---|---|---|
| 2.1 | **Packaging.** electron-builder (or Forge), Windows x64 unpacked folder build for the Steam depot (no installer), app icon, single-instance lock, `--no-sandbox` fallback flag for Proton | Without this there's no depot. Windows-only, with Deck/Linux via Proton (GTM report) | M |
| 2.2 | **userData split.** Player saves, settings and the local editor draft go to `app.getPath('userData')`. Bundled `content/` is read-only inside the package. The disk-content editor path stays as a dev-only mode | The current `CONTENT_DIR` write path fails in a packaged build | S–M |
| 2.3 | **Content pinning.** The Steam flavor boots bundled content only (the version baked at build time). Live KV content is opt-in per build via a flag, never default | A bad publish must not reach paying players, and Valve reviews builds, not KV. The live channel stays the browser build's superpower. **Sean decides** whether a "hotfix channel" opt-in exists at all (GTM open Q4) | S |
| 2.4 | **Save / continue.** Persist the `StateSnapshot` heartbeat at room transitions and checkpoints. Add a Continue button on the main menu and a room select that unlocks as rooms are reached (reusing the quiet level select). Achievements and discovered recipes persist across runs | Table stakes for a paid 4–6 h game, and a prerequisite for Steam Cloud and achievements. It must stay replay-safe: a loaded save starts a new recorded session with its snapshot as the seed state | M |
| 2.5 | **Steamworks bridge** via `steamworks.js` in the main process, exposed through preload IPC: init with the app ID, achievements (mapped 1:1 from `achievements.json` ids), Steam Cloud on the save file, overlay (`electronEnableSteamOverlay`), rich presence ("Escaping: Greenhouse"). No-ops in the browser flavor, suppressed in replay or tainted runs | Expected by Steam buyers. Cheap once 2.4 exists | M |
| 2.6 | **Settings menu.** Master/music/SFX volume, fullscreen/windowed, text/banner scale, screen-shake toggle, controls display, and keyboard rebinding. Defaults in `game.json` | Basic expectations. Text scale is also the Deck-legibility lever | M |
| 2.7 | **Controller polish.** Glyphs that switch with the active `ControlScheme` (Xbox/PlayStation/Deck), every prompt shown in the active scheme, the craft workbench fully navigable by pad, and a default Steam Input config published | Deck Verified requires correct glyphs and full controller support. Pad input is already polled, so this is mostly prompts and the craft UI | M |
| 2.8 | **Steam Deck pass.** 1280×800 (16:10) letterbox, measure the smallest glyph against 9 px at 800p (banner and HUD font most likely to fail), 30 fps sanity check, on-screen keyboard only where text entry exists (editor only), Proton test on real hardware | Cheapest credibility badge. Small 2D indies over-index on Deck players | S–M |
| 2.9 | **Editor in the Steam build.** Ship it local-only behind a menu item (no publish, no password prompt), or leave it out until a Workshop update | Tiny cost if local-only. Workshop is post-launch. **Sean decides** (GTM open Q5) | S |
| 2.10 | **Steam demo app.** Same package with the `steam-demo` flavor, `demoRooms` only, its own app ID and depot, a wishlist button opening the full game's store page via the overlay, and saves that carry into the full game | Demo live Apr 26, two weeks after GJ's | S (after 2.1–2.5) |
| 2.11 | **Ship script.** `tools/ship-steam.mjs`: build → package → steamcmd upload to the right branch, with `--no-set-live` by default (GJ's beta-branch lesson) → Discord notice | Repeatable demo and launch builds. Mirrors GJ's `ship.ps1` | S |

## Phase 3 — Earn the price (Feb → Jul 2027, content-heavy, runs alongside 2.x)

| # | Item | Why | Effort |
|---|---|---|---|
| 3.1 | **Length target from 0.1 data.** If the expert p10 clear time is under ~2.5 h, add rooms or optional depth until it isn't. Target 4–6 h median. Prefer optional NPC quests, hidden achievements and "second solution" challenges over padding the critical path | The 21% refund case (Paddle Paddle Paddle) and Sean's own "shipped too much game" Divekick lesson. Depth is optional, not padding | L (design + rooms) |
| 3.2 | **Room completion goals.** Per-room "found both solutions" and "helped the resident" checks on the room-select card, plus achievements, built on the existing `roomProgress` | Replay value and completionist hooks. A reason to revisit rooms | S–M |
| 3.3 | **Optional speedrun timer / IGT** in settings, with per-room splits | Low cost. Gives speedrunners and clips a point (the time-trial idea from GJ's plan) | S |
| 3.4 | **Demo iteration loop.** Weekly read of demo-room drop-off and session length (0.1/0.2 data). Tune the demo slice so the median session is ≥20 min before the Next Fest Press Preview build | The Next Fest ranking signal and the G4 gate | ongoing |
| 3.5 | **Soak and fault tolerance.** Long-session soak test (memory, fluid-sim perf in the largest rooms like the_long_run at 110×24 and mess_hall at 56×56), crash → report pipeline verified in the packaged build | Launch-week reviews. Electron leaks show up at hour 2, not minute 5 | S–M |

## Phase 4 — Launch hardening (Jul → Aug 16 2027)

| # | Item | Why | Effort |
|---|---|---|---|
| 4.1 | Release-candidate freeze **Jul 26**, Steam build review submitted by **Jul 30** (allow 7 business days) | Date locks ~Aug 2 | — |
| 4.2 | Day-0 patch path rehearsed: a content-only fix ships as a new pinned build through 2.11, not via KV | Keeps the 2.3 guarantee under pressure | S |
| 4.3 | Achievement and Cloud verification on a clean Steam account; Deck Verified review requested | Valve-side review takes time | S |
| 4.4 | Launch-week instrumentation: refund reasons, review velocity and per-UTM funnel, written into the same weekly sheet GJ uses | The Aug 2 GJ debrief compares straight against it | S |

## Post-launch (deliberately deferred)

Workshop for editor content bundles (the bundles already double as mods); full Simplified
Chinese localization (the store page alone is a GTM item, not dev); ghost replays of your
best run; Steam leaderboards on the speedrun timer. Each waits for launch data.

## Schedule fit

```
Oct ─ Nov ─ Dec ─ Jan ─ Feb ─ Mar ─ Apr ─ May ─ Jun ─ Jul ─ Aug
[Phase 0 ]
      [ Phase 1: capture/clips ][page live Feb 1]
            [ Phase 2: Steam product ............ ][demo Apr 26]
                        [ Phase 3: length, depth, demo loop ............ ]
                                                  [NF Jun 14][ Phase 4 ][Aug 16]
```

Critical path: **2.1 → 2.2 → 2.4 → 2.5 → 2.10** has to be done by mid-April for the
demo. Phase 3.1 is the largest unknown and depends on 0.1's playtime numbers. Phase 1 is
what the Feb 1 page needs from engineering, alongside the art.

## Decisions needed from Sean

1. Browser build after Feb 1: demo slice, labeled "classic", or stays full (affects 0.4)?
2. Live-content hotfix channel for Steam builds: never, or opt-in (2.3)?
3. Editor in the launch build: local-only, or held for Workshop (2.9)?
4. Approve the Phase 0 + Phase 1 items to start now?
