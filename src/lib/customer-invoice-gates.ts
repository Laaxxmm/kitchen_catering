import { CustomerInvoiceStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { humanizeStatus } from "@/lib/order-status";

/**
 * When a customer invoice may be approved for release and when it may be
 * issued. Pure decisions, no DB — shared by the actions and by the pages
 * that offer the buttons, so what the server refuses and what the UI offers
 * cannot drift apart.
 *
 * The client's rule: "I need to edit the invoice once it's generated, BEFORE
 * being given to the customer. Only after the approval from the admin or
 * manager, the invoice needs to be given to the customer."
 */

/** The only status an invoice can be signed off from. */
export const APPROVABLE_STATUSES: CustomerInvoiceStatus[] = [CustomerInvoiceStatus.DRAFT];

export function isApprovable(status: CustomerInvoiceStatus): boolean {
  return APPROVABLE_STATUSES.includes(status);
}

/**
 * The state an order-linked invoice is born in — the delivery-driven one
 * included. Everything an order raises is a draft nobody has signed off:
 * 100 were booked, 120 ate, and the extra 20 go on before the customer
 * ever sees the document. Spread into the `create` so the three creation
 * paths can't drift apart on what "not yet released" means.
 */
export const ORDER_INVOICE_INITIAL = {
  status: CustomerInvoiceStatus.DRAFT,
  issuedAt: null,
  approvedAt: null,
} as const;

/**
 * May this document be shown or emailed to the customer? A DRAFT is a
 * work-in-progress the numbers can still move on, and it has by definition
 * not been through the issue gate (which is what demands the signature).
 * Everything else got there via `issueCustomerInvoice`, or was born ISSUED
 * because it is informational (proforma).
 *
 * The one predicate behind both customer-facing doors: the invoice email
 * and the public share-token page.
 */
export function mayReachCustomer(status: CustomerInvoiceStatus): boolean {
  return status !== CustomerInvoiceStatus.DRAFT;
}

/**
 * Where an invoice lands the moment it is issued, given money already
 * recorded against it — cash the driver took at the door is credited onto
 * the draft, so an invoice can be fully settled before it is released.
 */
export function settledStatus(amountPaid: string, grandTotal: string): CustomerInvoiceStatus {
  // decimalString permits "" — blank-guard before new Decimal().
  const paid = amountPaid.trim() ? new Decimal(amountPaid) : new Decimal(0);
  const grand = grandTotal.trim() ? new Decimal(grandTotal) : new Decimal(0);
  if (paid.lte(0)) return CustomerInvoiceStatus.ISSUED;
  return paid.gte(grand) ? CustomerInvoiceStatus.PAID : CustomerInvoiceStatus.PARTIAL;
}

/**
 * Written into the invoice by every draft edit. An approval is given for the
 * numbers the approver was looking at: edit those numbers and the sign-off
 * is gone, so the invoice has to go back to a manager before it can be
 * issued. Exported as one object so the actions and the tests agree on what
 * "revoked" means.
 */
export const APPROVAL_CLEARED = {
  approvedAt: null,
  approvedById: null,
  approvalNote: null,
} as const;

/** Why this invoice can't be approved for release. */
export function approveRefusal(input: {
  invoiceNo: string;
  status: CustomerInvoiceStatus;
  approvedAt: Date | null;
}): string | null {
  const { invoiceNo, status, approvedAt } = input;
  if (!isApprovable(status)) {
    return `Cannot approve ${invoiceNo} — it's ${humanizeStatus(status)}. Only a draft is approved for release.`;
  }
  if (approvedAt) return `${invoiceNo} is already approved for release.`;
  return null;
}

/**
 * Why this invoice can't be issued. The hold is checked first — it's the
 * loud "someone actively blocked this" signal and no amount of approving
 * clears it.
 */
export function issueRefusal(input: {
  invoiceNo: string;
  status: CustomerInvoiceStatus;
  onHoldReason: string | null;
  onHold: boolean;
  approvedAt: Date | null;
}): string | null {
  const { invoiceNo, status, onHold, onHoldReason, approvedAt } = input;
  if (onHold) {
    return `Invoice is on hold: ${onHoldReason ?? "no reason recorded"} — release the hold first`;
  }
  if (status !== CustomerInvoiceStatus.DRAFT) {
    return `Cannot issue an invoice that's ${humanizeStatus(status)}`;
  }
  if (!approvedAt) {
    return `${invoiceNo} hasn't been approved for release — a manager or admin has to sign it off before it goes to the customer.`;
  }
  return null;
}

/**
 * Pro-rata a line quantity from the headcount the invoice was built for to
 * the headcount that actually turned up (100 ordered, 120 ate). This only
 * ever *suggests* — it pre-fills the editor and a human saves it, because
 * money on a customer document changes when someone confirms the number
 * they are looking at, not as a side effect of typing a pax count.
 *
 * Returns null when there is nothing to scale from: a missing or zero
 * "from" headcount would be a divide-by-zero, and a legacy invoice has no
 * snapshot to reason about. Quantity is Decimal(12,3) in the database, so
 * the suggestion is rounded to the same 3 places.
 */
export function prorateQuantity(
  quantity: string,
  fromHeadcount: number | null | undefined,
  toHeadcount: number | null | undefined,
): string | null {
  if (!fromHeadcount || fromHeadcount <= 0) return null;
  if (!toHeadcount || toHeadcount <= 0) return null;
  if (!quantity.trim()) return null;
  return new Decimal(quantity)
    .times(toHeadcount)
    .div(fromHeadcount)
    .toDecimalPlaces(3)
    .toString();
}
