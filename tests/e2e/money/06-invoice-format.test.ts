import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createCustomer } from "@/server/actions/customers";
import {
  createStandaloneCustomerInvoice,
  getCustomerInvoice,
  updateDraftInvoice,
} from "@/server/actions/customer-invoices";
import { renderCustomerInvoicePDF } from "@/server/pdf/customer-invoice";
import { asAdmin, ensureSeeded, mustOk } from "../harness";

/**
 * The client's tax invoice, as they bill it today in Excel: "No of Pax ×
 * Rate × No Of Days" per line, a service date per line when the bill spans
 * dates, and the buyer's own references (GST, vendor code, pay terms) in
 * the TO block. Everything here must survive create, edit and print.
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
    expect(edited!.lines[0].serviceDate?.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(edited!.subtotal.toString()).toBe("34000");

    // And the printed document builds with every new field on it.
    const e = edited!;
    const pdf = await renderCustomerInvoicePDF({
      invoiceNo: e.invoiceNo,
      kind: e.kind,
      issuedAt: new Date(),
      orderCode: null,
      order: null,
      placeOfSupplyStateCode: e.placeOfSupplyStateCode,
      customer: {
        name: e.customer.name,
        gstin: e.customer.gstin,
        billingAddress: e.customer.billingAddress,
        stateCode: e.customer.stateCode,
        vendorCode: e.customer.vendorCode,
        creditDays: e.customer.creditDays,
      },
      lines: e.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toString(),
        gstRatePct: l.gstRatePct.toString(),
        days: l.days,
        serviceDate: l.serviceDate,
        lineSubtotal: l.lineSubtotal.toString(),
        lineTotal: l.lineTotal.toString(),
      })),
      subtotal: e.subtotal.toString(),
      cgst: e.cgst.toString(),
      sgst: e.sgst.toString(),
      igst: e.igst.toString(),
      taxTotal: e.taxTotal.toString(),
      grandTotal: e.grandTotal.toString(),
      amountPaid: e.amountPaid.toString(),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
