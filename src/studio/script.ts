// Writers Studio — the Master Script model. Pure (no DOM): walks the
// campaign in order and lays out every scripted story beat as a screenplay
// — stage directions generated from what the game actually does, and the
// lines the writer owns (NPC dialog slots, notes, Warden taunts) as editable
// beats, each carrying a STABLE KEY for the game event it belongs to:
//
//   npc:<roomId>:<npcId>:<slot>   (npcId#n when a room has two of the same)
//   note:<roomId>@<x>,<y>          (same (type, x, y) match as the writer scope)
//   taunt:<tauntId>
//
// Keys never involve scene numbers or line positions, which is why a
// reordered campaign or a moved resident can't scramble the writer's work —
// see scriptview.ts for the page and tests/master-script.test.ts for the
// contract. Branching (requiresHelped / hiddenIfHelped) is modelled as
// branch blocks and IF-HELPED / IF-NOT alternates, and each quest-giver's
// "helped" flag as a story thread from the hand-over to every beat gated on
// it. Mirrors the game's own rules (game.ts talkToNpc/giveNpc): a talk-only
// resident can never be helped, so their dialogAfter never plays.
import type { Content, RoomDef, RoomEntity, TauntDef, TauntTrigger } from "../data/types";

export type DialogSlot = "dialogAsk" | "dialogConfirm" | "dialogDone" | "dialogAfter";

export type BeatTarget =
  | { kind: "npc"; roomId: string; entityIndex: number; slot: DialogSlot }
  | { kind: "note"; roomId: string; entityIndex: number }
  | { kind: "taunt"; tauntId: string };

/** A storyboard frame, drawn by the view through the real room renderer. */
export type FrameSpec =
  | { type: "close"; roomId: string; x: number; y: number; label: string; npcIds?: string[] }
  | { type: "recipe"; recipeId: string; label: string };

export interface StructFlag { level: "warn" | "bad"; text: string }

export interface Beat {
  kind: "dir" | "cond" | "line" | "warden" | "skip" | "stub" | "alt";
  /** dir / cond / skip / stub: the generated (read-only) text. */
  text?: string;
  /** Editable beats: the stable event key. */
  key?: string;
  target?: BeatTarget;
  gutter?: string;
  cue?: string;
  paren?: string;
  npcId?: string;
  /** The Give / Keep choice appears under this line. */
  choice?: boolean;
  /** A Warden pool that plays in many places (confiscation, npc_help). */
  shared?: boolean;
  where?: string;
  mapping?: string;
  frame?: FrameSpec;
  /** Set on every beat inside a branch block. */
  branch?: string;
  /** Set on the first beat of a branch block: what the branch needs. */
  branchHead?: string;
  /** Structural problems the game data implies (not voice lint). */
  flags?: StructFlag[];
  /** alt: side-by-side versions of one moment. */
  columns?: { label: string; beats: Beat[]; empty?: string }[];
}

export interface Scene {
  roomId: string;
  name: string;
  /** 1-based position in the campaign as it is now. */
  num: number;
  beats: Beat[];
  /** Residents present on this run (for the wide shot). */
  cast: string[];
  inDemo: boolean;
}

export interface Thread {
  npcId: string;
  name: string;
  color: string;
  /** Key of the JUST DONE line where #67 helps them (null: never helpable). */
  startKey: string | null;
  startRoom: string | null;
  deps: { key: string; roomId: string; early: boolean }[];
}

export interface ScriptModel {
  scenes: Scene[];
  ending: Beat[];
  threads: Thread[];
  /** Every editable npc/note key in the campaign (any branch), for orphan detection. */
  lineKeys: Set<string>;
  /** npcId -> roomId of the scene where the player first meets them (every branch). */
  firstMeet: Record<string, string>;
}

/** null = read every branch at once; a set = one specific run. */
export type Lens = ReadonlySet<string> | null;

const isQuest = (e: RoomEntity) => !!e.wants || !!e.roomQuest;
const gated = (e: RoomEntity) => !!(e.requiresHelped?.length || e.hiddenIfHelped?.length);

/** Does this entity exist on a run where exactly `helped` were helped?
 *  Same test as RoomRuntime's spawn gating. */
export function presentOnRun(e: RoomEntity, helped: ReadonlySet<string>): boolean {
  if (e.requiresHelped?.some((id) => !helped.has(id))) return false;
  if (e.hiddenIfHelped?.some((id) => helped.has(id))) return false;
  return true;
}

const gateSig = (e: RoomEntity) =>
  `+${[...(e.requiresHelped ?? [])].sort().join(",")}|-${[...(e.hiddenIfHelped ?? [])].sort().join(",")}`;

/** Stable reference for an NPC within its room: npcId, disambiguated only
 *  when a room holds two entities with the same npcId. */
export function npcRef(room: RoomDef, entityIndex: number): string {
  const e = room.entities[entityIndex];
  if (!e.npcId) return `#${entityIndex}`;
  const same = room.entities.map((x, i) => [x, i] as const).filter(([x]) => x.type === "npc" && x.npcId === e.npcId);
  if (same.length < 2) return e.npcId;
  return `${e.npcId}#${same.findIndex(([, i]) => i === entityIndex) + 1}`;
}

export const npcKey = (room: RoomDef, entityIndex: number, slot: DialogSlot) =>
  `npc:${room.id}:${npcRef(room, entityIndex)}:${slot}`;
export const noteKey = (room: RoomDef, e: RoomEntity) => `note:${room.id}@${e.x},${e.y}`;
export const tauntKey = (t: TauntDef) => `taunt:${t.id}`;

/** Every quest-giver's npcId — the residents a run can "help". */
export function helpableNpcs(content: Content): string[] {
  const out: string[] = [];
  for (const id of content.campaign?.rooms ?? []) {
    for (const e of content.rooms[id]?.entities ?? []) {
      if (e.type === "npc" && e.npcId && isQuest(e) && !out.includes(e.npcId)) out.push(e.npcId);
    }
  }
  return out;
}

function npcDisplay(content: Content): Map<string, { name: string; color: string }> {
  const m = new Map<string, { name: string; color: string }>();
  for (const room of Object.values(content.rooms)) {
    for (const e of room.entities) {
      if (e.type === "npc" && e.npcId && !m.has(e.npcId)) m.set(e.npcId, { name: e.name ?? e.npcId, color: e.color ?? "#7fd8e8" });
    }
  }
  return m;
}

const subjectSig = (text: string | undefined) => text?.match(/Subject\s*#\s*(\d+)/i)?.[1];

export function buildScript(content: Content, lens: Lens = null): ScriptModel {
  const order = (content.campaign?.rooms ?? []).filter((id) => content.rooms[id]);
  const demoRooms = content.campaign?.demo?.rooms ?? [];
  const people = npcDisplay(content);
  const nameOf = (id: string) => people.get(id)?.name ?? id;
  const live = (trigger: TauntTrigger, roomId?: string) =>
    content.taunts.filter((t) => t.trigger === trigger && !t.removed && (roomId === undefined || t.roomId === roomId));
  const itemName = (id: string) => content.items.find((i) => i.id === id)?.name ?? id;
  const recipeName = (rid: string) => {
    const r = content.recipes.find((x) => x.id === rid);
    return r ? itemName(r.output) : rid;
  };
  const roomName = (id: string) => content.rooms[id]?.name ?? id;

  // Where each resident is helped (first quest appearance, campaign order).
  const questRoom = new Map<string, string>();
  for (const id of order) {
    for (const e of content.rooms[id].entities) {
      if (e.type === "npc" && e.npcId && isQuest(e) && !questRoom.has(e.npcId)) questRoom.set(e.npcId, id);
    }
  }
  const helpable = [...questRoom.keys()];
  const runHelped = (n: string) => lens === null || lens.has(n);
  const threads = new Map<string, Thread>();
  for (const n of helpable) {
    const p = people.get(n);
    threads.set(n, { npcId: n, name: p?.name ?? n, color: p?.color ?? "#7fd8e8", startKey: null, startRoom: null, deps: [] });
  }

  const lineKeys = new Set<string>();
  const firstMeet: Record<string, string> = {};
  const metOnRun = new Set<string>();

  const wardenBeat = (t: TauntDef, gutter: string, where: string, shared = false): Beat => ({
    kind: "warden", key: tauntKey(t), target: { kind: "taunt", tauntId: t.id }, gutter, cue: "THE WARDEN",
    shared, where, mapping: `taunts.json · ${t.id}`,
  });

  const scenes: Scene[] = order.map((rid, idx) => {
    const room = content.rooms[rid];
    const beats: Beat[] = [];
    const push = (b: Beat, branch?: string) => { if (branch) b.branch = branch; beats.push(b); };

    if (idx === 0) {
      push({ kind: "dir", text: "A new run begins." });
      for (const t of live("game_start")) push(wardenBeat(t, "NEW RUN",
        "At the very start of every new run, before anything else — it lives in whichever level comes first, so reordering the campaign moves it on its own."));
    } else {
      push({ kind: "dir", text: "Between rooms — #67’s pockets are emptied." });
      for (const t of live("confiscate")) push(wardenBeat(t, "SHARED",
        "Between every room, as #67’s things are taken. One pool shared by every scene — edit it here and it changes everywhere.", true));
    }
    push({ kind: "dir", text: `#67 enters ${roomName(rid)}.` });
    const enter = live("room_enter", rid);
    if (enter.length) {
      for (const t of enter) push(wardenBeat(t, "ENTERING", `As #67 walks into ${roomName(rid)}.`));
    } else {
      push({ kind: "stub", text: "(The Warden has no line for entering this room yet — Sean can add one, then it appears here to write.)" });
    }

    // Story entities, left to right — roughly the order a player meets them.
    const story = room.entities
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === "note" || e.type === "npc")
      .sort((a, b) => a.e.x - b.e.x || a.e.y - b.e.y);

    const noteBeats = (e: RoomEntity, i: number, branch?: string) => {
      const key = noteKey(room, e);
      lineKeys.add(key);
      const sig = subjectSig(e.text);
      const teaches = e.recipe ? recipeName(e.recipe) : null;
      push({ kind: "dir", text: "#67 finds a note.", frame: { type: "close", roomId: rid, x: e.x, y: e.y, label: "CLOSE — THE NOTE" } }, branch);
      push({
        kind: "line", key, target: { kind: "note", roomId: rid, entityIndex: i }, gutter: "NOTE", cue: "A note",
        paren: [sig ? `signed Subject #${sig}` : "", teaches ? `teaches ${teaches}` : ""].filter(Boolean).join(" · ") || undefined,
        where: `The note #67 finds in ${roomName(rid)}.` + (teaches ? ` Reading it teaches the ${teaches} recipe — the lore rides along with the lesson.` : ""),
        mapping: `rooms/${rid} · note at ${e.x}, ${e.y} · text`,
      }, branch);
    };

    const npcBeats = (e: RoomEntity, i: number, branch?: string): Beat[] => {
      const start = beats.length;
      const id = e.npcId;
      const name = e.name ?? id ?? "A resident";
      const firstEver = id ? !metOnRun.has(id) : true;
      if (id) {
        metOnRun.add(id);
        if (!(id in firstMeet)) firstMeet[id] = rid;
      }
      const L = (slot: DialogSlot, gutter: string, where: string, more: Partial<Beat> = {}) => {
        const key = npcKey(room, i, slot);
        lineKeys.add(key);
        push({
          kind: "line", key, target: { kind: "npc", roomId: rid, entityIndex: i, slot }, gutter, cue: name, npcId: id,
          where, mapping: `rooms/${rid} · ${npcRef(room, i)} · ${slot}`, ...more,
        }, branch);
        return key;
      };
      push({ kind: "dir", text: firstEver ? `#67 meets ${name}.` : `${name} again.`,
        frame: { type: "close", roomId: rid, x: e.x, y: e.y, label: `${firstEver ? "TWO-SHOT" : "MEDIUM"} — ${name}`, npcIds: id ? [id] : [] } }, branch);
      const quest = isQuest(e);
      const askKey = L("dialogAsk", "FIRST TALK",
        quest ? `The first time #67 talks to ${name} in ${roomName(rid)} — the pitch: what they want, and why.`
          : `Every time #67 talks to ${name} in ${roomName(rid)}. With no quest here they can’t be helped, so this is their whole scene.`);
      if (!quest) {
        if (e.dialogAfter?.trim()) {
          push({ kind: "stub", text: `(${name}’s “after” line never plays here — with no quest in this room, #67 can’t help them.)` }, branch);
        }
      } else {
        if (e.wants) {
          push({ kind: "cond", text: `If #67 comes back with ${e.wants.count} ${itemName(e.wants.item)} —` }, branch);
          L("dialogConfirm", "HAS IT", `When #67 comes back carrying ${e.wants.count} ${itemName(e.wants.item)}. The Hand it over / Keep it choice appears under this line.`,
            { paren: "as the choice appears", choice: true });
        } else {
          push({ kind: "cond", text: "Once #67 finishes the job this room asks for —" }, branch);
        }
        const helps = id ? runHelped(id) : true;
        if (e.wants) {
          push({ kind: "stub", text: `${helps ? "If #67 keeps it" : "On this run #67 keeps it"} → no just-done scene, no recipe` +
            (id && threads.has(id) ? `, and ${name}’s thread never starts.` : ".") }, branch);
        }
        if (helps) {
          if (e.wants) push({ kind: "cond", text: "If #67 hands it over —" }, branch);
          const doneKey = L("dialogDone", "JUST DONE", `Right after #67 helps ${name} — this visit only.` +
            (e.rewardRecipes?.length ? " It’s where they teach their recipe." : ""));
          const th = id ? threads.get(id) : undefined;
          if (th && th.startKey === null && questRoom.get(id!) === rid) { th.startKey = doneKey; th.startRoom = rid; }
          for (const r of e.rewardRecipes ?? []) {
            push({ kind: "dir", text: `#67 learns to make: ${recipeName(r)}.`, frame: { type: "recipe", recipeId: r, label: "INSERT — THE RECIPE" } }, branch);
          }
          for (const t of live("npc_help")) push(wardenBeat(t, "SHARED",
            "Every time #67 helps any resident, in any room. Shared by every quest in the game.", true), branch);
          push({ kind: "dir", text: "Every visit after —" }, branch);
          L("dialogAfter", "AFTER", `Every later time #67 talks to ${name} in ${roomName(rid)}. One line, evergreen.`);
        }
      }
      // Gated: this beat depends on someone's thread.
      if (gated(e)) {
        const ask = beats.find((b) => b.key === askKey);
        const needs = [...(e.requiresHelped ?? []), ...(e.hiddenIfHelped ?? [])];
        for (const n of needs) {
          const th = threads.get(n);
          const qr = questRoom.get(n);
          const early = !qr || order.indexOf(qr) > idx;
          if (th) th.deps.push({ key: askKey, roomId: rid, early });
          if (ask && early) {
            (ask.flags ??= []).push({ level: "bad", text: qr
              ? `Needs ${nameOf(n)} helped, but #67 only meets their quest in ${roomName(qr)}, which comes later — this can never play`
              : `Needs ${nameOf(n)} helped, but nobody in the campaign can be helped by that name — this can never play` });
          }
        }
      }
      return beats.slice(start);
    };

    // Group gated entities by gating signature so a pair scene reads as one
    // branch, and a "helped" group with a "not helped" counterpart (or none)
    // reads as IF-HELPED / IF-NOT alternates.
    const done = new Set<number>();
    for (const { e, i } of story) {
      if (done.has(i)) continue;
      if (e.type === "note") {
        done.add(i);
        if (gated(e) && lens !== null && !presentOnRun(e, lens)) continue;
        noteBeats(e, i, gated(e) ? gateSig(e) : undefined);
        continue;
      }
      if (!gated(e)) { done.add(i); npcBeats(e, i); continue; }

      const sig = gateSig(e);
      const group = story.filter(({ e: x, i: xi }) => !done.has(xi) && x.type === "npc" && gateSig(x) === sig);
      group.forEach(({ i: xi }) => done.add(xi));
      const req = e.requiresHelped ?? [];
      const hid = e.hiddenIfHelped ?? [];
      const needLabel = (ids: string[]) => ids.map(nameOf).join(" and ");
      const head = req.length
        ? `Only on runs where #67 helped ${needLabel(req)}` + (hid.length ? ` but not ${needLabel(hid)}` : "")
        : `Only on runs where #67 did NOT help ${needLabel(hid)}`;
      // A single-resident "helped" gate is a moment with two sides; find the other.
      const single = req.length === 1 && !hid.length ? req[0] : null;
      const counterpart = single
        ? story.filter(({ e: x, i: xi }) => !done.has(xi) && x.type === "npc" && !x.requiresHelped?.length &&
            x.hiddenIfHelped?.length === 1 && x.hiddenIfHelped[0] === single)
        : [];
      counterpart.forEach(({ i: xi }) => done.add(xi));

      if (lens !== null) {
        // One specific run: only the side that happens.
        const on = group.filter(({ e: x }) => presentOnRun(x, lens));
        const other = counterpart.filter(({ e: x }) => presentOnRun(x, lens));
        if (on.length) {
          beats.push({ kind: "cond", text: `${head} —`, branch: sig, branchHead: "Happens on this run" });
          for (const g of on) npcBeats(g.e, g.i, sig);
        } else if (other.length) {
          for (const g of other) npcBeats(g.e, g.i, gateSig(g.e));
        } else {
          beats.push({ kind: "skip", text: `${group.map(({ e: x }) => x.name ?? x.npcId).join(" and ")} — ${head.toLowerCase()}.` });
          // Still a dependency on the thread, even when it doesn't play.
          for (const n of [...req, ...hid]) {
            const th = threads.get(n);
            const qr = questRoom.get(n);
            if (th) th.deps.push({ key: npcKey(room, group[0].i, "dialogAsk"), roomId: rid, early: !qr || order.indexOf(qr) > idx });
          }
        }
        continue;
      }

      if (single) {
        // IF HELPED | IF NOT, side by side.
        const left = group.flatMap((g) => npcBeats(g.e, g.i, sig));
        const right = counterpart.flatMap((g) => npcBeats(g.e, g.i, gateSig(g.e)));
        // npcBeats appended them to `beats`; lift them into the alt instead.
        beats.splice(beats.length - left.length - right.length, left.length + right.length);
        beats.push({
          kind: "alt", branch: sig,
          columns: [
            { label: `IF #67 HELPED ${nameOf(single)}`, beats: left },
            { label: "IF NOT", beats: right, empty: right.length ? undefined :
              `${group.map(({ e: x }) => x.name ?? x.npcId).join(" and ")} isn’t here on that run. Nothing plays. There’s no not-helped version in the game yet — ask Sean for one and it appears here to write.` },
          ],
        });
        continue;
      }
      beats.push({ kind: "cond", text: `${head} —`, branch: sig, branchHead: "Only on some runs" });
      for (const g of group) npcBeats(g.e, g.i, sig);
      beats.push({ kind: "dir", text: "End of the branch.", branch: sig });
    }

    if (demoRooms.length && rid === demoRooms[demoRooms.length - 1]) {
      const de = live("demo_end");
      if (de.length) {
        beats.push({ kind: "cond", text: "In the demo, the run ends here —", branch: "demo", branchHead: "Demo build only" });
        for (const t of de) beats.push({ ...wardenBeat(t, "DEMO END", "Over the wishlist card when the demo runs out — only in the demo build."), branch: "demo" });
      }
    }

    const helpedForShot = lens ?? new Set(helpable);
    return {
      roomId: rid, name: roomName(rid), num: idx + 1, beats, inDemo: demoRooms.includes(rid),
      cast: room.entities.filter((e) => e.type === "npc" && presentOnRun(e, helpedForShot)).map((e) => e.name ?? e.npcId ?? "?"),
    };
  });

  const ending: Beat[] = [];
  const win = live("win");
  if (win.length) {
    ending.push({ kind: "dir", text: "#67 escapes." });
    for (const t of win) ending.push(wardenBeat(t, "THE END", "The win line, as #67 gets out. Arc-critical: exactly one, and it carries the thesis."));
  }

  // Threads only exist on runs where that resident is helped.
  const out = [...threads.values()].filter((t) => runHelped(t.npcId));
  return { scenes, ending, threads: out, lineKeys, firstMeet };
}

/** What the writer saw last time (kept per viewer in localStorage), to tell
 *  them what changed in the campaign since. */
export interface ScriptSignature {
  order: string[];
  firstMeet: Record<string, string>;
}

export function signatureOf(m: ScriptModel): ScriptSignature {
  return { order: m.scenes.map((s) => s.roomId), firstMeet: { ...m.firstMeet } };
}

export interface ScriptChanges {
  moved: { roomId: string; from: number; to: number }[];
  added: string[];
  removed: string[];
  firstMeetMoved: { npcId: string; from: string; to: string }[];
}

export function diffSignature(prev: ScriptSignature | null, now: ScriptSignature): ScriptChanges {
  const out: ScriptChanges = { moved: [], added: [], removed: [], firstMeetMoved: [] };
  if (!prev) return out;
  // A room counts as moved when its neighbourhood changed, not merely its
  // index (inserting one level would otherwise "move" everything after it).
  const before = new Map(prev.order.map((r, i) => [r, i]));
  const common = now.order.filter((r) => before.has(r));
  const prevCommon = prev.order.filter((r) => now.order.includes(r));
  for (const [i, r] of common.entries()) {
    if (prevCommon[i] !== r) out.moved.push({ roomId: r, from: before.get(r)! + 1, to: now.order.indexOf(r) + 1 });
  }
  for (const r of now.order) if (!before.has(r)) out.added.push(r);
  for (const r of prev.order) if (!now.order.includes(r)) out.removed.push(r);
  for (const [n, r] of Object.entries(now.firstMeet)) {
    const was = prev.firstMeet[n];
    if (was && was !== r) out.firstMeetMoved.push({ npcId: n, from: was, to: r });
  }
  return out;
}

/** Lines that mention a room by name, whose order relative to this scene
 *  flipped since the writer last looked — "find me in the Bunk Room" reads
 *  wrong once the Bunk Room comes first. */
export function continuityFlags(
  content: Content, text: string, roomId: string, prev: ScriptSignature | null
): StructFlag[] {
  if (!prev) return [];
  const out: StructFlag[] = [];
  const now = content.campaign?.rooms ?? [];
  const lower = text.toLowerCase();
  for (const other of now) {
    if (other === roomId) continue;
    const nm = content.rooms[other]?.name;
    if (!nm) continue;
    const bare = nm.replace(/^the\s+/i, "").toLowerCase();
    if (bare.length < 4 || !lower.includes(bare)) continue;
    const a = prev.order.indexOf(other), b = prev.order.indexOf(roomId);
    if (a < 0 || b < 0) continue;
    const wasAfter = a > b;
    const isAfter = now.indexOf(other) > now.indexOf(roomId);
    if (wasAfter !== isAfter) out.push({ level: "warn", text: `Mentions ${nm}, which now comes ${isAfter ? "after" : "before"} this scene — still reads right?` });
  }
  return out;
}

/** Read / write the text behind a target. */
export function readTarget(content: Content, t: BeatTarget, line = 0): string {
  if (t.kind === "taunt") return content.taunts.find((x) => x.id === t.tauntId)?.lines[line] ?? "";
  const e = content.rooms[t.roomId]?.entities[t.entityIndex];
  if (!e) return "";
  return (t.kind === "note" ? e.text : e[t.slot]) ?? "";
}

export function writeTarget(content: Content, t: BeatTarget, value: string, line = 0): string {
  if (t.kind === "taunt") {
    const td = content.taunts.find((x) => x.id === t.tauntId);
    if (td) td.lines[line] = value;
    return "taunts.json";
  }
  const e = content.rooms[t.roomId]?.entities[t.entityIndex];
  if (e) {
    if (t.kind === "note") e.text = value;
    else e[t.slot] = value;
  }
  return `rooms/${t.roomId}.json`;
}

/** Every editable line beat in the model, in reading order (alts included). */
export function allLineBeats(m: ScriptModel): Beat[] {
  const out: Beat[] = [];
  const walk = (bs: Beat[]) => {
    for (const b of bs) {
      if (b.kind === "line" || b.kind === "warden") out.push(b);
      if (b.columns) for (const c of b.columns) walk(c.beats);
    }
  };
  for (const s of m.scenes) walk(s.beats);
  walk(m.ending);
  return out;
}
