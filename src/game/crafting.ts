// Combine-two crafting, Little Alchemy style. Order never matters.
import type { Content, RecipeDef } from "../data/types";
import type { RunState } from "./state";

export interface CraftResult {
  ok: boolean;
  recipe?: RecipeDef;
  outputId?: string;
  firstTime?: boolean;
}

export function findRecipe(content: Content, a: string, b: string): RecipeDef | undefined {
  return content.recipes.find((r) => {
    const [x, y] = r.inputs;
    return (x === a && y === b) || (x === b && y === a);
  });
}

/**
 * Break a crafted item back into its recipe inputs (softlock escape hatch).
 * Transformed carriers resolve to their base form first (lit torch -> torch,
 * full bucket -> bucket) so their recipe can be found.
 */
export function tryDismantle(
  content: Content, state: RunState, id: string
): { ok: boolean; inputs?: string[]; baseName?: string } {
  if (!state.has(id)) return { ok: false };
  // Walk transformation chains back to the craftable base item.
  let baseId = id;
  for (let hops = 0; hops < 4; hops++) {
    const def = content.items.find((i) => i.id === baseId);
    const back = def?.dousesTo ?? def?.emptiesTo;
    if (!back) break;
    baseId = back;
  }
  const recipe = content.recipes.find((r) => r.output === baseId);
  if (!recipe) return { ok: false };
  state.remove(id);
  for (const input of recipe.inputs) state.add(input);
  const baseName = content.items.find((i) => i.id === baseId)?.name ?? baseId;
  return { ok: true, inputs: [...recipe.inputs], baseName };
}

export function tryCraft(content: Content, state: RunState, a: string, b: string): CraftResult {
  const recipe = findRecipe(content, a, b);
  if (!recipe) return { ok: false };
  if (!state.has(a) || !state.has(b)) return { ok: false };
  if (a === b && state.count(a) < 2) return { ok: false };
  state.remove(a);
  state.remove(b);
  state.add(recipe.output);
  const firstTime = !state.craftedRecipes.has(recipe.id);
  state.craftedRecipes.add(recipe.id);
  if (!state.knownRecipes.has(recipe.id)) {
    state.knownRecipes.add(recipe.id);
    state.stats.discoveries++;
  }
  state.stats.crafts++;
  return { ok: true, recipe, outputId: recipe.output, firstTime };
}
