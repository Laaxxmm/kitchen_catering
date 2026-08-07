import { beforeAll, describe, expect, it } from "vitest";
import { BanquetItemSource } from "@prisma/client";
import { db } from "@/server/db";
import {
  resetEverythingKeepParties,
  resetTransactionalData,
} from "@/server/actions/admin-reset";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asNobody,
  asStore,
  desk,
  ensureSeeded,
  expectRefused,
  seeded,
} from "./harness";

/**
 * Go-live rehearsal. The client wipes production and imports a fresh
 * catalogue; if this sequence doesn't work, nothing else matters.
 */

beforeAll(async () => {
  await ensureSeeded();
});

describe("clean slate then import", () => {
  it("loaded the client's real catalogue", async () => {
    const [kitchen, inhouse, hired] = await Promise.all([
      db.ingredient.count(),
      db.banquetItem.count({ where: { source: BanquetItemSource.IN_HOUSE } }),
      db.banquetItem.count({ where: { source: BanquetItemSource.HIRED } }),
    ]);
    expect({ kitchen, inhouse, hired }).toEqual({ kitchen: 405, inhouse: 154, hired: 42 });
  });

  it("left no legacy catalogue rows behind", async () => {
    // The data-migrations seed ~362 legacy ingredients under STR-nnnn codes.
    // Every surviving row must carry a GP code from the new import.
    const nonGp = await db.ingredient.count({ where: { NOT: { sku: { startsWith: "GP-" } } } });
    expect(nonGp).toBe(0);
  });

  it("wound the item-code counters past the imported codes", async () => {
    const counter = await db.gPItemCodeSequence.findUnique({ where: { year: 0 } });
    // Highest imported kitchen code + 1 — the next GP code handed out must
    // not collide with one already printed on a shelf label.
    const all = await db.ingredient.findMany({ select: { sku: true } });
    const maxN = all.reduce((m, i) => {
      const match = /^GP-(\d+)$/.exec(i.sku);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    expect(counter?.next).toBe(maxN + 1);
  });

  it("kept the six desks and the master data the seed put back", async () => {
    const fixtures = seeded();
    const [customer, vendor, dishes, users] = await Promise.all([
      db.customer.findUnique({ where: { id: fixtures.customerId } }),
      db.vendor.findUnique({ where: { id: fixtures.vendorId } }),
      db.dish.count(),
      db.user.count(),
    ]);
    expect(customer?.name).toBe("E2E Catering Client");
    expect(vendor?.approvalStatus).toBe("APPROVED");
    expect(dishes).toBe(2);
    expect(users).toBe(6);
  });

  it("gave every desk a distinct real user row", async () => {
    const ids = [asAdmin(), asManager(), asChef(), asStore(), asDelivery(), asAccounts()].map(
      (u) => u.id,
    );
    expect(new Set(ids).size).toBe(6);
    const rows = await db.user.findMany({ where: { id: { in: ids } }, select: { role: true } });
    expect(rows.map((r) => r.role).sort()).toEqual([
      "ACCOUNTS",
      "ADMIN",
      "DELIVERY",
      "KITCHEN_HEAD",
      "MANAGER",
      "STORE_KEEPER",
    ]);
  });

  it("recorded who pressed the button, in a log it had just emptied", async () => {
    const row = await db.auditLog.findFirst({
      where: { action: "FULL_RESET" },
      orderBy: { at: "desc" },
    });
    expect(row?.userId).toBe(desk("admin").id);
  });
});

describe("who may wipe the system", () => {
  it("refuses every desk but admin", async () => {
    for (const become of [asManager, asChef, asStore, asDelivery, asAccounts]) {
      become();
      await expectRefused(() => resetEverythingKeepParties("ERASE EVERYTHING"));
      await expectRefused(() => resetTransactionalData("RESET"));
    }
    asNobody();
    await expectRefused(() => resetEverythingKeepParties("ERASE EVERYTHING"));
  });

  it("refuses admin without the exact confirmation phrase", async () => {
    asAdmin();
    const message = await expectRefused(() => resetEverythingKeepParties("erase everything"));
    expect(message).toContain("ERASE EVERYTHING");
    // And the catalogue is still standing.
    expect(await db.ingredient.count()).toBe(405);
  });
});
