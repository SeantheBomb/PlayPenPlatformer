# Building a Story Editor — a game-agnostic handoff

For Lorne, who wants to build a tool like PlayPen's Writers Studio and Master
Script for his own game. Nothing here depends on PlayPen's engine, language or
host. PlayPen is the worked example throughout; the ideas are meant to carry
over to Unity, Godot, a web game or anything else.

It covers three things, in order:

1. **The editor ecosystem** — the design rules behind the whole PlayPen editor,
   which the story tool inherits. Most of what makes the writing tool pleasant
   is decided at this level, not in the writing tool itself.
2. **Where the script editor fits** — precisely what the Master Script is, what
   it reads, what it writes, and why it can survive the game changing under it.
3. **The writer's UI/UX** — how the pages are built to keep a writer in flow,
   with the reasoning behind each choice and the mistakes we made on the way.

Part 4 is a build order if you're starting from nothing. The appendix has the
exact data shapes.

---

## Part 1 — The editor ecosystem

### 1.1 The game is data; the editor edits data

Every gameplay value, every room, every line of dialog lives in plain content
files (PlayPen uses JSON: `rooms/*.json`, `taunts.json`, `items.json`, …). Code
implements *verbs* — what a door does, how a quest resolves — and the content
decides *which* doors, *which* quests, *what's said*. Nothing a designer or
writer might want to change is hardcoded.

This is the precondition for everything else. A writing tool can only be as
good as the separation between words and code: if a line lives in a script
file or a scene node, the tool has to parse code to find it. If it lives in a
data file with a stable address, the tool is just a nice form over a document.

> **Carry-over rule:** before building any tool, make sure every line the
> writer owns has a home in data, and that the game reads it from there at
> runtime. Dialog strings embedded in scenes, prefabs or code are the first
> thing to move.

### 1.2 One source of truth, layered drafts

Content has exactly one authoritative copy: the **published** bundle that
players load (PlayPen keeps it in a key-value store behind a small API). Around
it there are layers, each overriding the one below:

```
bundled defaults (shipped with the build)
  < published bundle (what players have right now)
    < local draft (this person's unpublished edits, in their browser)
```

A collaborator's work is a *draft* until they publish. They can play the game
with their draft applied, so "try it before anyone sees it" is free. Every
publish is versioned, so anything can be restored.

Two consequences shaped the tools:

- **Developers pull before they work.** Anyone changing content or schema
  first pulls the live bundle into the repo, so they're working against what
  players have — not a stale copy that would silently undo someone's edits.
- **Old saves must not crash new code.** When a schema gains a field, older
  drafts and published bundles don't have it. Loading deep-merges every file
  over the current defaults (by nested key for objects, by `id` for lists), so
  a missing field gets its default instead of crashing the renderer. A
  *deliberately* removed value (an artist reverting to no art) is the
  exception and is kept absent on purpose.

### 1.3 Several tools over the same data, each scoped to a role

PlayPen has one full editor (for Sean: every field of every file, generated
from schemas) and two **studios** for collaborators — an Art Studio and a
Writers Studio. The studios are not cut-down editors; they're different
front-ends over the same files, organised around how that person thinks:

| Surface | Organised around | Can change |
|---|---|---|
| Developer editor | the data model (files, schemas) | everything |
| Art Studio | assets and how they look in place | art fields only |
| Writers Studio | characters, the Warden, the story | words + quest structure only |

Each studio has its own password and **its own publish scope, enforced on the
server**. A writer's publish doesn't send "a file"; the server takes the live
bundle and copies across *only the fields writers own* (dialog slots, quest
wants/rewards, gating, taunt lines, descriptions). A writer's publish
therefore cannot move a platform or delete an item even by accident, and it
can't clobber an art change made five minutes earlier.

Why enforce it on the server rather than just hiding fields in the UI? Because
the UI isn't the only way data gets sent — an old open tab, a stale draft or a
bug can send a whole file. Scope-by-construction means "it can't" rather than
"it shouldn't".

> **Carry-over rule:** decide field by field who owns what, write it down as
> a list in code, and enforce it at the one place every publish passes
> through. Then build each role's UI freely, because the safety isn't in the UI.

### 1.4 Concurrent work merges like git, and conflicts are asked, not guessed

Sean, an artist and a writer all publish to the same bundle. Every draft
remembers the version it was based on. On publish, the server does a 3-way
merge (base / live / incoming) down to individual fields: two people editing
different lines of the same character both survive. If *both* changed the
*same* value differently, that's a conflict, and the publisher sees the two
versions side by side and picks — nothing is silently overwritten.

Open studios also poll for newer publishes and fold them into the draft when
the person isn't mid-gesture (not typing, nothing focused, no dialog open).
Local work always wins locally; real collisions are left for the publish step
to ask about.

For a writing tool this means a writer never has to coordinate "are you in the
file right now?" with anyone.

### 1.5 Previews use the real renderer

Every preview in every studio — the dialog box, the villain's banner, a room
backdrop, a storyboard frame — is drawn by **the same function the game uses**,
not a lookalike. When the game's dialog box changes font or wrap width, every
preview changes with it, and "does it fit?" is answered on the page.

This costs a little up front (the render code has to be callable outside the
game loop) and pays back forever: no preview ever lies.

### 1.6 Guidance is soft; the game is one click away

- **Lint, don't lock.** The studios flag problems — a forbidden word, a line
  too long for its box, an empty required slot, a quest asking for an item the
  room never supplies — but never block a save or publish. A writer may mean
  it; the flag just makes sure they meant it.
- **Every page can hand off to the game.** "Play this room" closes the studio,
  warps to that room with the draft applied, and a button brings you back. The
  edit→play→edit loop is measured in seconds.

### 1.7 Rules live in tests, not in memory

Every design rule that matters is pinned by an automated test: which fields a
writer publish can touch, how merges resolve, how the script lays out a quest,
that a removed taunt never fires. When someone (often an AI assistant) changes
code months later, the test says "this was deliberate" before a player finds
out. The story model in Part 2 is pure data-in/data-out precisely so it can be
tested without a browser.

---

## Part 2 — Where the script editor fits

### 2.1 The Writers Studio pages, and what the Master Script adds

The Writers Studio started with pages organised **by subject**:

- **Cast** — one page per character, every room they appear in, in play order,
  with their dialog slots and quest.
- **Warden** — every villain line, grouped by level or by trigger, with search.
- **Notes / Hints / Items** — the in-world text.

Those pages are good for editing one voice. Lorne's feedback was that he
wanted to write the way you write a film: **by sequence**, top to bottom, the
whole campaign in order. That's the **Master Script** — a page that lays every
scripted beat out as a screenplay, scene by scene in campaign order.

The crucial design decision:

> **The Master Script is a projection, not a document.** It owns no dialog.
> Every line on it is a view of the same field the Cast, Warden and Notes pages
> edit. Type in the script, and the character page shows the change; edit the
> character page, and the script shows it.

There is no "export the script back into the game" step, no second copy of
any line, and therefore nothing to fall out of sync.

### 2.2 The pipeline

```
content files (rooms, taunts, items, campaign order)
        │
        ▼
 buildScript(content, lens)      ← pure function, no UI, unit-tested
        │   returns: scenes → beats, story threads, every line's key
        ▼
 script view (DOM)               ← draws beats; storyboard frames via the
        │                          game's real room renderer
        │  on edit: writeTarget(content, beat.target, text)
        ▼
 the SAME content fields the other pages edit
        │
        ▼
 save to draft → (later) scoped writer publish → merged onto live
```

The model and the page are separate files. The model is where all the
knowledge lives (what beats exist, in what order, under what conditions); the
page only draws it. That split is what let us test "the welcome line always
lands in whichever level is first" without opening a browser.

### 2.3 Beats: generated vs. authored

A scene is a list of **beats**. Each is one of:

| Beat | What it is | Who writes it |
|---|---|---|
| `dir` | stage direction — "#67 enters The Bunk Room.", "#67 finds a note." | **generated** from game data |
| `cond` | condition — "If #67 comes back with 1 glow mushroom —" | **generated** from quest data |
| `line` | a character line, a note's text | **the writer** |
| `warden` | a villain banner line (or a random pool of them) | **the writer** |
| `stub` | a short generated aside — "If #67 keeps it → no recipe…" | generated |
| `skip` | "not on this run" placeholder when reading one branch | generated |
| `alt` | two versions of one moment side by side (IF HELPED / IF NOT) | contains line beats |

Generated text is never editable, and it's always true: if Sean changes what
a quest asks for, the condition line rewrites itself. The writer's eye can
trust everything in capitals because nobody typed it.

**The model must mirror the game's real rules**, or the script lies. Two
examples from PlayPen:

- A character with no quest in a room can never be "helped" there, so their
  "after you helped me" line can never play. The script shows that line as
  flagged dead text, not as a beat — the game's `talkToNpc` logic is
  reproduced in the model and pinned by a test.
- The villain's welcome fires before the first room's entry line, so the
  script puts it first. That order came from fixing a real bug in the game,
  and the model follows the game, not the other way round.

> **Carry-over rule:** write the script model next to the runtime logic it
> mirrors, and test both against the same cases. Whenever the runtime's rules
> change, the model's tests should fail.

### 2.4 Stable event keys — why reordering can't scramble work

Every editable beat carries a **key that names the game event**, never a
position in the script:

```
npc:<roomId>:<npcId>:<slot>        e.g. npc:cell_block:marla:dialogAsk
npc:<roomId>:<npcId>#<n>:<slot>    when one room holds the same character twice
note:<roomId>@<x>,<y>              a note entity, by its position
taunt:<tauntId>                    a villain line (pool), by id
```

Scene numbers, line numbers and page order are computed fresh every time the
page draws. Move a level, and its scene renumbers; the keys don't change, so
nothing attached to them moves. Characters are keyed by a **stable identity**
(`npcId`), not by their position in a room, so Sean can drag Marla across the
room without detaching her lines.

The one weak spot is anything without a stable id. Notes are keyed by position
because they have no id; move one and its key changes. If you're designing
your data from scratch, **give every speaking thing a stable id** — it's the
single biggest thing that makes a tool like this robust.

### 2.5 Branching

PlayPen's story branches on one mechanism: helping a character adds their id
to a run-wide set, and any entity can require (`requiresHelped`) or exclude
(`hiddenIfHelped`) ids. Pair scenes and the ending send-off use it. The script
shows branches four ways:

1. **Branch blocks.** A group of beats that only exists on some runs is shaded,
   with a header naming what it needs ("Only on runs where #67 helped Marla
   and Toby").
2. **Alternates.** When a single character's appearance depends on being
   helped, the script shows *IF HELPED* and *IF NOT* side by side. If the game
   has no "not helped" version, that side says so — which turns a gap in the
   design into something visible.
3. **Story threads.** Each helpable character gets a coloured line down the
   margin, from the beat where #67 helps them to every beat that depends on it.
   A **red dot** means a payoff now comes *before* its setup (Sean moved a
   level) and can never play. Threads are how a writer sees setup and payoff at
   a glance without reading conditions.
4. **The lens — "Read the run where…".** By default the page shows every
   branch. Pick "Helped no one", or untick individual characters, and the
   script becomes one specific playthrough: beats that don't happen collapse
   to a dashed "not on this run" line, line counts update, and storyboard
   frames drop anyone who isn't there.

All four come from the same model function called with a different lens
(`null` = every branch, or a set of helped ids). The lens is the model's
input, not a filter bolted on afterwards.

If your game's branching is richer (dialog trees, flags with values,
reputation), the same shape works: define a "run state" type, make it the
model's input, generate conditions from it, and draw threads from where a flag
is set to where it's read.

### 2.6 Surviving change

Lorne's bonus ask was that the script adapt when the campaign changes without
throwing his work out. Three mechanisms:

- **Keys, not positions** (2.4) — the main one. Reorders and moves are free.
- **"Since you last looked."** The page stores, per viewer, a small signature
  of the campaign (room order, where each character is first met). On open, it
  diffs: which scenes moved, which levels were added or removed, who is now
  met somewhere new. A banner lists it, scenes show "was scene 4", and lines
  that may now read wrong are flagged — a line naming a room that's moved to
  the other side of it ("find me in the Bunk Room" when the Bunk Room now comes
  first), or a character's first line in a room that's no longer where you
  meet them. "Got it" stores the new signature.
- **The line ledger.** Every line written in the Master Script is also recorded
  in a writer-owned file, by key. It's never read while the key still exists —
  the real field is the truth. When a key disappears (Sean deleted the
  character from that room), its last text appears in **"Lines without a
  place"**, where the writer can give it to another moment or discard it.
  Nothing a writer wrote vanishes because of someone else's edit.

### 2.7 The writer's own file

Notes, reminders and the ledger live in one file (`script.json`) that the game
never reads. It's **wholly writer-owned** in the publish scope (a writer
publish takes it as sent), and it merges per key, so Sean's notes and Lorne's
notes made at the same time both survive.

```jsonc
{
  "notes":     { "cell_block": "…", "npc:marla": "…", "warden": "…" },
  "reminders": { "npc:marla": "open", "cell_block": "done" },
  "lines":     { "npc:vents:deb:dialogAsk": { "text": "…", "label": "…", "roomId": "vents", "npcId": "deb" } }
}
```

A scene's note is keyed by the bare room id, so the note on the outline and
the note at the top of that scene are literally the same entry.

### 2.8 Storyboard frames

Each scene opens on a wide shot of the real level; each meeting, note and
recipe gets a 16:9 close-up. They're drawn by constructing the game's own
room runtime for that room — with the lens's run state, so gated characters
appear or vanish correctly — and rendering it into a small canvas. They're
lazy (drawn when scrolled near) and cached per room and run state.

Because they come from the level data, a frame is always the room as it is
now. When Sean moves a character, the frame follows.

---

## Part 3 — The writer's UI/UX

### 3.1 Principles

1. **Meet the writer's mental model, not the data model.** The data is "a list
   of entities per room with four dialog fields each". Lorne thinks in scenes,
   cues and parentheticals. The page is a screenplay: Courier on cream paper,
   character cues centred, parentheticals indented, dialogue in a column. The
   villain's face is the parenthetical — `(smug)` — and clicking it cycles his
   expression.
2. **Make generated and authored text look different.** Capitals and grey are
   what the game does; the typewriter column is what you write. The slot label
   (FIRST TALK / HAS IT / JUST DONE / AFTER / NOTE / ENTERING / SHARED) sits in
   the left gutter, where a screenplay keeps scene numbers, so it's there when
   you need it and invisible when you don't.
3. **Typing never re-renders the page.** Edits write straight to the data and
   update the preview in place. A full redraw only happens for structural
   changes (adding a line to a pool, switching the lens). Losing focus or
   scroll position mid-sentence is the fastest way to break flow.
4. **Context appears where your eyes already are.** Focus a line and an
   inspector opens directly beneath it: where it plays in the game, its exact
   data address, its lint flags, a **live preview in the real dialog box or
   banner**, and "Play this scene in the game". Move to another line and it
   moves with you. No side panels to glance at.
5. **Flags, never locks.** Iceberg words (terms the fiction never says), lines
   that won't fit the banner, subject numbers out of range, continuity flags,
   dead text — all shown as small coloured chips. None of them stop a save.
6. **One page, linear, with an outline.** The whole campaign is one scroll.
   The left column is a sticky outline: every scene with line counts and empty
   counts, then the cast with their story threads, each item one click from
   its place in the script.
7. **Nothing is ever lost.** Edits save as you type to a draft. Lines whose
   moment disappears wait in a tray. Removed villain lines are tombstoned and
   restorable. Every publish is versioned.
8. **Your own margin.** Any outline item (a scene, a character, the villain)
   takes a sticky note via ✎. Tick "Reminder" and it becomes a to-do that
   collects at the top of the outline until it's done.

### 3.2 Page anatomy

```
┌──────────────────────────── header: Cast · Warden · Notes · … · Master Script · Try in game · Publish ┐
│ [banner: "The campaign changed since you last looked…"]                                               │
│ [tray: Lines without a place]                                                                         │
├───────────────┬───────────────────────────────────────────────────────────────────────────────────────┤
│ REMINDERS     │  SCENE 4 — THE BUNK ROOM            was scene 2 · 11 lines · + note · ▶ Play           │
│ THE SCRIPT    │  ┌───────────────────── wide shot of the real level ─────────────────────┐            │
│  1 First Day ✎│  └───────────────────────────────────────────────────────────────────────┘            │
│  2 Lost & …  ✎│  [writer's note]                                                                      │
│ READ THE RUN  │ ║        #67 ENTERS THE BUNK ROOM.                                                      │
│  WHERE…       │ ║ ENTERING        THE WARDEN (bored)                                                    │
│ CAST &        │ ║                   The Bunk Room! Everyone is assigned a bunk…                         │
│  THREADS     ✎│ ║  [frame] #67 MEETS XxMARLAxX.                                                         │
│ STORYBOARD    │ ║ FIRST TALK      XxMARLAxX                                                             │
│  on / off     │ ║                   You made it! …                     ← focused line                   │
│               │ ║   ┌ WHERE THIS PLAYS · data address · flags │ HOW IT LOOKS (real dialog box) ┐       │
│               │ ║   └──────────────────────────────────────────────────────────────────────────┘       │
│               │ ║ ← story threads in the margin                                                        │
└───────────────┴───────────────────────────────────────────────────────────────────────────────────────┘
```

On a phone the outline drops above the script, the gutter label moves above
each line, and the dialogue column goes full width.

### 3.3 The three workflows it's built for

**A writing session.** Open the script, jump to a scene from the outline, read
down. Click a line, rewrite it, watch the real dialog box fill in beneath it.
Change the villain's face by clicking his parenthetical. Leave yourself a note
on the scene. Hit "Play this scene" to hear it in context, come back with one
click, publish when happy.

**After the campaign changes.** The banner lists what moved. Scenes carry
"was scene N" tags. Lines that may now read wrong carry flags. A red dot on a
thread means a payoff now precedes its setup. Anything orphaned waits in the
tray. Work through the flags, tick "Got it".

**A branch audit.** Flip the lens to "Helped no one" and read the shortest
playthrough top to bottom — does it still hold together with every optional
scene collapsed? Then "Helped everyone". Then untick one character at a time.
The empty IF NOT sides are your list of moments with nothing for the player
who didn't help.

### 3.4 Lessons we learned the hard way

These are implementation details, but each one broke the experience once:

- **Previews must paint immediately.** The villain banner types out with a
  typewriter effect driven by animation frames. Browsers don't run animation
  frames in background or throttled tabs, so the preview showed an empty box.
  Paint the finished line synchronously first; animate only if frames arrive.
- **Auto-sizing text areas needs real layout.** Measuring a text area before
  it's on the page, or on an animation frame that never fires, gives zero or
  nonsense heights (we saw one at 1,610px). Fit all text areas in one pass after
  the page attaches, and again when the column width changes.
- **Don't uppercase names.** Screenplay caps turned `XxMARLAxX` into
  `XXMARLAXX`. Character names are identity; uppercase everything around them.
- **Shared lines appear in many places.** The between-rooms confiscation pool
  shows in every scene. Collapse it by default, and when one copy is edited,
  update every other copy on the page in place.
- **Search boxes must keep focus.** On a long filtered list, filter by toggling
  visibility rather than rebuilding, or every keystroke drops the cursor.
- **Deleting needs a tombstone.** In a merge-based system "absent" means "keep
  what's there". To delete a line, mark it removed rather than removing it, and
  offer restore.
- **Frames get expensive.** Dozens of real-renderer frames at once is slow;
  draw them lazily as they scroll near, and cache per room and run state.

---

## Part 4 — Building your own: a sane order

1. **Get the words into data** (1.1). Give every speaker a stable id (2.4).
   This is most of the work and none of it is UI.
2. **Make the game's text renderers callable standalone** — a function that
   draws your dialog box onto any canvas or texture, given a line and a
   portrait. This is your preview, for free, forever.
3. **Build one page by character** with a text field per line and the real
   preview beside it. Ship it to your writer. You'll learn more from a week of
   them using it than from any design.
4. **Write the script model as a pure function**: content + run state → scenes
   → beats, each editable beat carrying its event key and a pointer to the field
   it edits. Unit-test it against your runtime's rules before drawing anything.
5. **Draw the screenplay page** from the model, with edits writing back through
   the same field pointers.
6. **Add the inspector** under the focused line (where it plays, the data
   address, flags, live preview, play-in-game).
7. **Add branching**: the lens as a model input, then blocks, alternates and
   threads.
8. **Add change awareness**: the per-viewer signature diff and the ledger tray.
9. **Add storyboard frames** once your room renderer can draw offscreen.
10. **Only then** worry about multi-user merging and scoped publishing — unless
    several people are writing to the same files from day one, in which case
    do the field-ownership list (1.3) immediately and the merge (1.4) next.

### Engine notes

- **Web game:** this is the PlayPen setup — the studio is a page on the same
  site as the game, sharing its renderer code, and "play this room" just closes
  the overlay.
- **Unity / Godot:** the same model fits an editor window or an in-game debug
  overlay. Keep the model in plain classes with no engine types so it's
  testable. Render previews to a texture with the game's own UI prefab/scene.
  For a writer who shouldn't install the engine, a small standalone build
  (or a web build) that loads your content files works the same way.
- **Version control as the store:** if you don't want a server, the "published
  bundle" can be a git branch and the "draft" a working copy — but then do the
  field-ownership check in a pre-merge hook, because the UI isn't a boundary.

### What to skip at first

Storyboard frames, live sync and conflict UI are the most expensive pieces and
the least necessary for one writer. The screenplay page, the inspector with a
real preview, stable keys and soft lint deliver most of the value.

---

## Appendix

### A. Event key grammar

| Key | Addresses | Notes |
|---|---|---|
| `npc:<roomId>:<npcId>:<slot>` | one dialog slot of one character in one room | slot ∈ ask / confirm / done / after |
| `npc:<roomId>:<npcId>#<n>:<slot>` | the n-th copy of that character in that room | only when a room has two |
| `note:<roomId>@<x>,<y>` | a found note's text | position-keyed; moves detach it |
| `taunt:<tauntId>` | a villain line pool | individual lines are `#<index>` in the UI only |

### B. Beat shape (simplified)

```ts
interface Beat {
  kind: "dir" | "cond" | "line" | "warden" | "skip" | "stub" | "alt";
  text?: string;                 // generated beats
  key?: string;                  // editable beats: the event key
  target?:                       // where the text actually lives
    | { kind: "npc"; roomId: string; entityIndex: number; slot: string }
    | { kind: "note"; roomId: string; entityIndex: number }
    | { kind: "taunt"; tauntId: string };
  gutter?: string;               // FIRST TALK, HAS IT, ENTERING, …
  cue?: string; paren?: string;  // screenplay cue + parenthetical
  where?: string;                // plain-English "where this plays"
  frame?: FrameSpec;             // storyboard frame to draw beside a direction
  branch?: string; branchHead?: string;
  flags?: { level: "warn" | "bad"; text: string }[];
  columns?: { label: string; beats: Beat[]; empty?: string }[]; // alt only
}
```

### C. Model contract

```ts
buildScript(content, lens: Set<helpedId> | null) → {
  scenes:  { roomId, name, num, beats, cast, inDemo }[],
  ending:  Beat[],
  threads: { npcId, name, color, startKey, startRoom, deps: { key, roomId, early }[] }[],
  lineKeys: Set<string>,             // every editable key, every branch — for orphan detection
  firstMeet: Record<npcId, roomId>,  // for "now met somewhere new"
}
readTarget(content, target) / writeTarget(content, target, text)
signatureOf(model) / diffSignature(prev, now) / continuityFlags(content, text, roomId, prev)
```

### D. Where to look in PlayPen

| Concern | File |
|---|---|
| Script model (pure) | `src/studio/script.ts` |
| Script page | `src/studio/scriptview.ts` |
| Storyboard frames | `src/studio/storyboard.ts` |
| Line field + real previews | `src/studio/linepreview.ts` |
| Soft voice lint | `src/studio/voice.ts` |
| Character / Warden / notes pages | `src/studio/characters.ts`, `warden.ts`, `lore.ts` |
| Shared studio shell (login, publish, CSS) | `src/studio/shell.ts` |
| Merge, conflicts, live sync | `functions/api/_merge.js`, `src/studio/collab.ts` |
| Writer publish scope | `functions/api/_writerscope.js` |
| Tests that pin all of the above | `tests/master-script.test.ts`, `tests/writer-publish.test.ts`, `tests/content-merge.test.ts` |
