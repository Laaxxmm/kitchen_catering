"use server";

import { revalidatePath } from "next/cache";

import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { InventoryAuditPostInput } from "@/lib/validators";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD];

/**
 * Monthly physical-count adjustment. For each line where the storekeeper's
 * physical count differs from system onHandQty:
 *   - physical < system → IngredientIssue (adjustment OUT) at current avg cost
 *   - physical > system → IngredientReceipt (adjustment IN) at current avg cost
 *     (deliberate convention: keeps avgUnitCost stable; the "found" stock
 *     is treated as zero-cost reclamation — defensible for monthly audits)
 * Ingredient.onHandQty is set exactly to physical at the end.
 *
 * Requires a DRAFT order in the DB to anchor the adjustment issues, since
 * IngredientIssue.orderId is non-nullable. Phase 2 uses a magic "audit"
 * order if available, otherwise raises an error.
 */
export async function listAuditTargets() {
  await requireRole(READ_ROLES);
  return db.ingredient.findMany({
    where: { active: true },
    select: {
      id: true, sku: true, name: true, unit: true, onHandQty: true, avgUnitCost: true, reorderLevel: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function postInventoryAudit(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = InventoryAuditPostInput.parse(raw);

  // Find or create a sentinel "audit" order to anchor adjustment issues.
  // IngredientIssue.orderId is required by the schema, but adjustment
  // issues don't belong to a real customer order. We park them on a
  // permanent housekeeping order with code "AUDIT-ADJUSTMENTS".
  const auditOrder = await ensureAuditOrder();

  const result = await db.$transaction(async (tx) => {
    const changes: Array<{ ingredient: string; from: string; to: string; delta: string }> = [];

    for (const lineInput of input.lines) {
      const ing = await tx.ingredient.findUnique({
        where: { id: lineInput.ingredientId },
        select: { id: true, name: true, unit: true, onHandQty: true, avgUnitCost: true },
      });
      if (!ing) continue;

      const system = toDecimal(ing.onHandQty);
      const physical = toDecimal(lineInput.physicalCount);
      if (physical.lt(0)) throw new Error(`Physical count cannot be negative for ${ing.name}`);
      const delta = physical.minus(system);
      if (delta.eq(0)) continue;

      if (delta.gt(0)) {
        // Adjustment IN — receipt at current avg cost (no drift)
        await tx.ingredientReceipt.create({
          data: {
            ingredientId: ing.id,
            qty: delta.toString(),
            unitCost: ing.avgUnitCost.toString(),
            supplier: null,
            note: `Monthly audit adjustment IN${input.notes ? `: ${input.notes}` : ""}`,
            receivedAt: new Date(),
          },
        });
      } else {
        // Adjustment OUT — issue at current avg cost
        await tx.ingredientIssue.create({
          data: {
            ingredientId: ing.id,
            orderId: auditOrder.id,
            qty: delta.abs().toString(),
            unitCostAtIssue: ing.avgUnitCost.toString(),
            issuedById: session.user.id,
            issuedAt: new Date(),
            note: `Monthly audit adjustment OUT${input.notes ? `: ${input.notes}` : ""}`,
          },
        });
      }

      await tx.ingredient.update({
        where: { id: ing.id },
        data: { onHandQty: physical.toDecimalPlaces(3).toString() },
      });

      changes.push({
        ingredient: ing.name,
        from: system.toString(),
        to: physical.toString(),
        delta: delta.toString(),
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "INVENTORY_AUDIT_ADJUSTMENT",
          entity: "Ingredient",
          entityId: ing.id,
          payloadHash: sha256Json({ from: system.toString(), to: physical.toString(), delta: delta.toString() }),
        },
      });
    }

    return changes;
  });

  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/audit");
  return { changes: result };
}

/**
 * Lazily create a permanent "audit adjustments" anchor order so monthly
 * adjustment issues have somewhere to land. The order is in DRAFT and
 * never moves through approval; it exists purely as a parent for issues.
 */
async function ensureAuditOrder() {
  const existing = await db.order.findFirst({ where: { code: "AUDIT-ADJUSTMENTS" } });
  if (existing) return existing;

  // Need a customer to anchor it. Reuse or create a sentinel customer.
  let sentinelCustomer = await db.customer.findFirst({ where: { name: "[System: audit adjustments]" } });
  if (!sentinelCustomer) {
    sentinelCustomer = await db.customer.create({
      data: {
        name: "[System: audit adjustments]",
        billingAddress: "n/a",
        stateCode: "29",
        notes: "System-managed sentinel for monthly inventory audit adjustments. Do not edit.",
        active: false,
      },
    });
  }
  // Sentinel admin user as creator
  const admin = await db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("Cannot create audit anchor — no ADMIN user found");

  return db.order.create({
    data: {
      code: "AUDIT-ADJUSTMENTS",
      customerId: sentinelCustomer.id,
      eventDate: new Date("2099-12-31"),
      headcount: 1,
      mealType: "CUSTOM",
      deliveryAddress: "n/a",
      deliveryWindowStart: new Date("2099-12-31"),
      deliveryWindowEnd: new Date("2099-12-31"),
      placeOfSupplyStateCode: "29",
      contractValue: "0",
      status: "DRAFT",
      createdById: admin.id,
      notes: "System-managed sentinel order; anchors monthly inventory audit adjustment issues.",
    },
  });
}
