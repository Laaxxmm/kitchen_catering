import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/route-access";

/**
 * The login-free list. /i/<token> was once dropped from it as "dead" and
 * every emailed invoice link bounced customers to the login page for a
 * week — so the customer-facing links are pinned here by name.
 */
describe("paths reachable without a login", () => {
  it("the customer's invoice, feedback and quote links, and their PDFs", () => {
    expect(isPublicPath("/i/_rFnL7fSpg023I-NO-dwH4PFM41zPV_m")).toBe(true);
    expect(isPublicPath("/i/_rFnL7fSpg023I-NO-dwH4PFM41zPV_m/pdf")).toBe(true);
    expect(isPublicPath("/f/some-feedback-token")).toBe(true);
    expect(isPublicPath("/q/some-quote-token")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
  });

  it("nothing inside the app", () => {
    for (const p of ["/", "/dashboard", "/invoices", "/invoices/abc", "/api/invoices/abc/pdf", "/admin/settings", "/i", "/f"]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});
