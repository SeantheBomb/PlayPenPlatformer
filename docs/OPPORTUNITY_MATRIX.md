# PlayPen — Opportunity Matrix (v3 campaign: 10 rooms)

**Campaign shape** (pacing per Sean's direction — teach crafting first, enemies late,
one thinker, one action room, one boss):

| # | Room | Role | Focus |
| - | --- | --- | --- |
| 1 | Orientation | Introduce | fire→wood, crafting, brazier lighting |
| 2 | Storage | Introduce | bucket loop, water→fire |
| 3 | The Vents | Introduce/Twist | **goo carries fire** (fuse-line under a wall) |
| 4 | Cell Block | Introduce | spark conduction, fuse gates, Marla trade |
| 5 | The Gap | Introduce | placeable springs |
| 6 | Greenhouse | Exercise (long) | waterfall vs lit torch, freeze bridge, side treasure |
| 7 | Mess Hall | **Enemy debut** | sight cones, lockers, water safe-zones |
| 8 | The Vault | **The thinker** | multi-step chain: goo-fuse under falls → burn wall → conduct through pool → don't stand in it |
| 9 | The Yard | **The action room** | everything hostile, pre-crafted supplies |
| 10 | The Long Run | **Boss** | Warden chase, zero crafting, tools staged on route |

*(Older v2 interaction table below still describes the kernel; per-room mapping
superseded by the table above.)*

With the element kernel, matrix rows are **element interactions**, not one-off
mechanics. Each row should hit **I → E → T → C** across a wing:

- **I** Introduce (safe, legible first contact)
- **E** Exercise (apply under pressure)
- **T** Twist (subvert the expectation)
- **C** Combine (interlock with another interaction)
- `·` available in the room but not the focus

## Wing A (v0.2 campaign)

| Interaction | orientation | storage | vents | cell_block | the_gap | mess_hall | exit_wing |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| fire → wood (burn) | I | | | | | | E (upper route) |
| fire spread (chains) | I (barrier) | | E (goo strip) | | | · | C (goo near exit) |
| wood → fire (light torch) | I (brazier) | | | | | | E (brazier resupply) |
| water → fire (douse) | | I | | | | E (kitchen fire) | E (fire strip) |
| water → goo (dissolve) | | | I (pool + goo) | | | | E |
| bucket fill/refill | | I | E | | | E | E |
| ice → water (freeze bridge) | | | | | | I | E (pool crossing) |
| ice slippery surface | | | | | | T (frozen bridge is slick) | E |
| fire → ice (melt) | | | | I (note pocket) | | · (re-melt your bridge!) | · |
| force → brittle (shatter) | | I (note: hammer) | | E (ice pocket alt) | | · | · |
| spark → conduction | | | | I (fuse gate) | | | · (grate walkway) |
| spark self-danger | | | | T (strip underfoot) | | | · |
| fuse boxes / powered gates | | | | I | | | |
| placeable springs | | | | | I/E (shelf) | · (platform route) | E (route shortcuts) |
| fire vs goo creature (kill) | | · (crawler+torch) | E | · | | E | E |
| water/spark vs metal drone | | | E (pool + spotter) | | | E | E |
| smoke bomb (neutral fallback) | | | · | I (Marla) | | · | · |
| lockers / stealth | | | I/E | | | E | T (none on upper route) |
| water wading (slow, exposed) | | I | · | | | E (under spotter watch) | E |
| NPC trade | | | · (mushrooms) | I (Marla) | | | |
| death / drop / recover | I (pit) | E | E | E | E | E | E |

## Multi-solution gates (the emergence check)

| Gate | Solutions verified |
| --- | --- |
| Orientation barrier | burn it (intended); *only* fire — Introduce room |
| Storage shelf fire | douse (bucket) · frost vial · sneak nothing past it — it's 3 wide, jump is possible with a run |
| Vents goo strip | burn it · wash it · wade it slowly |
| Cell block note pocket | melt the ice · shatter the ice (hammer, or anything metal) |
| Cell block gate | spark the strip · spark the box side-on — conduction only, it's the Introduce |
| Gap shelf | placed spring (bounce pad chain assists) |
| Mess hall pool | freeze bridge · wade under pressure · spring to the high shelf |
| Mess hall fire | douse · high-shelf bypass · run-jump |
| Exit wing | upper: torch the wood wall past the drone · lower: freeze/wade + douse/jump + burn/wash goo |

## Known gaps (deliberate, queued for Wing B)

- **spark → water** (electrified pools) is implemented but never authored as a beat —
  Wing B introduces it as a trap AND a weapon (spotter wading = free stun).
- **ice → fire** quench never has a room. Twist idea: brazier you must NOT extinguish.
- **Burning goo as a fuse line** (lit at one end, carries fire to a target) — the
  system supports it today; author a room around it.
- **Melting your own ice bridge** (fire near frozen pool) is a live Twist in
  mess_hall but unhinted; make it explicit in Wing B.
- **Placed springs under enemies** (launch a crawler) — not yet supported; enemies
  ignore springs. Candidate engine addition.
- SPARK machinery beyond fuseboxes: powered platforms, timed conduits, camera turrets.

## Template for new rooms

```
Room id:            (kebab_case)
Wing / position:    (pacing slot)
Introduces (I):     one interaction max
Exercises (E):      1-2
Twists (T):         0-1
Combines (C):       0-1 pairing
Gate out:           which interactions open it; list ALL valid solutions (aim ≥2)
Supplies:           materials must cover every listed solution + one spare experiment
Taunt beats:        room_enter line? special trigger?
```
