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
    smokeThrowVx: number;      // bomb throw velocity, px/s
    smokeThrowVy: number;      // bomb throw upward velocity, px/s
    idleTauntSeconds: number;
    idleChaseSeconds: number;   // idle this long and the Warden comes for you
    wardenIdleSpeed: number;    // px/s while punishing idlers
    waterFlowEnabled: boolean;  // water falls into open shafts, spreads along floors
    airBlips: number;           // breath capacity while underwater
    airLossSeconds: number;     // seconds per blip lost while submerged
    drownSeconds: number;       // seconds per heart lost once air runs out
  };
  audio: { sfxVolume: number; muted: boolean };
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
  actor: string;           // element id applying the effect
  target?: string;         // element id of the target tile...
  targetProperty?: string; // ...or a tile property: flammable | brittle | conductive
  effect: RuleEffect;
  note?: string;
}

export type EnemyReaction = "kill" | "stun" | "knockback" | "none";

export type TileStyle =
  | "block" | "platform" | "spikes" | "cracked" | "spring" | "goo"
  | "wood" | "ice" | "water" | "fire" | "metal" | "waterfall" | "drain"
  | "lava" | "lavafall";

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
  slow?: number;    // movement multiplier while overlapping (sticky)
  wade?: number;    // movement multiplier while overlapping (liquid)
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
  // Loot: destructive transforms (melt/shatter/dissolve/burn) drop this item
  dropsItem?: string;
}

export type ItemKind = "material" | "tool" | "consumable" | "curio";
export type ItemShape =
  | "shard" | "plank" | "ring" | "cloth" | "ball" | "mushroom"
  | "cog" | "spring" | "coil" | "tool" | "bottle" | "torch" | "bucket" | "rod";

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
  fillsTo?: string;      // item id this becomes when swung at water (bucket)
  emptiesTo?: string;    // item id this reverts to after a splash
  placeType?: "spring" | "trap";
  capabilities?: string[];
  params?: Record<string, number>;
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
  behavior: EnemyBehavior;
  width: number;
  height: number;
  color: string;
  eyeColor: string;
  speed: number;
  damage: number;
  chaseSpeed?: number;
  sightRange?: number;
  loseTargetMs?: number;
  returnsHome?: boolean;
  turnAtEdges?: boolean;
  stunnable?: boolean;
  trappable?: boolean;
  element?: string;
  reactions?: Record<string, EnemyReaction>; // element id -> what happens
  description?: string;
}

export type TauntTrigger =
  | "game_start" | "room_enter" | "first_death" | "death"
  | "craft_fail" | "first_craft" | "craft_item" | "idle"
  | "hide_enter" | "npc_help" | "confiscate" | "warden_chase" | "win";

// ---- Achievements ----

export type AchievementTrigger =
  | "craft_item"  // itemId filter
  | "pickup_item" // itemId filter (hidden curios)
  | "counter"     // counter name reaches count
  | "npc_help"
  | "win";        // optional maxDeaths / maxSeconds filters

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
  | "spawn" | "checkpoint" | "pickup" | "note" | "door"
  | "locker" | "enemy" | "npc" | "exit" | "hint"
  | "brazier" | "fusebox";

export interface RoomEntity extends SpriteFields {
  type: EntityType;
  x: number; // tile coords
  y: number;
  // pickup
  item?: string;
  count?: number;
  // note
  recipe?: string;
  text?: string;
  // door
  to?: string; // room id or "next"
  gate?: boolean;  // opens in place instead of teleporting
  fuseId?: string; // gate opens when a fusebox with the same fuseId is energized
  // enemy
  enemy?: string;
  patrolMinX?: number;
  patrolMaxX?: number;
  // brazier
  lit?: boolean; // default true; author false for a cold brazier the player must light
  // npc
  name?: string;
  color?: string;
  portrait?: string; // data-URI override for the dialog portrait
  // `sprite`/`spriteFrames` (from SpriteFields, above) override this NPC's
  // in-room body — separate from `portrait`, which is the dialog-box face.
  wants?: { item: string; count: number };
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
  /** Boss mode: the Warden spawns and chases through walls. */
  wardenChase?: { speed: number; delayMs: number };
}

export interface CampaignDef {
  rooms: string[];
}

// Bundle of everything loaded
export interface Content {
  game: GameConfig;
  elements: ElementDef[];
  rules: RuleDef[];
  achievements: AchievementDef[];
  tiles: TileDef[];
  items: ItemDef[];
  recipes: RecipeDef[];
  enemies: EnemyDef[];
  taunts: TauntDef[];
  campaign: CampaignDef;
  rooms: Record<string, RoomDef>;
}
