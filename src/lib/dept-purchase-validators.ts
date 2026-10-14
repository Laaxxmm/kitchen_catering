import { z } from "zod";
import { Decimal } from "decimal.js";
import { StoreDepartment } from "@prisma/client";

/**
 * Inputs for the housekeeping / maintenance stock request → PO flow
 * (src/server/actions/dept-purchase.ts). Numbers arrive as strings or
 * numbers and leave as normalised decimal strings, already rounded to what
 * the column stores — so "0.0004" is refused here as nothing, not written
 * as a zero the DB check would then reject.
 */

const PLAIN_NUMBER = /^\d*\.?\d+$/;

/**
 * One transform, not a refine chain: zod runs later refines on a value an
 * earlier step already failed, and `new Decimal("abc")` would throw there.
 */
function parseAmount(
  raw: string | number,
  ctx: z.RefinementCtx,
  o: { dp: number; max: number; what: string; positive?: boolean },
): string {
  const fail = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  };
  const s = String(raw).trim();
  if (s === "") return fail(`Enter ${o.what}`);
  if (!PLAIN_NUMBER.test(s)) return fail(`Enter a valid ${o.what} (no minus sign)`);
  const d = new Decimal(s).toDecimalPlaces(o.dp);
  if (o.positive && d.lte(0)) return fail(`${o.what[0].toUpperCase()}${o.what.slice(1)} must be more than 0`);
  if (d.gt(o.max)) return fail(`That ${o.what} is too large`);
  return d.toString();
}

const num = z.union([z.string(), z.number()]);

/** Stock quantity: 3 dp, strictly positive after rounding ("0.0004" is nothing). */
export const positiveQty = num.transform((v, ctx) =>
  parseAmount(v, ctx, { dp: 3, max: 1_000_000, what: "quantity", positive: true }),
);
/** Approved quantity: 3 dp, 0 allowed (drops the line). */
export const approvedQty = num.transform((v, ctx) =>
  parseAmount(v, ctx, { dp: 3, max: 1_000_000, what: "approved quantity" }),
);
/** Unit rate in ₹: 2 dp; blank / null → null. */
const optionalRate = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v, ctx) =>
    v == null || String(v).trim() === ""
      ? null
      : parseAmount(v, ctx, { dp: 2, max: 10_000_000, what: "rate" }),
  );

/** Trimmed free text; blank → null. */
function optText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .nullish()
    .transform((v) => v || null);
}

const id = z.string().trim().min(1).max(64);

/** `<input type="date">` value; blank → null. */
const optDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date");

function noDuplicates<T>(key: (row: T) => string, message: string) {
  return (rows: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const k = key(row);
      if (seen.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message });
      seen.add(k);
    });
  };
}

const PurchaseLine = z.object({
  itemId: id,
  quantity: positiveQty,
  rate: optionalRate,
});

const purchaseFields = {
  reason: z.string().trim().min(2, "Say why the stock is needed").max(500),
  supplierName: optText(160),
  supplierPhone: optText(20),
  expectedAt: optDate,
  notes: optText(1000),
  lines: z
    .array(PurchaseLine)
    .min(1, "Add at least one item")
    .max(100, "At most 100 lines on one order")
    .superRefine(noDuplicates((l) => l.itemId, "This item is already on the order — change its quantity instead")),
};

export const DeptPurchaseCreateInput = z.object({
  department: z.nativeEnum(StoreDepartment),
  ...purchaseFields,
});
export type DeptPurchaseCreateInputT = z.input<typeof DeptPurchaseCreateInput>;

/** An edit keeps the order's department; it is never taken from the client. */
export const DeptPurchaseUpdateInput = z.object(purchaseFields);
export type DeptPurchaseUpdateInputT = z.input<typeof DeptPurchaseUpdateInput>;

export const DeptPurchaseDecisionInput = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("APPROVE"),
    note: optText(1000),
    /** Lines left out are approved as asked. */
    lines: z
      .array(z.object({ lineId: id, approvedQty }))
      .max(100)
      .superRefine(noDuplicates((l) => l.lineId, "Line listed twice"))
      .optional(),
  }),
  z.object({
    decision: z.literal("REJECT"),
    note: z.string({ required_error: "Give a reason for rejecting" }).trim().min(2, "Give a reason for rejecting").max(1000),
  }),
]);
export type DeptPurchaseDecisionInputT = z.input<typeof DeptPurchaseDecisionInput>;

export const DeptPurchaseOrderedInput = z.object({
  supplierName: optText(160),
  supplierPhone: optText(20),
  expectedAt: optDate,
});
export type DeptPurchaseOrderedInputT = z.input<typeof DeptPurchaseOrderedInput>;

export const DeptPurchaseReceiveInput = z.object({
  receivedAt: z.string().trim().min(1, "Enter when the goods arrived").max(40),
  supplierBillNo: optText(60),
  note: optText(500),
  lines: z
    .array(z.object({ lineId: id, quantity: positiveQty, costPerUnit: optionalRate }))
    .min(1, "Enter what arrived")
    .max(100)
    .superRefine(noDuplicates((l) => l.lineId, "Line listed twice")),
});
export type DeptPurchaseReceiveInputT = z.input<typeof DeptPurchaseReceiveInput>;

/** Reason for closing short / cancelling — required, it is the record. */
export const DeptPurchaseReason = z
  .string({ required_error: "Give a reason", invalid_type_error: "Give a reason" })
  .trim()
  .min(2, "Give a reason")
  .max(500);
