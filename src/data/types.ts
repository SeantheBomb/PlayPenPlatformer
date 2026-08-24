// Schemas for all serialized content. Every gameplay-affecting value lives in
// content/*.json and flows through these types — code never hardcodes design data.

export interface GameConfig {
  title: string;
  subtitle: string;
  antagonist: SpriteFields & {
    name: string;
    color: string;
    // Custom portrait override per emotion (data-URI images)
    portraits?: Partial<Record<WardenEmotion, string>>;
  };
  player: SpriteFields & {
    color: string;
    eyeColor: string;
    /** Draw the player as an unfinished, half-loaded sketch (dashed
     *  outline, missing fill) — the one construct without a finished look. */
    sketch?: boolean;
    width: number;
    height: number;
    runSpeed: number;
    acceleration: number;
    friction: number;
    airControl: number;
    gravity: number;
    jumpVelocity: number;
    jumpCutMultiplier: number;
    maxFallSpeed: number;
    coyoteTimeMs: number;
    jumpBufferMs: number;
    maxHealth: number;
    invulnMs: number;
    knockbackX: number;
    knockbackY: number;
    /** Swimming (engages in water ≥3 tiles deep — shallower stays wading). */
    swim: {
      gravity: number;        // slow sink pull, px/s²
      maxSink: number;        // terminal sink speed, px/s
      stroke: number;         // upward impulse per jump press, px/s
      holdLift: number;       // gentle upward accel while jump held, px/s²
      accelFactor: number;    // horizontal accel multiplier (floaty)
      frictionFactor: number; // horizontal friction multiplier (drifty)
    };
    /** BOTW-style stamina climb: standing in a goo-style tile with a solid
     *  neighbor on the pressed side (sticky bomb) engages it, the same way
     *  standing in a water column engages swim. */
    climb: {
      wallSeconds: number;    // climb duration against a goo-adjacent wall
      ceilingSeconds: number; // climb duration under a goo-adjacent ceiling
      speed: number;          // along-surface movement speed, px/s
      // Pressing off-axis (away from a wall, or down/jump off a ceiling)
      // dismounts AND launches the player in that direction, like a wall
      // jump, instead of just cutting them loose to fall straight down.
      jumpPushSpeed: number;  // horizontal push off a wall, px/s
      jumpLiftSpeed: number;  // wall: upward lift; ceiling: downward drop, px/s
    };
  };
  camera: { lerp: number; lookaheadX: number; lookaheadY: number };
  juice: {
    screenShake: boolean;
    shakeIntensity: number;
    particles: boolean;
    squashStretch: boolean;
    hitStopMs: number;
    landDustAtFallSpeed: number;
  };
  rules: {
    resetInventoryBetweenRooms: boolean;
    dropMaterialsOnDeath: boolean;
    respawnInvulnMs: number;
    healAtCheckpoints: boolean;
    stunDurationMs: number;
    smokeBombRadius: number;   // veil radius in px (160 = 10 tiles)
    smokeCloudSeconds: number; // how long a smoke veil lingers
    smokeThrowVx: number;      // throw velocity at FULL charge, px/s
    smokeThrowVy: number;      // throw upward velocity at FULL charge, px/s
    smokeThrowMinVx: number;   // tap (uncharged) throw velocity, px/s
    smokeThrowMinVy: number;   // tap (uncharged) upward velocity, px/s
    throwChargeSeconds: number; // hold time from tap strength to max trajectory
    idleTauntSeconds: number;
    idleChaseSeconds: number;   // idle this long and the Warden comes for you
    wardenIdleSpeed: number;    // px/s while punishing idlers
    waterFlowEnabled: boolean;  // water falls into open shafts, spreads along floors
    airBlips: number;           // breath capacity while underwater
    airLossSeconds: number;     // seconds per blip lost while submerged
    drownSeconds: number;       // seconds per heart lost once air runs out
    stickyBombRadius: number;   // goo splat radius in px, from detonation point
  };
  audio: {
    sfxVolume: number;
    muted: boolean;
    musicVolume: number;
    /** tracks.json id used by any room that doesn't set its own `track`. */
    defaultTrackId?: string;
  };
  /** HUD layout — editable in the editor's "game" tab, no code changes needed. */
  hud: {
    heartsX: number; heartsY: number; heartSpacing: number;
    heartColor: string; heartEmptyColor: string;
    airX: number; airY: number; airSpacing: number;
    airColor: string; airEmptyColor: string;
    toolbeltRightOffset: number; toolbeltTopOffset: number; toolbeltSpacing: number;
    hotbarLeftOffset: number; hotbarBottomOffset: number;
    hotbarSlotSize: number; hotbarSpacing: number; hotbarSelectedColor: string;
    bannerTopOffset: number;
    /** Climb-timer bar (goo climbing) — shown only while climbing. */
    climbX: number; climbY: number; climbWidth: number; climbHeight: number;
  };
}

// ---- Elemental system ----

export interface ElementDef {
  id: string;
  name: string;
  color: string;
}

export type RuleEffect =
  | "ignite"      // flammable target starts burning, becomes burnsTo after burnTime
  | "melt"        // target becomes meltsTo
  | "extinguish"  // fire/burning target reverts (extinguishesTo / stops burning)
  | "dissolve"    // target becomes dissolvesTo
  | "freeze"      // target becomes freezesTo
  | "shatter"     // brittle target becomes shattersTo
  | "energize"    // charge floods connected conductive tiles
  | "ignite_self" // the applied carrier item transforms (unlit torch -> lit)
  | "fizzle";     // visible puff, no change

export interface RuleDef {
  id: string;
  /** Pattern-line form: "actor + target -> effect", where target is an
   *  element id or a tile property (flammable | brittle | conductive) —
   *  e.g. "fire + flammable -> ignite", "lava + metal -> melt". */
  rule?: string;
  // Legacy split form, still honored (stale saves predate `rule`):
  actor?: string;          // element id applying the effect
  target?: string;         // element id of the target tile...
  targetProperty?: string; // ...or a tile property: flammable | brittle | conductive
  effect?: RuleEffect;
  note?: string;
}

export type EnemyReaction = "kill" | "stun" | "knockback" | "none";

// ---- Behavior scripting (penscript) ----
// Serialized in content/behaviors.json; compiled/run by src/game/penscript.ts
// + src/game/behavior.ts. Engine code provides the function vocabulary
// (registerFn); content provides the scripts. New gameplay should be a new or
// edited behavior script first — new functions only when the language
// genuinely can't say it.

/** Handler events a script can respond to (`on tick { ... }`). */
export type BehaviorTrigger =
  | "tick"           // every fixed sim step (enemies, entities)
  | "flowTick"       // every fluid-flow tick (entities — braziers douse here)
  | "elementContact" // an element was applied to the host (tool hit, hazard overlap)
  | "use"            // the player used the host item (F)
  | "heldTick"       // per-step while the host item is the selected hotbar item
  | "carriedTick"    // per-step for every item in the inventory
  // Policy hooks — the fluid/heat sims keep their iteration + conservation
  // machinery in engine code, but call these on the global docs at every
  // DECISION point so the policy is authored (and troubleshootable) in
  // script. When a doc has no handler for one, the engine falls back to
  // legacy behavior (incl. old sideBias/chainMeltRange vars on stale docs).
  | "pickSide"       // fluidFlow: which side does fluid try first? (prefer)
  | "sourcedSpread"  // fluidFlow: how does a fall-fed pool widen? (spreadBoth/Left/Right/None)
  | "fluidContact"   // fluidFlow(mover, other): two fluids met — who dies, who hardens
  | "meltChain"      // heatSpread(depth): does a lava melt chain keep going? (keepHot)
  | "recede";        // fluidFlow(ratio): when does a cut-off sourced tile dry up? (setDelay)

export interface BehaviorDef {
  id: string;
  name?: string;
  description?: string;
  /** What kind of host this attaches to (editor filtering + validation). */
  host?: "enemy" | "item" | "entity" | "tile" | "global";
  /** Semantic markers other systems key on (e.g. "sight" = hunts by sight:
   *  smoke hides the player from it and it draws a vision cone). */
  tags?: string[];
  /** penscript source, stored as lines (diffs cleanly, stays readable in
   *  raw JSON). Top-level `var`s are the behavior's tweakable fields. */
  script: string[];
}

/** A behavior attached to a def: plain id, or id + field-value overrides
 *  (params override the script's top-level `var` initializers by name). */
export interface BehaviorRef {
  id: string;
  params?: Record<string, unknown>;
}
export type BehaviorAttachment = string | BehaviorRef;

/**
 * An entity TYPE's definition (brazier, door, locker...): footprint size and
 * default behavior attachments. Serialized in content/entities.json — the
 * per-def home for entity behavior wiring, same as enemies/items have.
 */
export interface EntityTypeDef extends SpriteFields {
  id: string;
  width: number;
  height: number;
  behaviors?: BehaviorAttachment[];
  note?: string;
  /** Secondary-state art, meaning per kind: door/trapdoor = OPEN, brazier =
   *  UNLIT, capacitor/fusebox = ON/tripped, locker = occupied. The base
   *  sprite covers the primary state; either alone falls back to procedural
   *  for the state it doesn't cover. */
  spriteAlt?: string;
}

export type TileStyle =
  | "block" | "platform" | "spikes" | "cracked" | "spring" | "goo"
  | "wood" | "ice" | "water" | "fire" | "metal" | "waterfall" | "drain"
  | "lava" | "lavafall" | "gutter"
  // Decor set — the PlayPen's playtime dressing (non-gameplay unless solid)
  | "balloon" | "stringlight" | "crayon" | "toyblock";

/**
 * Optional custom art, available on tiles, items, enemies, the player, and
 * Warden portraits. `sprite` is a single data-URI image; `spriteFrames` (+
 * `spriteFps`) animates. When absent, procedural drawing is used.
 */
export interface SpriteFields {
  sprite?: string;
  spriteFrames?: string[];
  spriteFps?: number;
}

export interface TileDef extends SpriteFields {
  id: string;
  char: string;
  name: string;
  style: TileStyle;
  color: string;
  solid?: boolean;
  oneWay?: boolean;
  damage?: number;
  repels?: boolean; // shoves the player back out (even on invuln frames) — an impassable hazard
  bounce?: number;  // upward launch velocity in px/s
  slow?: number;    // movement multiplier while overlapping (goo, water, any liquid), default 1
  // Elemental identity + properties
  element?: string;
  flammable?: boolean;
  brittle?: boolean;
  conductive?: boolean;
  slippery?: boolean;
  spreads?: boolean;   // fire tiles ignite neighbors
  burnTime?: number;   // seconds a burning tile lasts
  // Transformations (tile id, or "" for empty)
  burnsTo?: string;
  meltsTo?: string;
  freezesTo?: string;
  shattersTo?: string;
  dissolvesTo?: string;
  extinguishesTo?: string;
  // Fluid dynamics
  fluid?: boolean;      // participates in the flow sim (falls, spreads)
  fallSpawns?: string;  // a fall tile: grows downward, emits this tile id at its base
  /** Fluid falls/flows straight through as if this tile weren't there —
   *  never rests/pools on top of it, unlike a platform (grate). Independent
   *  of `solid`: a gutter is meant to be BOTH solid to the player/enemies
   *  AND transparent to fluid, the inverse combination from a grate
   *  (walkable oneWay, fluid-transparent). See realTileBelow. */
  fluidPasses?: boolean;
  // Loot: destructive transforms (melt/shatter/dissolve/burn) drop this item
  dropsItem?: string;
  /** Composable behavior attachments (behaviors.json ids) — reserved for
   *  tile-hosted rules (elementContact overrides and future tile scripting). */
  behaviors?: BehaviorAttachment[];
}

export type ItemKind = "material" | "tool" | "consumable" | "curio";
export type ItemShape =
  | "shard" | "plank" | "ring" | "cloth" | "ball" | "mushroom"
  | "cog" | "spring" | "coil" | "springbox" | "tool" | "bottle" | "torch" | "bucket" | "rod";

export type ItemUseMode = "swing" | "splash" | "place" | "burst";

export interface ItemDef extends SpriteFields {
  id: string;
  name: string;
  kind: ItemKind;
  shape: ItemShape;
  color: string;
  description: string;
  element?: string;      // the element this item applies when used
  useMode?: ItemUseMode; // present = appears in the hotbar
  dousedBy?: string;     // element that reverts this item while overlapped (lit torch in water)
  dousesTo?: string;     // item id it reverts to when doused
  douseOnDeselect?: boolean; // also revert to dousesTo when no longer the held/selected item
  igniteTo?: string;     // item id this becomes automatically near a fire source while held
  scoopsInto?: Record<string, string>; // element -> item id this becomes when swung at it (bucket)
  emptiesTo?: string;    // item id this reverts to after a splash
  placeType?: "spring" | "trap";
  capabilities?: string[];
  params?: Record<string, number>;
  /** Composable behavior attachments (behaviors.json ids), run in order.
   *  When absent, derived from useMode/dousedBy/igniteTo (see itemAttachments). */
  behaviors?: BehaviorAttachment[];
}

export interface RecipeDef {
  id: string;
  inputs: [string, string] | string[];
  output: string;
  flavor: string;
}

export type EnemyBehavior = "patrol" | "chase";

export interface EnemyDef extends SpriteFields {
  id: string;
  name: string;
  /** Legacy preset, superseded by `behaviors`. Vestigial for any current
   *  enemy (all of them carry an explicit `behaviors` list); kept optional
   *  purely so `enemyAttachments()`'s fallback derivation still has
   *  something to read for hypothetical stale saves predating that list. */
  behavior?: EnemyBehavior;
  /** Composable behavior attachments (behaviors.json ids), run in order. */
  behaviors?: BehaviorAttachment[];
  width: number;
  height: number;
  color: string;
  eyeColor: string;
  speed: number;
  damage: number;
  /** Gates external stuns (e.g. a smoke bomb's radius) — read directly by
   *  stunEnemiesNear in room.ts, outside the behavior-dispatch system, so
   *  unlike chaseSpeed/sightRange/reactions/etc. this stays a flat field
   *  rather than moving into a behavior's params. */
  stunnable?: boolean;
  element?: string;
  description?: string;
}

export type TauntTrigger =
  | "game_start" | "room_enter" | "first_death" | "death"
  | "craft_fail" | "first_craft" | "craft_item" | "idle"
  | "hide_enter" | "npc_help" | "confiscate" | "warden_chase" | "win"
  | "first_ignite" | "first_melt" | "first_extinguish"
  | "first_freeze" | "first_shatter" | "first_dissolve";

// ---- Achievements ----

export type AchievementTrigger =
  | "craft_item"  // itemId filter
  | "pickup_item" // itemId filter (hidden curios)
  | "counter"     // counter name reaches count
  | "npc_help"
  | "room_progress" // roomProgress condition fully satisfied — see RoomQuest
  | "win";        // optional maxDeaths / maxSeconds filters

/** A "how many of tile/entity type X have been affected, out of how many
 *  exist in this room" condition — an NPC's quest (RoomEntity.roomQuest) and
 *  an achievement's room_progress trigger (AchievementDef.roomProgress)
 *  share this exact shape. Satisfied when total > 0 && done === total (see
 *  src/game/roomProgress.ts). tileId and entityType are mutually exclusive;
 *  entityField is required when entityType is set. */
export interface RoomQuest {
  roomId: string;
  tileId?: string;
  entityType?: string;
  entityField?: "open" | "lit";
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  trigger: AchievementTrigger;
  itemId?: string;
  counter?: string;
  count?: number;
  maxDeaths?: number;
  maxSeconds?: number;
  roomProgress?: RoomQuest;
  wardenLine: string;
  emotion: WardenEmotion;
}

export type WardenEmotion =
  | "smug" | "gleeful" | "annoyed" | "bored" | "shocked" | "proud";

export interface TauntDef {
  id: string;
  trigger: TauntTrigger;
  lines: string[];
  cooldownMs: number;
  chance: number;
  emotion?: WardenEmotion; // portrait face shown with the banner (default smug)
  roomId?: string; // filter for room_enter
  itemId?: string; // filter for craft_item
}

// ---- Rooms ----

export type EntityType =
  | "spawn" | "checkpoint" | "pickup" | "note" | "door" | "trapdoor"
  | "locker" | "enemy" | "npc" | "exit" | "hint"
  | "brazier" | "fusebox" | "source" | "converter" | "capacitor";

/** The cast's procedural body styles (dialog portraits reuse them too). */
export type NpcAvatar = "blocky" | "scribble" | "plush" | "trophy" | "windup";

export interface RoomEntity extends SpriteFields {
  type: EntityType;
  x: number; // tile coords
  y: number;
  /** Only spawn if EVERY listed npcId has been helped this run (any room).
   *  Lets later rooms show friendships the player's help created. */
  requiresHelped?: string[];
  /** Only spawn if NONE of the listed npcIds have been helped — the
   *  adaptive fallback (solo scene when a pair wasn't earned). */
  hiddenIfHelped?: string[];
  // pickup
  item?: string;
  count?: number;
  // note
  recipe?: string;
  text?: string;
  // door
  to?: string; // room id or "next"
  gate?: boolean;  // opens in place instead of teleporting
  fuseId?: string; // deprecated alias for openFuseId, still honored
  openFuseId?: string;  // gate opens when a fusebox with this fuseId trips
  closeFuseId?: string; // gate closes when a fusebox with this fuseId trips
  startOpen?: boolean;  // authored initial state, before any fuse trips this run
  // capacitor — turns on when ANY charge reaches it (no fuseId match needed),
  // stays on emitting its own charge into neighbors every tick, and turns
  // back off only when a fusebox with this fuseId trips (never, if unset).
  offFuseId?: string;
  // enemy
  enemy?: string;
  patrolMinX?: number;
  patrolMaxX?: number;
  // checkpoint
  /** Stable id for deep-linking straight to this checkpoint (?checkpoint=
   *  <id> in a share link) — optional, author it when you want one. */
  id?: string;
  /** Items the player spawns with whenever respawning from this checkpoint
   *  — replaces current inventory, same spirit as resetInventoryBetweenRooms
   *  (nothing carries over by default; this is what a checkpoint hands you
   *  back instead of nothing). */
  loadout?: { item: string; count: number }[];
  // source — E grabs one unit of sourceItem, up to sourceAmount total
  sourceItem?: string;
  /** Total units this source can ever give out. -1 (the SOURCED convention
   *  used elsewhere for fall-fed fluid) means infinite/never depletes. */
  sourceAmount?: number;
  // converter — E trades convertInputCount of convertInput for
  // convertOutputCount of convertOutput, whenever the player has enough
  // input on hand. Unlimited uses — self-limited by how much input the
  // player can bring, not a separate stock like a source.
  convertInput?: string;
  convertInputCount?: number;
  convertOutput?: string;
  convertOutputCount?: number;
  // brazier
  lit?: boolean; // default true; author false for a cold brazier the player must light
  // npc
  name?: string;
  color?: string;
  /** Stable cross-room identity ("marla", "toby"...). Helping this NPC
   *  anywhere sets a run-wide flag other rooms can react to. */
  npcId?: string;
  /** Procedural body/portrait style — the cast's signature looks. */
  avatar?: NpcAvatar;
  portrait?: string; // data-URI override for the dialog portrait
  // `sprite`/`spriteFrames` (from SpriteFields, above) override this NPC's
  // in-room body — separate from `portrait`, which is the dialog-box face.
  wants?: { item: string; count: number };
  /** Alternative to `wants` — quest is "give-able" once this room's progress
   *  condition is fully satisfied (see RoomQuest), instead of the player
   *  carrying an item. Mutually exclusive with `wants`. */
  roomQuest?: RoomQuest;
  rewardItems?: { item: string; count: number }[];
  rewardRecipes?: string[];
  dialogAsk?: string;
  dialogConfirm?: string; // shown with Give/Keep choice when the player has the item
  dialogDone?: string;
  dialogAfter?: string;
}

export interface RoomDef {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  tiles: string[]; // char rows, indexed into tiles.json by char
  entities: RoomEntity[];
  /** tracks.json id for this room's looping music. Unset -> falls back to
   *  game.audio.defaultTrackId, so old saves/rooms never crash on it. */
  track?: string;
  /** Boss mode: the Warden spawns and chases through walls. */
  wardenChase?: { speed: number; delayMs: number };
}

export interface CampaignDef {
  rooms: string[];
}

/** A looping music track. `dataUrl` is the actual audio (uploaded MP3, as a
 *  base64 data: URI) — kept separate from `id`/`name` specifically so the
 *  clip behind a track can be swapped later (re-upload onto the same id)
 *  without re-pointing every room that references it. */
export interface TrackDef {
  id: string;
  name: string;
  dataUrl: string;
}

// Bundle of everything loaded
export interface Content {
  game: GameConfig;
  elements: ElementDef[];
  rules: RuleDef[];
  behaviors: BehaviorDef[];
  entityTypes: EntityTypeDef[];
  achievements: AchievementDef[];
  tiles: TileDef[];
  items: ItemDef[];
  recipes: RecipeDef[];
  enemies: EnemyDef[];
  taunts: TauntDef[];
  tracks: TrackDef[];
  campaign: CampaignDef;
  rooms: Record<string, RoomDef>;
}
