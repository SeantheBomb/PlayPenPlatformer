# PlayPen — Art Handoff

*For the artist. Everything you need to know about the game, its current look, and
the tool you'll use to draw it — distilled from the design docs and the code so you
don't have to dig through either. No technical background required.*

---

## 1. What the game is

**PlayPen** is a comedic-menace escape platformer for kids (~10 years old — think
*The Amazing Digital Circus* crowd, or Portal filtered through a kindergarten). You
play **Subject #67**, trapped in a facility styled like a demented daycare, run by a
chatty mascot called **the Warden**. You scavenge junk, craft tools, solve elemental
puzzles (fire burns wood, water freezes into ice, lava melts metal), befriend the
other kids trapped there, and break out room by room.

**The tone your art needs to hit:** the player should grin, not shrink. Everything
can look a little off, a little worn, a little too cheerful for where it is — but
never gross, never actually scary, never cruel. Cute wrapped around something
slightly wrong is the whole visual joke.

---

## 2. The visual identity, as it exists today

**Right now, every single thing in the game is drawn by code** — flat-color
geometric primitives (rectangles, circles, simple paths), no image files at all.
That's not a placeholder aesthetic to preserve, it's just what happens before an
artist shows up. You're free to replace as much or as little of it as you want:
retexture one tile, or overhaul the entire game's look. Nothing you do can be
"wrong" in a way that breaks anything — worst case, it just gets swapped back out.

A few things ARE already locked in, either because they carry meaning in the design
or because two things looked too similar and confused players in testing. Worth
knowing before you start:

- **Braziers vs. fire hazards read as opposite temperatures.** Braziers are a safe,
  always-on light source (never hurts the player) — warm gold/amber, rounded, a
  slow, calm breathing glow. Hazard fire and burning tiles damage the player — hot
  white-tipped, jagged, fast. If you're designing new fire-adjacent art, keep these
  reading as opposites at a glance — cozy vs. dangerous.
- **The raw Spring Coil material and the placeable Spring pad look different on
  purpose** (they used to share an icon and players couldn't tell them apart). Coil
  = stacked wire rings, silver-grey. Spring pad = the "boing" zigzag, green.
- **The player character is deliberately an unfinished gray pencil sketch** — dashed
  outline, a wandering un-rendered notch that never quite resolves. This is
  intentional characterization tied to the story (see below) — please don't "finish"
  it into a normal character without checking with Sean first. Everything else can
  get a real design; the player stays the one construct that looks incomplete.
- **Each resident has an avatar concept already established** by the writing — see
  the cast table below. These aren't final art, just the *shape* each character
  should read as. Riff on them freely.

### The cast (for character work)

| Gamertag | Avatar concept | Vibe |
|---|---|---|
| **XxMARLAxX** | Square head, square body, chunky pixel shading, a satchel she guards | A Minecraft skin that walked out of its game |
| **TOBY.EXE** | A kid's crayon self-portrait come to life — jittery lines, unstable proportions, always mid-flail | Feral meme energy, silent "EXE" |
| **PATCHNURSE** | Hand-stitched plush bear, button eyes, a visible X of mended stitches on the belly | Care Bear by way of a daycare boo-boo buddy |
| **MVP_MARCUS** | A first-place trophy that decided it was a person — gold cup head, handle ears, foam #1 finger fused to one hand | Every rage-y esports captain |
| **DEBUG.DEB** | Dented tin wind-up toy, painted-on determined eyes, a strip of tape over the dent, a turn-key spinning in her back | The speedrunner who knows every frame |
| **The Warden** | A worn mascot costume — molded plastic permasmile that can't move, a stitched repair seam up one temple, a crooked ear, a merit-badge sash with one peeling star sticker | The smile and the eyes should feel like they don't quite agree |

Full character bios and story context live in `docs/WRITER_HANDOFF.md` if you want
the deeper why behind any of these — not required reading, but it's there.

---

## 3. The technical shape of art in this game

You don't need to hit exact pixel dimensions. **Every piece of art gets fitted to
its box automatically** — draw at any resolution, higher just looks crisper on
screen. Match the box's proportions to avoid stretching, but even that's forgiving.

Rough sizes, so you know what you're working with:

| Thing | Box size | Notes |
|---|---|---|
| Player | 12×14 | Kept as the "unfinished sketch" — see above |
| Warden (body) | 52×44 | |
| Warden portraits (dialog faces) | 32×32 each | 6 emotions: smug, gleeful, annoyed, bored, shocked, proud |
| NPCs (body) | 12×16 | One set of art per character, reused everywhere they appear |
| NPC dialog portraits | 32×32 | |
| Tiles (walls, water, lava, spikes, etc.) | 16×16 | 18 of them |
| Items (tools, materials, curios) | 16×16 | 22 of them |
| Enemies | ~16-18×12-20 (varies) | 2 currently: Crawler, Spotter |
| Interactive objects (doors, checkpoints, braziers, fuseboxes...) | varies, e.g. 16×32 door, 16×14 brazier | Several of these have a **second look** — see below |

**Animation** is just multiple frames + a frame rate (fps) — most things support it,
a few (portraits, dialog faces) are single-image only. **Some objects have a second
"state" look** — a door has an open look as well as closed, a brazier has an unlit
look as well as lit, a checkpoint has an "active" look as well as its normal one.
The tool shows you exactly which objects need a second look and what to call it.

**The game's default color palette** (16 flat colors, used across most of the
current procedural art — a starting reference, not a rule):

`#12101c` `#3d3a52` `#6e5c8a` `#b9bdd4` `#f4ead8` `#ffd166` `#ff7043` `#c84b6a`
`#8bd44f` `#5ad1a5` `#4fc3f7` `#7fd8e8` `#b08757` `#8a97a8` `#59627f` `#e8a2b4`

---

## 4. The Art Studio — your tool

Everything above is browsable and editable in one page, built specifically for you.
It needs no other apps installed and no technical setup.

**Getting in:** Sean will give you a URL and a password — different from his own
editor password, so you can't accidentally touch gameplay data even if you wanted
to. Log in once; the browser remembers you.

**The gallery** lists every drawable thing in the game — Characters, Tiles, Objects,
Items, Enemies — each card showing its current look (live-animated where the game
animates it) and whether it still needs art. Filter by "Needs art," "Has art," or
search by name. Click anything to open its page.

**On an asset's page** you get:
- A zoomed preview at a few sizes, so you can see it big.
- A drop zone for your own files — **PNG, SVG, GIF, an animation strip, or several
  numbered PNGs (auto-detected as animation frames)** all work. Bring in art from
  Aseprite, Photoshop, Illustrator, whatever you're comfortable with.
- Two **built-in editors** if you'd rather draw right there: a quick pixel-art
  editor and a vector shape editor. Both **start pre-populated with the current
  procedural look**, converted into something you can tweak — so you're editing a
  starting point, never staring at a blank canvas, even for things that are
  currently just code-drawn shapes.
- A resolution picker for the pixel editor (1×/2×/4×) if you want more detail.
- A second-look section for anything that changes appearance in-game (open/closed,
  lit/unlit, etc.), with its own drop zone and editors.

**Trying it out:** hit **"Try in game"** any time — the actual game runs right there
in the studio with your art already in it, before anyone else sees a thing. This is
your private draft; nothing is visible to players yet.

**Publishing:** when you're happy, **"Publish art"** ships it to everyone playing.
This is deliberately scoped so it's impossible to break anything — publishing from
here can only ever touch artwork fields, never gameplay values, room layouts, or
anything Sean's working on at the same time. Every publish is saved in history, so
anything can be rolled back.

**Reference sheet:** the "Download reference sheet" button at the top gives you one
PNG contact-sheet of every current asset's look — handy to keep open in another app
while you draw, or to print/reference offline.

---

## 5. Environments — parallax backdrops

The **🌄 Environments** tab in the studio is where rooms get depth: layered
backdrops that scroll at different speeds behind (and optionally in front of)
the action. Same trick the classic Sonic games use.

**How a layer works.** A layer is *one image that repeats sideways forever* —
not a giant painted mural. Draw a strip (something like 160×180 is plenty),
make its left and right edges line up, and it tiles seamlessly across any room.
That keeps files small, which matters: everything in the studio is downloaded
by every player when the game boots, so each set shows you exactly how many KB
it's adding.

**A set is a group of layers** (it starts with a far, a mid, and a foreground).
Rooms point at a set — so you dress "the facility" once and eleven rooms get it,
rather than painting eleven backdrops. Any room can be pointed at a different
set, and any single room can override a layer's numbers just for itself
("Tweak for this room only").

**The six knobs per layer**, in plain terms:
- **Follows camera ↔ / ↕** — the actual parallax. `1.00×` moves exactly with the
  level (as if painted on the wall), `0.15×` reads as far away in the distance,
  above `1.00×` rushes past like something between you and the camera.
- **Drifts ↔ / ↕** — the layer moving under its own steam, in pixels per second.
  Worth using: our rooms are much smaller than a Sonic level, so the camera
  often barely moves, and a slow drift is what keeps a backdrop feeling alive
  when the player is standing still.
- **Opacity** and **Vertical offset** — how solid it is, and where it sits.

The **far / mid / foreground** buttons set all of these to sensible values in
one click. Start there, then tweak.

**Foreground layers** (drawn in *front* of the player) are supported, with one
rule baked in: they automatically fade out in a soft circle around the player,
so foreground art can never hide the player, a hazard, or a prompt. You can
turn that off per layer, but the game is for 10-year-olds who need to read
spikes at a glance — please keep it on unless there's a good reason.

**How big should a strip be?** Each layer works this out for you and shows it
live under **📐 Size guidance**, updating as you move the sliders — so you can
try a setting and immediately see what size it would want. Two things drive it:

- **Width** is about how far the layer travels. A *nearer* layer (higher
  "follows camera") sweeps past faster and so needs a *wider* strip than a
  distant one — the opposite of what you'd expect. The panel tells you the
  width at which the repeat never comes around in the room you're previewing,
  and a second figure that covers every room in the set.
- **Height** is about tall rooms. A near-foreground layer barely moves relative
  to the level, so a screen-height strip runs out below the first screenful and
  the background shows through. Either draw it tall enough (the panel says how
  tall) or tick **repeats downwards**, after which any height works.

It also flags real problems — a strip too short to reach the bottom of a room,
or one repeating so often it reads as tiling — while staying quiet about
differences too small to see.

One quirk worth internalising: a strip is the *only* thing in the studio that
isn't fitted to a box. One image pixel is one pixel of the game world, so a
bigger strip covers more ground rather than looking sharper.

**Sizing one set to cover the whole game (the first-pass recipe).** The
Environments page works these out live, but the short version, and the
reasoning, is worth having up front:

| Layer | Never repeats anywhere | What to actually do |
|---|---|---|
| **Far** | 808 × 403 | Draw it at full size. It's the one plane where a repeat really shows — a horizon that comes around twice looks broken — and it's cheap art, so this is the best value in the set. |
| **Mid** | 1144 × 521 | Don't chase it. Draw a tileable pattern (roughly 400–600 wide) and let it repeat. Pillars, shelving and windows are rhythmic anyway. |
| **Foreground** | 2040 × 950 | Definitely don't chase it. 300–400 wide is plenty — bars, pipes and foliage are *supposed* to recur. |

Three things make those maximums smaller than they look:

- **One room is an outlier.** The Long Run is nearly twice as wide as any
  other room, and sizing for it inflates the foreground by about 40%. It's the
  finale chase — the player is sprinting — so it's fine to let the backdrop
  tile more there. Skip it and everything else is covered at 736 / 928 / 1440.
- **Vertical wrap removes the height question.** Only one room (the Boiler
  Room) is tall enough for height to matter. Tick **repeats downwards** on the
  mid and foreground layers and any height works, which leaves the far layer as
  the only one needing a real height — 420px covers every room.
- **Repeating is not failure.** Sonic tiled everything. The size guidance tells
  you how often a strip repeats in each room; treat anything under about 3× as
  fine, and worry only when it's high enough that the eye starts matching up
  landmarks.

So a realistic first pass is: **one properly-drawn far strip at 808 × 420**, and
**two tileable patterns** for mid and foreground with "repeats downwards" on.
That dresses all eleven rooms.

**Props** are one-off objects on a layer — a pipe, a poster, a cloud. Drop image
files in, then just **drag them around directly in the preview**. They move with
their layer's parallax like everything else on that plane.

**Want to see it working before you draw anything?** Hit **✨ Add placeholder
set**. It generates rough stand-in art for all three planes — distant silos,
interior pillars and shelving, foreground bars — and switches it on for every
room, so you can play the game and feel the effect immediately. It's also a
useful reference for what each plane is *for*: notice how the far layer is low
contrast and barely moves, while the foreground is dark, sparse, and rushes
past. Delete the set whenever your real art is ready. (There's a ✨ Placeholder
button on each individual layer too, if you only want a stand-in for one of
them while you work on the others.)

**The preview** pans a real room at the player's actual running speed, so you're
tuning by feel rather than by numbers. Drag it to scrub the camera yourself. And
**▶ Play this room** drops you into the real game, in that exact room, with your
draft layers — before anyone else sees any of it.

Nothing here can break the game: layers are pure decoration, and the game
doesn't read them for anything except drawing. A half-finished set is always
safe to leave in place — empty layers simply don't draw.

## 6. Where to start

There's no wrong order, but if you want a suggested path:

1. **The cast + player** — most emotionally central, and the thing that'll make the
   game feel like *your* game fastest. (Note: the player already has one custom
   sprite in place from earlier testing — feel free to redo it, it's not final.)
2. **Common tiles** — walls, platforms, water, lava, spikes. These repeat
   constantly, so they set the overall visual tone more than anything else.
3. **Objects** — doors, braziers, checkpoints, fuseboxes. Remember the
   brazier-vs-fire and second-look notes above.
4. **Items** — tools and materials. Smaller, faster, good for filling gaps.
5. **Enemies** — just two right now (Crawler, Spotter).
6. **Environments** — parallax backdrops (§5). Worth doing *after* the common
   tiles, so the backdrops can be built to sit behind a look that already
   exists. One good set applied to every room changes the feel of the whole
   game for very little drawing.

Everything currently in the game is a placeholder, not a fixed target — replace
anything, in any order, at any pace. If you're ever unsure whether something's
locked (like the player's unfinished-sketch look) or just hasn't been drawn yet,
ask Sean — most things fall in the second category.
