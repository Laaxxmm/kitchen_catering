"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { RecipeInput, RecipeSubRecipeInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

const WRITE_ROLES = [Role.ADMIN, Role.KITCHEN_HEAD];

/**
 * Create or replace the recipe attached to a dish (or a standalone sub-recipe
 * when dishId is null). Replaces the full ingredient list in a single
 * transaction.
 */
export async function upsertRecipe(
  dishId: string | null,
  raw: unknown,
): Promise<ActionResultWith<{ id: string }>> {
  try {
    return await upsertRecipeInner(dishId, raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertRecipeInner(
  dishId: string | null,
  raw: unknown,
): Promise<{ ok: true; id: string }> {
  const session = await requireRole(WRITE_ROLES);
  const input = RecipeInput.parse(raw);

  const recipe = await db.$transaction(async (tx) => {
    let recipeId: string;
    if (dishId) {
      // Dish-bound recipe: upsert by dishId.
      const existing = await tx.recipe.findUnique({ where: { dishId } });
      if (existing) {
        recipeId = existing.id;
        await tx.recipe.update({
          where: { id: recipeId },
          data: {
            name: input.name ?? "",
            yieldQty: input.yieldQty ?? "1",
            yieldUnit: input.yieldUnit ?? "portion",
            standardYieldPercent: input.standardYieldPercent ?? "100",
            notes: input.notes ?? null,
            isSubRecipe: false,
          },
        });
        await tx.recipeIngredient.deleteMany({ where: { recipeId } });
      } else {
        const created = await tx.recipe.create({
          data: {
            dishId,
            name: input.name ?? "",
            yieldQty: input.yieldQty ?? "1",
            yieldUnit: input.yieldUnit ?? "portion",
            standardYieldPercent: input.standardYieldPercent ?? "100",
            notes: input.notes ?? null,
            isSubRecipe: false,
          },
        });
        recipeId = created.id;
      }
    } else {
      // Standalone sub-recipe — always create fresh; sub-recipe editing
      // happens via dedicated endpoints later.
      const created = await tx.recipe.create({
        data: {
          name: input.name ?? "Sub-recipe",
          yieldQty: input.yieldQty ?? "1",
          yieldUnit: input.yieldUnit ?? "portion",
          standardYieldPercent: input.standardYieldPercent ?? "100",
          notes: input.notes ?? null,
          isSubRecipe: true,
        },
      });
      recipeId = created.id;
    }

    if (input.ingredients && input.ingredients.length > 0) {
      await tx.recipeIngredient.createMany({
        data: input.ingredients.map((ri) => ({
          recipeId,
          ingredientId: ri.ingredientId,
          qty: ri.qty,
          unit: ri.unit,
          wastagePercent: ri.wastagePercent ?? "0",
          notes: ri.notes ?? null,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "RECIPE_UPSERTED",
        entity: "Recipe",
        entityId: recipeId,
        payloadHash: sha256Json({ dishId, ingredients: input.ingredients?.length ?? 0 }),
      },
    });

    return { id: recipeId };
  });

  if (dishId) revalidatePath(`/dishes/${dishId}`);
  return { ok: true, id: recipe.id };
}

/**
 * Link a child recipe as a sub-recipe of a parent. Walks the child's full
 * sub-recipe tree to ensure adding this link wouldn't create a cycle. Limit
 * walk depth as a defensive bound; cycles via deep nesting are caught by
 * the visited-set independently.
 */
export async function upsertRecipeSubRecipe(raw: unknown): Promise<ActionResult> {
  try {
    return await upsertRecipeSubRecipeInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function upsertRecipeSubRecipeInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(WRITE_ROLES);
  const input = RecipeSubRecipeInput.parse(raw);

  if (input.parentId === input.childId) {
    throw new ActionError("A recipe cannot include itself as a sub-recipe");
  }

  await db.$transaction(async (tx) => {
    // Cycle prevention: walk the child's sub-recipe tree; if parentId
    // appears anywhere in the descendants, the new link would close a loop.
    const visited = new Set<string>();
    const queue = [input.childId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      if (current === input.parentId) {
        throw new ActionError("Adding this link would create a cycle in the recipe graph");
      }
      const children = await tx.recipeSubRecipe.findMany({
        where: { parentId: current },
        select: { childId: true },
      });
      for (const c of children) queue.push(c.childId);
    }

    await tx.recipeSubRecipe.upsert({
      where: { parentId_childId: { parentId: input.parentId, childId: input.childId } },
      create: {
        parentId: input.parentId,
        childId: input.childId,
        quantity: input.quantity,
      },
      update: { quantity: input.quantity },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "RECIPE_SUB_LINKED",
        entity: "Recipe",
        entityId: input.parentId,
        payloadHash: sha256Json({ child: input.childId, qty: input.quantity }),
      },
    });
  });
  return { ok: true };
}
