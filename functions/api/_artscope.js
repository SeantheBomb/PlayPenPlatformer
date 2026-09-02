// Art-scoped publish: overlay ONLY art fields from an artist's bundle onto
// the live bundle. This is what makes the artist password safe by
// construction — an artist publish can change how things LOOK and nothing
// else, and it can never clobber concurrent design/level edits (it starts
// from live, not from the artist's possibly-stale copy of everything else).
//
// Art fields:
//   - sprite / spriteFrames / spriteFps  (SpriteFields, on any def)
//   - spriteAlt                          (secondary state: unlit brazier,
//                                         open door — see room.ts)
//   - portrait                           (NPC dialog face, room entities)
//   - portraits                          (game.json antagonist emotions)
//
// Scopes:
//   - id-keyed arrays (tiles/items/enemies/entities): per entry by id.
//   - game.json: player + antagonist sprite fields, antagonist portraits.
//   - rooms/*.json: entities matched by stable npcId ONLY (index matching
//     would mis-target if a level edit reordered entities). Entities
//     without an npcId are not art-publishable — the studio edits them as
//     def-level art (entities.json) instead.

export const SPRITE_FIELDS = ["sprite", "spriteFrames", "spriteFps", "spriteAlt", "portrait"];
const ART_ARRAY_FILES = ["tiles.json", "items.json", "enemies.json", "entities.json"];

// layers.json (parallax backdrops) is wholly artist-owned — every field in it
// is cosmetic by construction and nothing in the simulation reads any of it,
// which is exactly why room->layer-set bindings live in THIS file rather than
// on RoomDef: it keeps rooms/*.json structurally unwritable by an artist
// publish while still letting her dress every room herself.
const ART_OWNED_FILES = ["layers.json"];

/** Copy art fields from `src` def onto a clone of `dst` def. Fields absent
 *  on src are DELETED on the result — "revert to procedural" must publish. */
function overlayDef(dst, src) {
  const out = { ...dst };
  for (const f of SPRITE_FIELDS) {
    if (src[f] !== undefined) out[f] = src[f];
    else delete out[f];
  }
  return out;
}

function overlayIdArray(liveArr, artistArr) {
  if (!Array.isArray(liveArr) || !Array.isArray(artistArr)) return liveArr;
  const artistById = new Map(artistArr.filter((e) => e && e.id).map((e) => [e.id, e]));
  return liveArr.map((entry) => {
    const src = entry && entry.id ? artistById.get(entry.id) : undefined;
    return src ? overlayDef(entry, src) : entry;
  });
}

function overlayGame(liveGame, artistGame) {
  if (!liveGame || !artistGame) return liveGame;
  const out = { ...liveGame };
  if (liveGame.player && artistGame.player) {
    out.player = overlayDef(liveGame.player, artistGame.player);
  }
  if (liveGame.antagonist && artistGame.antagonist) {
    out.antagonist = overlayDef(liveGame.antagonist, artistGame.antagonist);
    if (artistGame.antagonist.portraits !== undefined) {
      out.antagonist.portraits = artistGame.antagonist.portraits;
    } else {
      delete out.antagonist.portraits;
    }
  }
  return out;
}

function overlayRoom(liveRoom, artistRoom) {
  if (!liveRoom?.entities || !artistRoom?.entities) return liveRoom;
  const artistByNpc = new Map(
    artistRoom.entities.filter((e) => e && e.npcId).map((e) => [e.npcId, e])
  );
  if (artistByNpc.size === 0) return liveRoom;
  return {
    ...liveRoom,
    entities: liveRoom.entities.map((e) => {
      const src = e && e.npcId ? artistByNpc.get(e.npcId) : undefined;
      return src ? overlayDef(e, src) : e;
    }),
  };
}

/** live + artist bundle -> new bundle with only art fields taken from the
 *  artist. Files the artist bundle lacks pass through untouched; files that
 *  only the artist has are IGNORED (an artist can't introduce new files). */
export function overlayArtBundle(liveFiles, artistFiles) {
  const out = {};
  for (const [name, liveVal] of Object.entries(liveFiles)) {
    const artistVal = artistFiles[name];
    if (artistVal === undefined) { out[name] = liveVal; continue; }
    if (ART_ARRAY_FILES.includes(name)) out[name] = overlayIdArray(liveVal, artistVal);
    else if (ART_OWNED_FILES.includes(name)) out[name] = artistVal;
    else if (name === "game.json") out[name] = overlayGame(liveVal, artistVal);
    else if (name.startsWith("rooms/")) out[name] = overlayRoom(liveVal, artistVal);
    else out[name] = liveVal; // recipes, rules, tracks, … — never artist-writable
  }
  // An art-owned file live doesn't have yet (first publish after the feature
  // ships) still needs to land — the loop above only walks live's files.
  for (const name of ART_OWNED_FILES) {
    if (out[name] === undefined && artistFiles[name] !== undefined) out[name] = artistFiles[name];
  }
  return out;
}
