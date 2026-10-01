// Story-scoped publish: overlay ONLY story fields from a writer's bundle
// onto the live bundle. Same construction as _artscope.js — a writer publish
// starts from live and copies across just the fields the writer owns, so it
// can change what the game SAYS (and what each NPC asks for and gives —
// Sean's call, 2026-09-30: "text + quest structure") and nothing else. It
// can never move an entity, edit a room's tiles, touch an item's stats, add
// a new NPC or taunt, or clobber a concurrent design edit.
//
// Story fields, by file:
//   rooms/*.json  NPC entities, matched by stable npcId:
//                   name, dialogAsk/Confirm/Done/After,
//                   wants, roomQuest, rewardItems, rewardRecipes,
//                   requiresHelped, hiddenIfHelped
//                 note + hint entities, matched by (type, x, y) — they have
//                 no stable id; position is level data Sean owns, and a note
//                 he has since moved simply doesn't receive the writer's
//                 edit (safe, silent):
//                   text, recipe
//   taunts.json       per id: lines, emotion, cooldownMs, chance
//   achievements.json per id: name, description, wardenLine, emotion
//   items.json        per id: description
//   recipes.json      per id: flavor

export const NPC_STORY_FIELDS = [
  "name", "dialogAsk", "dialogConfirm", "dialogDone", "dialogAfter",
  "wants", "roomQuest", "rewardItems", "rewardRecipes",
  "requiresHelped", "hiddenIfHelped",
];
export const NOTE_STORY_FIELDS = ["text", "recipe"];
export const HINT_STORY_FIELDS = ["text"];
export const STORY_ARRAY_FILES = {
  "taunts.json": ["lines", "emotion", "cooldownMs", "chance"],
  "achievements.json": ["name", "description", "wardenLine", "emotion"],
  "items.json": ["description"],
  "recipes.json": ["flavor"],
};

/** Copy the listed fields from `src` onto a clone of `dst`. A field absent
 *  on src is DELETED — clearing a quest ("wants" removed) must publish. */
function overlayFields(dst, src, fields) {
  const out = { ...dst };
  for (const f of fields) {
    if (src[f] !== undefined) out[f] = src[f];
    else delete out[f];
  }
  return out;
}

function overlayIdArray(liveArr, writerArr, fields) {
  if (!Array.isArray(liveArr) || !Array.isArray(writerArr)) return liveArr;
  const byId = new Map(writerArr.filter((e) => e && e.id).map((e) => [e.id, e]));
  return liveArr.map((entry) => {
    const src = entry && entry.id ? byId.get(entry.id) : undefined;
    return src ? overlayFields(entry, src, fields) : entry;
  });
}

const posKey = (e) => `${e.type}@${e.x},${e.y}`;

function overlayRoom(liveRoom, writerRoom) {
  if (!liveRoom?.entities || !writerRoom?.entities) return liveRoom;
  const npcByid = new Map();
  const byPos = new Map();
  for (const e of writerRoom.entities) {
    if (!e) continue;
    if (e.type === "npc" && e.npcId) npcByid.set(e.npcId, e);
    else if (e.type === "note" || e.type === "hint") byPos.set(posKey(e), e);
  }
  if (npcByid.size === 0 && byPos.size === 0) return liveRoom;
  return {
    ...liveRoom,
    entities: liveRoom.entities.map((e) => {
      if (!e) return e;
      if (e.type === "npc" && e.npcId) {
        const src = npcByid.get(e.npcId);
        return src ? overlayFields(e, src, NPC_STORY_FIELDS) : e;
      }
      if (e.type === "note" || e.type === "hint") {
        const src = byPos.get(posKey(e));
        return src ? overlayFields(e, src, e.type === "note" ? NOTE_STORY_FIELDS : HINT_STORY_FIELDS) : e;
      }
      return e;
    }),
  };
}

/** live + writer bundle -> new bundle with only story fields taken from the
 *  writer. Files the writer bundle lacks pass through untouched; files only
 *  the writer has are IGNORED (a writer can't introduce new files). */
export function overlayStoryBundle(liveFiles, writerFiles) {
  const out = {};
  for (const [name, liveVal] of Object.entries(liveFiles)) {
    const writerVal = writerFiles[name];
    if (writerVal === undefined) { out[name] = liveVal; continue; }
    const fields = STORY_ARRAY_FILES[name];
    if (fields) out[name] = overlayIdArray(liveVal, writerVal, fields);
    else if (name.startsWith("rooms/")) out[name] = overlayRoom(liveVal, writerVal);
    else out[name] = liveVal; // game.json, tiles, rules, layers, … — never writer-writable
  }
  return out;
}
