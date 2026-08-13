import { describe, expect, it } from "vitest";
import { routeAllows } from "@/lib/route-access";

/**
 * Route gates, first-match-wins.
 *
 * The middleware used to test every matching rule and deny if any of them
 * excluded the role. A narrower rule could therefore only ever restrict a
 * broader one, never widen it — so four screens that had a rule admitting
 * them were still redirected to /forbidden by the catch-all underneath.
 * The chef's leftover-return flow was one; the team hit it in production
 * with stock sitting on the counter and no way to send it back.
 *
 * The four "widen" cases are the ones that regress silently, so they are
 * asserted alongside the restrictions they must not have loosened.
 */

describe("a narrower rule can widen the one below it", () => {
  it("lets the chef declare a return and open the declaration", () => {
    expect(routeAllows("/inventory/returns/declare", "KITCHEN_HEAD")).toBe(true);
    expect(routeAllows("/inventory/returns/clx123abc", "KITCHEN_HEAD")).toBe(true);
    // The list itself is still the store's — the chef reaches their own
    // declarations from the dashboard and the order.
    expect(routeAllows("/inventory/returns", "KITCHEN_HEAD")).toBe(false);
  });

  it("lets the manager read the audit log inside admin-only /admin", () => {
    expect(routeAllows("/admin/audit", "MANAGER")).toBe(true);
    expect(routeAllows("/admin/settings", "MANAGER")).toBe(false);
  });

  it("lets the maintenance manager see the shared room master", () => {
    expect(routeAllows("/housekeeping/rooms", "MAINTENANCE_MANAGER")).toBe(true);
    expect(routeAllows("/housekeeping/items", "MAINTENANCE_MANAGER")).toBe(false);
  });
});

describe("a narrower rule still restricts the one below it", () => {
  it("lets F&B read an invoice but not raise one", () => {
    expect(routeAllows("/invoices/new", "FNB_SERVICE")).toBe(false);
    expect(routeAllows("/invoices/clx123abc", "FNB_SERVICE")).toBe(true);
  });

  it("keeps hand-set stock figures to management", () => {
    expect(routeAllows("/inventory/adjustments/new", "STORE_KEEPER")).toBe(false);
    expect(routeAllows("/inventory/audit", "STORE_KEEPER")).toBe(false);
    // Adding stock by hand went the same way: the store's route to stock is
    // the GRN, which keeps the order, the goods and the bill agreeing.
    expect(routeAllows("/inventory/receipts", "STORE_KEEPER")).toBe(false);
    expect(routeAllows("/inventory/receipts", "ACCOUNTS")).toBe(true);
    // Receiving a delivery against its PO is still theirs.
    expect(routeAllows("/procurement/grns/new", "STORE_KEEPER")).toBe(true);
    // The log is theirs to read; posting a correction is not.
    expect(routeAllows("/inventory/adjustments", "STORE_KEEPER")).toBe(true);
  });

  it("keeps the chef out of the store's own movements", () => {
    expect(routeAllows("/inventory/issues", "KITCHEN_HEAD")).toBe(false);
    expect(routeAllows("/inventory/receipts", "KITCHEN_HEAD")).toBe(false);
    expect(routeAllows("/inventory/ingredients", "KITCHEN_HEAD")).toBe(true);
  });

  it("keeps new-item creation to management", () => {
    expect(routeAllows("/inventory/ingredients/new", "STORE_KEEPER")).toBe(false);
    expect(routeAllows("/banquet/adjust", "FNB_SERVICE")).toBe(false);
    expect(routeAllows("/banquet/returns", "FNB_SERVICE")).toBe(true);
  });
});

describe("everything else", () => {
  it("passes admin, and lets any signed-in role onto role-neutral paths", () => {
    expect(routeAllows("/admin/settings", "ADMIN")).toBe(true);
    expect(routeAllows("/dashboard", "DELIVERY")).toBe(true);
    expect(routeAllows("/tasks", "FNB_SERVICE")).toBe(true);
  });
});
