import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatIST } from "@/lib/time";
import { amountInWords } from "@/lib/amount-in-words";
import { getSetting } from "@/lib/settings";
import {
  indefineAddress,
  indefineCompanyName,
  indefineGstin,
} from "@/lib/org";
import type { InvoiceBankDetailsT } from "@/lib/validators";

const INK = "#000";
const RULE = "#000";
const HEAD_FILL = "#EFEFEF";

// Plain Indian-grouped money, 2dp, NO rupee glyph — @react-pdf's built-in
// Helvetica has no U+20B9, so the symbol would render as tofu. The "Rupees …
// Only" line makes the currency explicit.
const INR = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (v: string | number) => INR.format(Number(v));
// Trim trailing zeros on rate percentages: 2.5 not 2.50, 9 not 9.00.
const pct = (v: number) => String(Number(v.toFixed(2)));
// MealType enum → printed label. BREAKFAST → "Breakfast", HIGH_TEA → "High tea".
const mealLabel = (m: string) => m.charAt(0) + m.slice(1).toLowerCase().replaceAll("_", " ");

/**
 * Reformat the stored invoice number to the client's printed style.
 * "INV-26-27-0111" → "111/2026-27". Display-only — the stored value and
 * numbering are untouched. Unknown formats pass through verbatim.
 */
function displayInvoiceNo(stored: string): string {
  const m = stored.trim().match(/^INV-(\d{2})-(\d{2})-(\d+)$/);
  if (!m) return stored;
  const [, fy1, fy2, serial] = m;
  return `${parseInt(serial, 10)}/20${fy1}-${fy2}`;
}

const s = StyleSheet.create({
  page: {
    paddingVertical: 28,
    paddingHorizontal: 30,
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica",
    backgroundColor: "#fff",
  },
  frame: { borderWidth: 1, borderColor: RULE },

  // Title + company (centered)
  title: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 6,
  },
  company: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
  },
  companyLine: { fontSize: 9, textAlign: "center", marginTop: 2 },
  proformaNote: {
    fontSize: 8,
    textAlign: "center",
    marginTop: 3,
    marginBottom: 2,
    fontFamily: "Helvetica-Oblique",
  },

  // GSTIN / date / inv-no strip
  strip: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: RULE,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  stripLeft: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  stripRight: { alignItems: "flex-end" },
  stripMeta: { fontSize: 9 },

  // TO block
  toBlock: { paddingVertical: 6, paddingHorizontal: 8 },
  toLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  toName: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  toLine: { fontSize: 9, marginTop: 1 },

  // Items table
  table: { borderTopWidth: 1, borderTopColor: RULE },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  headRow: { backgroundColor: HEAD_FILL },
  cell: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: RULE,
    fontSize: 9,
  },
  cellLast: { borderRightWidth: 0 },
  headText: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  right: { textAlign: "right" },
  cDate: { width: "15%" },
  cParticular: { width: "34%" },
  cPax: { width: "12%" },
  cRate: { width: "13%" },
  cDays: { width: "11%" },
  cAmt: { width: "15%" },

  // Totals
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: "45%" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  totalLabel: { fontSize: 9 },
  totalValue: { fontSize: 9, textAlign: "right" },
  grandLabel: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 10, fontFamily: "Helvetica-Bold", textAlign: "right" },

  words: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  wordsLabel: { fontFamily: "Helvetica-Bold" },

  // Bank block
  bankWrap: { paddingVertical: 6, paddingHorizontal: 8 },
  bankHeading: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  bankTable: { borderWidth: 1, borderColor: RULE, width: "70%" },
  bankRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  bankRowLast: { borderBottomWidth: 0 },
  bankKey: {
    width: "40%",
    paddingVertical: 3,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: RULE,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  bankVal: { paddingVertical: 3, paddingHorizontal: 5, fontSize: 9 },
  bankFree: { fontSize: 9 },

  // Footer
  footer: { paddingTop: 10, paddingHorizontal: 8, paddingBottom: 14 },
  footerText: { fontSize: 9 },
  signSpace: { height: 46 },
});

interface InvoiceLine {
  description: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  gstRatePct: string | number;
  lineTotal: string | number;
}

interface BankFields {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  freeText?: string; // legacy INDEFINE_BANK_DETAILS fallback
}

interface InvoicePDFData {
  invoiceNo: string;
  kind?: string | null;
  issuedAt?: Date | null;
  orderCode?: string | null;

  seller: { name: string; gstin: string; address: string; bank: BankFields };
  contact: { email?: string; phone?: string; mobile?: string };
  customer: { name: string; address: string };

  /**
   * The billed event (null for adhoc / consolidated folio invoices, which
   * have no single order). When present the bill prints as ONE consolidated
   * event line. `headcount` must be the INVOICE's own finalHeadcount — the
   * live order moves after invoicing (100 booked, 120 fed) and the printed
   * rate is subtotal ÷ headcount, so taking it from anywhere but the
   * invoice makes the rate disagree with the invoice's own total.
   */
  order?: { headcount: number | null; mealType: string } | null;

  lines: InvoiceLine[];
  subtotal: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  grandTotal: string | number;
}

function nonEmptyLines(addr: string): string[] {
  return addr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function CustomerInvoiceDocument({ data }: { data: InvoicePDFData }) {
  const isProforma = data.kind === "PROFORMA";
  const subtotal = Number(data.subtotal);
  const cgst = Number(data.cgst);
  const sgst = Number(data.sgst);
  const igst = Number(data.igst);
  const isIntraState = cgst > 0 || sgst > 0;
  // Effective (blended across rates) tax percentage, derived from amounts.
  const rateOf = (tax: number) => (subtotal > 0 ? (tax / subtotal) * 100 : 0);

  const dateStr = data.issuedAt ? formatIST(data.issuedAt, "dd.MM.yyyy") : "";

  // An order-linked bill is ONE line — the customer bought a meal for N pax,
  // not a list of dishes. Pax comes from the invoice's own final headcount
  // and the rate is the per-head share of the taxable amount on this same
  // document, so the two can never contradict each other.
  const days = 1; // no per-line day count is stored; the client's format defaults to 1
  const eventPax = data.order?.headcount ?? 0;
  const rows = data.order
    ? [{
        particular: [`${mealLabel(data.order.mealType)} catering`, data.orderCode]
          .filter(Boolean)
          .join(" — "),
        pax: eventPax > 0 ? eventPax : "",
        rate: eventPax > 0 ? subtotal / eventPax : subtotal,
        taxable: subtotal,
      }]
    : data.lines.map((l) => ({
        particular: l.description,
        pax: Number(l.quantity),
        rate: Number(l.unitPrice),
        taxable: Number(l.quantity) * days * Number(l.unitPrice),
      }));
  const b = data.seller.bank;
  const bankRows = [
    ["Bank Name", b.bankName],
    ["Account Name", b.accountName],
    ["Account No", b.accountNumber],
    ["IFSC Code", b.ifsc],
  ].filter(([, v]) => Boolean(v)) as [string, string][];
  const hasBank = bankRows.length > 0 || Boolean(b.freeText);

  return (
    <Document title={`${isProforma ? "Proforma" : "Tax"} Invoice ${data.invoiceNo}`} author={data.seller.name}>
      <Page size="A4" style={s.page}>
        <View style={s.frame}>
          {/* Title + centered company block */}
          <Text style={s.title}>{isProforma ? "Proforma Invoice" : "Tax Invoice"}</Text>
          {isProforma && (
            <Text style={s.proformaNote}>PROFORMA — not a tax invoice</Text>
          )}
          <Text style={s.company}>{data.seller.name}</Text>
          {nonEmptyLines(data.seller.address).map((l, i) => (
            <Text key={i} style={s.companyLine}>{l}</Text>
          ))}
          {data.contact.email && (
            <Text style={s.companyLine}>Email : {data.contact.email}</Text>
          )}
          {(data.contact.phone || data.contact.mobile) && (
            <Text style={s.companyLine}>
              {[data.contact.phone && `Ph: ${data.contact.phone}`, data.contact.mobile && `Mob: ${data.contact.mobile}`]
                .filter(Boolean)
                .join("   ")}
            </Text>
          )}

          {/* GSTIN / Date / Inv No strip */}
          <View style={s.strip}>
            <Text style={s.stripLeft}>GSTIN : {data.seller.gstin}</Text>
            <View style={s.stripRight}>
              <Text style={s.stripMeta}>Date : {dateStr}</Text>
              <Text style={s.stripMeta}>Inv No: {displayInvoiceNo(data.invoiceNo)}</Text>
            </View>
          </View>

          {/* TO block */}
          <View style={s.toBlock}>
            <Text style={s.toLabel}>TO</Text>
            <Text style={s.toName}>{data.customer.name}</Text>
            {nonEmptyLines(data.customer.address).map((l, i) => (
              <Text key={i} style={s.toLine}>{l}</Text>
            ))}
          </View>

          {/* Line-items table */}
          <View style={s.table}>
            <View style={[s.row, s.headRow]}>
              <Text style={[s.cell, s.cDate, s.headText]}>Date</Text>
              <Text style={[s.cell, s.cParticular, s.headText]}>Particular</Text>
              <Text style={[s.cell, s.cPax, s.headText, s.right]}>No of Pax</Text>
              <Text style={[s.cell, s.cRate, s.headText, s.right]}>Rate</Text>
              <Text style={[s.cell, s.cDays, s.headText, s.right]}>No Of Days</Text>
              <Text style={[s.cell, s.cAmt, s.cellLast, s.headText, s.right]}>Taxable Amt</Text>
            </View>
            {rows.map((r, i) => (
              <View key={i} style={s.row}>
                <Text style={[s.cell, s.cDate]}>{dateStr}</Text>
                <Text style={[s.cell, s.cParticular]}>{r.particular}</Text>
                <Text style={[s.cell, s.cPax, s.right]}>{r.pax}</Text>
                <Text style={[s.cell, s.cRate, s.right]}>{money(r.rate)}</Text>
                <Text style={[s.cell, s.cDays, s.right]}>{days}</Text>
                <Text style={[s.cell, s.cAmt, s.cellLast, s.right]}>{money(r.taxable)}</Text>
              </View>
            ))}
          </View>

          {/* Totals (right-aligned) */}
          <View style={s.totalsWrap}>
            <View style={s.totalsBox}>
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>Total</Text>
                <Text style={s.totalValue}>{money(subtotal)}</Text>
              </View>
              {isIntraState ? (
                <>
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Cgst @{pct(rateOf(cgst))}%</Text>
                    <Text style={s.totalValue}>{money(cgst)}</Text>
                  </View>
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Sgst @{pct(rateOf(sgst))}%</Text>
                    <Text style={s.totalValue}>{money(sgst)}</Text>
                  </View>
                </>
              ) : (
                igst > 0 && (
                  <View style={s.totalRow}>
                    <Text style={s.totalLabel}>Igst @{pct(rateOf(igst))}%</Text>
                    <Text style={s.totalValue}>{money(igst)}</Text>
                  </View>
                )
              )}
              <View style={s.totalRow}>
                <Text style={s.grandLabel}>Grand Total</Text>
                <Text style={s.grandValue}>{money(data.grandTotal)}</Text>
              </View>
            </View>
          </View>

          {/* Amount in words */}
          <Text style={s.words}>
            <Text style={s.wordsLabel}>Rupees in Words: </Text>
            {amountInWords(data.grandTotal)}
          </Text>

          {/* Bank details — omitted entirely when nothing is configured */}
          {hasBank && (
            <View style={s.bankWrap} wrap={false}>
              <Text style={s.bankHeading}>For Online payment details furnished below</Text>
              {bankRows.length > 0 ? (
                <View style={s.bankTable}>
                  {bankRows.map(([k, v], i) => (
                    <View
                      key={k}
                      style={[s.bankRow, i === bankRows.length - 1 ? s.bankRowLast : {}]}
                    >
                      <Text style={s.bankKey}>{k}</Text>
                      <Text style={s.bankVal}>{v}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                nonEmptyLines(b.freeText ?? "").map((l, i) => (
                  <Text key={i} style={s.bankFree}>{l}</Text>
                ))
              )}
            </View>
          )}

          {/* Footer — leave whitespace for the physical stamp/sign */}
          <View style={s.footer}>
            <Text style={s.footerText}>Thanking You</Text>
            <View style={s.signSpace} />
          </View>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Render a CustomerInvoice (with its lines) to a PDF Buffer.
 * Seller-side fields come from src/lib/org.ts; contact + bank from config.
 */
export async function renderCustomerInvoicePDF(input: {
  invoiceNo: string;
  kind?: string | null;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  orderCode?: string | null;
  /**
   * The billed event — pass `headcount: invoice.finalHeadcount` (never the
   * live order's), plus the meal, for every order-linked invoice. Omit for
   * adhoc / consolidated invoices (they print their own lines).
   */
  order?: { headcount: number | null; mealType: string } | null;
  placeOfSupplyStateCode: string;
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: Date | null;

  customer: {
    name: string;
    gstin?: string | null;
    billingAddress: string;
    stateCode: string;
  };

  lines: Array<{
    description: string;
    quantity: string | number;
    unit: string;
    unitPrice: string | number;
    gstRatePct: string | number;
    lineTotal: string | number;
  }>;
  subtotal: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  taxTotal: string | number;
  grandTotal: string | number;
  amountPaid: string | number;
  notes?: string | null;
  terms?: string | null;
}): Promise<Buffer> {
  // Structured bank details (Admin → Settings → Invoice bank details). Legacy
  // free-text INDEFINE_BANK_DETAILS is still honoured as a fallback. When
  // neither is set the whole bank block is omitted — no placeholder rows.
  const bankSetting = await getSetting<InvoiceBankDetailsT>("invoice.bankDetails");
  const bank: BankFields = {
    bankName: bankSetting?.bankBranch || undefined,
    accountName: bankSetting?.accountName || undefined,
    accountNumber: bankSetting?.accountNumber || undefined,
    ifsc: bankSetting?.ifsc || undefined,
    freeText: process.env.INDEFINE_BANK_DETAILS || undefined,
  };

  const data: InvoicePDFData = {
    invoiceNo: input.invoiceNo,
    kind: input.kind,
    issuedAt: input.issuedAt,
    orderCode: input.orderCode,
    order: input.order ?? null,
    seller: {
      name: indefineCompanyName(),
      gstin: indefineGstin(),
      address: indefineAddress(),
      bank,
    },
    // Contact lines come from env config (org.ts holds no contact fields).
    // Set INDEFINE_EMAIL / INDEFINE_PHONE / INDEFINE_MOBILE to show them;
    // unset lines are simply omitted — no hardcoded business data.
    contact: {
      email: process.env.INDEFINE_EMAIL || undefined,
      phone: process.env.INDEFINE_PHONE || undefined,
      mobile: process.env.INDEFINE_MOBILE || undefined,
    },
    customer: {
      name: input.customer.name,
      address: input.customer.billingAddress,
    },
    lines: input.lines,
    subtotal: input.subtotal,
    cgst: input.cgst,
    sgst: input.sgst,
    igst: input.igst,
    grandTotal: input.grandTotal,
  };
  return renderToBuffer(<CustomerInvoiceDocument data={data} />);
}
