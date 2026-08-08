import "./pin-database-url";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentEntityType, PaymentMethod } from "@prisma/client";
import { AuthenticationError, AuthorizationError } from "@/server/rbac";
import * as adminReset from "@/server/actions/admin-reset";
import * as banquet from "@/server/actions/banquet";
import * as catalogueCleanup from "@/server/actions/catalogue-cleanup";
import * as catalogueImport from "@/server/actions/catalogue-import";
import * as chefRequisitions from "@/server/actions/chef-requisitions";
import * as customerInvoices from "@/server/actions/customer-invoices";
import * as deliveries from "@/server/actions/deliveries";
import * as dishes from "@/server/actions/dishes";
import * as documents from "@/server/actions/documents";
import * as housekeeping from "@/server/actions/housekeeping";
import * as inventory from "@/server/actions/inventory";
import * as inventoryAudit from "@/server/actions/inventory-audit";
import * as invoiceSettings from "@/server/actions/invoice-settings";
import * as maintenance from "@/server/actions/maintenance";
import * as manpower from "@/server/actions/manpower";
import * as orders from "@/server/actions/orders";
import * as payments from "@/server/actions/payments";
import * as pettyCash from "@/server/actions/petty-cash";
import * as procurement from "@/server/actions/procurement";
import * as productionJobs from "@/server/actions/production-jobs";
import * as reminders from "@/server/actions/reminders";
import * as settings from "@/server/actions/settings";
import * as stockTransfer from "@/server/actions/stock-transfer";
import * as storeStock from "@/server/actions/store-stock";
import * as users from "@/server/actions/users";
import { actingAs, asNobody, ensureSeeded, type DeskName } from "../harness";

/**
 * The permission matrix: for every mutating server action, which desks the
 * action's OWN gate admits and which it turns away.
 *
 * A table rather than hand-written cases, for two reasons. Every action is
 * asserted in BOTH directions — an allowed desk gets through, every other
 * desk is stopped — which a hand-written suite quietly stops doing after the
 * first dozen. And the ledger at the bottom walks src/server/actions and
 * fails if a mutating export appears in neither this table nor the explicit
 * "not covered, because…" list, so a newly added action can't slip in
 * ungated and unnoticed.
 *
 * What a case asserts is the GATE, not the outcome: the call is made with a
 * missing id or an empty payload, so an admitted desk fails a moment later
 * on "not found" / validation and writes nothing. That keeps ~100 actions
 * affordable in one file. The rules the client actually stated — who may
 * edit stock, who may approve an invoice, when a bill becomes payable — are
 * proven end to end, against real rows, in rules.test.ts.
 */

const DESKS: DeskName[] = ["admin", "manager", "chef", "store", "delivery", "accounts"];

/** A cuid-shaped id that matches nothing. */
const MISSING_ID = "cmissingmissingmissingmis";

/** What the role guards say when they turn someone away. */
const GATE_REFUSAL = /^(Requires one of|Not signed in|Forbidden)/;

type Verdict = "stopped at the gate" | "past the gate";

/**
 * Did the call die at the role gate, or get past it? Anything that isn't an
 * authorization/authentication failure counts as past — a "not found", a
 * validation error and a success all mean the gate let this desk through,
 * which is exactly what an allowed desk must see.
 */
async function verdict(call: () => Promise<unknown>): Promise<Verdict> {
  try {
    const result = await call();
    if (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      (result as { ok: unknown }).ok === false
    ) {
      const error = String((result as { error?: unknown }).error ?? "");
      return GATE_REFUSAL.test(error) ? "stopped at the gate" : "past the gate";
    }
    return "past the gate";
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof AuthenticationError) {
      return "stopped at the gate";
    }
    return "past the gate";
  }
}

interface GateCase {
  /** Source file under src/server/actions, without the extension. */
  module: string;
  /** The exported action name — the ledger below matches on this. */
  action: string;
  /** Desks the action's own gate must admit. Every other desk must not be. */
  allow: DeskName[];
  call: () => Promise<unknown>;
}

function gate(
  module: string,
  action: string,
  allow: DeskName[],
  call: () => Promise<unknown>,
): GateCase {
  return { module, action, allow, call };
}

const CASES: GateCase[] = [
  // ── Kitchen store: catalogue, movements, and the hand-typed figure ────
  gate("inventory", "setReorderLevel", ["admin", "manager", "store", "chef"], () =>
    inventory.setReorderLevel(MISSING_ID, "5"),
  ),
  gate("inventory", "createIngredient", ["admin", "manager"], () =>
    inventory.createIngredient({}),
  ),
  gate("inventory", "updateIngredient", ["admin", "manager"], () =>
    inventory.updateIngredient(MISSING_ID, {}),
  ),
  gate("inventory", "deactivateIngredient", ["admin", "manager"], () =>
    inventory.deactivateIngredient(MISSING_ID),
  ),
  gate("inventory", "reactivateIngredient", ["admin", "manager"], () =>
    inventory.reactivateIngredient(MISSING_ID),
  ),
  gate(
    "inventory",
    "recordIngredientReceipt",
    ["admin", "manager", "store", "accounts"],
    () => inventory.recordIngredientReceipt({}),
  ),
  gate("inventory", "recordDirectIngredientIssue", ["admin", "manager", "store"], () =>
    inventory.recordDirectIngredientIssue({}),
  ),
  gate("inventory", "recordIngredientReturn", ["admin", "manager", "store"], () =>
    inventory.recordIngredientReturn({}),
  ),
  gate("inventory", "declareIngredientReturn", ["admin", "manager", "chef"], () =>
    inventory.declareIngredientReturn({}),
  ),
  gate("inventory", "confirmIngredientReturn", ["admin", "manager", "store"], () =>
    inventory.confirmIngredientReturn({}),
  ),
  gate(
    "inventory",
    "rejectIngredientReturnDeclaration",
    ["admin", "manager", "store", "chef"],
    () => inventory.rejectIngredientReturnDeclaration(MISSING_ID, "gate probe"),
  ),
  gate("inventory", "adjustIngredientStock", ["admin", "manager"], () =>
    inventory.adjustIngredientStock({}),
  ),
  gate("inventory", "mergeIngredient", ["admin", "manager"], () =>
    inventory.mergeIngredient(MISSING_ID, MISSING_ID),
  ),
  gate("inventory-audit", "postInventoryAudit", ["admin", "manager"], () =>
    inventoryAudit.postInventoryAudit({ lines: [] }),
  ),

  // ── The other three stores' hand-typed figure ─────────────────────────
  gate("store-stock", "adjustStoreStock", ["admin", "manager"], () =>
    storeStock.adjustStoreStock({
      store: "banquet",
      itemId: MISSING_ID,
      mode: "delta",
      qty: "1",
      reason: "gate probe",
    }),
  ),
  gate("store-stock", "adjustStoreStock", ["admin", "manager"], () =>
    storeStock.adjustStoreStock({
      store: "housekeeping",
      itemId: MISSING_ID,
      mode: "delta",
      qty: "1",
      reason: "gate probe",
    }),
  ),
  gate("stock-transfer", "recordStockTransfer", ["admin", "manager", "store"], () =>
    stockTransfer.recordStockTransfer({}),
  ),

  // ── F&B (banquet) store ───────────────────────────────────────────────
  gate("banquet", "upsertBanquetItem", ["admin", "manager"], () =>
    banquet.upsertBanquetItem({}),
  ),
  gate("banquet", "deactivateBanquetItem", ["admin", "manager"], () =>
    banquet.deactivateBanquetItem(MISSING_ID),
  ),
  gate("banquet", "deleteBanquetItem", ["admin", "manager"], () =>
    banquet.deleteBanquetItem(MISSING_ID),
  ),
  gate(
    "banquet",
    "recordBanquetReceipt",
    ["admin", "manager", "delivery", "store"],
    () => banquet.recordBanquetReceipt({}),
  ),
  gate("banquet", "recordBanquetIssue", ["admin", "manager", "delivery", "store"], () =>
    banquet.recordBanquetIssue({}),
  ),
  gate("banquet", "recordBanquetReturn", ["admin", "manager", "delivery", "store"], () =>
    banquet.recordBanquetReturn({}),
  ),
  gate("banquet", "postBanquetStockCount", ["admin", "manager"], () =>
    banquet.postBanquetStockCount({ lines: [] }),
  ),
  gate(
    "banquet",
    "createBanquetRequisition",
    ["admin", "manager", "delivery", "store"],
    () => banquet.createBanquetRequisition({}),
  ),
  gate(
    "banquet",
    "issueBanquetRequisitionLine",
    ["admin", "manager", "delivery", "store"],
    () => banquet.issueBanquetRequisitionLine({}),
  ),
  gate(
    "banquet",
    "cancelBanquetRequisitionLine",
    ["admin", "manager", "delivery", "store"],
    () => banquet.cancelBanquetRequisitionLine(MISSING_ID, "gate probe"),
  ),
  gate(
    "banquet",
    "amendBanquetRequisitionLineQty",
    ["admin", "manager", "delivery", "store"],
    () => banquet.amendBanquetRequisitionLineQty(MISSING_ID, "1", "gate probe"),
  ),
  gate(
    "banquet",
    "sendBanquetRequisitionLineToProcurement",
    ["admin", "manager", "delivery", "store"],
    () => banquet.sendBanquetRequisitionLineToProcurement({}),
  ),

  // ── Chef requisitions: the chef raises, the store fulfils ─────────────
  gate("chef-requisitions", "createChefRequisition", ["admin", "chef"], () =>
    chefRequisitions.createChefRequisition({}),
  ),
  gate("chef-requisitions", "createStandaloneChefRequisition", ["admin", "chef"], () =>
    chefRequisitions.createStandaloneChefRequisition({}),
  ),
  gate("chef-requisitions", "markIngredientsAvailable", ["admin", "chef"], () =>
    chefRequisitions.markIngredientsAvailable(MISSING_ID, "gate probe"),
  ),
  gate("chef-requisitions", "addChefRequisitionLine", ["admin", "chef"], () =>
    chefRequisitions.addChefRequisitionLine(MISSING_ID, {}),
  ),
  gate("chef-requisitions", "removeChefRequisitionLine", ["admin", "chef"], () =>
    chefRequisitions.removeChefRequisitionLine(MISSING_ID),
  ),
  gate("chef-requisitions", "updateChefRequisitionLineQty", ["admin", "chef"], () =>
    chefRequisitions.updateChefRequisitionLineQty(MISSING_ID, "1"),
  ),
  gate("chef-requisitions", "amendChefRequisitionLineQty", ["admin", "chef"], () =>
    chefRequisitions.amendChefRequisitionLineQty(MISSING_ID, "1", "gate probe"),
  ),
  gate("chef-requisitions", "submitChefRequisition", ["admin", "chef"], () =>
    chefRequisitions.submitChefRequisition(MISSING_ID),
  ),
  gate("chef-requisitions", "issueChefRequisitionLine", ["admin", "store"], () =>
    chefRequisitions.issueChefRequisitionLine({}),
  ),
  gate("chef-requisitions", "cancelChefRequisitionLine", ["admin", "store"], () =>
    chefRequisitions.cancelChefRequisitionLine(MISSING_ID, "gate probe"),
  ),
  gate(
    "chef-requisitions",
    "sendChefRequisitionLineToProcurement",
    ["admin", "store"],
    () => chefRequisitions.sendChefRequisitionLineToProcurement({}),
  ),

  // ── Orders ────────────────────────────────────────────────────────────
  gate("orders", "createOrder", ["admin", "manager", "delivery"], () =>
    orders.createOrder({}),
  ),
  gate("orders", "updateOrderDraft", ["admin", "manager", "delivery"], () =>
    orders.updateOrderDraft(MISSING_ID, {}),
  ),
  gate("orders", "reviseOrder", ["admin", "manager"], () =>
    orders.reviseOrder(MISSING_ID, {}),
  ),
  gate("orders", "acknowledgeOrderRevision", ["admin", "manager", "chef"], () =>
    orders.acknowledgeOrderRevision(MISSING_ID, "chef"),
  ),
  gate("orders", "acknowledgeOrderRevision", ["admin", "manager", "store"], () =>
    orders.acknowledgeOrderRevision(MISSING_ID, "store"),
  ),
  gate("orders", "acknowledgeRevisedDocument", ["admin", "chef"], () =>
    orders.acknowledgeRevisedDocument("CHEF_REQUISITION", MISSING_ID),
  ),
  gate("orders", "submitOrder", ["admin", "manager", "delivery"], () =>
    orders.submitOrder(MISSING_ID),
  ),
  gate("orders", "adminApproveOrder", ["admin", "manager"], () =>
    orders.adminApproveOrder(MISSING_ID, { decision: "APPROVED", note: "gate probe" }),
  ),
  gate("orders", "chefApproveOrder", ["admin", "chef"], () =>
    orders.chefApproveOrder(MISSING_ID, { decision: "APPROVED", note: "gate probe" }),
  ),
  gate("orders", "managerApproveChefSuggestion", ["admin", "manager"], () =>
    orders.managerApproveChefSuggestion(MISSING_ID, { decision: "APPROVED" }),
  ),
  gate("orders", "storeApproveOrder", ["admin", "store"], () =>
    orders.storeApproveOrder(MISSING_ID, {}),
  ),
  gate("orders", "managerApproveOrder", ["admin", "manager"], () =>
    orders.managerApproveOrder(MISSING_ID, {}),
  ),
  gate("orders", "managerOverrideStoreRejection", ["admin", "manager"], () =>
    orders.managerOverrideStoreRejection(MISSING_ID, {}),
  ),
  gate("orders", "cancelOrder", ["admin", "manager"], () =>
    orders.cancelOrder(MISSING_ID, "gate probe"),
  ),
  gate("orders", "forceDeliverOrder", ["admin", "manager"], () =>
    orders.forceDeliverOrder(MISSING_ID, "gate probe"),
  ),
  gate("orders", "closeOrder", ["admin", "manager"], () => orders.closeOrder(MISSING_ID)),
  gate("orders", "allocateOrderFeedback", ["admin", "manager"], () =>
    orders.allocateOrderFeedback(MISSING_ID, MISSING_ID),
  ),
  gate("orders", "markInHouseServed", ["admin", "manager", "chef", "delivery"], () =>
    orders.markInHouseServed(MISSING_ID),
  ),
  gate("orders", "swapOrderItemDish", ["admin", "manager", "chef"], () =>
    orders.swapOrderItemDish(MISSING_ID, MISSING_ID, MISSING_ID, "gate probe"),
  ),
  gate("orders", "assignKitchenSupervisor", ["admin", "manager", "chef"], () =>
    orders.assignKitchenSupervisor(MISSING_ID, MISSING_ID),
  ),

  // ── Kitchen production board ──────────────────────────────────────────
  gate("production-jobs", "assignChef", ["admin", "manager", "chef"], () =>
    productionJobs.assignChef({}),
  ),
  gate("production-jobs", "startProductionItem", ["admin", "manager", "chef"], () =>
    productionJobs.startProductionItem(MISSING_ID),
  ),
  gate("production-jobs", "syncProductionJobCompletion", ["admin", "manager", "chef"], () =>
    productionJobs.syncProductionJobCompletion(MISSING_ID),
  ),
  gate("production-jobs", "markProductionItemReady", ["admin", "manager", "chef"], () =>
    productionJobs.markProductionItemReady(MISSING_ID),
  ),
  gate("production-jobs", "startCookingOrder", ["admin", "manager", "chef"], () =>
    productionJobs.startCookingOrder(MISSING_ID),
  ),
  gate("production-jobs", "markOrderCooked", ["admin", "manager", "chef"], () =>
    productionJobs.markOrderCooked(MISSING_ID),
  ),
  gate(
    "production-jobs",
    "markItemHandedOver",
    ["admin", "manager", "chef", "delivery"],
    () => productionJobs.markItemHandedOver(MISSING_ID),
  ),
  gate(
    "production-jobs",
    "markAllItemsHandedOver",
    ["admin", "manager", "chef", "delivery"],
    () => productionJobs.markAllItemsHandedOver(MISSING_ID),
  ),

  // ── Deliveries ────────────────────────────────────────────────────────
  gate("deliveries", "handToDelivery", ["admin", "manager", "chef"], () =>
    deliveries.handToDelivery(MISSING_ID),
  ),
  gate("deliveries", "markEventPrepReady", ["admin", "manager", "delivery"], () =>
    deliveries.markEventPrepReady(MISSING_ID),
  ),
  gate("deliveries", "claimDelivery", ["admin", "manager", "delivery"], () =>
    deliveries.claimDelivery(MISSING_ID),
  ),
  gate("deliveries", "scheduleDelivery", ["admin", "manager"], () =>
    deliveries.scheduleDelivery({}),
  ),
  gate("deliveries", "dispatchDelivery", ["admin", "manager", "delivery"], () =>
    deliveries.dispatchDelivery(MISSING_ID),
  ),
  gate("deliveries", "markDeliveryArrived", ["admin", "manager", "delivery"], () =>
    deliveries.markDeliveryArrived(MISSING_ID),
  ),
  gate("deliveries", "confirmDeliveryOTP", ["admin", "manager", "delivery"], () =>
    deliveries.confirmDeliveryOTP(MISSING_ID, {}),
  ),
  gate("deliveries", "failDelivery", ["admin", "manager", "delivery"], () =>
    deliveries.failDelivery(MISSING_ID, {}),
  ),

  // ── Customer invoices (money out to the customer) ─────────────────────
  gate(
    "customer-invoices",
    "createCustomerInvoiceFromOrder",
    ["admin", "manager", "accounts"],
    () => customerInvoices.createCustomerInvoiceFromOrder(MISSING_ID),
  ),
  gate(
    "customer-invoices",
    "createProformaInvoiceForOrder",
    ["admin", "manager", "accounts"],
    () => customerInvoices.createProformaInvoiceForOrder(MISSING_ID),
  ),
  gate(
    "customer-invoices",
    "createStandaloneCustomerInvoice",
    ["admin", "manager", "accounts"],
    () =>
      customerInvoices.createStandaloneCustomerInvoice({
        customerId: "",
        placeOfSupplyStateCode: "29",
        lines: [],
      }),
  ),
  gate("customer-invoices", "updateDraftInvoice", ["admin", "manager", "accounts"], () =>
    customerInvoices.updateDraftInvoice(MISSING_ID, { lines: [] }),
  ),
  gate("customer-invoices", "emailTaxInvoice", ["admin", "manager", "accounts"], () =>
    customerInvoices.emailTaxInvoice(MISSING_ID),
  ),
  gate("customer-invoices", "markCustomerInvoicePaid", ["admin", "manager"], () =>
    customerInvoices.markCustomerInvoicePaid({
      invoiceId: MISSING_ID,
      method: PaymentMethod.NEFT,
    }),
  ),
  gate("customer-invoices", "approveCustomerInvoiceForRelease", ["admin", "manager"], () =>
    customerInvoices.approveCustomerInvoiceForRelease(MISSING_ID),
  ),
  gate(
    "customer-invoices",
    "issueCustomerInvoice",
    ["admin", "manager", "accounts"],
    () => customerInvoices.issueCustomerInvoice(MISSING_ID),
  ),
  gate("customer-invoices", "cancelCustomerInvoiceEInvoice", ["admin", "accounts"], () =>
    customerInvoices.cancelCustomerInvoiceEInvoice(MISSING_ID, "gate probe"),
  ),
  gate("customer-invoices", "cancelCustomerInvoice", ["admin", "manager"], () =>
    customerInvoices.cancelCustomerInvoice(MISSING_ID, "gate probe"),
  ),
  gate(
    "customer-invoices",
    "holdCustomerInvoice",
    ["admin", "manager", "accounts"],
    () => customerInvoices.holdCustomerInvoice(MISSING_ID, "gate probe"),
  ),
  gate(
    "customer-invoices",
    "releaseCustomerInvoiceHold",
    ["admin", "manager", "accounts"],
    () => customerInvoices.releaseCustomerInvoiceHold(MISSING_ID, "gate probe"),
  ),
  gate(
    "customer-invoices",
    "createConsolidatedInHouseInvoice",
    ["admin", "manager", "accounts", "delivery"],
    () => customerInvoices.createConsolidatedInHouseInvoice([]),
  ),

  // ── Payments (money moving, both directions) ──────────────────────────
  gate(
    "payments",
    "recordCustomerInvoicePayment",
    ["admin", "manager", "accounts"],
    () => payments.recordCustomerInvoicePayment({}),
  ),
  gate(
    "payments",
    "reverseCustomerInvoicePayment",
    ["admin", "manager", "accounts"],
    () => payments.reverseCustomerInvoicePayment({}),
  ),
  gate("payments", "recordVendorBillPayment", ["admin", "manager", "accounts"], () =>
    payments.recordVendorBillPayment({}),
  ),
  gate("payments", "reverseVendorBillPayment", ["admin", "manager", "accounts"], () =>
    payments.reverseVendorBillPayment({}),
  ),

  // ── Procurement ───────────────────────────────────────────────────────
  gate("procurement", "createVendorPO", ["admin", "manager", "store"], () =>
    procurement.createVendorPO({}),
  ),
  gate("procurement", "updateVendorPOLines", ["admin", "manager", "store"], () =>
    procurement.updateVendorPOLines({}),
  ),
  gate("procurement", "submitVendorPO", ["admin", "manager", "store"], () =>
    procurement.submitVendorPO(MISSING_ID),
  ),
  gate("procurement", "approveVendorPO", ["admin", "manager"], () =>
    procurement.approveVendorPO(MISSING_ID),
  ),
  gate("procurement", "sendVendorPO", ["admin", "manager", "store"], () =>
    procurement.sendVendorPO(MISSING_ID),
  ),
  gate("procurement", "cancelVendorPO", ["admin", "manager", "store"], () =>
    procurement.cancelVendorPO(MISSING_ID, "gate probe"),
  ),
  gate("procurement", "closeVendorPO", ["admin", "manager"], () =>
    procurement.closeVendorPO(MISSING_ID, "gate probe"),
  ),
  gate("procurement", "recallVendorPOToDraft", ["admin", "manager", "store"], () =>
    procurement.recallVendorPOToDraft(MISSING_ID),
  ),
  gate("procurement", "createGRN", ["admin", "manager", "store", "accounts"], () =>
    procurement.createGRN({}),
  ),
  gate("procurement", "createVendorBill", ["admin", "manager", "store", "accounts"], () =>
    procurement.createVendorBill({}),
  ),
  gate("procurement", "updateVendorBill", ["admin", "manager", "store", "accounts"], () =>
    procurement.updateVendorBill(MISSING_ID, {}),
  ),
  gate("procurement", "matchVendorBill", ["admin", "manager", "store", "accounts"], () =>
    procurement.matchVendorBill(MISSING_ID),
  ),
  gate("procurement", "approveVendorBill", ["admin", "manager", "accounts"], () =>
    procurement.approveVendorBill(MISSING_ID),
  ),
  gate("procurement", "markVendorBillPaid", ["admin", "manager", "accounts"], () =>
    procurement.markVendorBillPaid({ id: MISSING_ID, method: PaymentMethod.NEFT }),
  ),
  gate("procurement", "recordVendorAdvance", ["admin", "manager", "accounts"], () =>
    procurement.recordVendorAdvance({}),
  ),
  gate("procurement", "applyVendorAdvanceToBill", ["admin", "manager", "accounts"], () =>
    procurement.applyVendorAdvanceToBill(MISSING_ID, MISSING_ID),
  ),
  gate("reminders", "runVendorPaymentReminders", ["admin", "manager", "accounts"], () =>
    reminders.runVendorPaymentReminders(),
  ),

  // ── Hired labour ──────────────────────────────────────────────────────
  gate(
    "manpower",
    "createManpowerRequest",
    ["admin", "manager", "chef", "delivery"],
    () => manpower.createManpowerRequest({}),
  ),
  gate("manpower", "approveManpowerRequest", ["admin", "manager"], () =>
    manpower.approveManpowerRequest({}),
  ),
  gate("manpower", "rejectManpowerRequest", ["admin", "manager"], () =>
    manpower.rejectManpowerRequest(MISSING_ID, "gate probe"),
  ),
  gate(
    "manpower",
    "completeManpowerRequest",
    ["admin", "manager", "chef", "delivery"],
    () => manpower.completeManpowerRequest(MISSING_ID),
  ),
  gate(
    "manpower",
    "cancelManpowerRequest",
    ["admin", "manager", "chef", "delivery"],
    () => manpower.cancelManpowerRequest(MISSING_ID),
  ),
  gate("manpower", "settleManpowerCost", ["admin", "manager", "accounts"], () =>
    manpower.settleManpowerCost({}),
  ),
  gate("manpower", "payManpowerRequest", ["admin", "manager", "accounts"], () =>
    manpower.payManpowerRequest({}),
  ),

  // ── Petty cash ────────────────────────────────────────────────────────
  gate("petty-cash", "createPettyCashFloat", ["admin", "manager", "accounts"], () =>
    pettyCash.createPettyCashFloat({}),
  ),
  gate("petty-cash", "createPettyCashVoucher", ["admin", "manager", "accounts"], () =>
    pettyCash.createPettyCashVoucher({}),
  ),
  gate("petty-cash", "updatePettyCashVoucher", ["admin", "manager", "accounts"], () =>
    pettyCash.updatePettyCashVoucher(MISSING_ID, {}),
  ),
  gate("petty-cash", "deletePettyCashVoucher", ["admin", "manager", "accounts"], () =>
    pettyCash.deletePettyCashVoucher(MISSING_ID, "gate probe"),
  ),
  gate("petty-cash", "reversePettyCashVoucher", ["admin", "manager", "accounts"], () =>
    pettyCash.reversePettyCashVoucher(MISSING_ID, "gate probe"),
  ),
  gate("petty-cash", "topUpPettyCash", ["admin", "manager", "accounts"], () =>
    pettyCash.topUpPettyCash({}),
  ),

  // ── Admin desk ────────────────────────────────────────────────────────
  gate("admin-reset", "resetTransactionalData", ["admin"], () =>
    adminReset.resetTransactionalData("not the phrase"),
  ),
  gate("admin-reset", "clearOrdersKeepFinance", ["admin"], () =>
    adminReset.clearOrdersKeepFinance("not the phrase"),
  ),
  gate("admin-reset", "resetEverythingKeepParties", ["admin"], () =>
    adminReset.resetEverythingKeepParties("not the phrase"),
  ),
  // Takes no arguments, so there is no bad input to die on just past the
  // gate — the admin probe runs the real import. Harmless: it is idempotent
  // and the catalogue is already in from the seed, so it writes nothing new.
  gate("catalogue-import", "importCatalogueFromFiles", ["admin"], () =>
    catalogueImport.importCatalogueFromFiles(),
  ),
  // Preview pass: counts what it would remove and writes nothing, so the
  // probe can run it for the desks its gate admits without touching rows.
  gate("catalogue-cleanup", "removeSampleCatalogueItems", ["admin", "manager"], () =>
    catalogueCleanup.removeSampleCatalogueItems(true),
  ),
  gate("users", "createUser", ["admin"], () => users.createUser({})),
  gate("users", "updateUser", ["admin"], () => users.updateUser(MISSING_ID, {})),
  gate("users", "deactivateUser", ["admin"], () => users.deactivateUser(MISSING_ID)),
  gate("settings", "upsertSetting", ["admin"], () => settings.upsertSetting("", null)),
  // Every field of the bank-details form defaults, so `{}` would be a valid
  // save — an over-long IFSC is what fails validation just past the gate.
  gate("invoice-settings", "saveInvoiceBankDetails", ["admin", "manager"], () =>
    invoiceSettings.saveInvoiceBankDetails({ ifsc: "X".repeat(21) }),
  ),

  // ── Menu + documents ──────────────────────────────────────────────────
  gate("dishes", "createDish", ["admin", "manager", "chef"], () => dishes.createDish({})),
  gate("dishes", "updateDish", ["admin", "manager", "chef"], () =>
    dishes.updateDish(MISSING_ID, {}),
  ),
  gate("dishes", "deactivateDish", ["admin", "manager", "chef"], () =>
    dishes.deactivateDish(MISSING_ID),
  ),
  gate(
    "documents",
    "uploadDocument",
    ["admin", "manager", "store", "accounts", "delivery"],
    () =>
      documents.uploadDocument({
        entityType: DocumentEntityType.VENDOR_BILL,
        entityId: MISSING_ID,
        base64: "",
        fileName: "gate-probe.pdf",
      }),
  ),
  // Uploading is wide (whoever holds the paper); removing one from the
  // record is not.
  gate("documents", "deleteDocument", ["admin", "manager"], () =>
    documents.deleteDocument(MISSING_ID),
  ),

  // ── Housekeeping + maintenance (peripheral; their own managers have no
  //    seeded desk, so only the management set is asserted here) ─────────
  gate("housekeeping", "upsertRoom", ["admin", "manager"], () =>
    housekeeping.upsertRoom({}),
  ),
  gate("housekeeping", "deleteRoom", ["admin", "manager"], () =>
    housekeeping.deleteRoom(MISSING_ID),
  ),
  gate("housekeeping", "upsertHousekeepingItem", ["admin", "manager"], () =>
    housekeeping.upsertHousekeepingItem({}),
  ),
  gate("housekeeping", "recordHousekeepingReceipt", ["admin", "manager"], () =>
    housekeeping.recordHousekeepingReceipt({}),
  ),
  gate("housekeeping", "recordHousekeepingIssue", ["admin", "manager"], () =>
    housekeeping.recordHousekeepingIssue({}),
  ),
  gate("housekeeping", "returnHousekeepingStock", ["admin", "manager"], () =>
    housekeeping.returnHousekeepingStock({
      itemId: MISSING_ID,
      qty: "1",
      outcome: "returned",
    }),
  ),
  gate("maintenance", "upsertMaintenanceItem", ["admin", "manager"], () =>
    maintenance.upsertMaintenanceItem({}),
  ),
  gate("maintenance", "recordMaintenanceReceipt", ["admin", "manager"], () =>
    maintenance.recordMaintenanceReceipt({}),
  ),
  gate("maintenance", "recordMaintenanceActivity", ["admin", "manager"], () =>
    maintenance.recordMaintenanceActivity({}),
  ),
];

beforeAll(async () => {
  await ensureSeeded();
});

describe("every mutating action admits exactly the desks it should", () => {
  for (const [index, testCase] of CASES.entries()) {
    // The index keeps the two adjacent adjustStoreStock / acknowledge cases
    // (same action, different argument) as distinct test names.
    it(`${testCase.module}.${testCase.action} #${index}`, async () => {
      for (const desk of DESKS) {
        const expected: Verdict = testCase.allow.includes(desk)
          ? "past the gate"
          : "stopped at the gate";
        const actual = await actingAs(desk, () => verdict(testCase.call));
        expect({ desk, verdict: actual }).toEqual({ desk, verdict: expected });
      }
    });
  }
});

describe("signed out", () => {
  it("is refused by every action in the matrix", async () => {
    asNobody();
    const admitted: string[] = [];
    for (const testCase of CASES) {
      if ((await verdict(testCase.call)) === "past the gate") {
        admitted.push(`${testCase.module}.${testCase.action}`);
      }
    }
    expect(admitted).toEqual([]);
  });
});

// ─── The ledger ─────────────────────────────────────────────────────────
//
// Every mutating export in src/server/actions must appear above, or here
// with a reason. The point is that adding an action to the codebase and not
// to this suite is a test failure, not an oversight nobody notices.

/** Queries whose names don't start with list/get/can. */
const READ_ONLY = new Set([
  "banquet.banquetConsumptionByItem",
  "banquet.banquetSummary",
  "housekeeping.consumptionByItem",
  "housekeeping.consumptionByRoom",
  "housekeeping.consumptionByStaff",
  "housekeeping.housekeepingSummary",
  "maintenance.activitiesByCategory",
  "maintenance.activitiesByRoom",
  "maintenance.activitiesByStaff",
  "maintenance.maintenanceConsumptionByItem",
  "maintenance.maintenanceSummary",
  "notifications.myUnreadCount",
  "procurement.poHasReceivedGoods",
  "tasks.myTaskCounts",
  "tasks.adminTaskCounts",
]);

/** Not reachable as a server action: takes a transaction, or is the
 *  deliberately ungated internal half of one. */
const INTERNAL = new Set([
  "customer-invoices.createTaxInvoiceForOrderInTx",
  "production-jobs.createProductionJobForOrder",
  // Called by the cron route, which authenticates with CRON_SECRET instead
  // of a session. Its behaviour is asserted in rules.test.ts.
  "reminders.runVendorPaymentRemindersInternal",
]);

/** Proven in rules.test.ts against real rows rather than in the table. */
const COVERED_IN_RULES = new Set([
  "banquet.cancelBanquetRequisition",
  "chef-requisitions.cancelChefRequisition",
]);

/** Deliberately out of scope for this pass, with the reason. */
const NOT_COVERED: Record<string, string> = {
  "customer-groups.createCustomerGroup": "peripheral master data (ADMIN/MANAGER)",
  "customer-groups.updateCustomerGroup": "peripheral master data (ADMIN/MANAGER)",
  "customer-groups.deactivateCustomerGroup": "peripheral master data (ADMIN/MANAGER)",
  "customers.createCustomer": "party master data, no stock or money",
  "customers.updateCustomer": "party master data, no stock or money",
  "customers.deactivateCustomer": "party master data, no stock or money",
  "customers.reactivateCustomer": "party master data, no stock or money",
  "vendors.createVendor": "party master data, no stock or money",
  "vendors.approveVendor": "party master data, no stock or money",
  "vendors.updateVendor": "party master data, no stock or money",
  "vendors.deactivateVendor": "party master data, no stock or money",
  "feedback.submitFeedback": "customer-facing feedback capture",
  "leftover-return.addOrderLeftover": "records leftovers; moves no stock figure",
  "leftover-return.removeOrderLeftover": "records leftovers; moves no stock figure",
  "notifications.markNotificationRead": "own bell only, ownership-checked",
  "notifications.markAllNotificationsRead": "own bell only, ownership-checked",
  "notifications.purgeOldNotifications": "housekeeping of the bell",
  "order-templates.upsertOrderTemplate": "sales convenience template",
  "order-templates.deactivateOrderTemplate": "sales convenience template",
  "quotes.createQuote": "pre-order sales pipeline — no stock, no ledger",
  "quotes.sendQuote": "pre-order sales pipeline — no stock, no ledger",
  "quotes.resendQuoteEmail": "pre-order sales pipeline — no stock, no ledger",
  "quotes.acceptQuote": "pre-order sales pipeline — no stock, no ledger",
  "quotes.markQuoteLost": "pre-order sales pipeline — no stock, no ledger",
  "quotes.flagQuoteChangesRequested": "pre-order sales pipeline — no stock, no ledger",
  "quotes.addQuoteLine": "pre-order sales pipeline — no stock, no ledger",
  "quotes.removeQuoteLine": "pre-order sales pipeline — no stock, no ledger",
  "quotes.reviseQuote": "pre-order sales pipeline — no stock, no ledger",
  "quotes.convertQuoteToOrder": "pre-order sales pipeline — no stock, no ledger",
  "recipes.upsertRecipe": "recipe master data (ADMIN/KITCHEN_HEAD)",
  "recipes.upsertRecipeSubRecipe": "recipe master data (ADMIN/KITCHEN_HEAD)",
  "reconcile-grn-stock.applyGrnStockReconcile": "one-off migration tool",
  "reconcile-grn-stock.postReconcileLineManual": "one-off migration tool",
  "salary.upsertSalaryStructure": "payroll — not in this pass",
  "salary.createSalaryRun": "payroll — not in this pass",
  "salary.approveSalaryRun": "payroll — not in this pass",
  "salary.postSalaryRun": "payroll — not in this pass",
  "staff-allocation.addOrderStaff": "rostering, no stock or money",
  "staff-allocation.removeOrderStaff": "rostering, no stock or money",
  "tasks.upsertTaskTemplate": "task board",
  "tasks.deactivateTaskTemplate": "task board",
  "tasks.assignTask": "task board",
  "tasks.updateTask": "task board",
  "tasks.submitTask": "task board, ownership-checked",
  "tasks.reviewTask": "task board",
  "housekeeping.deactivateRoom": "same WRITE_ROLES as upsertRoom, asserted above",
  "housekeeping.upsertHousekeepingStaff": "same WRITE_ROLES, asserted above",
  "housekeeping.deactivateHousekeepingStaff": "same WRITE_ROLES, asserted above",
  "housekeeping.deleteHousekeepingStaff": "same WRITE_ROLES, asserted above",
  "housekeeping.deactivateHousekeepingItem": "same WRITE_ROLES, asserted above",
  "housekeeping.deleteHousekeepingItem": "same WRITE_ROLES, asserted above",
  "maintenance.upsertMaintenanceStaff": "same WRITE_ROLES, asserted above",
  "maintenance.deactivateMaintenanceStaff": "same WRITE_ROLES, asserted above",
  "maintenance.deleteMaintenanceStaff": "same WRITE_ROLES, asserted above",
  "maintenance.deactivateMaintenanceItem": "same WRITE_ROLES, asserted above",
  "maintenance.deleteMaintenanceItem": "same WRITE_ROLES, asserted above",
};

/** Names that read rather than write. */
function isQuery(name: string): boolean {
  return /^(list|get|can|find|search|preview)/.test(name);
}

describe("the ledger", () => {
  it("accounts for every mutating action in src/server/actions", () => {
    const dir = path.resolve(process.cwd(), "src/server/actions");
    const covered = new Set(CASES.map((c) => `${c.module}.${c.action}`));
    const unaccounted: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const moduleName = file.replace(/\.ts$/, "");
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const match of source.matchAll(/^export async function (\w+)/gm)) {
        const name = match[1];
        const key = `${moduleName}.${name}`;
        if (isQuery(name) || READ_ONLY.has(key) || INTERNAL.has(key)) continue;
        if (covered.has(key) || COVERED_IN_RULES.has(key) || key in NOT_COVERED) continue;
        unaccounted.push(key);
      }
    }

    expect(unaccounted).toEqual([]);
  });

  it("keeps every file in this directory on its own database", () => {
    const dir = path.resolve(process.cwd(), "tests/e2e/access");
    const wrong = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts"))
      .filter(
        (f) =>
          !readFileSync(path.join(dir, f), "utf8").startsWith(
            'import "./pin-database-url";',
          ),
      );
    expect(wrong).toEqual([]);
  });
});
