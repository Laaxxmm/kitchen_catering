/**
 * No "use server" here on purpose: a directive file may only export async
 * functions it defines, so it cannot re-export. The stage files carry the
 * directive; this file only forwards their action references.
 *
 * The procurement lifecycle, one stage per file under ./procurement/. This barrel keeps
 * `@/server/actions/procurement` as the import path every caller already uses.
 *
 * Stages:
 *   po         The purchase order. Raise, edit lines while it is still ours, submit, approve by
 *   grn        Receiving the goods. One GRN per delivery: accept and reject per line, take more
 *   bills      The supplier's bill. Record it (prefilled from the PO), correct it, run the 3-way
 *   advances   Money handed to a vendor ahead of a bill, and applying it when the bill arrives
 *   read       Reads. POs, GRNs and bills, as lists and one by id.
 */

export { createVendorPO, updateVendorPOLines, submitVendorPO, approveVendorPO, sendVendorPO, recallVendorPOToDraft, cancelVendorPO, closeVendorPO } from "./procurement/po";
export { createGRN, poHasReceivedGoods } from "./procurement/grn";
export { createVendorBill, updateVendorBill, matchVendorBill, approveVendorBill, markVendorBillPaid } from "./procurement/bills";
export { recordVendorAdvance, listOpenVendorAdvances, applyVendorAdvanceToBill } from "./procurement/advances";
export { listVendorPOs, getVendorPO, listGRNs, getGRN, listVendorBills, getVendorBill } from "./procurement/read";
