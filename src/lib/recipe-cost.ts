import { Decimal } from "decimal.js";
import { db } from "@/server/db";
import { toDecimal } from "./money";

// Recipe-based ingredient costing. Unlike the issue-based actual cost (which
// only sees ingredients physically issued from the store), this prices the
// WHOLE recipe of each dish — every ingredient it needs, including ones that
// were already sitting in the store and used without a fresh purchase. That's
// the true cost of goods for profitability.
//
// Handles wastage %, nested sub-recipes (recursive, cycle-guarded) and the
// recipe yield (cost is scaled to one yield-unit, then × the order's portions).

interface LoadedRecipe {
  id: string;
  yieldQty: Decimal;
  ingredients: { qty: Decimal; wastagePercent: Decimal; avgCost: Decimal }[];
  children: { quantity: Decimal; childId: string }[];
}

async function loadRecipes(): Promise<Map<string, LoadedRecipe>> {
  const recipes = await db.recipe.findMany({
    where: { active: true },
    select: {
      id: true,
      yieldQty: true,
      ingredients: {
        select: {
          qty: true,
          wastagePercent: true,
          ingredient: { select: { avgUnitCost: true } },
        },
      },
      childLinks: { select: { quantity: true, childId: true } },
    },
  });
  const map = new Map<string, LoadedRecipe>();
  for (const r of recipes) {
    map.set(r.id, {
      id: r.id,
      yieldQty: toDecimal(r.yieldQty),
      ingredients: r.ingredients.map((ri) => ({
        qty: toDecimal(ri.qty),
        wastagePercent: toDecimal(ri.wastagePercent),
        avgCost: toDecimal(ri.ingredient.avgUnitCost),
      })),
      children: r.childLinks.map((c) => ({ quantity: toDecimal(c.quantity), childId: c.childId })),
    });
  }
  return map;
}

/** Cost to produce ONE yield-unit of a recipe (ingredients + sub-recipes). */
function unitCost(
  recipeId: string,
  recipes: Map<string, LoadedRecipe>,
  memo: Map<string, Decimal>,
  stack: Set<string>,
): Decimal {
  const cached = memo.get(recipeId);
  if (cached) return cached;
  if (stack.has(recipeId)) return new Decimal(0); // cyclic sub-recipe guard
  const r = recipes.get(recipeId);
  if (!r) return new Decimal(0);

  stack.add(recipeId);
  let total = new Decimal(0);
  for (const ing of r.ingredients) {
    const withWastage = ing.qty.times(new Decimal(1).plus(ing.wastagePercent.div(100)));
    total = total.plus(withWastage.times(ing.avgCost));
  }
  for (const ch of r.children) {
    total = total.plus(ch.quantity.times(unitCost(ch.childId, recipes, memo, stack)));
  }
  stack.delete(recipeId);

  const perUnit = r.yieldQty.gt(0) ? total.div(r.yieldQty) : total;
  memo.set(recipeId, perUnit);
  return perUnit;
}

/**
 * Total recipe-based ingredient cost for a set of order lines (dish × portions).
 * Dishes without a recipe contribute 0 (the caller falls back to issued cost).
 */
export async function computeOrderRecipeCost(
  items: Array<{ dishId: string; portions: Decimal }>,
): Promise<Decimal> {
  if (items.length === 0) return new Decimal(0);

  const dishRecipes = await db.recipe.findMany({
    where: { dishId: { in: items.map((i) => i.dishId) } },
    select: { id: true, dishId: true },
  });
  const recipeByDish = new Map(dishRecipes.map((r) => [r.dishId as string, r.id]));
  if (recipeByDish.size === 0) return new Decimal(0);

  const recipes = await loadRecipes();
  const memo = new Map<string, Decimal>();
  let total = new Decimal(0);
  for (const it of items) {
    const recipeId = recipeByDish.get(it.dishId);
    if (!recipeId) continue;
    const perPortion = unitCost(recipeId, recipes, memo, new Set());
    total = total.plus(perPortion.times(it.portions));
  }
  return total.toDecimalPlaces(2);
}
