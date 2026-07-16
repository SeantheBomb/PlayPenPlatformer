// Generates content/rooms/*.json for PlayPen with reliable grid math.
import fs from "fs";
import path from "path";

const OUT = "C:/Users/SeanF/Documents/PlayPenPlatformer/content/rooms";
fs.mkdirSync(OUT, { recursive: true });

function grid(w, h) {
  const g = Array.from({ length: h }, () => Array(w).fill("."));
  return {
    w, h, g,
    set(x, y, c) { if (x >= 0 && x < w && y >= 0 && y < h) g[y][x] = c; },
    rect(x0, y0, x1, y1, c) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    },
    rows() { return g.map(r => r.join("")); },
  };
}

// Standard frame: ceiling row 0, side walls, floor slab
function frame(g, floorTop) {
  g.rect(0, 0, g.w - 1, 0, "#");
  g.rect(0, 0, 0, g.h - 1, "#");
  g.rect(g.w - 1, 0, g.w - 1, g.h - 1, "#");
  g.rect(0, floorTop, g.w - 1, g.h - 1, "#");
}

function save(id, name, g, background, entities) {
  const room = { id, name, width: g.w, height: g.h, background, tiles: g.rows(), entities };
  fs.writeFileSync(path.join(OUT, id + ".json"), JSON.stringify(room, null, 2) + "\n");
  console.log("wrote", id, g.w + "x" + g.h, "entities:", entities.length);
}

// ---------- Room 1: Orientation (44x24, floor top 21) ----------
{
  const g = grid(44, 24);
  frame(g, 21);
  g.rect(14, 19, 16, 20, "#");        // step 1 (2 high)
  g.rect(20, 18, 22, 20, "#");        // step 2 (3 high)
  g.rect(27, 21, 29, 21, ".");        // pit opening
  g.rect(27, 22, 29, 22, "^");        // pit spikes (floor row 23 below)
  g.rect(36, 17, 36, 20, "C");        // cracked wall gate (4 tall)
  save("orientation", "Orientation", g, "#17131f", [
    { type: "spawn", x: 3, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 9, y: 20 },
    { type: "pickup", item: "plank", x: 21, y: 17 },
    { type: "pickup", item: "scrap_metal", x: 25, y: 20 },
    { type: "note", x: 33, y: 20, recipe: "recipe_hammer",
      text: "Day 12. The walls with CRACKS can break. Metal + plank made me a hammer. The Warden watched me build it and said nothing. Unsettling. — Subject #31" },
    { type: "door", x: 41, y: 20, to: "next" },
  ]);
}

// ---------- Room 2: Storage (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(8, 18, 13, 18, "=");         // plat 1
  g.rect(16, 15, 21, 15, "=");        // plat 2
  g.rect(24, 12, 31, 12, "=");        // plat 3
  g.rect(34, 12, 47, 23, "#");        // high shelf on right
  g.rect(30, 20, 33, 20, "^");        // spikes under final gap
  save("storage", "Storage", g, "#151a24", [
    { type: "spawn", x: 3, y: 20 },
    { type: "pickup", item: "cloth", x: 5, y: 20 },
    { type: "pickup", item: "cloth", x: 10, y: 17 },
    { type: "pickup", item: "rope", x: 18, y: 14 },
    { type: "pickup", item: "plank", x: 26, y: 11 },
    { type: "pickup", item: "rope", x: 37, y: 11 },
    { type: "enemy", enemy: "crawler", x: 16, y: 20, patrolMinX: 14, patrolMaxX: 28 },
    { type: "checkpoint", x: 40, y: 11 },
    { type: "door", x: 45, y: 11, to: "next" },
  ]);
}

// ---------- Room 3: Vents (52x24, floor top 21) ----------
{
  const g = grid(52, 24);
  frame(g, 21);
  g.rect(20, 1, 35, 14, "#");         // low vent ceiling section
  g.rect(24, 20, 28, 20, "G");        // goo strip
  g.rect(49, 19, 50, 23, "#");        // step to ledge
  g.rect(46, 17, 48, 23, "#");        // right ledge
  save("vents", "The Vents", g, "#101a17", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 6, y: 20 },
    { type: "pickup", item: "goo_blob", x: 10, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 14, y: 20 },
    { type: "locker", x: 22, y: 20 },
    { type: "pickup", item: "goo_blob", x: 26, y: 19 },
    { type: "enemy", enemy: "spotter", x: 30, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 34, y: 20 },
    { type: "locker", x: 38, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 50, y: 18 },
    { type: "door", x: 47, y: 16, to: "next" },
  ]);
}

// ---------- Room 4: Cell Block (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(6, 16, 11, 16, "#");         // Marla's cell roof (decor)
  // crumble-floor pocket hiding the lockpick note: walk over the cracked
  // tile with the hammer and the floor gives way
  g.rect(17, 22, 19, 22, ".");
  g.rect(18, 21, 19, 21, "C");
  // gate wall above locked door
  g.rect(24, 1, 24, 18, "#");
  save("cell_block", "Cell Block B", g, "#1a1420", [
    { type: "spawn", x: 2, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 4, y: 20 },
    { type: "npc", x: 8, y: 20, name: "Marla (#12)", color: "#7fd8e8",
      wants: { item: "glow_mushroom", count: 1 },
      rewardItems: [{ item: "goo_blob", count: 2 }],
      rewardRecipes: ["recipe_smoke_bomb"],
      dialogAsk: "Psst. #47! Marla. #12. If you've got a GLOW MUSHROOM from the vents, I'll trade you something good. The Warden hates trades. Do it out of spite.",
      dialogDone: "A mushroom! You beautiful stranger. Take this goo I've been hoarding, and a recipe I scratched into a food tray: goo + mushroom = instant privacy. Poof.",
      dialogAfter: "Go. GO. Wave at the parking lot for me." },
    { type: "pickup", item: "cog", x: 14, y: 20 },
    { type: "note", x: 18, y: 22, recipe: "recipe_lockpick",
      text: "They lock everything, but they're cheap about it. Scrap + a cog = a pick. One use. Make it count. — Subject #19" },
    { type: "door", x: 24, y: 20, locked: true, gate: true },
    { type: "checkpoint", x: 27, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 30, y: 20 },
    { type: "enemy", enemy: "crawler", x: 32, y: 20, patrolMinX: 29, patrolMaxX: 40 },
    { type: "pickup", item: "cog", x: 42, y: 20 },
    { type: "door", x: 45, y: 20, to: "next" },
  ]);
}

// ---------- Room 5: The Gap (40x28, floor top 25) ----------
{
  const g = grid(40, 28);
  frame(g, 25);
  g.rect(8, 24, 9, 24, "S");          // bounce pad on floor
  g.rect(5, 16, 11, 16, "=");         // ledge A (reach via bounce)
  g.rect(14, 13, 20, 13, "=");        // ledge B
  g.rect(23, 10, 29, 10, "=");        // ledge C
  g.rect(32, 5, 39, 27, "#");         // final shelf — needs spring boots
  g.rect(14, 24, 17, 24, "^");        // fall punishment
  save("the_gap", "The Gap", g, "#141522", [
    { type: "spawn", x: 2, y: 24 },
    { type: "checkpoint", x: 4, y: 24 },
    { type: "pickup", item: "spring_coil", x: 6, y: 24 },
    { type: "pickup", item: "spring_coil", x: 8, y: 22 },
    { type: "pickup", item: "cloth", x: 17, y: 12 },
    { type: "note", x: 26, y: 9, recipe: "recipe_spring_boots",
      text: "The shelf CANNOT be jumped. Believe me. BELIEVE ME. Coil + cloth, strap the bounce to your feet. — Subject #45" },
    { type: "door", x: 36, y: 4, to: "next" },
  ]);
}

// ---------- Room 6: Mess Hall (52x24, floor top 21) ----------
{
  const g = grid(52, 24);
  frame(g, 21);
  g.rect(8, 18, 11, 18, "=");         // table 1
  g.rect(16, 18, 19, 18, "=");        // table 2
  g.rect(24, 18, 27, 18, "=");        // table 3
  g.rect(39, 17, 44, 17, "=");        // platform over spikes
  g.rect(40, 20, 43, 20, "^");        // spike strip before door
  save("mess_hall", "Mess Hall", g, "#1c1712", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 4, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 6, y: 20 },
    { type: "pickup", item: "plank", x: 9, y: 17 },
    { type: "enemy", enemy: "crawler", x: 14, y: 20, patrolMinX: 12, patrolMaxX: 26 },
    { type: "note", x: 17, y: 17, recipe: "recipe_sticky_trap",
      text: "Goo on a plank stops the walkers dead. They just... stand there. It's very funny. — Subject #28" },
    { type: "pickup", item: "goo_blob", x: 25, y: 17 },
    { type: "locker", x: 31, y: 20 },
    { type: "enemy", enemy: "spotter", x: 36, y: 20 },
    { type: "pickup", item: "goo_blob", x: 47, y: 20 },
    { type: "pickup", item: "plank", x: 49, y: 20 },
    { type: "door", x: 50, y: 20, to: "next" },
  ]);
}

// ---------- Room 7: Exit Wing (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(10, 21, 13, 21, ".");        // pit opening
  g.rect(10, 22, 13, 22, "^");        // pit spikes
  g.rect(18, 20, 23, 20, "G");        // goo slow strip
  g.rect(25, 20, 26, 20, "^");        // spikes right after goo
  g.rect(28, 16, 33, 16, "=");        // escape platform
  save("exit_wing", "Exit Wing", g, "#221218", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 4, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 7, y: 20 },
    { type: "pickup", item: "goo_blob", x: 20, y: 19 },
    { type: "enemy", enemy: "spotter", x: 31, y: 20 },
    { type: "enemy", enemy: "crawler", x: 38, y: 20, patrolMinX: 36, patrolMaxX: 43 },
    { type: "exit", x: 44, y: 20 },
  ]);
}

console.log("done");
