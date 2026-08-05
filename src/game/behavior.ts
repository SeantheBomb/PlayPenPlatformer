// Behavior runtime: executes penscript behaviors attached to enemies, items,
// and entities (plus "global" tunables docs the sims read fields from).
//
// A behavior doc (content/behaviors.json) is { id, host, tags?, script } where
// script is penscript source (stored as lines). Top-level `var`s are the
// behavior's FIELDS: evaluated per attached instance (so `host.speed` refs
// resolve against that def), overridable per attachment via BehaviorRef.params
// — the Unity public-field model — and mutable at runtime as per-instance
// state. Engine capability comes only from functions registered here with
// registerFn, which is what keeps scripts replay-deterministic: there is no
// wall clock or Math.random for a script to reach; `now` is simNow().
//
// Dispatch model: fire(trigger, ...) runs every matching `on <trigger>`
// handler across the host's attachments, in attachment order. `return` ends
// one handler; `halt` consumes the whole dispatch (the caller treats it as
// its `continue` — a killed enemy, a spent use).
import type {
  BehaviorAttachment, BehaviorDef, BehaviorRef, BehaviorTrigger,
  Content, EnemyDef, ItemDef,
} from "../data/types";
import { simNow } from "../engine/simclock";
import {
  compileScript, type CompiledScript, type Expr, type ScriptError, type Stmt,
} from "./penscript";

/** Caller-supplied handle the registered functions reach into (RoomRuntime,
 *  the enemy instance, Game glue...). Typed loosely on purpose: each dispatch
 *  site and its functions agree on the shape; the runtime never looks inside. */
export type BehaviorApi = Record<string, unknown>;

/** Named values a dispatch site exposes to scripts (enemy `state`, brazier
 *  `lit`). Reads go through get, assignments through set. */
export type BehaviorBuiltins = Record<string, {
  get: () => unknown;
  set?: (v: unknown) => void;
}>;

export interface ScriptCtx {
  hostDef: Record<string, unknown>;
  data: Record<string, unknown>;
  api: BehaviorApi;
  /** Set true by a function to consume the dispatch (same as `halt`). */
  halt: boolean;
}

type ScriptFn = (ctx: ScriptCtx, args: unknown[]) => unknown;

const fns = new Map<string, { fn: ScriptFn; doc: string }>();
const warned = new Set<string>();

/** Register an engine function callable from scripts. Positional args.
 *  `doc` feeds the editor's tooltips/legend — lead with the signature. */
export function registerFn(name: string, fn: ScriptFn, doc = ""): void {
  fns.set(name, { fn, doc });
}

/** Function names for the editor legend / linting. */
export function knownFnNames(): string[] {
  return [...fns.keys()].sort();
}
export function isKnownFn(name: string): boolean {
  return fns.has(name);
}
/** The doc string a function was registered with (editor tooltips). */
export function fnDoc(name: string): string {
  return fns.get(name)?.doc ?? "";
}

export const TRIGGERS: BehaviorTrigger[] = [
  "tick", "flowTick", "elementContact", "use", "heldTick", "carriedTick",
  "pickSide", "sourcedSpread", "fluidContact", "meltChain", "recede",
];

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[behavior] ${message}`);
}

export function normalizeAttachment(a: BehaviorAttachment): BehaviorRef {
  return typeof a === "string" ? { id: a } : a;
}

export function scriptSource(def: BehaviorDef): string {
  return Array.isArray(def.script) ? def.script.join("\n") : String(def.script ?? "");
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

interface Env {
  ctx: ScriptCtx;
  /** Per-instance behavior fields (top-level vars). */
  fields: Record<string, unknown>;
  /** Handler-scope locals (payload params + `var` inside handlers). */
  locals: Record<string, unknown>;
  builtins: BehaviorBuiltins;
  docId: string;
  returned: boolean;
}

function truthy(v: unknown): boolean {
  return !!v;
}

function evalExpr(e: Expr, env: Env): unknown {
  switch (e.k) {
    case "num": return e.v;
    case "str": return e.v;
    case "bool": return e.v;
    case "null": return null;
    case "ident": {
      const n = e.name;
      if (n in env.locals) return env.locals[n];
      if (n in env.fields) return env.fields[n];
      if (n === "now") return simNow();
      if (n === "host") return env.ctx.hostDef;
      if (n === "player") return "player";
      if (n === "home") return "home";
      const b = env.builtins[n];
      if (b) return b.get();
      if (n in env.ctx.data) return env.ctx.data[n];
      warnOnce(`ident:${env.docId}:${n}`, `${env.docId}: unknown name "${n}" (line ${e.line}) — treated as null`);
      return null;
    }
    case "member": {
      const obj = evalExpr(e.obj, env);
      if (obj === null || obj === undefined || typeof obj !== "object") return undefined;
      return (obj as Record<string, unknown>)[e.prop];
    }
    case "call": {
      const entry = fns.get(e.name);
      if (!entry) {
        warnOnce(`fn:${e.name}`, `unknown function "${e.name}" (in ${env.docId}, line ${e.line})`);
        return undefined;
      }
      const args = e.args.map((a) => evalExpr(a, env));
      return entry.fn(env.ctx, args);
    }
    case "un": {
      const v = evalExpr(e.e, env);
      return e.op === "!" ? !truthy(v) : -(typeof v === "number" ? v : Number(v ?? 0));
    }
    case "bin": {
      const op = e.op;
      if (op === "&&") return truthy(evalExpr(e.l, env)) ? evalExpr(e.r, env) : false;
      if (op === "||") {
        const l = evalExpr(e.l, env);
        return truthy(l) ? l : evalExpr(e.r, env);
      }
      if (op === "??") {
        const l = evalExpr(e.l, env);
        return l === null || l === undefined ? evalExpr(e.r, env) : l;
      }
      const l = evalExpr(e.l, env);
      const r = evalExpr(e.r, env);
      // A missing host/tile field reads back as undefined (member access
      // above), but scripts write the idiomatic "field != null" — treat
      // null and undefined as the same absence here (like ?? just above),
      // or every "host.igniteTo != null"-style guard misfires true for any
      // item that simply doesn't define that field.
      const nullish = (v: unknown) => v === null || v === undefined;
      switch (op) {
        case "==": return nullish(l) || nullish(r) ? nullish(l) === nullish(r) : l === r;
        case "!=": return nullish(l) || nullish(r) ? nullish(l) !== nullish(r) : l !== r;
        case "<": return (l as number) < (r as number);
        case ">": return (l as number) > (r as number);
        case "<=": return (l as number) <= (r as number);
        case ">=": return (l as number) >= (r as number);
        case "+": return (l as number) + (r as number);
        case "-": return (l as number) - (r as number);
        case "*": return (l as number) * (r as number);
        case "/": return (l as number) / (r as number);
        case "%": return (l as number) % (r as number);
      }
      return undefined;
    }
    case "cond":
      return truthy(evalExpr(e.c, env)) ? evalExpr(e.t, env) : evalExpr(e.f, env);
  }
}

function runStmts(stmts: Stmt[], env: Env): void {
  for (const s of stmts) {
    if (env.ctx.halt || env.returned) return;
    switch (s.k) {
      case "var":
        env.locals[s.name] = evalExpr(s.init, env);
        break;
      case "assign": {
        const n = s.name;
        const v = evalExpr(s.e, env);
        if (n in env.locals) env.locals[n] = v;
        else if (n in env.fields) env.fields[n] = v;
        else if (env.builtins[n]?.set) env.builtins[n].set!(v);
        else {
          warnOnce(`assign:${env.docId}:${n}`,
            `${env.docId}: assignment to unknown name "${n}" (line ${s.line}) — declare it with var first`);
        }
        break;
      }
      case "if":
        if (truthy(evalExpr(s.c, env))) runStmts(s.then, env);
        else if (s.else) runStmts(s.else, env);
        break;
      case "expr":
        evalExpr(s.e, env);
        break;
      case "halt":
        env.ctx.halt = true;
        return;
      case "return":
        env.returned = true;
        return;
    }
  }
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

interface CompiledDoc {
  def: BehaviorDef;
  script: CompiledScript | null;
  errors: ScriptError[];
}

export class BehaviorSystem {
  private docs = new Map<string, CompiledDoc>();
  /** hostKey|docId -> per-instance fields */
  private fieldsByKey = new Map<string, Record<string, unknown>>();
  private entityTypesById = new Map<string, { behaviors?: BehaviorAttachment[] }>();

  constructor(content: Pick<Content, "behaviors"> & Partial<Pick<Content, "entityTypes">>) {
    for (const def of content.behaviors ?? []) {
      const src = scriptSource(def);
      const { script, errors } = compileScript(src);
      if (errors.length > 0) {
        warnOnce(`compile:${def.id}`,
          `behavior "${def.id}" has ${errors.length} error(s); first: line ${errors[0].line}: ${errors[0].message}`);
      }
      this.docs.set(def.id, { def, script: errors.length === 0 ? script : null, errors });
    }
    for (const et of content.entityTypes ?? []) {
      this.entityTypesById.set(et.id, et);
    }
  }

  get(id: string): BehaviorDef | undefined {
    return this.docs.get(id)?.def;
  }

  /** Compile diagnostics for the editor. */
  errorsFor(id: string): ScriptError[] {
    return this.docs.get(id)?.errors ?? [];
  }

  /** Does this doc define an `on <trigger>` handler? Policy-hook call sites
   *  need this to tell "handler ran and chose to do nothing" (a meaningful
   *  decision — e.g. meltChain not calling keepHot stops the chain) apart
   *  from "no handler at all" (fall back to legacy engine behavior). */
  hasHandler(docId: string, trigger: BehaviorTrigger): boolean {
    const doc = this.docs.get(docId);
    return !!doc?.script?.handlers.some((h) => h.event === trigger);
  }

  /** Behavior attachments for an entity TYPE (brazier, door...), from
   *  entities.json — per-def, exactly like enemies/items. */
  entityAttachments(entityType: string): BehaviorAttachment[] {
    return this.entityTypesById.get(entityType)?.behaviors ?? [];
  }

  /** Does any attached behavior carry this tag? (e.g. "sight") */
  hasTag(attachments: BehaviorAttachment[], tag: string): boolean {
    return attachments.some((a) => this.docs.get(normalizeAttachment(a).id)?.def.tags?.includes(tag));
  }

  /** First attached behavior carrying this tag (for reading its fields). */
  taggedAttachment(attachments: BehaviorAttachment[], tag: string): BehaviorRef | null {
    for (const a of attachments) {
      const ref = normalizeAttachment(a);
      if (this.docs.get(ref.id)?.def.tags?.includes(tag)) return ref;
    }
    return null;
  }

  /**
   * A doc's field values as configured (initializers evaluated against
   * hostDef, attachment params winning) — for engine code that reads
   * tunables outside a dispatch: global docs (fluid_flow...), sight-cone
   * drawing, reset states. Initializers may reference earlier fields.
   */
  resolvedFields(
    docId: string,
    hostDef: Record<string, unknown> = {},
    attParams?: Record<string, unknown>
  ): Record<string, unknown> {
    const doc = this.docs.get(docId);
    if (!doc?.script) return {};
    const out: Record<string, unknown> = {};
    const env: Env = {
      ctx: { hostDef, data: {}, api: {}, halt: false },
      fields: out, locals: {}, builtins: {}, docId, returned: false,
    };
    for (const f of doc.script.fields) {
      out[f.name] = attParams && f.name in attParams
        ? attParams[f.name]
        : evalExpr(f.init, env);
    }
    return out;
  }

  /** Fields of a global tunables doc (fluidFlow, heatSpread...). */
  globalParams(docId: string): Record<string, unknown> {
    return this.resolvedFields(docId);
  }

  /** All fields of one ATTACHED behavior, resolved (attachment overrides
   *  win) — null when the behavior isn't attached or didn't compile. */
  attachedFields(
    attachments: BehaviorAttachment[], docId: string,
    hostDef: Record<string, unknown>
  ): Record<string, unknown> | null {
    const att = attachments.map(normalizeAttachment).find((a) => a.id === docId);
    if (!att || !this.docs.get(docId)?.script) return null;
    return this.resolvedFields(docId, hostDef, att.params);
  }

  /** One field of one attached behavior, resolved (attachment override or
   *  initializer default). */
  fieldValue(
    attachments: BehaviorAttachment[], docId: string, field: string,
    hostDef: Record<string, unknown>
  ): unknown {
    return this.attachedFields(attachments, docId, hostDef)?.[field];
  }

  /** Drop per-instance fields — room reload, or scoped by key prefix
   *  (resetEnemies drops "enemy:*" so seenAt-style state restarts fresh). */
  resetInstances(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.fieldsByKey.clear();
      return;
    }
    for (const key of [...this.fieldsByKey.keys()]) {
      if (key.startsWith(keyPrefix)) this.fieldsByKey.delete(key);
    }
  }

  /**
   * Dispatch one trigger to a host's attachments. Handlers run in attachment
   * order, then script order; `halt` consumes everything. Returns whether
   * the dispatch was halted.
   */
  fire(
    trigger: BehaviorTrigger,
    opts: {
      hostDef: Record<string, unknown>;
      hostKey: string;
      attachments: BehaviorAttachment[];
      data?: Record<string, unknown>;
      api?: BehaviorApi;
      builtins?: BehaviorBuiltins;
    }
  ): boolean {
    const ctx: ScriptCtx = {
      hostDef: opts.hostDef,
      data: opts.data ?? {},
      api: opts.api ?? {},
      halt: false,
    };
    const builtins = opts.builtins ?? {};
    for (const a of opts.attachments) {
      const ref = normalizeAttachment(a);
      const doc = this.docs.get(ref.id);
      if (!doc?.script) continue;
      let fields: Record<string, unknown> | undefined;
      for (const h of doc.script.handlers) {
        if (h.event !== trigger) continue;
        fields ??= this.instanceFields(opts.hostKey, ref, doc, ctx, builtins);
        const locals: Record<string, unknown> = {};
        for (const p of h.params) locals[p] = ctx.data[p];
        const env: Env = { ctx, fields, locals, builtins, docId: ref.id, returned: false };
        try {
          runStmts(h.body, env);
        } catch (err) {
          // A content-authored script must never take down the rAF loop.
          warnOnce(`run:${ref.id}:${trigger}`, `${ref.id}.on ${trigger} threw: ${String(err)}`);
        }
        if (ctx.halt) return true;
      }
    }
    return false;
  }

  private instanceFields(
    hostKey: string, ref: BehaviorRef, doc: CompiledDoc,
    ctx: ScriptCtx, builtins: BehaviorBuiltins
  ): Record<string, unknown> {
    const key = hostKey + "|" + ref.id;
    let fields = this.fieldsByKey.get(key);
    if (!fields) {
      fields = {};
      const env: Env = { ctx, fields, locals: {}, builtins, docId: ref.id, returned: false };
      for (const f of doc.script!.fields) {
        fields[f.name] = ref.params && f.name in ref.params
          ? ref.params[f.name]
          : evalExpr(f.init, env);
      }
      this.fieldsByKey.set(key, fields);
    }
    return fields;
  }
}

// ---------------------------------------------------------------------------
// Legacy mappings: defs without an explicit `behaviors` list get the exact
// attachment set that reproduces the pre-grammar hardcoded behavior. Shipped
// content carries explicit lists; these keep stale saves working unchanged.
// ---------------------------------------------------------------------------

export function enemyAttachments(def: EnemyDef): BehaviorAttachment[] {
  if (def.behaviors) return def.behaviors;
  // Fallback for content that predates the behaviors[] list entirely —
  // every current enemy (and the editor's new-enemy template) always sets
  // an explicit list, so this path is untested-in-practice safety net only.
  // returnsHome/trappable/reactions no longer exist on EnemyDef; read them
  // loosely in case ancient stale JSON still carries them. Note this can't
  // recover a stale enemy's old flat `reactions` table (elementReactions
  // now owns that data itself) — a truly pre-behaviors save falls back to
  // an empty reactions map, same as any fresh enemy with no params set.
  const raw = def as unknown as Record<string, unknown>;
  const wake = def.behavior === "patrol" ? "patrol" : "return";
  const list: BehaviorAttachment[] = [
    "hazardReactions",
    "elementReactions",
    { id: "stunCycle", params: { wakeTo: wake } },
  ];
  if (def.behavior === "chase") {
    list.push({
      id: "chaseOnSight",
      params: { giveUpTo: raw.returnsHome ? "return" : "patrol" },
    });
  }
  list.push("patrolRoute", "returnHome", "groundedMove");
  if (raw.trappable) list.push("trappable");
  return list;
}

/** The state resetEnemies/respawn puts an enemy back into: stunCycle's
 *  wakeTo (patrol for patrollers, return for homebound chasers). */
export function enemyResetState(sys: BehaviorSystem, def: EnemyDef): "patrol" | "return" {
  const v = sys.fieldValue(
    enemyAttachments(def), "stunCycle", "wakeTo", def as unknown as Record<string, unknown>
  );
  return v === "return" ? "return" : "patrol";
}

export function itemAttachments(def: ItemDef): BehaviorAttachment[] {
  if (def.behaviors) return def.behaviors;
  const list: BehaviorAttachment[] = [];
  switch (def.useMode) {
    case "swing": list.push("useSwing"); break;
    case "splash": list.push("useSplash"); break;
    case "place": list.push("usePlace"); break;
    case "burst": list.push("useBurst"); break;
  }
  if (def.dousedBy) list.push("dousedInLiquid");
  // Mirrors the old held-item if/else: an unlit carrier lights itself; a
  // lit fire carrier lights braziers instead.
  if (def.igniteTo) list.push("ignitesNearFire");
  else if (def.element === "fire") list.push("lightsBraziers");
  return list;
}
