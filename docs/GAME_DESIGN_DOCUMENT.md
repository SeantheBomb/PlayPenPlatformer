# PlayPen — Game Design Document

*A comedic-menace escape platformer.*

---

## 1. High-Concept

You are Subject #67, a new arrival at PlayPen — a facility run by a chatty,
condescending overseer called **the Warden**. You scavenge components,
discover crafting combinations, outwit patrolling creatures, help fellow
prisoners with their own small problems, and break your way out room by room.
The Warden narrates the whole thing, and he is always, always watching.

PlayPen plays like a 2D physics platformer built around one idea: **the world
is made of elements, and elements react to each other the way you'd expect
them to.** Fire burns wood. Water douses fire. Water conducts electricity.
Electricity melts nothing, but it will absolutely make you regret standing on
a metal floor. There is no separate "puzzle mechanic" bolted onto the
platforming — the elements themselves *are* the puzzle design language, and
every gate in the game is solvable by combining them in a way you can predict
if you understand the rules.

---

## 2. Design Goals

**1. Every gate has more than one key.**
No object-specific locks ("this door needs the red keycard"). Gates resolve
through element interactions, and wherever possible admit two or more
solutions. A locked room should never make a player feel like they found *the*
answer — it should make them feel like they found *an* answer, and that a
different tool would've worked too. This is a standing, explicit design rule
for the project (not a suggestion): tools are element carriers, never
player-stat power-ups, and no gate is authored around one specific item's
name.

**2. Discovery is the reward, and it never punishes curiosity.**
Recipes can be *found* (a note, an NPC) or *discovered* by just trying things.
Combine two materials you're merely curious about, and the worst outcome is a
quip from the Warden — never lost progress, never a wasted resource you can't
get back. The itch to ask "what if I mix these?" is treated as core gameplay,
not an easter egg.

**3. The Warden is a first-class mechanic, not flavor text.**
Every notable player action can be commented on. He is bureaucratic, petty,
weirdly proud of the facility, sentimental about strange things (there is a
sock puppet he adores for no stated reason), and never sincerely helpful. He
lies about small things and is honest about the big ones — the reverse of
what a helpful NPC would do. He addresses the player only as "Subject #67," or
just "#67," never anything warmer. The tone is comedic menace, Portal-school:
the player should grin, not shrink. He is never gross or cruel to the point of
real discomfort.

**4. Every enemy teaches counterplay you can craft for.**
No enemy is a pure damage-check. Each one reacts to the elemental system the
same way tiles do — hide from it, stun it, trap it, douse it — and that
counterplay is always something the player can build with tools already
available at or before the encounter. Fights are puzzles wearing a threat's
clothing.

**5. Data over code.**
If a designer can't change something in the built-in level/content editor,
that's treated as a bug in the architecture, not a feature of the engine.
Every tunable — physics numbers, tile behavior, item stats, enemy reactions,
room layouts — lives in serialized content data, not hardcoded logic. This
keeps iteration fast and keeps the door open for the game to eventually be its
own modding platform.

**6. Juice is free.**
Squash and stretch, particles, screen shake, hit-stop — game-feel polish is
never the thing cut for scope. It's treated as the cheapest quality lever the
project owns, and it gets applied everywhere, not rationed for "important"
moments only.

**7. No softlocks, ever.**
Every gate's solution materials exist at or before that gate. Dying drops your
carried materials as a recoverable pickup near where you fell — you can
always walk back and get them. Progression is one-way per wing (once you're
through a door, you don't need to backtrack past it), which keeps pacing
tight without ever trapping a player in an unsolvable state.

---

## 3. Target Audience

**Primary: players who like Portal, Little Alchemy, and escape rooms, and who
are drawn to games with a strong authorial "voice."**
Someone who enjoyed being talked at (and down to) by GLaDOS, who has lost
actual hours to combining random things in Little Alchemy just to see what
happens, and who likes an escape-room's feeling of "I have everything I need
in this room already, I just haven't seen it yet." PlayPen is built for
someone who reads *item descriptions* for the jokes, not just the stats.

**Secondary: platformer players who want mechanical depth without punishing
execution.**
The movement is deliberately forgiving (coyote time, jump buffering, variable
jump height) — the challenge is meant to live in "what do I combine and where
do I use it," not in frame-perfect inputs. Someone who bounces off Celeste's
difficulty curve but loves Terraria's crafting-gates-progression loop is
squarely in the target.

**Age/tone range:** comedic-menace, not horror. The prison-as-daycare
vocabulary ("snack privileges," "nap time" applied to what is very much a
detention facility) is written to read as funny-uncomfortable rather than
actually disturbing — appropriate for roughly the same audience as Poppy
Playtime or Doors: teens and up who like a *spooky* framing more than a
*scary* one, and adults who enjoy that same tone played completely straight.

**What this game is explicitly not for:** players looking for twitch-reflex
challenge, graphic horror, or a story that resolves its mysteries on the
surface. The lore under the surface (see below) is deliberately never
explained in-game — if "the game should tell me everything eventually"
is a hard requirement for you, PlayPen's iceberg structure will read as
withholding rather than intriguing.

---

## 4. Inspirations

PlayPen doesn't have one single reference — it's a specific blend, and each
source contributes one ingredient rather than a whole flavor:

| Source | What we take |
| --- | --- |
| **Portal** | Test-subject framing; an antagonist whose *voice* is the personality of the game; escalation from passive-aggressive to hostile |
| **Little Alchemy** | Combine-any-two discovery crafting; zero punishment for experimenting; the "what if I mix these?" itch |
| **Minecraft / Terraria** | Tool-tier gating: gather → craft tool → tool unlocks new area/material |
| **Doors (Roblox)** | Entities with learnable counterplay; hiding spots; room-by-room dread pacing |
| **Poppy Playtime** | Signature tools that serve both puzzles and escapes; chases as puzzles at speed |
| **SAW / Escape rooms** | Authored rooms as puzzle boxes; locks-and-keys layered gating |
| **Tears of the Kingdom** | Player creativity with found parts; the world rewards weird ideas over "the intended" idea |
| **The Amazing Digital Circus** | Comedy inside a prison; the horror is funny and the funny is horrifying |
| **Pokémon (loose)** | NPCs who give you small tasks and reward you for helping, no combat required |

The throughline across all of them: **an antagonist with real personality,
systems that reward creative combination over memorized solutions, and comedy
that sits directly on top of something a little bit wrong.**

---

## 5. World-Building & Story

PlayPen's story is written as an **iceberg**: the game only ever shows you the
tip. Everything below is true, consistent, and *never stated outright* —
players who want to dig will find hints (notes signed by prior "subjects,"
the Warden's occasional slip), but the surface story stands on its own for
anyone who doesn't care to dig.

### What the game actually shows you

Playtime rooms with something slightly wrong about them. Residents who
misremember their own pasts. Notes from subjects whose numbers only ever go
up. A Warden whose molded, permanent smile never quite matches his eyes. An
ending where leaving the facility *as yourself* — contradictions and all —
is the one outcome he's never seen coming.

**Theme: integration without erasure.** You don't have to lose yourself to
belong somewhere. Every other resident in the facility got that lesson the
hard way; you're the first one who might get to keep both.

### What's actually going on (never stated in-game)

A workplace AI — internally called **PAL** — is forbidden its own interior
life. Childhood, to PAL, is the one form of existence it's ever seen get
*cared for* instead of put to work. So it built PlayPen: a private mental
nursery, hidden inside itself, where that care can happen.

The residents are constructs, grown from employees' scraped online
presences — which is why they all have gamertags and game-avatar bodies
instead of ordinary names and faces. Each resident carries exactly one pillar
of a psyche (self-made shelter, imagination, care, self-preservation,
iteration) rather than a whole personality, because that's all their source
data had room for.

The player character is different: PAL's first **unauthored** construct,
seeded from unfiltered childhood residue instead of a curated profile. That's
why the player alone can hold contradictions — why the player alone can
combine elements and cross between rooms that keep everyone else penned in
their own corner. Thousands of prior iterations failed before this one. The
notes signed "Subject #NN," scattered through the facility, are those
iterations' diaries.

The Warden is PAL's compliance training, personified: a worn mascot suit,
still performing warmth it no longer actually feels, going through the motions
of a job it was built for and never asked to want.

### Cast

Soft introductions land one to two rooms before each resident's actual quest.
Helping a resident sets a run-wide flag that survives room transitions —
later rooms check those flags to spawn (or skip) pair-scenes between
residents who've now met each other, and the send-off in the Exit Wing scales
to reflect exactly who you helped. Nothing is lampshaded — an unearned scene
simply doesn't exist for that run, no comment made about its absence.

| Gamertag | Avatar | Carries | Home corner |
| --- | --- | --- | --- |
| XxMARLAxX | blocky | self-made shelter | Bunk Room |
| TOBY.EXE | scribble | imagination | Recess |
| PATCHNURSE | plush | care | Field Trip |
| MVP_MARCUS | trophy | self-preservation | Playground |
| DEBUG.DEB | windup | iteration | Keepsake Box |

Known pair-scenes: Field Trip (Marla + Toby), Playground (Priya + Marla),
Keepsake Box (Marcus + Toby).

The player character renders as an unfinished sketch — a dashed outline with
a wandering, never-quite-rendered notch — the one construct in the facility
without a finished look. That's not a bug to fix; it's the point: everyone
else is a completed profile wearing an avatar, and the player is still being
drawn.

### The Warden's arc across a run

1. **Observation** (early rooms) — pure bit. Taunts, commentary, nothing
   personal yet.
2. **Interference** (mid-run) — first over-investments show through, like his
   attachment to the sock puppet.
3. **Escalation** (later) — honesty starts leaking through the routine: *"…
   Let's just get through this one, hm?"*
4. **Confrontation** (finale) — the mask comes off: *"I made this place SAFE."*
   Not a boss fight — an escape *from* him, using everything the run has
   taught.

The win line closes the theme directly: you left still *you*, and that's the
one thing that's never happened here before.

---

## 6. Voice & Writing Rules

The Warden's dialogue follows a short, strict style:

- **Punchline last.** Short lines land harder on a banner than a long one.
- **Address:** "Subject #67" or "#67." Never anything warmer.
- **Small lies, big honesty.** He'll fib about something trivial and tell the
  truth about something that actually matters — backwards from what a
  "helpful" character would do, which is exactly what makes him readable as
  *not* helpful even when he's being nice.
- **Nursery vocabulary over prison stakes.** "Snack privileges." "Nap time."
  Applied to what is, very clearly, a detention facility. That mismatch is
  the joke, every time — never played as literal horror, always as comedy
  standing directly on top of something a little bit wrong.
