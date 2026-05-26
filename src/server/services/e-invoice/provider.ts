/**
 * E-invoice (IRN + signed QR) provider abstraction.
 *
 * Production Greenpath deployments use a GSP (ClearTax / IRIS / NIC
 * direct). Dev + this scaffold ship a sandbox provider that issues
 * synthetic IRNs so the rest of the system can be exercised end-to-end
 * without real GSP credentials.
 *
 * Switch providers via Settings key `eInvoice.provider`:
 *   "sandbox"  — default; synthesises IRN + QR. Safe for dev + demo.
 *   "cleartax" — real ClearTax integration (Phase 3 follow-up; needs
 *                CLEARTAX_API_KEY + CLEARTAX_GSP_GSTIN env vars).
 *   "nic"      — direct NIC IRP. Future.
 *
 * The Settings flag `eInvoice.enabled` (boolean) controls whether an IRN
 * is requested at all on invoice issue. Default off; turn on once the
 * client has registered for e-invoicing.
 */

import { createHash } from "node:crypto";
import { getSettingOr } from "@/lib/settings";

export interface EInvoicePayload {
  invoiceNo: string;
  invoiceDate: Date;
  sellerGstin: string;
  sellerName: string;
  buyerGstin: string | null;
  buyerName: string;
  buyerStateCode: string;
  placeOfSupplyStateCode: string;
  lineCount: number;
  subtotal: string;
  cgst: string;
  sgst: string;
  igst: string;
  grandTotal: string;
}

export interface EInvoiceResult {
  irn: string;
  ackNo: string;
  ackDate: Date;
  signedQrPayload: string;
  signedInvoiceJson: unknown;
}

export interface EInvoiceProvider {
  readonly name: string;
  generate(payload: EInvoicePayload): Promise<EInvoiceResult>;
  cancel(irn: string, reason: string): Promise<void>;
}

class SandboxEInvoiceProvider implements EInvoiceProvider {
  readonly name = "sandbox";

  async generate(payload: EInvoicePayload): Promise<EInvoiceResult> {
    // Synthesise an IRN that has the right shape (64-char hex) and is
    // deterministic given the payload — so re-running the same invoice
    // (e.g. retry after a UI error) returns the same IRN.
    const irn = createHash("sha256")
      .update(JSON.stringify({
        s: payload.sellerGstin,
        i: payload.invoiceNo,
        d: payload.invoiceDate.toISOString().slice(0, 10),
      }))
      .digest("hex");

    const ackDate = new Date();
    const ackNo = `SBX${Date.now().toString().slice(-12)}`;

    // The IRP returns a signed QR payload string. We synthesise one that
    // contains the canonical fields so a QR reader at least sees structured
    // text. Real signed QRs from NIC are JWT-encoded.
    const signedQrPayload = JSON.stringify({
      sellerGstin: payload.sellerGstin,
      buyerGstin: payload.buyerGstin,
      invoiceNo: payload.invoiceNo,
      invoiceDate: payload.invoiceDate.toISOString().slice(0, 10),
      totalAmount: payload.grandTotal,
      irn,
      ackNo,
    });

    const signedInvoiceJson = {
      provider: "sandbox",
      generatedAt: ackDate.toISOString(),
      payload,
      irn,
      ackNo,
    };

    return { irn, ackNo, ackDate, signedQrPayload, signedInvoiceJson };
  }

  async cancel(irn: string, reason: string): Promise<void> {
    console.error(`[E-Invoice SANDBOX] cancelled IRN ${irn}: ${reason}`);
  }
}

export async function getEInvoiceProvider(): Promise<EInvoiceProvider> {
  const which = await getSettingOr<string>("eInvoice.provider", "sandbox");
  switch (which) {
    case "sandbox":
      return new SandboxEInvoiceProvider();
    case "cleartax":
    case "nic":
      // Real implementations follow when client signs the GSP agreement.
      // Until then, fall back to sandbox so the flow exercises end-to-end.
      console.error(`[E-Invoice] provider "${which}" not yet implemented; falling back to sandbox`);
      return new SandboxEInvoiceProvider();
    default:
      return new SandboxEInvoiceProvider();
  }
}

export async function eInvoiceEnabled(): Promise<boolean> {
  return getSettingOr<boolean>("eInvoice.enabled", false);
}
