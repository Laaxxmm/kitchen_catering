import { indefineCompanyName } from "./org";

/**
 * Build a UPI deep link per the UPI spec (`upi://pay?...`). The link can be
 * embedded in the public invoice view; a recipient with any UPI app
 * installed taps it and sees the amount + payee pre-filled.
 *
 * Reference: https://developers.google.com/pay/india/api/upi-app-link
 *   pa = payee VPA (e.g. indefine@hdfcbank)
 *   pn = payee name
 *   am = amount in INR
 *   cu = currency (always INR)
 *   tn = transaction note (we put the invoice no)
 *   tr = transaction reference (echoed back by the app; we use invoice no)
 */
export function buildUPILink(opts: {
  amount: string | number;
  invoiceNo: string;
  payeeVPA?: string;
  payeeName?: string;
}): string {
  const vpa = opts.payeeVPA ?? process.env.INDEFINE_UPI_VPA ?? "";
  if (!vpa) return ""; // caller checks empty -> don't show button
  const name = opts.payeeName ?? indefineCompanyName();
  const params = new URLSearchParams({
    pa: vpa,
    pn: name,
    am: String(opts.amount),
    cu: "INR",
    tn: `IK ${opts.invoiceNo}`,
    tr: opts.invoiceNo,
  });
  return `upi://pay?${params.toString()}`;
}
