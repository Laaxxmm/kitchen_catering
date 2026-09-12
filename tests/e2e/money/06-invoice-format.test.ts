import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createCustomer } from "@/server/actions/customers";
import {
  approveCustomerInvoiceForRelease,
  createStandaloneCustomerInvoice,
  getCustomerInvoice,
  getCustomerInvoiceByToken,
  issueCustomerInvoice,
  updateDraftInvoice,
} from "@/server/actions/customer-invoices";
import { buildInvoiceView, renderCustomerInvoicePDF } from "@/server/pdf/customer-invoice";
import { GET as publicInvoicePdf } from "@/app/(public)/i/[token]/pdf/route";
import { asAdmin, asManager, ensureSeeded, flushDeferred, mustOk } from "../harness";

/**
 * The client's tax invoice, as they bill it today in Excel: "No of Pax ×
 * Rate × No Of Days" per line, a service date per line when the bill spans
 * dates, and the buyer's own references (GST, vendor code, pay terms) in
 * the TO block. Everything here must survive create, edit and print — and
 * the customer's share link must hand out the same document, login-free.
 */

beforeAll(async () => {
  await ensureSeeded();
});

describe("the client's tax-invoice format", () => {
  it("keeps pax × rate × days per line, the buyer's references, and prints", async () => {
    await asAdmin();
    const customer = mustOk(
      await createCustomer({
        name: `Format Probe ${Date.now()}`,
        billingAddress: "Dept of Chemical Engineering\nIISC, Bangalore",
        stateCode: "29",
        phone: "9999999999",
        gstin: "29AAATI1501J2ZV",
        vendorCode: "2000010609",
        creditDays: 45,
      }),
      "customer",
    );
    const row = await db.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(row.vendorCode).toBe("2000010609");
    expect(row.creditDays).toBe(45);

    // A month of box lunches on one line, plus the transport charge.
    const inv = mustOk(
      await createStandaloneCustomerInvoice({
        customerId: customer.id,
        placeOfSupplyStateCode: "29",
        lines: [
          { description: "Veg carrier box lunch", quantity: "25", unit: "pax", unitPrice: "125", gstRatePct: "5", days: "22", serviceDate: "2026-08-03" },
          { description: "Transportation charges", quantity: "1", unit: "ea", unitPrice: "2000", gstRatePct: "5" },
        ],
      }),
      "invoice",
    );
    const full = await getCustomerInvoice(inv.id);
    expect(full).not.toBeNull();
    const [lunch, transport] = full!.lines;
    expect(lunch.days).toBe(22);
    expect(lunch.serviceDate?.toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(lunch.lineSubtotal.toString()).toBe("68750");
    expect(transport.days).toBe(1);
    expect(transport.serviceDate).toBeNull();
    expect(full!.subtotal.toString()).toBe("70750");
    expect(full!.grandTotal.toString()).toBe("74287.5");

    // Days is a whole number from 1 up — a zero-day line is a keying error.
    const bad = await updateDraftInvoice(inv.id, {
      lines: [{ description: "x", quantity: "1", unit: "pax", unitPrice: "1", days: "0" }],
    });
    expect(bad.ok).toBe(false);

    // The edit path replaces every line and must carry the fields through.
    mustOk(
      await updateDraftInvoice(inv.id, {
        lines: [{ description: "Hi tea", quantity: "85", unit: "pax", unitPrice: "200", gstRatePct: "5", days: "2", serviceDate: "2026-09-07" }],
      }),
      "edit",
    );
    const edited = await getCustomerInvoice(inv.id);
    expect(edited!.lines[0].days).toBe(2);
    expect(edited!.subtotal.toString()).toBe("34000");

    // The printed figures, exactly as the Excel sheet lays them out.
    const view = await buildInvoiceView(edited!);
    expect(view.title).toBe("Tax Invoice");
    expect(view.displayNo).toMatch(/^\d+\/20\d\d-\d\d$/);
    // A draft has no issue date yet; the bill still carries a date.
    expect(view.dateStr).toMatch(/^\d\d\.\d\d\.20\d\d$/);
    expect(view.rows).toEqual([
      { sl: 1, date: "07.09.2026", particular: "Hi tea", pax: "85", rate: "200.00", days: 2, taxable: "34,000.00" },
    ]);
    expect(view.customer.metaLines).toEqual(["GST: 29AAATI1501J2ZV", "Vendor Code: 2000010609", "Pay Terms : 45 Days"]);
    expect(view.totals.map((t) => t.label)).toEqual(["Total", "Cgst @2.5%", "Sgst @2.5%", "Grand Total"]);
    expect(view.totals.at(-1)!.value).toBe("35,700.00");
    expect(view.words).toMatch(/^Rupees Thirty[- ]Five Thousand Seven Hundred Only$/i);

    const pdf = await renderCustomerInvoicePDF(edited!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("the customer's share link serves the page and the PDF only once issued", async () => {
    await asAdmin();
    const customerId = (await db.customer.findFirstOrThrow({ select: { id: true } })).id;
    const inv = mustOk(
      await createStandaloneCustomerInvoice({
        customerId,
        placeOfSupplyStateCode: "29",
        lines: [{ description: "Packed Lunch", quantity: "10", unit: "pax", unitPrice: "250", gstRatePct: "5" }],
      }),
      "invoice",
    );
    const token = (await db.customerInvoice.findUniqueOrThrow({ where: { id: inv.id }, select: { shareToken: true } })).shareToken;
    const params = Promise.resolve({ token });

    // A draft is nobody's business yet: no page, no PDF.
    expect(await getCustomerInvoiceByToken(token)).toBeNull();
    expect((await publicInvoicePdf(new Request("http://test/i/x/pdf"), { params })).status).toBe(404);

    await asManager();
    mustOk(await approveCustomerInvoiceForRelease(inv.id), "approve");
    mustOk(await issueCustomerInvoice(inv.id), "issue");
    await flushDeferred();

    const issued = await getCustomerInvoiceByToken(token);
    expect(issued?.customer.vendorCode).toBeDefined();
    const res = await publicInvoicePdf(new Request("http://test/i/x/pdf"), { params });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
