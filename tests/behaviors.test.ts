// The behavior system's customization contract: content-authored penscript
// and field overrides actually change gameplay — no engine edits. These cover
// the three things the system exists for: composing behaviors onto defs,
// overriding script fields per attachment, and the global sim tunables
// (including the two knobs Sean asked for: melt chain range and fluid side
// bias). Plus the compiler itself.
import { describe, expect, it } from "vitest";
import { RoomRuntime } from "../src/game/room";
import { compileScript, lintScript } from "../src/game/penscript";

const TRIGGERS_FOR_TEST = ["tick", "flowTick", "elementContact", "use", "heldTick", "carriedTick"];
import type {
  BehaviorDef, Content, EnemyDef, RoomDef, RoomEntity, RuleDef, TileDef,
} from "../src/data/types";
import type { RoomMutations } from "../src/game/state";
import { setSimTime } from "../src/engine/simclock";
import tilesJson from "../content/tiles.json";
import gameJson from "../content/game.json";
import rulesJson from "../content/rules.json";
import behaviorsJson from "../content/behaviors.json";
import entitiesJson from "../content/entities.json";
import enemiesJson from "../content/enemies.json";

const TILES = tilesJson as TileDef[];
const BEHAVIORS = behaviorsJson as unknown as BehaviorDef[];
const ENEMIES = enemiesJson as unknown as EnemyDef[];

function makeContent(opts: {
  behaviors?: BehaviorDef[];
  enemies?: EnemyDef[];
  rules?: RuleDef[];
} = {}): Content {
  return {
    game: gameJson as Content["game"],
    elements: [],
    rules: opts.rules ?? [],
    behaviors: opts.behaviors ?? BEHAVIORS,
    entityTypes: entitiesJson,
    achievements: [],
    tiles: TILES,
    items: [],
    recipes: [],
    enemies: opts.enemies ?? ENEMIES,
    taunts: [],
    campaign: { rooms: [] },
    rooms: {},
  } as unknown as Content;
}

function makeMuts(): RoomMutations {
  return {
    collected: new Set(), tileOverrides: [], openedDoors: new Set(),
    gateTouched: new Set(), helpedNpcs: new Set(), disabledEnemies: new Set(),
    drops: [], placedItems: [], brazierLit: [],
  };
}

function makeRoom(rows: string[], content: Content, entities: RoomEntity[] = []): RoomRuntime {
  const room: RoomDef = {
    id: "test", name: "test", width: rows[0].length, height: rows.length,
    background: "#000", tiles: rows, entities,
  } as RoomDef;
  return new RoomRuntime(room, content, makeMuts());
}

/** Deep-copy the shipped library and rewrite one doc's `var name = ...;`
 *  line — exactly the edit Sean would make in the script pane. */
function withVar(docId: string, name: string, valueSrc: string): BehaviorDef[] {
  const lib = JSON.parse(JSON.stringify(BEHAVIORS)) as BehaviorDef[];
  const doc = lib.find((b) => b.id === docId)!;
  let hit = false;
  doc.script = doc.script.map((line) => {
    if (new RegExp(`^\\s*var\\s+${name}\\b`).test(line)) {
      hit = true;
      return `var ${name} = ${valueSrc};`;
    }
    return line;
  });
  if (!hit) throw new Error(`no var ${name} in ${docId}`);
  return lib;
}

const crawler = ENEMIES.find((e) => e.id === "crawler")!;
const charAt = (rt: RoomRuntime, x: number, y: number) => rt.map.at(x, y)?.char ?? ".";

const FLOOR_ROOM = [
  "#..........#",
  "#..........#",
  "#..........#",
  "############",
];

describe("penscript compiler", () => {
  it("compiles the whole shipped behavior library clean", () => {
    for (const doc of BEHAVIORS) {
      const { errors } = compileScript(doc.script.join("\n"));
      expect(errors, `${doc.id} should compile`).toEqual([]);
    }
  });

  it("reports syntax errors with line numbers", () => {
    const { errors } = compileScript("on tick {\n  if state == 3 { }\n}");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBe(2); // missing parens around the condition
  });

  it("anchors errors at a real column/length, not just the line (editor squiggle placement)", () => {
    // "state" is found where "(" was expected — the squiggle belongs on
    // "state" itself (col 5, length 5 in "  if state == 3 { }"), not col 0.
    const src = "on tick {\n  if state == 3 { }\n}";
    const { errors } = compileScript(src);
    const line2 = errors.find((e) => e.line === 2)!;
    expect(line2.col).toBe(5);
    expect(line2.len).toBe(5);
    expect(src.split("\n")[1].slice(line2.col, line2.col + line2.len)).toBe("state");
  });

  it("anchors an EOF error ('before end of script') at the actual end position", () => {
    const src = "on tick {\n  halt;\n"; // missing closing "}"
    const { errors } = compileScript(src);
    expect(errors.length).toBeGreaterThan(0);
    const last = errors[errors.length - 1];
    expect(last.line).toBe(3); // one line past the trailing newline
    expect(last.col).toBe(0);
  });

  it("anchors unknown-function lint errors at the call site", () => {
    const src = "on tick {\n  totallyMadeUp(1, 2);\n}";
    const { script } = compileScript(src);
    const errs = lintScript(script!, TRIGGERS_FOR_TEST, () => false);
    const e = errs.find((x) => x.message.includes("totallyMadeUp"))!;
    expect(e.line).toBe(2);
    expect(src.split("\n")[1].slice(e.col, e.col! + e.len!)).toBe("totallyMadeUp");
  });

  it("always terminates on malformed input (editor live-typing safety)", () => {
    // Regression: a stray statement keyword at the top level used to stall
    // the parser's error recovery in an infinite loop, hanging the editor.
    const nasty = [
      "if seesPlayer(range)) { state = \"chase\"; }",
      "on tick { if (x { } }",
      "var = ;",
      "} } } on { { {",
      "on tick {",
    ];
    for (const src of nasty) {
      const { errors } = compileScript(src);
      expect(errors.length, `should error, not hang: ${src}`).toBeGreaterThan(0);
    }
  });

  it("evaluates expressions with TS-style semantics (??, &&, ternary)", () => {
    // Exercised through a room: a script that computes its field from host.
    const doc: BehaviorDef = {
      id: "exprCheck", host: "enemy",
      script: [
        "var a = host.chaseSpeed ?? host.speed * 2;",
        "var b = host.missing ?? \"fallback\";",
        "var c = host.speed > 50 ? 1 : 0;",
      ],
    };
    const content = makeContent({ behaviors: [...BEHAVIORS, doc] });
    const rt = makeRoom(FLOOR_ROOM, content);
    const fields = rt.bhv.resolvedFields("exprCheck", crawler as unknown as Record<string, unknown>);
    expect(fields.a).toBe(110);         // crawler: no chaseSpeed, speed 55
    expect(fields.b).toBe("fallback");
    expect(fields.c).toBe(1);
  });
});

describe("custom behavior scripts replace engine behavior without engine changes", () => {
  it("a content-authored elementContact script overrides the reactions table", () => {
    // A crawler variant whose fire response is a 1s stun, NOT the reactions
    // table's kill — purely by swapping one attachment in content.
    const customDoc: BehaviorDef = {
      id: "fireStunsInstead",
      host: "enemy",
      script: [
        "on elementContact(element) {",
        "  if (element == \"fire\") { stun(1000); }",
        "}",
      ],
    };
    const variant: EnemyDef = {
      ...crawler,
      id: "crawler_damp",
      behaviors: [
        "hazardReactions",
        "fireStunsInstead", // <- replaces elementReactions
        { id: "stunCycle", params: { wakeTo: "patrol" } },
        "patrolRoute", "groundedMove",
      ],
    };
    const content = makeContent({
      behaviors: [...BEHAVIORS, customDoc],
      enemies: [...ENEMIES, variant],
    });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_damp", x: 5, y: 2 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const events = rt.applyElementToEnemies("fire", { x: en.x - 2, y: en.y - 2, w: 24, h: 24 }, 3000);
    expect(events.some((e) => e.effect === "enemy_stun")).toBe(true);
    expect(rt.enemies.length).toBe(1); // NOT killed, unlike a stock crawler
    expect(en.state).toBe("stunned");
    // The custom stun used its own 1000ms, not the passed stunMs (3000).
    setSimTime(11_100);
    rt.update(1 / 60, null, 3000, () => {});
    expect(en.state).toBe("patrol");
  });

  it("attachment params override a script's field defaults", () => {
    const speedy: EnemyDef = {
      ...crawler,
      id: "crawler_speedy",
      behaviors: [
        { id: "patrolRoute", params: { speed: 200 } }, // vs. host.speed = 55
        "groundedMove",
      ],
    };
    const content = makeContent({ enemies: [...ENEMIES, speedy] });
    const rt = makeRoom(FLOOR_ROOM, content, [
      { type: "enemy", enemy: "crawler_speedy", x: 2, y: 2, patrolMinX: 1, patrolMaxX: 20 } as RoomEntity,
    ]);
    setSimTime(10_000);
    const en = rt.enemies[0];
    const x0 = en.x;
    for (let i = 0; i < 30; i++) rt.update(1 / 60, null, 0, () => {});
    const moved = en.x - x0;
    expect(moved).toBeGreaterThan(200 * 0.5 * 0.8); // ~100px in half a second
  });
});

describe("global sim tunables (behaviors.json global docs)", () => {
  it("heatSpread.chainMeltRange = 0 stops the melt at direct lava contact", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withVar("heatSpread", "chainMeltRange", "0"),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // touching lava: melts
    expect(charAt(rt, 2, 0)).toBe("M"); // chain suppressed
    expect(charAt(rt, 3, 0)).toBe("M");
  });

  it("heatSpread.chainMeltRange = 1 lets the melt travel exactly one tile further", () => {
    const content = makeContent({
      rules: rulesJson as RuleDef[],
      behaviors: withVar("heatSpread", "chainMeltRange", "1"),
    });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe(".");
    expect(charAt(rt, 2, 0)).toBe("."); // one tile of chain
    expect(charAt(rt, 3, 0)).toBe("M"); // no further
  });

  it("default chainMeltRange (-1) keeps the unlimited chain (the shipped behavior)", () => {
    const content = makeContent({ rules: rulesJson as RuleDef[] });
    const rt = makeRoom(["LMMMM."], content);
    for (let i = 0; i < 8; i++) rt.update(0.7, null, 0, () => {});
    for (let x = 1; x <= 4; x++) expect(charAt(rt, x, 0)).toBe(".");
  });

  it("fluidFlow.sideBias pins which side finite fluid commits to (the slosh knob)", () => {
    // One water tile perched on a one-tile pillar, open holes both sides —
    // exactly the can't-pick-a-direction shape. A pinned bias must commit.
    const rows = [
      "#..........#",
      "#....w.....#", // water at (5,1)
      "#....#.....#", // pillar at (5,2)
      "#..........#",
      "############",
    ];
    const tickOnce = (rt: RoomRuntime) =>
      (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);

    const left = makeRoom(rows, makeContent({ behaviors: withVar("fluidFlow", "sideBias", '"left"') }));
    tickOnce(left);
    expect(charAt(left, 4, 1)).toBe("w"); // moved left
    expect(charAt(left, 6, 1)).toBe(".");

    const right = makeRoom(rows, makeContent({ behaviors: withVar("fluidFlow", "sideBias", '"right"') }));
    tickOnce(right);
    expect(charAt(right, 6, 1)).toBe("w"); // moved right
    expect(charAt(right, 4, 1)).toBe(".");
  });

  describe("fluidFlow.sideBias = \"lower\" (falls toward the deeper-connected side)", () => {
    const tickOnce = (rt: RoomRuntime) =>
      (rt as never as { tickWaterFlow(ev: unknown[]): void }).tickWaterFlow([]);
    const lowerContent = () => makeContent({ behaviors: withVar("fluidFlow", "sideBias", '"lower"') });

    it("prefers the side whose floor is further down when the right side is deeper", () => {
      // Water perched on a pillar at (5,1); left (x=4) has a shallow floor
      // two rows down (y=3), right (x=6) stays open until y=5 — genuinely
      // more room to fall, not just a wider single opening.
      const rows = [
        "#...........#",
        "#....w......#", // water at (5,1)
        "#....#......#", // pillar at (5,2)
        "#...#.......#", // shallow floor at x=4 (left depth = 2)
        "#...........#",
        "#############", // deep floor (right depth = 4)
      ];
      const rt = makeRoom(rows, lowerContent());
      tickOnce(rt);
      expect(charAt(rt, 6, 1)).toBe("w"); // moved to the deeper (right) side
      expect(charAt(rt, 4, 1)).toBe(".");
    });

    it("prefers the side whose floor is further down when the left side is deeper", () => {
      // Mirror image: right (x=6) has the shallow floor, left (x=4) is deep.
      const rows = [
        "#...........#",
        "#....w......#",
        "#....#......#",
        "#.....#.....#", // shallow floor at x=6 (right depth = 2)
        "#...........#",
        "#############", // deep floor (left depth = 4)
      ];
      const rt = makeRoom(rows, lowerContent());
      tickOnce(rt);
      expect(charAt(rt, 4, 1)).toBe("w"); // moved to the deeper (left) side
      expect(charAt(rt, 6, 1)).toBe(".");
    });

    it("falls back to the alternating flip on an equal-depth tie", () => {
      // Same symmetric shape as the slosh-knob test above — both sides tie
      // in depth, so "lower" degrades to the same flip-based order
      // "alternate" uses (flowSideFlip toggles true on the very first tick
      // of a fresh room, which biases the first tie-break rightward).
      const rows = [
        "#..........#",
        "#....w.....#",
        "#....#.....#",
        "#..........#",
        "############",
      ];
      const rt = makeRoom(rows, lowerContent());
      tickOnce(rt);
      expect(charAt(rt, 6, 1)).toBe("w");
      expect(charAt(rt, 4, 1)).toBe(".");
    });
  });

  it("rules.json pattern lines drive the element table (lava + metal -> melt)", () => {
    const content = makeContent({ rules: rulesJson as RuleDef[] });
    const rt = makeRoom(["LM."], content);
    rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe("."); // melted via the pattern line
  });

  it("legacy split-field rules (stale saves) still work", () => {
    const legacy: RuleDef[] = [
      { id: "old_style", actor: "lava", target: "metal", effect: "melt" },
    ];
    const content = makeContent({ rules: legacy });
    const rt = makeRoom(["LM."], content);
    rt.update(0.7, null, 0, () => {});
    expect(charAt(rt, 1, 0)).toBe(".");
  });
});
