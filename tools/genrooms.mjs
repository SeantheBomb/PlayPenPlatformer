// Generates content/rooms/*.json for PlayPen (elemental v2 campaign).
// Tile chars: # stone  = grate  ^ spikes  C cracked  S pad  G goo
//             W wood   I ice    w water   f fire     M metal
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

// ---------- Room 1: Orientation — fire vs wood (44x24, floor top 21) ----------
{
  const g = grid(44, 24);
  frame(g, 21);
  g.rect(14, 19, 16, 20, "#");        // step 1
  g.rect(20, 18, 22, 20, "#");        // step 2
  g.rect(27, 21, 29, 21, ".");        // spike pit
  g.rect(27, 22, 29, 22, "^");
  g.rect(36, 17, 36, 20, "W");        // wooden barrier gates the exit
  save("orientation", "Orientation", g, "#17131f", [
    { type: "spawn", x: 3, y: 20 },
    { type: "hint", x: 6, y: 17, text: "A / D — move · SPACE — jump" },
    { type: "hint", x: 18, y: 14, text: "hold SPACE to jump higher" },
    { type: "hint", x: 30, y: 15, text: "TAB — craft what you find" },
    { type: "hint", x: 33, y: 13, text: "light it, then burn what burns" },
    { type: "pickup", item: "plank", x: 9, y: 20 },
    { type: "pickup", item: "cloth", x: 12, y: 20 },
    { type: "pickup", item: "cloth", x: 21, y: 17 },
    { type: "pickup", item: "plank", x: 25, y: 20 },
    { type: "brazier", x: 31, y: 20 },
    { type: "note", x: 33, y: 20, recipe: "recipe_torch",
      text: "Day 9. Cloth wrapped on a plank makes a torch — but it wants a flame first. The brazier never goes out. The wooden doors DO. — Subject #31" },
    { type: "door", x: 41, y: 20, to: "next" },
  ]);
}

// ---------- Room 2: Storage — water vs fire (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(8, 18, 13, 18, "=");         // plat 1
  g.rect(16, 15, 21, 15, "=");        // plat 2
  g.rect(24, 12, 31, 12, "=");        // plat 3
  g.rect(34, 12, 47, 23, "#");        // high shelf on right
  g.rect(18, 21, 22, 21, "w");        // water pool set into the floor
  g.rect(40, 11, 42, 11, "f");        // fire blocks the shelf route to the door
  save("storage", "Storage", g, "#151a24", [
    { type: "spawn", x: 3, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 5, y: 20 },
    { type: "note", x: 12, y: 20, recipe: "recipe_bucket",
      text: "Bend the scrap into a bowl, rope for a handle. The pools refill it forever. Fire hates it. — Subject #22" },
    { type: "pickup", item: "rope", x: 9, y: 17 },
    { type: "hint", x: 20, y: 16, text: "F — scoop water · F — throw it" },
    { type: "note", x: 16, y: 20, recipe: "recipe_hammer",
      text: "Metal on a stick shatters what's brittle. Cracks in stone. Ice. Keep one around. — Subject #31" },
    { type: "enemy", enemy: "crawler", x: 26, y: 20, patrolMinX: 25, patrolMaxX: 31 },
    { type: "pickup", item: "scrap_metal", x: 30, y: 20 },
    { type: "pickup", item: "rope", x: 26, y: 11 },
    { type: "pickup", item: "plank", x: 28, y: 11 },
    { type: "pickup", item: "scrap_metal", x: 37, y: 11 },
    { type: "checkpoint", x: 38, y: 11 },
    { type: "door", x: 45, y: 11, to: "next" },
  ]);
}

// ---------- Room 3: Vents — goo, choices, stealth (52x24, floor top 21) ----------
{
  const g = grid(52, 24);
  frame(g, 21);
  g.rect(20, 1, 35, 14, "#");         // low vent ceiling section
  g.rect(8, 21, 10, 21, "w");         // small pool (wash the goo, or stun the drone)
  g.rect(24, 20, 28, 20, "G");        // goo strip
  g.rect(42, 19, 43, 23, "#");        // stair step
  g.rect(44, 17, 50, 23, "#");        // landing with the door
  save("vents", "The Vents", g, "#101a17", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 5, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 4, y: 20 },
    { type: "pickup", item: "rope", x: 6, y: 20 },
    { type: "pickup", item: "goo_blob", x: 13, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 15, y: 20 },
    { type: "hint", x: 19, y: 16, text: "E — hide in lockers to break line of sight" },
    { type: "locker", x: 22, y: 20 },
    { type: "hint", x: 26, y: 15, text: "goo burns. goo washes away. dealer's choice" },
    { type: "pickup", item: "goo_blob", x: 26, y: 19 },
    { type: "enemy", enemy: "spotter", x: 30, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 34, y: 20 },
    { type: "locker", x: 38, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 45, y: 16 },
    { type: "door", x: 49, y: 16, to: "next" },
  ]);
}

// ---------- Room 4: Cell Block — spark + conduction (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(6, 16, 11, 16, "#");         // Marla's cell roof (decor)
  // ice-sealed floor pocket hiding the spark rod note (melt it or shatter it)
  g.rect(17, 22, 19, 22, ".");
  g.rect(18, 21, 19, 21, "I");
  // conductive floor strip runs under the gate to the fuse box
  g.rect(20, 21, 28, 21, "M");
  // gate wall above the powered door
  g.rect(24, 1, 24, 18, "#");
  save("cell_block", "Cell Block B", g, "#1a1420", [
    { type: "spawn", x: 2, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 4, y: 20 },
    { type: "npc", x: 8, y: 20, name: "Marla (#12)", color: "#7fd8e8",
      wants: { item: "glow_mushroom", count: 1 },
      rewardItems: [{ item: "cloth", count: 2 }],
      rewardRecipes: ["recipe_smoke_bomb"],
      dialogAsk: "Psst. #67! Marla. #12. There's a GLOW MUSHROOM sealed under the ice over there — I've been staring at it for a month. Get it out, bring it here, I'll make it worth your while.",
      dialogDone: "Beautiful. Here — cloth I've been hoarding, and a recipe: mushroom spores in a sock. Shake it and everything nearby takes a nap. Poof.",
      dialogAfter: "Go. GO. Wave at the parking lot for me." },
    { type: "pickup", item: "scrap_metal", x: 10, y: 20 },
    { type: "pickup", item: "cog", x: 12, y: 20 },
    { type: "pickup", item: "plank", x: 15, y: 20 },
    { type: "hint", x: 14, y: 17, text: "ice melts. ice shatters. treasure underneath" },
    { type: "pickup", item: "glow_mushroom", x: 17, y: 22 },
    { type: "note", x: 18, y: 22, recipe: "recipe_spark_rod",
      text: "Every gate runs to a fuse box. A cog on scrap makes a rod that BITES. Zap the box — or any metal touching it. Don't be standing on that metal. — Subject #19" },
    { type: "hint", x: 21, y: 17, text: "charge follows metal" },
    { type: "door", x: 24, y: 20, gate: true, fuseId: "A" },
    { type: "fusebox", x: 27, y: 19, fuseId: "A" },
    { type: "checkpoint", x: 30, y: 20 },
    { type: "pickup", item: "cog", x: 33, y: 20 },
    { type: "enemy", enemy: "crawler", x: 36, y: 20, patrolMinX: 34, patrolMaxX: 42 },
    { type: "pickup", item: "scrap_metal", x: 43, y: 20 },
    { type: "door", x: 45, y: 20, to: "next" },
  ]);
}

// ---------- Room 5: The Gap — placeable springs (40x28, floor top 25) ----------
{
  const g = grid(40, 28);
  frame(g, 25);
  g.rect(8, 24, 9, 24, "S");          // fixed bounce pad demo
  g.rect(5, 16, 11, 16, "=");         // ledge A
  g.rect(14, 13, 20, 13, "=");        // ledge B
  g.rect(23, 10, 29, 10, "=");        // ledge C
  g.rect(32, 5, 39, 27, "#");         // final shelf — bring your own bounce
  g.rect(14, 24, 17, 24, "^");        // fall punishment
  save("the_gap", "The Gap", g, "#141522", [
    { type: "spawn", x: 2, y: 24 },
    { type: "checkpoint", x: 4, y: 24 },
    { type: "hint", x: 9, y: 20, text: "bounce pads launch you upward" },
    { type: "pickup", item: "spring_coil", x: 6, y: 24 },
    { type: "pickup", item: "spring_coil", x: 8, y: 22 },
    { type: "pickup", item: "plank", x: 17, y: 12 },
    { type: "note", x: 26, y: 9, recipe: "recipe_spring",
      text: "You can't jump the shelf. You can BUILD the jump. Coil + plank. Place it (F), take it back (E). The floor is wherever you say it is. — Subject #45" },
    { type: "hint", x: 25, y: 7, text: "F — place · jump on it · E — reclaim" },
    { type: "door", x: 36, y: 4, to: "next" },
  ]);
}

// ---------- Room 6: Mess Hall — ice bridges + pressure (52x24, floor top 21) ----------
{
  const g = grid(52, 24);
  frame(g, 21);
  g.rect(8, 18, 11, 18, "=");         // table 1
  g.rect(16, 18, 19, 18, "=");        // table 2
  g.rect(20, 21, 31, 21, "w");        // wide water crossing set into the floor
  g.rect(35, 20, 37, 20, "f");        // kitchen fire before the door
  g.rect(38, 17, 45, 17, "=");        // high shelf route over the fire
  save("mess_hall", "Mess Hall", g, "#1c1712", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 4, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 6, y: 20 },
    { type: "pickup", item: "goo_blob", x: 9, y: 17 },
    { type: "pickup", item: "scrap_metal", x: 11, y: 17 },
    { type: "pickup", item: "rope", x: 14, y: 20 },
    { type: "enemy", enemy: "crawler", x: 13, y: 20, patrolMinX: 11, patrolMaxX: 18 },
    { type: "note", x: 17, y: 17, recipe: "recipe_frost_vial",
      text: "Mushroom cold + goo = winter in a bottle. Water freezes hard enough to walk on. Slick, though. — Subject #28" },
    { type: "hint", x: 25, y: 15, text: "cold turns water into floor" },
    { type: "locker", x: 33, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 33, y: 20 },
    { type: "enemy", enemy: "spotter", x: 40, y: 20 },
    { type: "pickup", item: "goo_blob", x: 47, y: 20 },
    { type: "pickup", item: "plank", x: 49, y: 20 },
    { type: "door", x: 50, y: 20, to: "next" },
  ]);
}

// ---------- Room 7: Exit Wing — the exam, two routes (48x24, floor top 21) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  // upper route: steps up to a long grate walkway with a wooden wall mid-way
  g.rect(6, 18, 7, 20, "#");          // step to the walkway
  g.rect(8, 15, 30, 15, "=");         // walkway
  g.rect(20, 11, 21, 14, "W");        // wooden wall on the walkway — burn it
  // lower route: water, fire, goo in sequence
  g.rect(12, 21, 17, 21, "w");
  g.rect(22, 20, 25, 20, "f");
  g.rect(28, 20, 31, 20, "G");
  save("exit_wing", "Exit Wing", g, "#221218", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 3, y: 20 },
    { type: "brazier", x: 5, y: 20 },
    { type: "pickup", item: "plank", x: 4, y: 17 },
    { type: "pickup", item: "scrap_metal", x: 7, y: 17 },
    { type: "pickup", item: "rope", x: 8, y: 20 },
    { type: "pickup", item: "cloth", x: 9, y: 20 },
    { type: "pickup", item: "glow_mushroom", x: 10, y: 20 },
    { type: "pickup", item: "goo_blob", x: 11, y: 20 },
    { type: "hint", x: 14, y: 12, text: "high road or low road. both argue back" },
    { type: "enemy", enemy: "spotter", x: 26, y: 14 },
    { type: "enemy", enemy: "crawler", x: 36, y: 20, patrolMinX: 34, patrolMaxX: 42 },
    { type: "pickup", item: "scrap_metal", x: 44, y: 20 },
    { type: "exit", x: 44, y: 20 },
  ]);
}

console.log("done");
