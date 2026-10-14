import { Decimal } from "decimal.js";
import { MaintenanceCategory, Role, StoreDepartment } from "@prisma/client";
import { unitsEquivalent } from "@/lib/units";

/**
 * One-time department stock upload — the pure half. Reads a .csv that
 * management filled in and plans it against the department's current
 * items. No database, no session: the action in
 * src/server/actions/dept-stock-upload.ts loads the items, re-plans on apply
 * and does the writes.
 *
 * CSV only, by decision (14 Oct security review): parsing an untrusted
 * .xlsx with exceljs let a 6 KB workbook exhaust the server's memory (a
 * merge or column range is expanded cell by cell) and a crafted zip slip
 * past any size pre-check. A CSV is read by the small parser below, with a
 * 1 MB cap, strict numbers, and names normalised (NFKC, invisible and
 * format characters stripped, mixed alphabets refused) so a look-alike
 * cannot become a second "Towel". In Excel: File → Save As → CSV UTF-8.
 *
 * Errors are plain `Error`s on purpose: actionFailure passes their message
 * through, and importing the server ActionError would drag NextAuth into the
 * unit tests.
 */

export const MAX_UPLOAD_BYTES = 1024 * 1024;
export const MAX_UPLOAD_ROWS = 2000;

/**
 * Who may upload. Management only: "we upload the stock once, and they
 * maintain it" — after go-live a department's stock moves through its jobs,
 * issues and approved stock requests, never through another bulk file.
 */
export const UPLOAD_ROLES: Record<StoreDepartment, Role[]> = {
  HOUSEKEEPING: [Role.ADMIN, Role.MANAGER],
  MAINTENANCE: [Role.ADMIN, Role.MANAGER],
};

export function parseDepartment(raw: unknown): StoreDepartment {
  if (raw === StoreDepartment.HOUSEKEEPING || raw === StoreDepartment.MAINTENANCE) return raw;
  throw new Error("Unknown department");
}

type Field = "name" | "unit" | "qty" | "minStock" | "cost" | "reusable" | "category";

const COLUMNS: Array<{ field: Field; header: string; only?: StoreDepartment }> = [
  { field: "name", header: "Item name*" },
  { field: "unit", header: "Unit*" },
  { field: "qty", header: "Opening quantity*" },
  { field: "minStock", header: "Minimum stock" },
  { field: "cost", header: "Cost per unit" },
  { field: "reusable", header: "Reusable", only: StoreDepartment.HOUSEKEEPING },
  { field: "category", header: "Category", only: StoreDepartment.MAINTENANCE },
];
const REQUIRED: Field[] = ["name", "unit", "qty"];

const columnsFor = (dept: StoreDepartment) => COLUMNS.filter((c) => !c.only || c.only === dept);
const label = (field: Field) => COLUMNS.find((c) => c.field === field)!.header.replace("*", "");
/** "Item name*" / "item  NAME" / "ItemName" → "itemname". */
const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** The template: header row and one example row the user overwrites. */
export function templateSheet(dept: StoreDepartment): { header: string[]; example: Array<string | number> } {
  const header = columnsFor(dept).map((c) => c.header);
  const example =
    dept === StoreDepartment.HOUSEKEEPING
      ? ["Bath towel (example - delete this row)", "piece", 40, 10, 250, "yes"]
      : ["LED bulb 9W (example - delete this row)", "piece", 25, 5, 90, "Electrical"];
  return { header, example };
}

/** The template as CSV text (UTF-8 with BOM so Excel opens it cleanly). */
export function templateCsv(dept: StoreDepartment): string {
  const { header, example } = templateSheet(dept);
  const esc = (v: string | number) => {
    const t = String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "\uFEFF" + [header, example].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// ─── Reading the file ─────────────────────────────────────────────────────

/** A formula or an error cell: never a value we will trust. */
type Cell = string | null;

/**
 * Whitespace runs (tabs, newlines, NBSP, line separators) become one space;
 * remaining control characters, zero-width and bidi-override characters are
 * dropped — a name that renders the same as another but isn't is a
 * duplicate nobody can see.
 */
export function cleanText(s: string): string {
  return s
    // Compatibility forms fold together: decomposed "é", full-width letters,
    // ligatures — the same name typed two ways is one name.
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    // Control and format characters (zero-width, bidi, soft hyphen, tags,
    // joiners) and the filler characters that render as blanks.
    .replace(/[\p{Cc}\p{Cf}\u034F\u115F\u1160\u3164\uFFA0\uFE00-\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case- and whitespace-insensitive identity of an item name. */
export const nameKey = (name: string) => cleanText(name).toLowerCase();

function bad(msg: string): Error {
  return new Error(msg);
}

/** A non-blank row of the sheet, with the row number the user sees. */
interface SheetRow {
  line: number;
  cells: Cell[];
}

const tooManyRows = () =>
  bad(`The file has more than ${MAX_UPLOAD_ROWS} item rows — upload ${MAX_UPLOAD_ROWS} or fewer at a time.`);

/** RFC 4180: quoted fields, "" escapes, CRLF / LF / CR line ends. Blank lines are skipped. */
function readCsv(bytes: Uint8Array): SheetRow[] {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Excel's plain "CSV" save is Windows-1252, not UTF-8.
    text = new TextDecoder("latin1").decode(bytes);
  }
  text = text.replace(/^\uFEFF/, "");
  const rows: SheetRow[] = [];
  let line = 1;
  let cells: Cell[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    cells.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    if (cells.some((c) => c !== "")) {
      rows.push({ line, cells });
      if (rows.length > MAX_UPLOAD_ROWS + 1) throw tooManyRows();
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && field === "" && !wasQuoted) {
      quoted = wasQuoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
      line++;
    } else {
      field += ch;
    }
  }
  if (quoted) throw bad('The CSV has a quote mark that is never closed — check the row with the stray " mark.');
  endRow();
  return rows;
}

// ─── Rows ────────────────────────────────────────────────────────────────

export interface UploadRow {
  /** The row number the user sees in their spreadsheet (header = 1). */
  line: number;
  name: string;
  unit: string;
  /** Normalised decimal strings; null = blank / not given / unusable. */
  qty: string | null;
  minStock: string | null;
  cost: string | null;
  reusable: boolean | null;
  category: MaintenanceCategory | null;
  problems: string[];
}

const QTY = /^\d{1,11}(\.\d{1,3})?$/; // Decimal(14, 3)
const MONEY = /^\d{1,10}(\.\d{1,2})?$/; // Decimal(12, 2)
const FORMULA_START = /^[=+\-@]/;

const short = (s: string) => (s.length > 24 ? `${s.slice(0, 24)}…` : s);

function number(
  raw: string,
  field: Field,
  re: RegExp,
  dp: number,
  problems: string[],
): string | null {
  if (raw === "") return null;
  if (/^-\d/.test(raw)) {
    problems.push(`${label(field)} can't be negative`);
    return null;
  }
  if (!re.test(raw)) {
    problems.push(`${label(field)} "${short(raw)}" isn't a plain number (up to ${dp} decimals)`);
    return null;
  }
  return new Decimal(raw).toString();
}

function text(raw: string, field: Field, max: number, problems: string[]): string {
  if (raw === "") problems.push(`${label(field)} is blank`);
  else if (raw.length > max) problems.push(`${label(field)} is longer than ${max} characters`);
  else if (FORMULA_START.test(raw)) problems.push(`${label(field)} can't start with = + - or @`);
  return raw.slice(0, max);
}

const YES = new Set(["yes", "y", "true"]);
const NO = new Set(["no", "n", "false"]);
const CATEGORY = new Map<string, MaintenanceCategory>([
  ["electrical", MaintenanceCategory.ELECTRICAL],
  ["mechanical", MaintenanceCategory.MECHANICAL],
  ["general", MaintenanceCategory.GENERAL],
]);

function toRows(sheet: SheetRow[], dept: StoreDepartment): UploadRow[] {
  const headerAt = sheet.findIndex((r) => r.cells.some((c) => typeof c === "string" && cleanText(c) !== ""));
  if (headerAt < 0) throw bad("The file is empty.");

  const byHeader = new Map(columnsFor(dept).map((c) => [headerKey(c.header), c.field]));
  const colOf = new Map<Field, number>();
  sheet[headerAt].cells.forEach((c, i) => {
    const field = typeof c === "string" ? byHeader.get(headerKey(c)) : undefined;
    if (!field) return;
    if (colOf.has(field)) throw bad(`The "${label(field)}" column appears twice.`);
    colOf.set(field, i);
  });
  const missing = REQUIRED.filter((f) => !colOf.has(f));
  if (missing.length > 0) {
    throw bad(
      `The first row must be the header — missing ${missing.map((f) => `"${label(f)}"`).join(", ")}. Download the template and copy your rows into it.`,
    );
  }

  const rows: UploadRow[] = [];
  for (const { line, cells } of sheet.slice(headerAt + 1)) {
    const problems: string[] = [];
    const values = new Map<Field, string>();
    for (const [field, col] of colOf) {
      const c = cells[col];
      values.set(field, c == null ? "" : cleanText(c));
    }
    if (problems.length === 0 && [...values.values()].every((v) => v === "")) continue;
    // A formula cell already has its problem; don't also call it blank.
    const has = (f: Field) => !colOf.has(f) || values.has(f);
    const v = (f: Field) => values.get(f) ?? "";

    if (has("qty") && v("qty") === "") problems.push(`${label("qty")} is blank`);
    const name = has("name") ? text(v("name"), "name", 160, problems) : "";
    if (name.length === 1) problems.push(`${label("name")} is too short`);
    // "Tоwel" with a Cyrillic о reads as "Towel" and would become a second item.
    if (/\p{Script=Latin}/u.test(name) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name)) {
      problems.push(`${label("name")} mixes alphabets (a Cyrillic or Greek letter among Latin ones) — retype it`);
    }
    if (/\(example - delete this row\)/i.test(name)) {
      problems.push("This is the template's example row — delete it");
    }
    const unit = has("unit") ? text(v("unit"), "unit", 20, problems) : "";

    const reusableRaw = v("reusable").toLowerCase();
    const reusable = YES.has(reusableRaw) ? true : NO.has(reusableRaw) ? false : null;
    if (reusableRaw !== "" && reusable === null) problems.push(`Reusable "${short(reusableRaw)}" must be yes or no`);
    const categoryRaw = v("category").toLowerCase();
    const category = CATEGORY.get(categoryRaw) ?? null;
    if (categoryRaw !== "" && category === null) {
      problems.push(`Category "${short(categoryRaw)}" must be Electrical, Mechanical or General`);
    }

    rows.push({
      line,
      name,
      unit,
      qty: number(v("qty"), "qty", QTY, 3, problems),
      minStock: number(v("minStock"), "minStock", QTY, 3, problems),
      cost: number(v("cost"), "cost", MONEY, 2, problems),
      reusable,
      category,
      problems,
    });
  }
  if (rows.length === 0) throw bad("The file has a header but no item rows.");
  if (rows.length > MAX_UPLOAD_ROWS) throw tooManyRows();
  return rows;
}

/**
 * Untrusted upload → rows. Throws (with a message fit for the user) when the
 * file as a whole is unusable; row-level faults come back as `problems`.
 */
export async function readStockFile(
  file: { name: string; bytes: Uint8Array },
  dept: StoreDepartment,
): Promise<UploadRow[]> {
  const { bytes } = file;
  if (bytes.length === 0) throw bad("That file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw bad("That file is larger than 1 MB — upload the stock sheet on its own.");
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (ext === "xlsx" || ext === "xls" || isZip) {
    throw bad("Upload a .csv file — in Excel use File → Save As → CSV UTF-8 (Comma delimited).");
  }
  if (ext === "csv") {
    if (bytes.includes(0)) throw bad("That file is named .csv but isn't a text CSV.");
    return toRows(readCsv(bytes), dept);
  }
  throw bad("Upload a .csv file (download the template to start).");
}

// ─── Plan ────────────────────────────────────────────────────────────────

export interface ExistingItem {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  currentStock: string;
  /** Housekeeping reusables out in rooms; "0" for maintenance. */
  inCirculation: string;
  minStock: string | null;
  /** Housekeeping only; null for maintenance. */
  reusable: boolean | null;
  /** Maintenance only; null for housekeeping. */
  category: MaintenanceCategory | null;
  /** Any receipt / issue / job line — the unit then can't be relabelled. */
  hasHistory: boolean;
}

export type RowStatus = "NEW" | "UPDATE" | "UNCHANGED" | "PROBLEM";

export interface PlanRow extends Omit<UploadRow, "problems"> {
  status: RowStatus;
  /** PROBLEM: why. NEW / UPDATE: what will change. */
  notes: string[];
  /** The matched item (UPDATE / UNCHANGED). */
  itemId: string | null;
  /** On-hand before the upload, for the matched item. */
  before: string | null;
  /** Item fields an UPDATE writes besides on-hand. */
  set: { unit?: string; minStock?: string; reusable?: boolean; category?: MaintenanceCategory };
}

export interface UploadPlan {
  rows: PlanRow[];
  summary: { new: number; update: number; unchanged: number; problems: number };
}

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

export function planUpload(rows: UploadRow[], existing: ExistingItem[]): UploadPlan {
  const byKey = new Map<string, ExistingItem[]>();
  for (const e of existing) {
    const k = nameKey(e.name);
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const firstLine = new Map<string, number>();

  const planned = rows.map((r): PlanRow => {
    const { problems: rowProblems, ...fields } = r;
    const problems = [...rowProblems];
    const changes: string[] = [];
    const set: PlanRow["set"] = {};
    let item: ExistingItem | undefined;

    if (r.name !== "") {
      const key = nameKey(r.name);
      const first = firstLine.get(key);
      if (first !== undefined) problems.push(`Same item as row ${first} — keep one row per item`);
      else firstLine.set(key, r.line);
      const matches = byKey.get(key) ?? [];
      if (matches.length > 1) {
        problems.push(`Matches ${matches.length} existing items that differ only in capitals — rename one first`);
      }
      item = matches.length === 1 ? matches[0] : undefined;
    }

    if (item) {
      if (!item.active) problems.push(`${item.name} is inactive — reactivate it before uploading stock for it`);
      if (r.unit !== "" && !unitsEquivalent(r.unit, item.unit)) {
        const hasStock = new Decimal(item.currentStock).gt(0) || new Decimal(item.inCirculation).gt(0);
        if (hasStock || item.hasHistory) {
          problems.push(
            `Unit "${r.unit}" doesn't match "${item.unit}" — ${item.name} already has stock or history in ${item.unit}`,
          );
        } else {
          set.unit = r.unit;
          changes.push(`unit ${item.unit} → ${r.unit}`);
        }
      }
      if (r.qty !== null && !new Decimal(r.qty).eq(item.currentStock)) {
        changes.push(`on hand ${new Decimal(item.currentStock).toString()} → ${r.qty}`);
      }
      if (r.minStock !== null && (item.minStock === null || !new Decimal(r.minStock).eq(item.minStock))) {
        set.minStock = r.minStock;
        changes.push(`min stock ${item.minStock === null ? "—" : new Decimal(item.minStock).toString()} → ${r.minStock}`);
      }
      if (r.reusable !== null && item.reusable !== null && r.reusable !== item.reusable) {
        if (!r.reusable && new Decimal(item.inCirculation).gt(0)) {
          problems.push(`${item.name} has ${item.inCirculation} out in rooms — return them before making it a consumable`);
        } else {
          set.reusable = r.reusable;
          changes.push(r.reusable ? "becomes reusable" : "becomes a consumable");
        }
      }
      if (r.category !== null && item.category !== null && r.category !== item.category) {
        set.category = r.category;
        changes.push(`category ${CATEGORY_LABEL[item.category]} → ${CATEGORY_LABEL[r.category]}`);
      }
    } else if (problems.length === 0) {
      changes.push(`new item, opening stock ${r.qty}`);
    }

    const status: RowStatus =
      problems.length > 0 ? "PROBLEM" : !item ? "NEW" : changes.length > 0 ? "UPDATE" : "UNCHANGED";
    return {
      ...fields,
      status,
      notes: status === "PROBLEM" ? problems : changes,
      itemId: item?.id ?? null,
      before: item ? new Decimal(item.currentStock).toString() : null,
      set,
    };
  });

  const count = (s: RowStatus) => planned.filter((r) => r.status === s).length;
  return {
    rows: planned,
    summary: { new: count("NEW"), update: count("UPDATE"), unchanged: count("UNCHANGED"), problems: count("PROBLEM") },
  };
}
