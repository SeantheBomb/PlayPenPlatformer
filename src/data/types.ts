// Schemas for all serialized content. Every gameplay-affecting value lives in
// content/*.json and flows through these types — code never hardcodes design data.

export interface GameConfig {
  title: string;
  subtitle: string;
  antagonist: { name: string; color: string };
  player: {
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
    dropMaterialsOnDeath: boolean;
    respawnInvulnMs: number;
    healAtCheckpoints: boolean;
    stunDurationMs: number;
    smokeBombRadius: number;
    idleTauntSeconds: number;
  };
  audio: { sfxVolume: number; muted: boolean };
}

export type TileStyle = "block" | "platform" | "spikes" | "cracked" | "spring" | "goo";

export interface TileDef {
  id: string;
  char: string;
  name: string;
  style: TileStyle;
  color: string;
  solid?: boolean;
  oneWay?: boolean;
  damage?: number;
  breakBy?: string; // capability string, e.g. "break:cracked"
  bounce?: number;  // upward launch velocity in px/s
  slow?: number;    // movement multiplier while overlapping
}

export type ItemKind = "material" | "tool" | "consumable" | "curio";
export type ItemShape =
  | "shard" | "plank" | "ring" | "cloth" | "ball" | "mushroom"
  | "cog" | "spring" | "tool" | "bottle";

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  shape: ItemShape;
  color: string;
  description: string;
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

export interface EnemyDef {
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
  description?: string;
}

export type TauntTrigger =
  | "game_start" | "room_enter" | "first_death" | "death"
  | "craft_fail" | "first_craft" | "craft_item" | "idle"
  | "hide_enter" | "npc_help" | "win";

export interface TauntDef {
  id: string;
  trigger: TauntTrigger;
  lines: string[];
  cooldownMs: number;
  chance: number;
  roomId?: string; // filter for room_enter
  itemId?: string; // filter for craft_item
}

// ---- Rooms ----

export type EntityType =
  | "spawn" | "checkpoint" | "pickup" | "note" | "door"
  | "locker" | "enemy" | "npc" | "exit";

export interface RoomEntity {
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
  locked?: boolean;
  gate?: boolean; // opens in place instead of teleporting
  // enemy
  enemy?: string;
  patrolMinX?: number;
  patrolMaxX?: number;
  // npc
  name?: string;
  color?: string;
  wants?: { item: string; count: number };
  rewardItems?: { item: string; count: number }[];
  rewardRecipes?: string[];
  dialogAsk?: string;
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
}

export interface CampaignDef {
  rooms: string[];
}

// Bundle of everything loaded
export interface Content {
  game: GameConfig;
  tiles: TileDef[];
  items: ItemDef[];
  recipes: RecipeDef[];
  enemies: EnemyDef[];
  taunts: TauntDef[];
  campaign: CampaignDef;
  rooms: Record<string, RoomDef>;
}
