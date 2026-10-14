// FIRST import, always — pins DATABASE_URL to the e2e container.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { StockStore, StoreAdjustmentKind, StoreDepartment } from "@prisma/client";
import { db } from "@/server/db";
import { applyDeptStockUpload, previewDeptStockUpload } from "@/server/actions/dept-stock-upload";
import { upsertHousekeepingItem } from "@/server/actions/housekeeping";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import { getStoreStock } from "@/server/actions/store-stock";
import { GET as templateRoute } from "@/app/api/dept-stock-template/[department]/route";
import {
  asAdmin,
  asHousekeeping,
  asMaintenance,
  asManager,
  asNobody,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
} from "../harness";

/**
 * The one-time department stock upload, end to end: management previews
 * and applies a sheet, new items arrive on an opening receipt, existing items
 * are set by an ADJUSTED record, a second run changes nothing, one bad row
 * stops the whole file, and the department heads cannot upload at all —
 * after go-live they maintain stock through jobs and stock requests. Plus the other half of the go-live: housekeeping is no longer
 * a store the kitchen desk can move stock into, and each department's
 * on-hand is read only by its own head and management.
 *
 * The database is shared with other suites, so every item carries a suffix.
 */

const tag = Date.now();
const HK = StoreDepartment.HOUSEKEEPING;
const MT = StoreDepartment.MAINTENANCE;
const HK_HEADER = "Item name*,Unit*,Opening quantity*,Minimum stock,Cost per unit,Reusable";

function sheet(lines: string[], header = HK_HEADER): FormData {
  const fd = new FormData();
  fd.append("file", new Blob([[header, ...lines].join("\n")], { type: "text/csv" }), "stock.csv");
  return fd;
}

const towel = `Towel ${tag}`;
const soap = `Soap ${tag}`;
const robe = `Robe ${tag}`;
const HK_FILE = [`${towel.toUpperCase()},pieces,12,3,,yes`, `${soap},pcs,40,10,15.50,no`, `${robe},piece,0,,,yes`];

let towelId: string;

const hkItem = (name: string) =>
  db.housekeepingItem.findUniqueOrThrow({
    where: { name },
    include: { receiptLines: { include: { receipt: true } }, adjustments: { orderBy: { at: "asc" } } },
  });

beforeAll(async () => {
  await ensureSeeded();
  asHousekeeping();
  towelId = mustOk(
    await upsertHousekeepingItem({ name: towel, unit: "piece", reusable: true, openingStock: "5" }),
    "towel",
  ).id;
});

describe("management uploads the housekeeping shelf", () => {
  it("previews without writing anything", async () => {
    asManager();
    const plan = mustOk(await previewDeptStockUpload(HK, sheet(HK_FILE)), "preview");
    expect(plan.summary).toEqual({ new: 2, update: 1, unchanged: 0, problems: 0 });
    expect(plan.rows.map((r) => [r.line, r.status, r.notes])).toEqual([
      [2, "UPDATE", ["on hand 5 → 12", "min stock — → 3"]],
      [3, "NEW", ["new item, opening stock 40"]],
      [4, "NEW", ["new item, opening stock 0"]],
    ]);
    expect(await db.housekeepingItem.count({ where: { name: soap } })).toBe(0);
  });

  it("creates new items on an opening receipt and sets existing ones through an ADJUSTED record", async () => {
    asManager();
    const res = mustOk(await applyDeptStockUpload(HK, sheet(HK_FILE)), "apply");
    expect(res).toMatchObject({ created: 2, updated: 1, unchanged: 0 });

    const s = await hkItem(soap);
    expectDecimal(s.currentStock, "40", "soap on hand");
    expectDecimal(s.minStock, "10", "soap min stock");
    expect(s.reusable).toBe(false);
    expect(s.receiptLines).toHaveLength(1);
    expectDecimal(s.receiptLines[0].quantity, "40", "soap opening line");
    expectDecimal(s.receiptLines[0].costPerUnit, "15.5", "soap cost");
    expect(s.receiptLines[0].receipt).toMatchObject({
      sourceNote: "Opening balance (stock upload)",
      sourceContact: "Opening balance",
    });

    // Zero is "never counted": an item, but no receipt line.
    const r = await hkItem(robe);
    expectDecimal(r.currentStock, "0", "robe on hand");
    expect(r.reusable).toBe(true);
    expect(r.receiptLines).toHaveLength(0);

    // The existing towel, matched case-insensitively: set, not added to.
    const t = await hkItem(towel);
    expect(t.id).toBe(towelId);
    expect(t.unit).toBe("piece"); // "pieces" is the same measure; the label stays
    expectDecimal(t.currentStock, "12", "towel on hand");
    expectDecimal(t.minStock, "3", "towel min stock");
    expect(t.adjustments).toHaveLength(1);
    expect(t.adjustments[0]).toMatchObject({ kind: StoreAdjustmentKind.ADJUSTED, reason: "Stock upload" });
    expectDecimal(t.adjustments[0].beforeQty, "5", "before");
    expectDecimal(t.adjustments[0].afterQty, "12", "after");
    expectDecimal(t.adjustments[0].delta, "7", "delta");

    expect(
      await db.auditLog.count({ where: { action: "HK_STOCK_UPLOADED", entityId: s.receiptLines[0].receiptId } }),
    ).toBe(1);
  });

  it("changes nothing when the same file is applied again", async () => {
    asManager();
    const counts = async () => ({
      receipts: await db.housekeepingReceiptLine.count({ where: { item: { name: { in: [towel, soap, robe] } } } }),
      adjustments: await db.housekeepingAdjustment.count({ where: { item: { name: { in: [towel, soap, robe] } } } }),
      audits: await db.auditLog.count({ where: { action: "HK_STOCK_UPLOADED" } }),
    });
    const before = await counts();
    const plan = mustOk(await previewDeptStockUpload(HK, sheet(HK_FILE)), "preview again");
    expect(plan.summary).toEqual({ new: 0, update: 0, unchanged: 3, problems: 0 });
    expect(mustOk(await applyDeptStockUpload(HK, sheet(HK_FILE)), "apply again")).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 3,
    });
    expect(await counts()).toEqual(before);
    expectDecimal((await hkItem(towel)).currentStock, "12", "towel still");
  });

  it("applies nothing when a single row has a problem", async () => {
    asManager();
    const bad = `Bad ${tag}`;
    const file = () => sheet([`${towel},piece,15,,,yes`, `${bad},piece,abc,,,`]);
    const plan = mustOk(await previewDeptStockUpload(HK, file()), "preview with a problem");
    expect(plan.summary.problems).toBe(1);
    expect(plan.rows[1].notes).toEqual(['Opening quantity "abc" isn\'t a plain number (up to 3 decimals)']);

    expect(await expectRefused(() => applyDeptStockUpload(HK, file()))).toMatch(/1 row has a problem.*Nothing was changed/);
    expectDecimal((await hkItem(towel)).currentStock, "12", "towel untouched");
    expect(await db.housekeepingItem.count({ where: { name: bad } })).toBe(0);
  });

  it("sets a recount on existing items without posting a receipt", async () => {
    asManager();
    const receiptsBefore = await db.housekeepingReceipt.count();
    expect(mustOk(await applyDeptStockUpload(HK, sheet([`${towel},piece,15,,,`])), "recount")).toMatchObject({
      created: 0,
      updated: 1,
    });
    expect(await db.housekeepingReceipt.count()).toBe(receiptsBefore);
    const t = await hkItem(towel);
    expectDecimal(t.currentStock, "15", "towel recounted");
    expectDecimal(t.minStock, "3", "min stock left alone when the column is blank");
    expect(t.adjustments.map((a) => [a.beforeQty.toString(), a.afterQty.toString()])).toEqual([
      ["5", "12"],
      ["12", "15"],
    ]);
  });
});

describe("each department is its own", () => {
  const MT_HEADER = "Item name*,Unit*,Opening quantity*,Category";

  it("lets management upload maintenance spares, with their category", async () => {
    asAdmin();
    const fuse = `Fuse ${tag}`;
    mustOk(await applyDeptStockUpload(MT, sheet([`${fuse},piece,8,Electrical`], MT_HEADER)), "maintenance upload");
    const item = await db.maintenanceItem.findUniqueOrThrow({ where: { name: fuse }, include: { receiptLines: true } });
    expect(item.category).toBe("ELECTRICAL");
    expectDecimal(item.currentStock, "8", "fuse on hand");
    expect(item.receiptLines).toHaveLength(1);
  });

  it("keeps both heads and the store keeper out of the upload", async () => {
    for (const as of [asHousekeeping, asMaintenance]) {
      as();
      for (const call of [previewDeptStockUpload, applyDeptStockUpload]) {
        expect(await expectRefused(() => call(MT, sheet(["X,piece,1"], MT_HEADER)))).toMatch(/^Requires one of/);
        expect(await expectRefused(() => call(HK, sheet(HK_FILE)))).toMatch(/^Requires one of/);
      }
    }
    asStore();
    for (const dept of [HK, MT]) {
      expect(await expectRefused(() => applyDeptStockUpload(dept, sheet(HK_FILE)))).toMatch(/^Requires one of/);
    }
    asAdmin();
    expect(await expectRefused(() => previewDeptStockUpload("KITCHEN" as StoreDepartment, sheet(HK_FILE)))).toBe(
      "Unknown department",
    );
    expectDecimal((await hkItem(towel)).currentStock, "15", "towel untouched by the refusals");
  });

  it("refuses the store keeper a transfer into housekeeping", async () => {
    const soapRow = await hkItem(soap);
    const ingredient = await db.ingredient.findFirstOrThrow({ where: { active: true }, select: { id: true } });
    asStore();
    expect(
      await expectRefused(() =>
        recordStockTransfer({
          transferredAt: istInput(new Date()),
          fromStore: StockStore.KITCHEN,
          fromItemId: ingredient.id,
          toStore: StockStore.HOUSEKEEPING,
          toItemId: soapRow.id,
          quantity: "1",
        }),
      ),
    ).toMatch(/Housekeeping runs its own store/);
    expectDecimal((await hkItem(soap)).currentStock, "40", "soap untouched");
  });

  it("lets only a department's own head (and management) read its on-hand", async () => {
    asHousekeeping();
    expect((await getStoreStock("housekeeping")).itemCount).toBeGreaterThan(0);
    expect(await expectRefused(() => getStoreStock("maintenance"))).toMatch(/^Requires one of/);
    asMaintenance();
    expect((await getStoreStock("maintenance")).itemCount).toBeGreaterThan(0);
    expect(await expectRefused(() => getStoreStock("housekeeping"))).toMatch(/^Requires one of/);
    asStore();
    expect(await expectRefused(() => getStoreStock("housekeeping"))).toMatch(/^Requires one of/);
    expect(await expectRefused(() => getStoreStock("maintenance"))).toMatch(/^Requires one of/);
    expect((await getStoreStock("banquet")).itemCount).toBeGreaterThanOrEqual(0);
    asAdmin();
    await expect(getStoreStock("kitchen" as "banquet")).rejects.toThrow("Unknown store");
  });
});

describe("the template download", () => {
  const get = (slug: string) =>
    templateRoute(new Request(`http://localhost/api/dept-stock-template/${slug}`), {
      params: Promise.resolve({ department: slug }),
    });

  it("checks the session and the department itself", async () => {
    asManager();
    const ok = await get("housekeeping");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toMatch(/housekeeping-stock-template\.csv/);
    // UTF-8 BOM first so Excel opens it cleanly, then the header.
    const body = Buffer.from(await ok.arrayBuffer());
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.subarray(3).toString("utf8")).toMatch(/^Item name\*,Unit\*,Opening quantity\*/);
    expect((await get("maintenance")).status).toBe(200);
    asHousekeeping();
    expect((await get("housekeeping")).status).toBe(403);
    asMaintenance();
    expect((await get("maintenance")).status).toBe(403);
    asStore();
    expect((await get("housekeeping")).status).toBe(403);
    asNobody();
    expect((await get("housekeeping")).status).toBe(401);
    asAdmin();
    expect((await get("kitchen")).status).toBe(404);
  });
});
