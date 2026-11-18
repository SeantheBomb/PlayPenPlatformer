// Which moments can a tile (or placed item) actually have? Derived from the
// engine's own data — tile fields plus rules.json through the SAME
// parseRuleLine/first-match logic room.ts uses — so the Art Studio's Effects
// panel only ever offers a moment the game can really raise for that tile.
// tests/vfx-moments.test.ts drives rooms headlessly and proves each listed
// moment fires (and that unlisted ones don't).
import type { Content, ItemDef, RuleDef, TileDef } from "../data/types";
import { parseRuleLine, type ParsedRule } from "./room";

export interface TileMoment {
  key: string;
  /** Element moments: the actor element that causes it (stages apply it). */
  actor?: string;
  /** Applied just before `actor` when the moment needs a state first (water
   *  only puts out a tile that's already burning). */
  prime?: string;
  /** Why the engine raises it, in plain words. */
  why: string;
}

function ruleOf(r: RuleDef): ParsedRule | null {
  if (typeof r.rule === "string" && r.rule.trim() !== "") return parseRuleLine(r.rule);
  if (r.actor && r.effect) {
    return { actor: r.actor, target: r.target || undefined, targetProperty: r.targetProperty || undefined, effect: r.effect } as ParsedRule;
  }
  return null;
}

const isFluid = (t: TileDef) => !!t.fluid || t.style === "water";

/** Mirror of RoomRuntime.findRule: the FIRST rule for this actor that
 *  matches the tile decides what happens. */
function firstRule(rules: RuleDef[], actor: string, tile: TileDef): ParsedRule | undefined {
  for (const r of rules) {
    const p = ruleOf(r);
    if (!p || p.actor !== actor) continue;
    if (p.target) { if (p.target === tile.element) return p; continue; }
    if (p.targetProperty && (tile as unknown as Record<string, unknown>)[p.targetProperty]) return p;
  }
  return undefined;
}

export function tileMoments(content: Pick<Content, "rules">, tile: TileDef): TileMoment[] {
  const out: TileMoment[] = [];
  const add = (m: TileMoment) => { if (!out.some((o) => o.key === m.key)) out.push(m); };
  if (tile.bounce) add({ key: "bounce", why: "it launches the player (bounce)" });
  else if (tile.solid || tile.oneWay) add({ key: "land", why: "the player can land on it" });
  if (isFluid(tile)) {
    add({ key: "enter", why: "the player can step into it" });
    add({ key: "exit", why: "the player can step out of it" });
  }
  if (tile.fallSpawns) {
    add({ key: "fallImpact:fluid", why: "it's a fall — where it pours into a pool" });
    add({ key: "fallImpact:solid", why: "it's a fall — where it hits the ground" });
  }
  const actors = [...new Set(content.rules.map((r) => ruleOf(r)?.actor).filter((a): a is string => !!a))];
  for (const actor of actors) {
    const p = firstRule(content.rules, actor, tile);
    if (!p) continue;
    const rule = `${actor} + ${p.target ?? p.targetProperty} → ${p.effect}`;
    switch (p.effect) {
      case "ignite":
        if (tile.flammable) {
          add({ key: "ignite", actor, why: `rule ${rule}` });
          add({ key: "burnout", actor, why: "it burns, then burns out" });
        }
        break;
      case "melt": if (tile.meltsTo !== undefined) add({ key: "melt", actor, why: `rule ${rule}` }); break;
      case "freeze": if (tile.freezesTo && tile.element) add({ key: "freeze", actor, why: `rule ${rule}` }); break;
      case "energize": if (tile.conductive) add({ key: "energize", actor, why: `rule ${rule}` }); break;
      case "extinguish": case "dissolve": case "shatter": case "fizzle":
        add({ key: p.effect, actor, why: `rule ${rule}` });
        break;
    }
  }
  // Water puts out a burning flammable tile without any rule (room.ts).
  if (tile.flammable && !out.some((o) => o.key === "extinguish")) {
    add({ key: "extinguish", actor: "water", prime: "fire", why: "water puts out a burning tile" });
  }
  add({ key: "ambient", why: "plays all the time on every copy on screen" });
  return out;
}

export function itemMoments(item: ItemDef): TileMoment[] {
  if (item.placeType === "spring") return [{ key: "bounce", why: "placed, it launches the player" }];
  return [];
}

/** The fluid tile at a point, if any (enter/exit moments compare this step
 *  to step). Pure — Game.fluidMoments uses it, so do the tests. */
export function fluidAt(map: { at(tx: number, ty: number): TileDef | null }, x: number, y: number): TileDef | null {
  const def = map.at(Math.floor(x / 16), Math.floor(y / 16));
  return def && isFluid(def) ? def : null;
}
