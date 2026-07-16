# PlayPen — Opportunity Matrix

Mechanics × rooms. Every mechanic should ideally hit **I → E → T → C** across a wing:

- **I** Introduce (safe, legible first contact)
- **E** Exercise (apply under mild pressure)
- **T** Twist (subvert the expectation)
- **C** Combine (interlock with another mechanic)
- `·` present but not the focus

## Wing A (v0.1 campaign)

| Mechanic | orientation | storage | vents | cell_block | the_gap | mess_hall | exit_wing |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Run / jump | I | E | · | · | T (vertical) | · | E |
| One-way platforms | | I | | | E | E (tables) | E |
| Spikes / pits | I | E | | | E (fall cost) | E | C (goo+spikes) |
| Goo (slow) | | | I | | | | C (goo+spikes) |
| Bounce pads | | | | | I | | |
| Pickups / materials | I | E | E | E | E | E | · |
| Notes / recipes | I | | | T (buried in floor) | E | E | |
| Crafting (combine) | I (hammer) | · (sock puppet bait) | | E (lockpick) | E (boots) | E (trap) | · |
| Break (cracked) | I (wall) | | | T (floor crumbles under you) | | | |
| Locked door / key | | | | I | | | |
| Mobility gate (boots) | | | | | I | · | E (platform route) |
| Crawler (patrol) | | I | | E | | C (w/ spotter) | E |
| Spotter (chase) | | | I | | | E | C (w/ crawler) |
| Lockers (hide) | | | I | | | E | T (none near exit!) |
| Smoke bomb (stun) | | | · (materials) | · (recipe) | | I/E | E |
| Sticky trap | | | | | | I | E |
| NPC / fetch quest | | | · (mushroom source) | I | | | |
| Checkpoints | · | I | E | E | E | E | E |
| Death / drop / recover | I (pit) | E | E | · | E | E | E |
| Taunt beats | I (intro) | · | E (room bark) | E (npc bark) | · | · | T (win bark) |

## Reading the gaps

Empty columns down a mechanic's row = authoring opportunities for the next wing.
Current known gaps (deliberate, queued for M2):

- **Bounce pads** only appear once (I without E/T/C). Wing B should exercise them under
  enemy pressure and twist them (ceiling spikes above a pad).
- **Lockers** never get their Twist in a punishing form — the Lurker entity (haunts
  overused hiding spots) is the planned T.
- **NPCs** have one instance. Wing B: an NPC whose request requires a *discovered*
  (unhinted) recipe; an NPC who trades for curios.
- **Goo** deserves a Combine with bounce pads (goo-covered pad = no bounce until cleaned?).
- **Crafting fail-space** is untapped as a mechanic: fake recipe notes planted by the
  Warden (Act 2 interference) are the natural Twist.

## Template for new rooms

For each new room, fill in before building:

```
Room id:            (kebab_case)
Wing / position:    (pacing slot)
Teaches (I):        one thing max
Exercises (E):      1-2 things
Twists (T):         0-1 thing
Combines (C):       0-1 pairing
Gate out:           tool / key / mobility / knowledge / courage
Materials in room:  must cover the gate + one spare experiment
Taunt beats:        room_enter line? special trigger?
```
