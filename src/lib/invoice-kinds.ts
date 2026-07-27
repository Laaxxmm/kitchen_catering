import { CustomerInvoiceKind, type Prisma } from "@prisma/client";

/**
 * A PROFORMA invoice is a non-binding quote-with-numbers, auto-created when an
 * order is approved. It carries status ISSUED and the full order value purely
 * so it can be shown/emailed — but it is NOT real revenue, NOT a receivable,
 * and NOT a filed tax invoice (it has no IRN). The real invoice (kind ORDER /
 * ADVANCE / ADHOC) is separate, so counting both double-counts the order.
 *
 * Spread this into any customerInvoice `where` that feeds a money figure
 * (revenue, AR/outstanding, GST output, collect lists) so a proforma can never
 * inflate it. Single source of truth — do not inline `kind: PROFORMA` checks.
 */
export const EXCLUDE_PROFORMA = {
  kind: { not: CustomerInvoiceKind.PROFORMA },
} satisfies Prisma.CustomerInvoiceWhereInput;
