import { Prisma } from "@prisma/client";
import { getFyForDate } from "./fy";

/**
 * Atomic FY-scoped document-number generators. Each variant pairs with
 * its own `*-Sequence` model in schema.prisma.
 *
 * Claiming is a single upsert statement:
 *   INSERT ... ON CONFLICT ("year") DO UPDATE SET "next" = "next" + 1 RETURNING "next"
 * Postgres serialises concurrent claimers on the row lock inside that one
 * statement, so two users creating documents at the same instant can never
 * receive the same number (the old find-then-update pattern could, which
 * surfaced as P2002 unique-constraint crashes under multi-user load).
 *
 * The row is seeded with next=2 ("1 has just been handed out"), so the
 * claimed value is always RETURNING "next" - 1 on both insert and update
 * paths.
 *
 * Always call inside an outer `db.$transaction(async (tx) => …)`.
 */

type Tx = Prisma.TransactionClient;

async function nextSequenceValue(
  tx: Tx,
  tableName:
    | "OrderCodeSequence"
    | "QuoteNumberSequence"
    | "CustomerInvoiceNumberSequence"
    | "ChefRequisitionNumberSequence"
    | "BanquetRequisitionNumberSequence"
    | "DeliveryNumberSequence"
    | "ProductionJobNumberSequence"
    | "VendorPONumberSequence"
    | "GRNNumberSequence"
    | "VendorBillNumberSequence"
    | "VendorCodeSequence"
    | "GPItemCodeSequence"
    | "GPInhouseItemCodeSequence"
    | "GPHiredItemCodeSequence"
    | "PettyCashVoucherNumberSequence",
  storageYear: number,
): Promise<number> {
  const table = Prisma.raw(`"${tableName}"`);
  const rows = await tx.$queryRaw<Array<{ next: number }>>(
    Prisma.sql`INSERT INTO ${table} ("year", "next") VALUES (${storageYear}, 2)
       ON CONFLICT ("year") DO UPDATE SET "next" = ${table}."next" + 1
       RETURNING "next"`,
  );
  return rows[0].next - 1;
}

export async function nextOrderCode(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "OrderCodeSequence", fy.storageYear);
  return `ORD-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextQuoteNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "QuoteNumberSequence", fy.storageYear);
  return `QT-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextCustomerInvoiceNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "CustomerInvoiceNumberSequence", fy.storageYear);
  return `INV-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextChefRequisitionNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "ChefRequisitionNumberSequence", fy.storageYear);
  return `CR-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextBanquetRequisitionNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "BanquetRequisitionNumberSequence", fy.storageYear);
  return `BRQ-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextDeliveryNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "DeliveryNumberSequence", fy.storageYear);
  return `DLV-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextProductionJobNo(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "ProductionJobNumberSequence", fy.storageYear);
  return `PJ-${fy.label}-${String(n).padStart(4, "0")}`;
}

// ─── Procurement (Phase 2) ───────────────────────────────────────────────

export async function nextVendorPONumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "VendorPONumberSequence", fy.storageYear);
  return `VPO-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextGRNNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "GRNNumberSequence", fy.storageYear);
  return `GRN-${fy.label}-${String(n).padStart(4, "0")}`;
}

export async function nextVendorBillNumber(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "VendorBillNumberSequence", fy.storageYear);
  return `VB-${fy.label}-${String(n).padStart(4, "0")}`;
}

/**
 * Vendor code is not FY-scoped — vendors persist across years. Uses
 * VendorCodeSequence with year=0 as a single global counter slot.
 */
export async function nextVendorCode(tx: Tx): Promise<string> {
  const n = await nextSequenceValue(tx, "VendorCodeSequence", 0);
  return `V-${String(n).padStart(4, "0")}`;
}

/** Padded to 3, never truncated — item 1000 is GP-1000, not GP-000. */
export function formatGPItemCode(n: number): string {
  return `GP-${String(n).padStart(3, "0")}`;
}

/**
 * Kitchen item code (Ingredient.sku). Draws from the GPItemCodeSequence
 * slot (year=0, not FY-scoped).
 */
export async function nextGPItemCode(tx: Tx): Promise<string> {
  const n = await nextSequenceValue(tx, "GPItemCodeSequence", 0);
  return formatGPItemCode(n);
}

/**
 * F&B item codes. The prefix carries the source, so the three catalogues
 * count independently and a code can never collide across them — the
 * kitchen's GP-042 and the hire list's GP-HR-042 are different strings.
 * Same padding rule as formatGPItemCode: pad to 3, never truncate.
 */
export function formatGPInhouseItemCode(n: number): string {
  return `GP-IN-${String(n).padStart(3, "0")}`;
}

export function formatGPHiredItemCode(n: number): string {
  return `GP-HR-${String(n).padStart(3, "0")}`;
}

export async function nextGPInhouseItemCode(tx: Tx): Promise<string> {
  const n = await nextSequenceValue(tx, "GPInhouseItemCodeSequence", 0);
  return formatGPInhouseItemCode(n);
}

export async function nextGPHiredItemCode(tx: Tx): Promise<string> {
  const n = await nextSequenceValue(tx, "GPHiredItemCodeSequence", 0);
  return formatGPHiredItemCode(n);
}

// ─── Finance (Phase 3) ───────────────────────────────────────────────────

export async function nextPettyCashVoucherNo(tx: Tx): Promise<string> {
  const fy = getFyForDate(new Date());
  const n = await nextSequenceValue(tx, "PettyCashVoucherNumberSequence", fy.storageYear);
  return `PCV-${fy.label}-${String(n).padStart(4, "0")}`;
}

/**
 * Salary run number = `SR-YY-YY-MM` (FY suffix + 2-digit calendar month).
 * Not strictly atomic-FY-sequenced because there's exactly one run per
 * calendar month (DB unique on periodMonth), so the run number is
 * deterministic from the period.
 */
export function salaryRunNo(periodMonth: Date): string {
  const fy = getFyForDate(periodMonth);
  const mm = String(periodMonth.getUTCMonth() + 1).padStart(2, "0");
  return `SR-${fy.label}-${mm}`;
}
