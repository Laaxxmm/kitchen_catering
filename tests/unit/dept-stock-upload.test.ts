import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_ROWS,
  cleanText,
  planUpload,
  readStockFile,
  templateCsv,
  type ExistingItem,
} from "@/server/dept-stock-upload";

/**
 * The department stock upload's pure half: reading an untrusted .csv into
 * rows, and planning those rows against the items already in the
 * department. The database half is tests/e2e/dept/upload.test.ts.
 */

const HK = "HOUSEKEEPING" as const;
const MT = "MAINTENANCE" as const;

const csv = (text: string, name = "stock.csv") => ({ name, bytes: new TextEncoder().encode(text) });

const HEADER = "Item name*,Unit*,Opening quantity*,Minimum stock,Cost per unit,Reusable";

function item(over: Partial<ExistingItem> = {}): ExistingItem {
  return {
    id: "item-1",
    name: "Bath Towel",
    unit: "piece",
    active: true,
    currentStock: "10",
    inCirculation: "0",
    minStock: null,
    reusable: true,
    category: null,
    hasHistory: true,
    ...over,
  };
}

describe("reading the file", () => {
  it("reads a CSV with header variants, quotes and CRLF", async () => {
    const rows = await readStockFile(
      csv(
        'ITEM NAME,  unit ,opening QUANTITY,minimum stock,COST PER UNIT,reusable\r\n' +
          '"Towel, bath",piece,40,10,250.5,Yes\r\n' +
          '\r\n' +
          '"Soap ""mini""",pcs,100.125,,,no\r\n',
      ),
      HK,
    );
    expect(rows.map((r) => [r.line, r.name, r.unit, r.qty, r.minStock, r.cost, r.reusable, r.problems])).toEqual([
      [2, "Towel, bath", "piece", "40", "10", "250.5", true, []],
      [4, 'Soap "mini"', "pcs", "100.125", null, null, false, []],
    ]);
  });

  it("reads the department's own columns only", async () => {
    // Category means nothing to housekeeping; Reusable nothing to maintenance.
    const [hk] = await readStockFile(csv(`${HEADER},Category\nTowel,piece,1,,,yes,Bogus`), HK);
    expect(hk).toMatchObject({ reusable: true, category: null, problems: [] });
    const [mt] = await readStockFile(csv(`${HEADER},Category\nFuse,piece,1,,,maybe,mechanical`), MT);
    expect(mt).toMatchObject({ reusable: null, category: "MECHANICAL", problems: [] });
  });

  it("flags bad numbers, blanks and lengths per row, strictly", async () => {
    const rows = await readStockFile(
      csv(
        [
          HEADER,
          "Towel,piece,,,,", // blank qty
          "Sheet,piece,-3,,,", // negative
          "Pillow,piece,1.2345,,,", // 4 dp
          "Duvet,piece,1e3,,,", // not plain
          "Robe,piece,5,,12.345,", // 3 dp money
          "Mat,piece,5,-1,,", // negative min
          `${"x".repeat(161)},piece,1,,,`,
          "Cup,a-unit-that-is-way-too-long,1,,,",
          "=HYPERLINK(1),piece,1,,,",
          "Slipper,piece,1,,,perhaps",
          ",piece,1,,,",
        ].join("\n"),
      ),
      HK,
    );
    expect(rows.map((r) => r.problems)).toEqual([
      ["Opening quantity is blank"],
      ["Opening quantity can't be negative"],
      ['Opening quantity "1.2345" isn\'t a plain number (up to 3 decimals)'],
      ['Opening quantity "1e3" isn\'t a plain number (up to 3 decimals)'],
      ['Cost per unit "12.345" isn\'t a plain number (up to 2 decimals)'],
      ["Minimum stock can't be negative"],
      ["Item name is longer than 160 characters"],
      ["Unit is longer than 20 characters"],
      ["Item name can't start with = + - or @"],
      ['Reusable "perhaps" must be yes or no'],
      ["Item name is blank"],
    ]);
  });

  it("strips control and invisible characters", async () => {
    expect(cleanText("  Bath​ \t towel‮\u0007 ")).toBe("Bath towel");
    const [row] = await readStockFile(csv(`${HEADER}\n"Bath​\ttowel",piece,1,,,`), HK);
    expect(row.name).toBe("Bath towel");
  });

  it("refuses a file without the required header", async () => {
    await expect(readStockFile(csv("Name,Qty\nTowel,4"), HK)).rejects.toThrow(
      /missing "Item name", "Unit", "Opening quantity"/,
    );
    await expect(readStockFile(csv(`${HEADER},Unit\nTowel,piece,1,,,,x`), HK)).rejects.toThrow(/appears twice/);
    await expect(readStockFile(csv(`${HEADER}\n\n`), HK)).rejects.toThrow(/no item rows/);
  });

  it("takes CSV only, and refuses anything else or too big", async () => {
    await expect(readStockFile(csv("x", "stock.txt"), HK)).rejects.toThrow(/Upload a \.csv/);
    await expect(readStockFile(csv(`${HEADER}\nTowel,piece,1,,,`, "stock.xlsx"), HK)).rejects.toThrow(/CSV UTF-8/);
    // A workbook renamed to .csv is still a zip.
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expect(readStockFile({ name: "stock.csv", bytes: zip }, HK)).rejects.toThrow(/CSV UTF-8/);
    await expect(readStockFile({ name: "stock.csv", bytes: new Uint8Array([65, 0, 66]) }, HK)).rejects.toThrow(
      /isn't a text CSV/,
    );
    await expect(
      readStockFile({ name: "stock.csv", bytes: new Uint8Array(1024 * 1024 + 1).fill(65) }, HK),
    ).rejects.toThrow(/larger than 1 MB/);
    await expect(readStockFile({ name: "stock.csv", bytes: new Uint8Array(0) }, HK)).rejects.toThrow(/empty/);
  });

  it("folds look-alike names and refuses mixed alphabets", async () => {
    // Full-width letters and a decomposed é fold to the plain spelling.
    expect(cleanText("Ｔｏｗｅｌ")).toBe("Towel");
    expect(cleanText("Cafe\u0301 mug")).toBe("Café mug");
    expect(cleanText("Bath\u3164towel")).toBe("Bathtowel");
    const rows = await readStockFile(csv(`${HEADER}\nT\u043Ewel,piece,1,,,\nПолотенце,piece,1,,,`), HK);
    expect(rows[0].problems).toEqual(["Item name mixes alphabets (a Cyrillic or Greek letter among Latin ones) — retype it"]);
    expect(rows[1].problems).toEqual([]);
  });

  it(`caps the upload at ${MAX_UPLOAD_ROWS} item rows`, async () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i},piece,1,,,`).join("\n");
    expect(await readStockFile(csv(`${HEADER}\n${body(MAX_UPLOAD_ROWS)}`), HK)).toHaveLength(MAX_UPLOAD_ROWS);
    await expect(readStockFile(csv(`${HEADER}\n${body(MAX_UPLOAD_ROWS + 1)}`), HK)).rejects.toThrow(
      /more than 2000 item rows/,
    );
  });

  it("reads its own template, and won't import the example row", async () => {
    for (const dept of [HK, MT]) {
      const rows = await readStockFile(csv(templateCsv(dept), "template.csv"), dept);
      expect(rows).toHaveLength(1);
      expect(rows[0].problems).toEqual(["This is the template's example row — delete it"]);
    }
  });
});

describe("planning against the department's items", () => {
  const rowsOf = (body: string) => readStockFile(csv(`${HEADER}\n${body}`), HK);

  it("sorts rows into new, update and unchanged, matching names case-insensitively", async () => {
    const plan = planUpload(
      await rowsOf(["  bath towel ,piece,12,,,", "Hand towel,piece,5,2,,", "Soap,pcs,30,,15,no"].join("\n")),
      [item(), item({ id: "item-2", name: "Hand Towel", currentStock: "5", minStock: "2" })],
    );
    expect(plan.rows.map((r) => [r.status, r.itemId, r.notes])).toEqual([
      ["UPDATE", "item-1", ["on hand 10 → 12"]],
      ["UNCHANGED", "item-2", []],
      ["NEW", null, ["new item, opening stock 30"]],
    ]);
    expect(plan.summary).toEqual({ new: 1, update: 1, unchanged: 1, problems: 0 });
  });

  it("is idempotent: the same quantities planned again change nothing", async () => {
    const rows = await rowsOf("Bath towel,pieces,10,4,,yes");
    const plan = planUpload(rows, [item({ minStock: "4.000" })]);
    // "pieces" and "piece" are the same measure.
    expect(plan.rows[0].status).toBe("UNCHANGED");
  });

  it("flags duplicates within the file, and the rows that clash with an item's history", async () => {
    const plan = planUpload(
      await rowsOf(
        [
          "Towel,piece,1,,,",
          "TOWEL,piece,2,,,",
          "Bath towel,kg,1,,,", // unit change on an item with history
          "Robe,piece,1,,,", // inactive
          "Linen,piece,1,,,no", // reusable → consumable while out in rooms
        ].join("\n"),
      ),
      [
        item(),
        item({ id: "item-3", name: "Robe", active: false, currentStock: "0" }),
        item({ id: "item-4", name: "Linen", inCirculation: "6" }),
      ],
    );
    expect(plan.rows.map((r) => [r.status, r.notes])).toEqual([
      ["NEW", ["new item, opening stock 1"]],
      ["PROBLEM", ["Same item as row 2 — keep one row per item"]],
      ["PROBLEM", ['Unit "kg" doesn\'t match "piece" — Bath Towel already has stock or history in piece']],
      ["PROBLEM", ["Robe is inactive — reactivate it before uploading stock for it"]],
      ["PROBLEM", ["Linen has 6 out in rooms — return them before making it a consumable"]],
    ]);
    expect(plan.summary.problems).toBe(4);
  });

  it("relabels the unit of an item that has never held stock", async () => {
    const plan = planUpload(await rowsOf("Bath towel,set,3,,,"), [item({ currentStock: "0", hasHistory: false })]);
    expect(plan.rows[0]).toMatchObject({ status: "UPDATE", set: { unit: "set" } });
  });

  it("refuses a name that matches two existing items differing only in capitals", async () => {
    const plan = planUpload(await rowsOf("bath towel,piece,1,,,"), [item(), item({ id: "item-9", name: "BATH TOWEL" })]);
    expect(plan.rows[0].notes).toEqual(["Matches 2 existing items that differ only in capitals — rename one first"]);
  });

  it("updates a maintenance item's category and min stock", async () => {
    const rows = await readStockFile(
      csv("Item name*,Unit*,Opening quantity*,Minimum stock,Category\nFuse,piece,4,2,Electrical"),
      MT,
    );
    const plan = planUpload(rows, [
      item({ name: "Fuse", currentStock: "4", reusable: null, category: "GENERAL", minStock: null }),
    ]);
    expect(plan.rows[0]).toMatchObject({
      status: "UPDATE",
      set: { minStock: "2", category: "ELECTRICAL" },
      notes: ["min stock — → 2", "category General → Electrical"],
    });
  });
});
