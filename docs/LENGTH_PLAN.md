# PlayPen — Content-Length Plan (STEAM_DEV_PLAN item 3.1)

*Drafted 2026-10-19. Plan only, no rooms built yet. Decisions are numbered at the bottom
so they can be approved one at a time.*

**Target:** median first playthrough 4–6 h, and a fast player stays well clear of Steam's
2 h refund line (aim ≥ 2.5 h). **Constraint:** don't pad the critical path (the Divekick
lesson). Most of the added hours should be optional depth the player chooses, sitting on
top of a critical path that grows only as far as it can while every room still teaches
something new.

---

## 1. Where we are: telemetry re-read (2026-10-19)

`npm run analytics` pulled all 1,353 batches (274 sessions, 4 full wins). **No batch
carries the dev/bot flags yet**, since the flags shipped today. Every number below
mixes in Sean's and collaborators' runs, so it is **not an organic read**. Re-run once
organic sessions build up (see decision 2).

| Room | Clears | p10 | Median | p90 | Deaths | Note |
|---|--:|--:|--:|--:|--:|---|
| orientation | 50 | 22s | 1m04s | 4m03s | 9 | 235 attempts: heavy restarts/abandons |
| storage | 30 | 21s | 1m09s | 4m54s | 12 | |
| vents | 24 | 25s | 59s | 2m52s | 1 | |
| cell_block | 20 | 21s | 1m02s | 7m56s | 8 | |
| the_gap | 20 | 20s | 44s | 3m10s | 3 | |
| greenhouse | 15 | 50s | 1m33s | 12m00s | 0 | widest p90: the side treasure |
| the_yard | 18 | 25s | 1m07s | 5m03s | 71 | |
| the_vault | 11 | 54s | 1m20s | 3m33s | 5 | |
| mess_hall | 6 | 3m00s | 8m04s | 9m47s | 88 | **6 of 73 attempts clear**: a difficulty wall |
| exit_wing | 5 | 7s | 1m05s | 3m34s | 72 | 7s p10 is a dev warp/replay artifact |
| the_long_run | 4 | 22s | 27s | 40s | 18 | |
| **Campaign** | | **7m28s** | **18m33s** | | | 4 wins, median 20m05s session clock |

How to read it:
- **Two biases pull in opposite directions.** Times are wall clock, which makes them an
  upper bound (menus and idling count). The samples are dev-heavy, which pulls them
  *down*, because people who already know the solutions clear in seconds. Dev runs are
  likely the larger effect, so real first-time times are probably **~1.5× higher**. That
  is assumption A1 below and needs verifying. Even at 2×, the campaign is ~40 min. The
  gap is real.
- **The rooms are introductions, not puzzle boxes.** Nine of 11 rooms have a median near
  1 min. Only mess_hall (56×56, four fuseboxes, 13 trapdoors) behaves like a full puzzle
  room, and part of its 8 min is frustration (88 deaths).

## 2. Where the time comes from today (inventory)

| Source | What exists | Time it adds now |
|---|---|---|
| **Rooms** | 11 rooms, 40×24 to 110×24 tiles. 10 recipes, 22 items, 2 enemies (crawler, spotter), 9 elements | ~18.5 min median, all critical path |
| **Resident quests** | 5 residents (Marla, Toby, Priya, Marcus, Deb). Real `wants` trades in **5 rooms**: cell_block (Marla), the_gap (Toby), greenhouse (Priya), the_yard (Marcus), the_vault (Deb). Soft intros in storage/vents. Pair scenes + Exit Wing send-off driven by `helpedNpcIds` | ~1–3 min each, mostly folded into the room medians |
| **Achievements** | 14 defs, 7 hidden (best_friend, teachers_pet, grounded, chef, short_circuit, librarian, spring_hoarder). Evaluated per run, not persisted | Near zero today. Nothing persists, so no player hunts them |
| **Multi-solution gates** | OPPORTUNITY_MATRIX lists ~9 gates. True ≥2-solution gates: storage shelf fire, vents goo strip, cell_block note pocket, mess_hall pool + fire, exit_wing upper/lower. Orientation, the_gap and cell_block's main gate are single-solution by design (Introduce) | Zero as replay. Nothing records *which* solution you used (deferred from 1.3) |
| **Notes / hints** | ~1 note per room ("Subject #NN" diaries), several hints. `librarian` achievement exists | Seconds. Notes aren't framed as a collection |
| **Side content** | greenhouse side treasure (the warden_plush) | Visible in greenhouse's 12 min p90 |

**Unbuilt mechanics already designed** (OPPORTUNITY_MATRIX "Known gaps" + DESIGN M2/M3).
This is the fuel for new wings, and it's what keeps new rooms from being reruns:
spark→water (electrified pools as trap *and* weapon), ice→fire quench / "brazier you
must not extinguish", burning goo as a fuse line, melting your own ice bridge (explicit),
springs under enemies, powered platforms, timed conduits, camera turrets, dark rooms +
torch vision, Lurker (punishes locker camping), Listener (hears jumps/breaks, not sight),
moving walls (the Warden's Escalation tier).

## 3. The proposed mix

### Shape: 4 wings, 31 rooms (20 new)

| Wing | Rooms | Critical-path arc (I → E → T → C) | Ends on |
|---|---|---|---|
| **A: Orientation** (existing) | orientation → mess_hall (9) | Unchanged: crafting, bucket, goo, spark, springs, enemies | mess_hall as the act-one wall |
| **B: Spark and Water** (new) | 7 | spark→water as trap + weapon (stun a wading spotter), powered platforms, timed conduits, the ice→fire quench twist, springs under enemies | a conduction-chain set piece |
| **C: Lights Out** (new) | 7 | dark rooms + torch vision, Listener (noise, not sight), burning goo fuse lines, melt-your-own-bridge made explicit | a dark chase *without* crafting (locked rule) |
| **D: Lockdown** (new) | 6 + exit_wing + the_long_run | Lurker, camera turrets, moving walls (Warden Escalation → Confrontation), then everything combined | the existing finale |

- **exit_wing + the_long_run move to the very end.** They're already the finale: the
  send-off scales with whoever you helped, and the Long Run is the Confrontation beat.
  With a longer game and more residents, the send-off pays off harder. Wing A then ends
  on mess_hall with a Warden cliffhanger ("the next facility layer" from DESIGN's
  meta-loop).
- Wing names and room names are placeholders. Writers own those.

### Anti-padding rules (the Divekick guard)

1. **Every critical-path room carries at least one I, T or C.** Pure Exercise content
   goes into optional zones, never onto the main route.
2. **Cap the critical route at ~12 min median per room.** A room that runs longer gets
   split or has its excess moved into an optional zone.
3. **No fetch or backtracking on the critical path.** Confiscation already keeps rooms
   self-contained. Keep it that way.
4. **Optional depth lives *inside* rooms** (side zones, high shelves, sealed alcoves),
   not behind side-room doors. This keeps one-way flow and needs no return-door engine
   work.
5. **Cut list:** no NG+, no hard mode, no remixed rooms, no collect-100 grind, no
   arena/wave rooms.

### Optional depth layers

| Layer | What | Systemic hook (no "X opens Y") |
|---|---|---|
| **Second solutions** | Every new room, plus the 5–6 existing multi-solution rooms (~24 of 31), has a gate that admits ≥2 element routes. The room card shows "found both" | Gates record *which effect verb* cleared them (burn vs. wash, melt vs. shatter). Needs per-gate solution tracking (engineering E1) |
| **Resident quests** | 5 existing + ~10 new in-room quests (`wants` + `roomQuest`), so about every other new room has one. Pair scenes keep using `requiresHelped`. **2 new residents** introduced in Wings B/C (decision 7) | Unchanged quest system. Rewards are recipes/items that open a second solution, not stat boosts |
| **Subject notes as a set** | 1 hidden note per room (31) in an optional zone, with a counter on the room card. The diaries already carry the iceberg lore, so this is where lore hunters get their reward | Existing note entities. Persisted via save (2.4) |
| **Achievements** | ~14 → ~40, ~half hidden: per-wing "helped everyone", "both solutions ×N", note set, element-combo firsts, no-death rooms, speed pars (with 3.3) | `achievements.json` triggers. Persisted + Steam bridge (2.4/2.5) |
| **Room challenges** | No-death and par-time marks on the room-select card (3.2/3.3) | Completionist tail. Not counted toward the median |

### Assumptions (explicit, all checkable)

- **A1.** Real first-time Wing A times ≈ 1.5× today's dev-skewed telemetry: median ~25 min,
  p10 ~11 min for the 9 Wing A rooms.
- **A2.** A new room (avg ~70×28 tiles, 2–3 chained gates) runs **median 8 min, p10 4 min**
  (p10/median 0.5, typical for first-clear puzzle rooms; today's 0.4 is dev-skewed).
  Calibrated against mess_hall's 8 min with its death spike discounted.
- **A3.** Optional time per item: second solution ~4 min, resident quest ~5 min,
  note/hidden achievement ~1.5 min per room.
- **A4.** Engagement. Median player: 50% of second solutions, 80% of quests, 50% of notes.
  Fast player: 20% / 50% / 20%.

### The math

| | Fast player (p10) | Median | Completionist |
|---|--:|--:|--:|
| Wing A critical (9 rooms) | 11 min | 25 min | 25 min |
| New critical (20 rooms) | 80 min | 160 min | 160 min |
| Finale (exit_wing + long_run) | 1 min | 3 min | 3 min |
| **Critical path** | **1h32** | **3h08** | 3h08 |
| Second solutions (24 × 4 min) | 19 min | 48 min | 96 min |
| Resident quests (15 × 5 min) | 37 min | 60 min | 75 min |
| Notes + hidden achievements (31 × 1.5) | 9 min | 23 min | 46 min |
| Room challenges | — | — | ~60 min |
| **Total** | **~2h37** | **~5h19** | **~7h45** |

**Sensitivity.** The plan is driven by A2, because the new rooms are 85% of the critical path:

| New-room median / p10 | Median total | Fast total | Verdict |
|---|--:|--:|---|
| 8 / 4 min (plan) | 5h19 | 2h37 | ✅ |
| 6 / 3 min | 4h39 | 2h17 | ✅ thin margin |
| 5 / 2.5 min | 4h19 | 2h07 | ⚠️ add ~4 rooms or deepen rooms |
| 10 / 5 min | 5h59 | 2h57 | ✅ consider cutting a room |

**So the room count floats.** After the first 3 Wing B rooms, measure them with blind
testers (gate G1 below). Below 6 min median, add rooms or deepen them. Above 10 min,
cut. A1 barely matters (Wing A is under 15% of the total).

## 4. Sizing against the timeline

40 weeks to the Jul 26 RC freeze. Room building runs alongside Phase 2 engineering
(packaging, saves, settings, Steamworks), and that's the real capacity squeeze for a
solo dev. Rooms are script-generated (`tools/genrooms.mjs`, extended to wings), so
blockout is cheap. **Blind playtesting and tuning is the bottleneck.** Budget ~1 room
per week net, including iteration (20 rooms ≈ 20–24 build weeks).

| Window | Content work | Gate |
|---|---|---|
| **Oct 20 – Nov 15** | Calibrate: Discord push on the flagged web build plus 3–5 blind testers watched via replay. Engineering E1–E3. Wing B/C/D briefs, one OPPORTUNITY_MATRIX template per room, approved by Sean | **G0** organic Wing A numbers replace A1 |
| **Nov 16 – Jan 31** | Wing B (7 rooms) + its mechanics (E4). Retrofit Wing A's optional layer (second-solution marks, note set, quests) | **G1** first 3 Wing B rooms blind-tested → lock room count. Feb 1 page footage can include Wing B |
| **Feb – Mar** | Wing C (7 rooms) + E5. Achievements to ~30 | **G2** Wing B fully art-dressed |
| **Apr 1 – Apr 26** | Demo polish takes priority (2.10, demo freeze ~Apr 12). Wing D blockout in parallel | Demo ships Apr 26 |
| **May** | Wing D (6) + E6. Finale re-sequenced, send-off scaled to new residents. First full-campaign blind runs | **G3** full-run median ≥ 4 h, fast ≥ 2 h 15 |
| **Jun** | Next Fest Jun 14–21: demo support only. Closed full-game beta on Discord for organic length data | |
| **Jul 1 – 26** | Tune from telemetry (death walls, drop-offs), achievement pass to ~40, RC freeze Jul 26 | **G4** organic p10 ≥ 2 h 15 |

Slack: ~6 weeks of float if rooms run at 1/week. If Phase 2 slips into May, Wing D is
the first thing to compress (6 → 4 rooms; the finale already exists).

### Engineering this plan needs (code; feeds STEAM_DEV_PLAN 3.x)

| # | Item | Effort |
|---|---|---|
| E1 | **Per-gate solution tracking.** Rooms tag gate regions; the effect verb that cleared one is recorded into `roomProgress`. Also unblocks the deferred 1.3 "solved by the other solution" taunts | S–M |
| E2 | **Room card completion** (both solutions / resident helped / note found / no-death), persisted via 2.4. This is 3.2 pulled forward | S–M |
| E3 | **genrooms v2.** Wing-aware generator, room template from the matrix, solvability notes in output | S |
| E4 | Wing B verbs: powered platform entity (gate-like, fusebox-wired), timed conduit, springs launching enemies. Each as entity/behavior data first | M |
| E5 | Wing C verbs: darkness + light radius (view-only, replay-safe), Listener noise events (`heardNoise` behavior fn) | M |
| E6 | Wing D verbs: Lurker behavior (locker dwell time), camera turret (sight tag reuse), moving walls | M |

### What Casey and Miranda supply

Rooms are built from the shared kit (tiles, items, entities are art'd once and reused
everywhere), so **a new room costs little unique art**. The cost comes per wing and per
new mechanic.

| Per… | Art ask | Due |
|---|---|---|
| **New room** | 1–3 room-identity props (parallax props or decor tiles) so rooms read as different places. Room-select thumbnails come free from `captureFrame` | ~3 weeks after that room's blockout locks |
| **New wing** (×3) | 1 parallax set (far/mid/near strips + ~4 props). *Optional:* a wing tile variant (~6 tiles: wall, platform, grate, cracked, door, checkpoint) (decision 10) | Wing B by Mar 1, C by Apr 30, D by Jun 30 |
| **New mechanic** | Tile/entity art incl. second-look states. B: powered platform on/off, conduit live/dead, electrified-water overlay. C: dark-room vignette/light falloff (mostly code), burning-goo fuse. D: camera turret idle/alert, moving-wall segment | Before that wing's art pass |
| **New enemy** (Listener, Lurker) | Body with idle / move / alert / stunned frames | Listener by Mar 15, Lurker by May 15 |
| **New resident** (×2) | 12×16 body (animated) + 32×32 dialog portrait | First by Jan 15, second by Mar 15 |
| **Demo (Apr 26)** | Wing A (or whatever decision 9 picks) fully dressed | Apr 5 |

The writers also need, per new room: a `room_enter` line plus 3–5 taunts, 1 Subject note,
and quest dialog where a resident lives. That's Writers Studio work and needs no engineering.

## 5. Decisions for Sean

1. **Length framing:** critical path ~3 h median; optional depth brings the median to
   ~5 h; fast players land ~2.5 h on critical path + light optional. (Alternative: push
   the critical path alone past 2 h for fast players. That needs ~27–35 new rooms, which is
   the padding we're avoiding.)
2. **Calibrate before committing:** push the flagged web build on Discord + 3–5 blind
   testers by Nov 15 (G0), and lock the final room count at G1 (±4 rooms).
3. **20 new rooms in 3 wings (7 / 7 / 6)**, with exit_wing + the_long_run moved to the
   end as the finale. Wing A ends on mess_hall with a Warden cliffhanger.
4. **Wing mechanic arcs:** B = spark & water, C = lights out / sound, D = lockdown (as in §3).
5. **Optional depth lives inside rooms** (side zones), not behind side-room doors.
   One-way flow stays.
6. **Pull E1 + E2 (gate solution tracking, room completion card) forward to November.**
   The second-solution layer and many achievements depend on them.
7. **Two new residents** (Wings B and C) and ~10 new in-room quests. Or: zero new
   residents and deepen the existing five across the new wings.
8. **Subject notes become a 31-piece hidden set**, and achievements grow to ~40 (~half hidden).
9. **Widen the demo** from 4 rooms (~5 min) to orientation → greenhouse (6 rooms + their
   optional layer, ~20–25 min) to meet 3.4's ≥20 min median session. Leave mess_hall out
   while it's a death wall.
10. **Art asks as tabled in §4.** Per-wing tile variants: yes or no?
11. **Cut list** (no NG+, hard mode, remix rooms, grind collectibles, arena rooms): approve.

**Adjacent, not in scope:** mess_hall clears 6 of 73 attempts with 88 deaths, and
exit_wing has 72 deaths across 5 clears. Even dev-skewed, that's a difficulty wall worth
a replay review before the demo, separate from this plan.
