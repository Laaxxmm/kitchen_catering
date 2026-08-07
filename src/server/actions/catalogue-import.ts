"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";
import { actionFailure, type ActionResultWith } from "@/server/action-result";
import {
  importCatalogue,
  type CatalogueImportSummary,
} from "@/server/catalogue-import";

// Loads the client's three replacement catalogues (405 kitchen items, 154
// in-house F&B, 42 hired) from data/catalogue/. ADMIN only, and in-app
// because production has no shell — this is the second half of go-live, run
// straight after the clean-slate reset.
//
// Safe to press twice: the import is idempotent and all-or-nothing (see
// src/server/catalogue-import.ts), so a re-run updates names/units/rates and
// leaves live stock and the opening receipt exactly as they are.

export async function importCatalogueFromFiles(): Promise<
  ActionResultWith<CatalogueImportSummary>
> {
  try {
    const session = await requireRole([Role.ADMIN]);
    const summary = await importCatalogue(db, session.user.id);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CATALOGUE_IMPORT",
        entity: "System",
        entityId: "catalogue-import",
        payloadHash: sha256Json(summary),
      },
    });

    revalidatePath("/inventory/ingredients");
    revalidatePath("/banquet/items");
    revalidatePath("/admin/settings");

    return { ok: true, ...summary };
  } catch (err) {
    return actionFailure(err);
  }
}
