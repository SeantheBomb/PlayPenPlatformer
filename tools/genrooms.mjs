// Generates content/rooms/*.json for PlayPen (v3 campaign, 10 rooms).
// Tile chars: # stone  = grate  ^ spikes  C cracked  S pad  G goo
//             W wood   I ice    w water   f fire     M metal  V waterfall
//
// Authoring rules: jump clears 3 tiles up / ~5 across. Entity y = feet tile.
// Every room supplies everything its own gates need (inventory resets between rooms).
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

function save(id, name, g, background, entities, extra = {}) {
  const room = {
    id, name, width: g.w, height: g.h, background,
    tiles: g.rows(), entities, ...extra,
  };
  fs.writeFileSync(path.join(OUT, id + ".json"), JSON.stringify(room, null, 2) + "\n");
  console.log("wrote", id, g.w + "x" + g.h, "entities:", entities.length);
}

// ---------- 1: Orientation — fire vs wood (44x24, floor top 21) ----------
{
  const g = grid(44, 24);
  frame(g, 21);
  g.rect(14, 19, 16, 20, "#");
  g.rect(20, 18, 22, 20, "#");
  g.rect(27, 21, 29, 21, ".");
  g.rect(27, 22, 29, 22, "^");
  g.rect(36, 17, 36, 20, "W");
  g.rect(10, 18, 12, 18, "=");         // small ledge — first "look up" moment
  save("orientation", "Orientation", g, "#17131f", [
    { type: "spawn", x: 3, y: 20 },
    { type: "hint", x: 6, y: 17, text: "A / D — move · SPACE — jump" },
    { type: "hint", x: 18, y: 14, text: "hold SPACE to jump higher" },
    { type: "hint", x: 30, y: 15, text: "TAB — craft what you find" },
    { type: "hint", x: 33, y: 13, text: "light it, then burn what burns" },
    { type: "pickup", item: "plank", x: 9, y: 20 },
    { type: "hint", x: 11, y: 14, text: "a glint on the ledge above" },
    { type: "pickup", item: "cloth", x: 11, y: 17 },
    { type: "pickup", item: "cloth", x: 21, y: 17 },
    { type: "pickup", item: "plank", x: 25, y: 20 },
    { type: "brazier", x: 31, y: 20 },
    { type: "note", x: 33, y: 20, recipe: "recipe_torch",
      text: "Day 9. Cloth wrapped on a plank makes a torch — but it wants a flame first. The brazier never goes out. The wooden doors DO. — Subject #31" },
    { type: "door", x: 41, y: 20, to: "next" },
  ]);
}

// ---------- 2: Storage — water vs fire, no enemies yet (48x24) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(8, 18, 13, 18, "=");
  g.rect(16, 15, 21, 15, "=");
  g.rect(24, 12, 31, 12, "=");
  g.rect(34, 12, 47, 23, "#");
  g.rect(18, 21, 22, 21, "w");
  g.rect(40, 11, 42, 11, "f");
  g.rect(4, 18, 6, 18, "=");           // scrap tucked onto a shelf above the crates
  g.rect(29, 19, 31, 19, "=");
  save("storage", "Storage", g, "#151a24", [
    { type: "spawn", x: 3, y: 20 },
    { type: "hint", x: 4, y: 15, text: "the shelves rattle when you walk under them" },
    { type: "pickup", item: "scrap_metal", x: 5, y: 17 },
    { type: "note", x: 12, y: 20, recipe: "recipe_bucket",
      text: "Bend the scrap into a bowl, rope for a handle. The pools refill it forever. Fire hates it. — Subject #22" },
    { type: "pickup", item: "rope", x: 9, y: 17 },
    { type: "hint", x: 20, y: 16, text: "F — scoop water · F — throw it" },
    { type: "note", x: 16, y: 20, recipe: "recipe_hammer",
      text: "Metal on a stick shatters what's brittle. Cracks in stone. Ice. Keep one around. — Subject #31" },
    { type: "hint", x: 29, y: 16, text: "rust doesn't rest on bare ground" },
    { type: "pickup", item: "scrap_metal", x: 30, y: 18 },
    { type: "pickup", item: "rope", x: 26, y: 11 },
    { type: "pickup", item: "plank", x: 28, y: 11 },
    { type: "pickup", item: "scrap_metal", x: 37, y: 11 },
    { type: "checkpoint", x: 38, y: 11 },
    { type: "door", x: 45, y: 11, to: "next" },
  ]);
}

// ---------- 3: The Vents — goo carries fire (52x24) ----------
{
  const g = grid(52, 24);
  frame(g, 21);
  g.rect(20, 1, 35, 13, "#");         // low vent ceiling
  g.rect(6, 21, 8, 21, "w");          // small pool (wash option / bucket refill)
  g.rect(30, 1, 30, 20, "#");         // full-height wall — fire must go under
  // goo duct through the floor, under the wall
  g.rect(26, 22, 37, 22, "G");
  g.set(26, 21, "G");                 // light it here
  g.set(37, 21, "G");                 // it comes up here...
  g.set(37, 20, "G");                 // ...right next to the wood barrier
  g.rect(38, 18, 38, 20, "W");        // barrier gating the door side
  g.rect(11, 18, 13, 18, "=");
  g.rect(44, 18, 46, 18, "=");
  save("vents", "The Vents", g, "#101a17", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 4, y: 20 },
    { type: "pickup", item: "plank", x: 10, y: 20 },
    { type: "hint", x: 11, y: 15, text: "mildew loves a high shelf" },
    { type: "pickup", item: "cloth", x: 12, y: 17 },
    { type: "pickup", item: "plank", x: 14, y: 20 },
    { type: "brazier", x: 17, y: 20 },
    { type: "hint", x: 15, y: 16, text: "goo carries fire. light one end, mind the other" },
    { type: "pickup", item: "glow_mushroom", x: 22, y: 20 },
    { type: "pickup", item: "goo_blob", x: 24, y: 20 },
    { type: "hint", x: 26, y: 17, text: "the duct goes under. so would a flame" },
    { type: "brazier", x: 43, y: 20 },
    { type: "hint", x: 44, y: 15, text: "dust settles where it's still" },
    { type: "pickup", item: "cloth", x: 45, y: 17 },
    { type: "door", x: 49, y: 20, to: "next" },
  ]);
}

// ---------- 4: Cell Block — spark + conduction + Marla (48x24) ----------
{
  const g = grid(48, 24);
  frame(g, 21);
  g.rect(6, 16, 11, 16, "#");
  g.rect(17, 22, 19, 22, ".");
  g.rect(18, 21, 19, 21, "I");
  g.rect(20, 21, 28, 21, "M");
  g.rect(24, 1, 24, 18, "#");
  g.rect(11, 18, 13, 18, "=");
  g.rect(42, 18, 44, 18, "=");
  save("cell_block", "Cell Block B", g, "#1a1420", [
    { type: "spawn", x: 2, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 4, y: 20 },
    { type: "npc", x: 8, y: 20, name: "Marla (#12)", color: "#7fd8e8",
      wants: { item: "glow_mushroom", count: 1 },
      rewardItems: [{ item: "cloth", count: 2 }],
      rewardRecipes: ["recipe_smoke_bomb"],
      dialogAsk: "Psst. #67! Marla. #12. There's a GLOW MUSHROOM sealed under the ice over there — I've been staring at it for a month. Get it out, bring it here, I'll make it worth your while.",
      dialogConfirm: "You HAVE it. The mushroom. Okay. Okay okay okay. Hand it over and my spore recipe is yours. Deal?",
      dialogDone: "Beautiful. Here — cloth I've been hoarding, and the recipe: mushroom spores in a sock. Shake it and everything nearby takes a nap. Poof.",
      dialogAfter: "Go. GO. Wave at the parking lot for me." },
    { type: "pickup", item: "scrap_metal", x: 10, y: 20 },
    { type: "hint", x: 11, y: 15, text: "a cog doesn't roll uphill on its own" },
    { type: "pickup", item: "cog", x: 12, y: 17 },
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
    { type: "hint", x: 42, y: 15, text: "something shines near the exit" },
    { type: "pickup", item: "scrap_metal", x: 43, y: 17 },
    { type: "door", x: 45, y: 20, to: "next" },
  ]);
}

// ---------- 5: The Gap — placeable springs (40x28, floor top 25) ----------
{
  const g = grid(40, 28);
  frame(g, 25);
  g.rect(8, 24, 9, 24, "S");
  g.rect(5, 16, 11, 16, "=");
  g.rect(14, 13, 20, 13, "=");
  g.rect(23, 10, 29, 10, "=");
  g.rect(32, 5, 39, 27, "#");
  g.rect(14, 24, 17, 24, "^");
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

// ---------- 6: Greenhouse — waterfalls, ice, side treasure (64x26, floor 23) ----------
{
  const g = grid(64, 26);
  frame(g, 23);
  g.rect(10, 23, 12, 23, "w");        // small pool (bucket)
  g.rect(15, 19, 15, 22, "W");        // wood door A (burn recap)
  g.rect(20, 23, 27, 23, "w");        // big pool (freeze teach)
  // side treasure: cracked floor pocket on the far bank
  g.rect(31, 24, 33, 24, ".");
  g.set(32, 23, "C");
  g.rect(36, 1, 36, 22, "V");         // THE WATERFALL — no flame passes
  g.rect(44, 19, 44, 22, "I");        // ice wall past the falls (4 tall)
  g.rect(12, 20, 14, 20, "=");
  g.rect(54, 20, 56, 20, "=");
  save("greenhouse", "The Greenhouse", g, "#12201a", [
    { type: "spawn", x: 2, y: 22 },
    { type: "checkpoint", x: 4, y: 22 },
    { type: "pickup", item: "plank", x: 5, y: 22 },
    { type: "pickup", item: "cloth", x: 7, y: 22 },
    { type: "brazier", x: 8, y: 22 },
    { type: "hint", x: 9, y: 19, text: "scoop before you burn" },
    { type: "pickup", item: "scrap_metal", x: 11, y: 22 },
    { type: "hint", x: 12, y: 17, text: "rope hangs. it doesn't just sit around" },
    { type: "pickup", item: "rope", x: 13, y: 19 },
    { type: "checkpoint", x: 17, y: 22 },
    { type: "note", x: 18, y: 22, recipe: "recipe_frost_vial",
      text: "Mushroom cold + goo = winter in a bottle. Water freezes hard enough to walk on. Slick, though. — Subject #28" },
    { type: "pickup", item: "glow_mushroom", x: 19, y: 22 },
    { type: "hint", x: 23, y: 19, text: "cold turns water into floor" },
    { type: "pickup", item: "goo_blob", x: 28, y: 22 },
    { type: "pickup", item: "scrap_metal", x: 29, y: 22 },
    { type: "pickup", item: "plank", x: 30, y: 22 },
    { type: "hint", x: 32, y: 20, text: "something under the cracks" },
    { type: "pickup", item: "warden_plush", x: 32, y: 24 },
    { type: "hint", x: 34, y: 15, text: "flames hate the falls" },
    { type: "pickup", item: "spring_coil", x: 39, y: 22 },
    { type: "pickup", item: "plank", x: 41, y: 22 },
    { type: "hint", x: 46, y: 16, text: "over it, or through it" },
    { type: "checkpoint", x: 49, y: 22 },
    { type: "pickup", item: "glow_mushroom", x: 53, y: 22 },
    { type: "hint", x: 54, y: 17, text: "moss climbs before it spreads" },
    { type: "pickup", item: "goo_blob", x: 55, y: 19 },
    { type: "door", x: 61, y: 22, to: "next" },
  ]);
}

// ---------- 7: Mess Hall — enemy debut (56x24) ----------
{
  const g = grid(56, 24);
  frame(g, 21);
  g.rect(8, 18, 11, 18, "=");
  g.rect(16, 18, 19, 18, "=");
  g.rect(22, 21, 29, 21, "w");        // pool — the drones won't follow
  g.rect(34, 17, 40, 17, "=");
  g.rect(36, 20, 38, 20, "f");
  g.rect(11, 18, 13, 18, "=");
  g.rect(50, 18, 52, 18, "=");
  save("mess_hall", "Mess Hall", g, "#1c1712", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 3, y: 20 },
    { type: "hint", x: 8, y: 14, text: "the specimens are loose. elements are your friends" },
    { type: "pickup", item: "glow_mushroom", x: 5, y: 20 },
    { type: "pickup", item: "goo_blob", x: 7, y: 20 },
    { type: "pickup", item: "scrap_metal", x: 9, y: 17 },
    { type: "hint", x: 11, y: 15, text: "coiled rope, up out of reach of the floor" },
    { type: "pickup", item: "rope", x: 12, y: 17 },
    { type: "enemy", enemy: "crawler", x: 14, y: 20, patrolMinX: 12, patrolMaxX: 20 },
    { type: "pickup", item: "plank", x: 17, y: 17 },
    { type: "pickup", item: "cloth", x: 19, y: 17 },
    { type: "hint", x: 25, y: 15, text: "metal drones won't swim" },
    { type: "locker", x: 32, y: 20 },
    { type: "hint", x: 32, y: 15, text: "E — lockers break line of sight" },
    { type: "checkpoint", x: 33, y: 20 },
    { type: "enemy", enemy: "spotter", x: 44, y: 20, patrolMinX: 41, patrolMaxX: 49 },
    { type: "hint", x: 50, y: 15, text: "warm goo never pools on its own" },
    { type: "pickup", item: "goo_blob", x: 51, y: 17 },
    { type: "pickup", item: "plank", x: 52, y: 20 },
    { type: "door", x: 54, y: 20, to: "next" },
  ]);
}

// ---------- 8: The Vault — the thinker (64x26, floor 23) ----------
{
  const g = grid(64, 26);
  frame(g, 23);
  g.rect(24, 1, 24, 22, "V");         // waterfall splits the room
  // goo fuse-line: down a shaft, under the falls, back up, along the floor
  g.set(18, 23, "G");
  g.rect(18, 24, 26, 24, "G");
  g.set(26, 23, "G");
  g.rect(26, 22, 26, 22, "G");
  g.rect(27, 22, 39, 22, "G");
  g.rect(40, 18, 40, 22, "W");        // wood wall — only fire opens it, and fire can't swim
  g.rect(44, 22, 53, 23, "w");        // the pool that carries the charge — 2 tall,
                                       // deep enough to duck under the column
  g.rect(53, 16, 53, 21, "M");        // metal column: pool -> fuse box (stops short —
                                       // swim under it as an alternate to conducting)
  save("the_vault", "The Vault", g, "#161226", [
    { type: "spawn", x: 2, y: 22 },
    { type: "checkpoint", x: 4, y: 22 },
    { type: "note", x: 6, y: 22,
      text: "The box wants charge. The water carries charge. The wood doesn't care about your hammer. Work backwards. — Subject #3" },
    { type: "pickup", item: "plank", x: 8, y: 22 },
    { type: "pickup", item: "cloth", x: 9, y: 22 },
    { type: "pickup", item: "plank", x: 10, y: 22 },
    { type: "pickup", item: "cog", x: 12, y: 22 },
    { type: "pickup", item: "scrap_metal", x: 13, y: 22 },
    { type: "pickup", item: "scrap_metal", x: 14, y: 22 },
    { type: "brazier", x: 16, y: 22 },
    { type: "hint", x: 15, y: 18, text: "fire finds a way. help it" },
    { type: "hint", x: 32, y: 18, text: "the duct runs under the falls" },
    { type: "checkpoint", x: 42, y: 22 },
    { type: "hint", x: 47, y: 19, text: "don't be in the water when it bites" },
    { type: "fusebox", x: 53, y: 15, fuseId: "B" },
    { type: "door", x: 58, y: 22, gate: true, fuseId: "B" },
    { type: "door", x: 61, y: 22, to: "next" },
  ]);
}

// ---------- 9: The Yard — the action room (72x24) ----------
{
  const g = grid(72, 24);
  frame(g, 21);
  g.rect(18, 21, 20, 21, "w");
  g.rect(24, 20, 26, 20, "f");
  g.rect(32, 17, 35, 17, "=");
  g.rect(36, 21, 38, 21, ".");
  g.rect(36, 22, 38, 22, "^");
  g.rect(42, 16, 45, 16, "=");
  g.rect(46, 20, 49, 20, "G");
  g.rect(50, 21, 52, 21, "w");
  save("the_yard", "The Yard", g, "#221a12", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 3, y: 20 },
    { type: "pickup", item: "torch_lit", x: 6, y: 20 },
    { type: "pickup", item: "bucket", x: 9, y: 20 },
    { type: "enemy", enemy: "crawler", x: 12, y: 20, patrolMinX: 10, patrolMaxX: 16 },
    { type: "enemy", enemy: "spotter", x: 29, y: 20, patrolMinX: 27, patrolMaxX: 33 },
    { type: "pickup", item: "smoke_bomb", x: 33, y: 16 },
    { type: "checkpoint", x: 40, y: 20 },
    { type: "pickup", item: "frost_vial", x: 43, y: 15 },
    { type: "enemy", enemy: "crawler", x: 56, y: 20, patrolMinX: 54, patrolMaxX: 62 },
    { type: "enemy", enemy: "spotter", x: 64, y: 20, patrolMinX: 61, patrolMaxX: 67 },
    { type: "locker", x: 59, y: 20 },
    { type: "pickup", item: "sticky_trap", x: 53, y: 20 },
    { type: "door", x: 70, y: 20, to: "next" },
  ]);
}

// ---------- 10: The Long Run — the Warden, in person (110x24) ----------
{
  const g = grid(110, 24);
  frame(g, 21);
  g.rect(18, 17, 18, 20, "W");        // wood wall (torch provided)
  g.rect(26, 21, 28, 21, ".");
  g.rect(26, 22, 28, 22, "^");        // spike pit
  g.rect(34, 20, 37, 20, "G");        // goo strip — jump it
  g.rect(48, 21, 55, 21, "w");        // wide pool — freeze on the run
  g.rect(64, 17, 64, 20, "C");        // cracked wall (hammer provided)
  g.rect(80, 12, 109, 23, "#");       // final shelf — spring provided
  g.rect(88, 11, 90, 11, "^");        // shelf hazards
  g.rect(96, 11, 98, 11, "G");
  save("the_long_run", "The Long Run", g, "#1c0e14", [
    { type: "spawn", x: 2, y: 20 },
    { type: "checkpoint", x: 3, y: 20 },
    { type: "hint", x: 8, y: 15, text: "RUN." },
    { type: "pickup", item: "torch_lit", x: 12, y: 20 },
    { type: "pickup", item: "frost_vial", x: 44, y: 20 },
    { type: "pickup", item: "hammer", x: 60, y: 20 },
    { type: "checkpoint", x: 68, y: 20 },
    { type: "pickup", item: "spring", x: 73, y: 20 },
    { type: "hint", x: 75, y: 15, text: "up. UP." },
    { type: "exit", x: 105, y: 11 },
  ], { wardenChase: { speed: 118, delayMs: 3000 } });
}

console.log("done");
