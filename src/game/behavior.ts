// Behavior grammar interpreter: trigger -> conditions -> actions.
//
// Behaviors are named, composable rule bundles serialized in
// content/behaviors.json and attached to enemies, items, and entities (or
// registered as "global" parameter docs the sims read tunables from). Engine
// code provides the VOCABULARY — small single-purpose condition/action verbs
// registered here — and content wires which hosts run which rules with which
// params. That split is the whole point: adding/adjusting a behavior is a
// content deployment, adding a brand-new verb is a code deployment.
//
// Determinism rules (session replay): verbs must only read sim state, simNow()
// and the room's seeded RNG — never performance.now()/Math.random(). Anything
// registered here runs inside the fixed-step simulation.
import type {
  BehaviorAction, BehaviorAttachment, BehaviorCondition, BehaviorDef,
  BehaviorRef, BehaviorTrigger, Content, EnemyDef, ItemDef,
} from "../data/types";
import { simNow } from "../engine/simclock";

/** Caller-supplied handle into whatever the verbs need (RoomRuntime, the
 *  enemy instance, the player stub, Game glue...). Typed loosely on purpose:
 *  each dispatch site and its verbs agree on the shape; the interpreter
 *  itself never looks inside. */
export type BehaviorApi = Record<string, unknown>;

export interface BehaviorCtx {
  /** The host def whose fields "$host.field" references read. */
  hostDef: Record<string, unknown>;
  trigger: BehaviorTrigger;
  /** Trigger payload ("$data.field") — element for elementContact, charge
   *  for use, plus anything verbs stash for later rules (e.g. reaction). */
  data: Record<string, unknown>;
  /** Per-instance, per-behavior variables (initialized from def.vars). */
  vars: Record<string, unknown>;
  api: BehaviorApi;
  /** Set true to stop every further rule/behavior for this host this
   *  dispatch — the grammar's "continue"/early-return. */
  halt: boolean;
  /** Resolve an arg: "$now", "$host.x", "$data.x", "$var.x", "$param" (from
   *  the attachment's params, then the behavior's defaults), else literal. */
  arg(v: unknown): unknown;
  num(v: unknown, fallback: number): number;
  str(v: unknown, fallback: string): string;
  bool(v: unknown, fallback: boolean): boolean;
  /** Read a key out of an options-object arg (already resolving $refs). */
  opt(args: unknown[], key: string): unknown;
}

type ConditionFn = (ctx: BehaviorCtx, args: unknown[]) => boolean;
type ActionFn = (ctx: BehaviorCtx, args: unknown[]) => void;

const conditions = new Map<string, ConditionFn>();
const actions = new Map<string, ActionFn>();
const warned = new Set<string>();

/** Register a condition verb. Last registration wins (hot-reload safe). */
export function registerCondition(name: string, fn: ConditionFn): void {
  conditions.set(name, fn);
}

/** Register an action verb. Last registration wins (hot-reload safe). */
export function registerAction(name: string, fn: ActionFn): void {
  actions.set(name, fn);
}

/** Names for the editor's dropdowns. */
export function knownConditionNames(): string[] {
  return [...conditions.keys()].sort();
}
export function knownActionNames(): string[] {
  return [...actions.keys()].sort();
}

function warnOnce(kind: string, name: string): void {
  const key = kind + ":" + name;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[behavior] unknown ${kind} "${name}" — rule skipped`);
}

export function normalizeAttachment(a: BehaviorAttachment): BehaviorRef {
  return typeof a === "string" ? { id: a } : a;
}

export class BehaviorSystem {
  private byId = new Map<string, BehaviorDef>();
  /** hostKey|behaviorId -> per-instance vars */
  private varsByKey = new Map<string, Record<string, unknown>>();

  constructor(content: Pick<Content, "behaviors">) {
    for (const b of content.behaviors ?? []) this.byId.set(b.id, b);
  }

  get(id: string): BehaviorDef | undefined {
    return this.byId.get(id);
  }

  /** Behavior docs that auto-attach to this entity type (content order). */
  entityAttachments(entityType: string): BehaviorRef[] {
    const out: BehaviorRef[] = [];
    for (const b of this.byId.values()) {
      if (b.attachTo?.entities?.includes(entityType as never)) out.push({ id: b.id });
    }
    return out;
  }

  /** Merged params (attachment overrides > behavior defaults) for one
   *  attached behavior — for code that needs to READ a tunable outside a
   *  dispatch (vision-cone drawing, global sim params). $host/$data refs are
   *  NOT resolved here; pass hostDef to resolve $host. */
  resolvedParams(
    attachments: BehaviorAttachment[], behaviorId: string,
    hostDef: Record<string, unknown> = {}
  ): Record<string, unknown> | null {
    const att = attachments.map(normalizeAttachment).find((a) => a.id === behaviorId);
    const def = this.byId.get(behaviorId);
    if (!att || !def) return null;
    const merged = { ...(def.params ?? {}), ...(att.params ?? {}) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(merged)) {
      out[k] = typeof v === "string" && v.startsWith("$host.")
        ? hostDef[v.slice(6)]
        : v;
    }
    return out;
  }

  /** Params of a "global" behavior doc (fluid_flow, heat_spread...). Returns
   *  {} when the doc is missing so callers can `?? fallback` every read. */
  globalParams(behaviorId: string): Record<string, unknown> {
    return this.byId.get(behaviorId)?.params ?? {};
  }

  /** Does any attached behavior carry this tag? (e.g. "sight") */
  hasTag(attachments: BehaviorAttachment[], tag: string): boolean {
    return attachments.some((a) => this.byId.get(normalizeAttachment(a).id)?.tags?.includes(tag));
  }

  /** First attached behavior carrying this tag (for reading its params). */
  taggedAttachment(attachments: BehaviorAttachment[], tag: string): BehaviorRef | null {
    for (const a of attachments) {
      const ref = normalizeAttachment(a);
      if (this.byId.get(ref.id)?.tags?.includes(tag)) return ref;
    }
    return null;
  }

  /** Drop all per-instance vars (room reload). */
  resetVars(): void {
    this.varsByKey.clear();
  }

  /**
   * Dispatch one trigger to a host's attachment list. Rules run in
   * attachment order, then rule order; a halting action stops everything
   * for this host. Returns whether the dispatch was halted — callers use it
   * as their `continue` (a killed enemy, a consumed use).
   */
  fire(
    trigger: BehaviorTrigger,
    opts: {
      hostDef: Record<string, unknown>;
      hostKey: string;
      attachments: BehaviorAttachment[];
      data?: Record<string, unknown>;
      api?: BehaviorApi;
    }
  ): boolean {
    const data = opts.data ?? {};
    const api = opts.api ?? {};
    let halted = false;
    for (const a of opts.attachments) {
      const ref = normalizeAttachment(a);
      const def = this.byId.get(ref.id);
      if (!def) continue;
      let ctx: BehaviorCtx | null = null;
      for (const rule of def.rules) {
        if (rule.on !== trigger) continue;
        ctx ??= this.makeCtx(def, ref, opts.hostDef, opts.hostKey, trigger, data, api);
        if (rule.if && !rule.if.every((c) => this.evalCondition(ctx!, c))) continue;
        for (const act of rule.do) {
          this.runAction(ctx, act);
          if (ctx.halt) break;
        }
        if (ctx.halt) {
          halted = true;
          break;
        }
      }
      if (halted) break;
    }
    return halted;
  }

  private evalCondition(ctx: BehaviorCtx, cond: BehaviorCondition): boolean {
    const [name, ...args] = cond;
    if (name === "not") {
      // Built-in combinator: ["not", ["someCondition", ...]]
      const inner = args[0] as BehaviorCondition | undefined;
      return inner ? !this.evalCondition(ctx, inner) : true;
    }
    if (name === "anyOf") {
      return args.some((c) => this.evalCondition(ctx, c as BehaviorCondition));
    }
    const fn = conditions.get(name);
    if (!fn) {
      warnOnce("condition", name);
      return false;
    }
    try {
      return fn(ctx, args);
    } catch (e) {
      warnOnce("condition-error", name + ": " + String(e));
      return false;
    }
  }

  private runAction(ctx: BehaviorCtx, act: BehaviorAction): void {
    const [name, ...args] = act;
    if (name === "halt") {
      ctx.halt = true;
      return;
    }
    const fn = actions.get(name);
    if (!fn) {
      warnOnce("action", name);
      return;
    }
    try {
      fn(ctx, args);
    } catch (e) {
      // A bad content-authored rule must never take down the rAF loop.
      warnOnce("action-error", name + ": " + String(e));
    }
  }

  private makeCtx(
    def: BehaviorDef, ref: BehaviorRef, hostDef: Record<string, unknown>,
    hostKey: string, trigger: BehaviorTrigger,
    data: Record<string, unknown>, api: BehaviorApi
  ): BehaviorCtx {
    const varsKey = hostKey + "|" + def.id;
    let vars = this.varsByKey.get(varsKey);
    if (!vars) {
      vars = { ...(def.vars ?? {}) };
      this.varsByKey.set(varsKey, vars);
    }
    const resolve = (v: unknown, depth = 0): unknown => {
      if (typeof v !== "string" || !v.startsWith("$") || depth > 4) return v;
      if (v === "$now") return simNow();
      if (v.startsWith("$host.")) return hostDef[v.slice(6)];
      if (v.startsWith("$data.")) return data[v.slice(6)];
      if (v.startsWith("$var.")) return vars![v.slice(5)];
      const name = v.slice(1);
      const raw = ref.params && name in ref.params
        ? ref.params[name]
        : def.params?.[name];
      return resolve(raw, depth + 1);
    };
    const ctx: BehaviorCtx = {
      hostDef, trigger, data, vars, api, halt: false,
      arg: (v) => resolve(v),
      num: (v, fb) => {
        const r = resolve(v);
        return typeof r === "number" && Number.isFinite(r) ? r : fb;
      },
      str: (v, fb) => {
        const r = resolve(v);
        return typeof r === "string" ? r : fb;
      },
      bool: (v, fb) => {
        const r = resolve(v);
        return typeof r === "boolean" ? r : fb;
      },
      opt: (args, key) => {
        const o = args[0];
        if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
        return resolve((o as Record<string, unknown>)[key]);
      },
    };
    return ctx;
  }
}

// ---------------------------------------------------------------------------
// Legacy mappings: defs without an explicit `behaviors` list get the exact
// attachment set that reproduces the pre-grammar hardcoded behavior. Shipped
// content carries explicit lists; these keep stale saves and hand-rolled
// content working unchanged.
// ---------------------------------------------------------------------------

export function enemyAttachments(def: EnemyDef): BehaviorAttachment[] {
  if (def.behaviors) return def.behaviors;
  const wake = def.behavior === "patrol" ? "patrol" : "return";
  const list: BehaviorAttachment[] = [
    "hazard_reactions",
    "element_reactions",
    { id: "stun_cycle", params: { wakeTo: wake } },
  ];
  if (def.behavior === "chase") {
    list.push({
      id: "chase_on_sight",
      params: { giveUpTo: def.returnsHome ? "return" : "patrol" },
    });
  }
  list.push("patrol_route", "return_home", "grounded_move");
  if (def.trappable) list.push("trappable");
  return list;
}

/** The state resetEnemies/respawn puts an enemy back into: the stun_cycle
 *  wake target (patrol for patrollers, return for homebound chasers). */
export function enemyResetState(sys: BehaviorSystem, def: EnemyDef): "patrol" | "return" {
  const p = sys.resolvedParams(enemyAttachments(def), "stun_cycle", def as never);
  return p?.wakeTo === "return" ? "return" : "patrol";
}

export function itemAttachments(def: ItemDef): BehaviorAttachment[] {
  if (def.behaviors) return def.behaviors;
  const list: BehaviorAttachment[] = [];
  switch (def.useMode) {
    case "swing": list.push("use_swing"); break;
    case "splash": list.push("use_splash"); break;
    case "place": list.push("use_place"); break;
    case "burst": list.push("use_burst"); break;
  }
  if (def.dousedBy) list.push("doused_in_liquid");
  // Mirrors the old held-item if/else: an unlit carrier lights itself; a
  // lit fire carrier lights braziers instead.
  if (def.igniteTo) list.push("ignites_near_fire");
  else if (def.element === "fire") list.push("lights_braziers");
  return list;
}
