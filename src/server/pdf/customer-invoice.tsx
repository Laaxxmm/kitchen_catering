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
import type { InvoiceBankDetailsT, InvoiceCompanyDetailsT } from "@/lib/validators";

/**
 * The customer's tax invoice, as the client bills it: one document, two
 * renderings. `buildInvoiceView` turns an invoice row into the printed
 * figures (rows, totals, words, seller and buyer blocks); the PDF below and
 * the shared /i/<token> page both draw from that one view, so they can
 * never disagree.
 */

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
// Pax prints whole; anything else (2.5 kg of cookies) keeps its decimals.
const qty = (v: Money) => {
  const n = Number(String(v));
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
};

/**
 * Reformat the stored invoice number to the client's printed style.
 * "INV-26-27-0111" → "111/2026-27". Display-only — the stored value and
 * numbering are untouched. Unknown formats pass through verbatim.
 */
export function displayInvoiceNo(stored: string): string {
  const m = stored.trim().match(/^INV-(\d{2})-(\d{2})-(\d+)$/);
  if (!m) return stored;
  const [, fy1, fy2, serial] = m;
  return `${parseInt(serial, 10)}/20${fy1}-${fy2}`;
}

type Money = string | number | { toString(): string };

/**
 * What a render needs off an invoice. Every read of CustomerInvoice that
 * includes `customer`, `lines` and `order` satisfies this as-is (Prisma
 * Decimals go through String()); the proforma mailer assembles it by hand.
 */
export interface PrintableInvoice {
  invoiceNo: string;
  kind?: string | null;
  issuedAt?: Date | null;
  /** Pax the bill was raised for — the printed rate is subtotal ÷ this. */
  finalHeadcount?: number | null;
  subtotal: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  grandTotal: Money;
  customer: {
    name: string;
    billingCompanyName?: string | null;
    gstin?: string | null;
    billingAddress: string;
    vendorCode?: string | null;
    creditDays?: number | null;
  };
  /**
   * The billed event, for order-linked invoices. Those print as ONE line —
   * the customer bought a meal for N pax, not a list of dishes — with pax
   * from the invoice's own headcount (the live order moves after billing)
   * and the event day in the Date column. Null for ad-hoc invoices.
   */
  order?: { code: string; headcount: number | null; mealType: string; eventDate?: Date | null } | null;
  lines: Array<{
    description: string;
    quantity: Money;
    unitPrice: Money;
    days?: number | null;
    serviceDate?: Date | null;
    /** Stored taxable value; preferred so the column sums to the Total. */
    lineSubtotal?: Money | null;
  }>;
}

export interface InvoiceView {
  title: string;
  proforma: boolean;
  seller: { name: string; gstin: string; addressLines: string[]; email: string | null; phoneLine: string | null };
  dateStr: string;
  displayNo: string;
  customer: { name: string; addressLines: string[]; metaLines: string[] };
  rows: Array<{ sl: number; date: string; particular: string; pax: string; rate: string; days: number; taxable: string }>;
  totals: Array<{ label: string; value: string; grand: boolean }>;
  words: string;
  bank: { rows: Array<[string, string]>; freeLines: string[] } | null;
}

function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The printed figures. Seller block and bank details come from Admin →
 * Settings ("invoice.company", "invoice.bankDetails"); a blank setting falls
 * back to the INDEFINE_* env, and an empty bank block is omitted entirely.
 */
export async function buildInvoiceView(inv: PrintableInvoice): Promise<InvoiceView> {
  const [bankSetting, company] = await Promise.all([
    getSetting<InvoiceBankDetailsT>("invoice.bankDetails"),
    getSetting<InvoiceCompanyDetailsT>("invoice.company"),
  ]);

  const fmt = (d: Date | null | undefined) => (d ? formatIST(d, "dd.MM.yyyy") : "");
  const dateStr = fmt(inv.issuedAt);
  const subtotal = Number(String(inv.subtotal));
  const cgst = Number(String(inv.cgst));
  const sgst = Number(String(inv.sgst));
  const igst = Number(String(inv.igst));
  const rateOf = (tax: number) => (subtotal > 0 ? (tax / subtotal) * 100 : 0);

  const pax = inv.order ? (inv.finalHeadcount ?? inv.order.headcount ?? 0) : 0;
  const rows: InvoiceView["rows"] = inv.order
    ? [{
        sl: 1,
        date: fmt(inv.order.eventDate) || dateStr,
        particular: `${mealLabel(inv.order.mealType)} catering — ${inv.order.code}`,
        pax: pax > 0 ? String(pax) : "",
        rate: money(pax > 0 ? subtotal / pax : subtotal),
        days: 1,
        taxable: money(subtotal),
      }]
    : inv.lines.map((l, i) => {
        const days = l.days ?? 1;
        const taxable =
          l.lineSubtotal != null
            ? Number(String(l.lineSubtotal))
            : Number(String(l.quantity)) * days * Number(String(l.unitPrice));
        return {
          sl: i + 1,
          date: fmt(l.serviceDate),
          particular: l.description,
          pax: qty(l.quantity),
          rate: money(String(l.unitPrice)),
          days,
          taxable: money(taxable),
        };
      });

  const totals: InvoiceView["totals"] = [{ label: "Total", value: money(subtotal), grand: false }];
  if (cgst > 0 || sgst > 0) {
    totals.push({ label: `Cgst @${pct(rateOf(cgst))}%`, value: money(cgst), grand: false });
    totals.push({ label: `Sgst @${pct(rateOf(sgst))}%`, value: money(sgst), grand: false });
  } else if (igst > 0) {
    totals.push({ label: `Igst @${pct(rateOf(igst))}%`, value: money(igst), grand: false });
  }
  totals.push({ label: "Grand Total", value: money(String(inv.grandTotal)), grand: true });

  const bankRows = (
    [
      ["Bank Name", bankSetting?.bankBranch],
      ["Account Name", bankSetting?.accountName],
      ["Account No", bankSetting?.accountNumber],
      ["IFSC Code", bankSetting?.ifsc],
    ] as Array<[string, string | undefined]>
  ).filter((r): r is [string, string] => Boolean(r[1]));
  const bankFree = bankRows.length === 0 ? nonEmptyLines(process.env.INDEFINE_BANK_DETAILS ?? "") : [];

  const phone = company?.phone || process.env.INDEFINE_PHONE || "";
  const mobile = company?.mobile || process.env.INDEFINE_MOBILE || "";
  const payTerms = inv.customer.creditDays ?? 0;

  return {
    title: inv.kind === "PROFORMA" ? "Proforma Invoice" : "Tax Invoice",
    proforma: inv.kind === "PROFORMA",
    seller: {
      name: company?.name || indefineCompanyName(),
      gstin: company?.gstin || indefineGstin(),
      addressLines: nonEmptyLines(company?.address || indefineAddress()),
      email: company?.email || process.env.INDEFINE_EMAIL || null,
      phoneLine:
        [phone && `Ph: ${phone}`, mobile && `Mob: ${mobile}`].filter(Boolean).join(", ") || null,
    },
    dateStr,
    displayNo: displayInvoiceNo(inv.invoiceNo),
    customer: {
      name: inv.customer.billingCompanyName || inv.customer.name,
      addressLines: nonEmptyLines(inv.customer.billingAddress),
      metaLines: [
        inv.customer.gstin && `GST: ${inv.customer.gstin}`,
        inv.customer.vendorCode && `Vendor Code: ${inv.customer.vendorCode}`,
        payTerms > 0 && `Pay Terms : ${payTerms} Days`,
      ].filter((s): s is string => Boolean(s)),
    },
    rows,
    totals,
    words: amountInWords(String(inv.grandTotal)),
    bank: bankRows.length > 0 || bankFree.length > 0 ? { rows: bankRows, freeLines: bankFree } : null,
  };
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
  toMeta: { fontSize: 9, marginTop: 3, fontFamily: "Helvetica-Bold" },

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
  cSl: { width: "7%" },
  cDate: { width: "13%" },
  cParticular: { width: "33%" },
  cPax: { width: "10%" },
  cRate: { width: "12%" },
  cDays: { width: "10%" },
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
  signName: { fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "right" },
});

function CustomerInvoiceDocument({ view }: { view: InvoiceView }) {
  return (
    <Document title={`${view.title} ${view.displayNo}`} author={view.seller.name}>
      <Page size="A4" style={s.page}>
        <View style={s.frame}>
          {/* Title + centered company block */}
          <Text style={s.title}>{view.title}</Text>
          {view.proforma && <Text style={s.proformaNote}>PROFORMA — not a tax invoice</Text>}
          <Text style={s.company}>{view.seller.name}</Text>
          {view.seller.addressLines.map((l, i) => (
            <Text key={i} style={s.companyLine}>{l}</Text>
          ))}
          {view.seller.email && <Text style={s.companyLine}>Email : {view.seller.email}</Text>}
          {view.seller.phoneLine && <Text style={s.companyLine}>{view.seller.phoneLine}</Text>}

          {/* GSTIN / Date / Inv No strip */}
          <View style={s.strip}>
            <Text style={s.stripLeft}>GSTIN : {view.seller.gstin}</Text>
            <View style={s.stripRight}>
              <Text style={s.stripMeta}>Date : {view.dateStr}</Text>
              <Text style={s.stripMeta}>Inv No: {view.displayNo}</Text>
            </View>
          </View>

          {/* TO block — name, address, then the buyer's own references */}
          <View style={s.toBlock}>
            <Text style={s.toLabel}>TO</Text>
            <Text style={s.toName}>{view.customer.name}</Text>
            {view.customer.addressLines.map((l, i) => (
              <Text key={i} style={s.toLine}>{l}</Text>
            ))}
            {view.customer.metaLines.map((l) => (
              <Text key={l} style={s.toMeta}>{l}</Text>
            ))}
          </View>

          {/* Line-items table */}
          <View style={s.table}>
            <View style={[s.row, s.headRow]}>
              <Text style={[s.cell, s.cSl, s.headText]}>Sl.No</Text>
              <Text style={[s.cell, s.cDate, s.headText]}>Date</Text>
              <Text style={[s.cell, s.cParticular, s.headText]}>Particular</Text>
              <Text style={[s.cell, s.cPax, s.headText, s.right]}>No of Pax</Text>
              <Text style={[s.cell, s.cRate, s.headText, s.right]}>Rate</Text>
              <Text style={[s.cell, s.cDays, s.headText, s.right]}>No Of Days</Text>
              <Text style={[s.cell, s.cAmt, s.cellLast, s.headText, s.right]}>Taxable Amt</Text>
            </View>
            {view.rows.map((r) => (
              <View key={r.sl} style={s.row}>
                <Text style={[s.cell, s.cSl]}>{r.sl}</Text>
                <Text style={[s.cell, s.cDate]}>{r.date}</Text>
                <Text style={[s.cell, s.cParticular]}>{r.particular}</Text>
                <Text style={[s.cell, s.cPax, s.right]}>{r.pax}</Text>
                <Text style={[s.cell, s.cRate, s.right]}>{r.rate}</Text>
                <Text style={[s.cell, s.cDays, s.right]}>{r.days}</Text>
                <Text style={[s.cell, s.cAmt, s.cellLast, s.right]}>{r.taxable}</Text>
              </View>
            ))}
          </View>

          {/* Totals (right-aligned) */}
          <View style={s.totalsWrap}>
            <View style={s.totalsBox}>
              {view.totals.map((t) => (
                <View key={t.label} style={s.totalRow}>
                  <Text style={t.grand ? s.grandLabel : s.totalLabel}>{t.label}</Text>
                  <Text style={t.grand ? s.grandValue : s.totalValue}>{t.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Amount in words */}
          <Text style={s.words}>
            <Text style={s.wordsLabel}>Rupees in Words: </Text>
            {view.words}
          </Text>

          {/* Bank details — omitted entirely when nothing is configured */}
          {view.bank && (
            <View style={s.bankWrap} wrap={false}>
              <Text style={s.bankHeading}>For Online payment details furnished below</Text>
              {view.bank.rows.length > 0 ? (
                <View style={s.bankTable}>
                  {view.bank.rows.map(([k, v], i) => (
                    <View key={k} style={[s.bankRow, i === view.bank!.rows.length - 1 ? s.bankRowLast : {}]}>
                      <Text style={s.bankKey}>{k}</Text>
                      <Text style={s.bankVal}>{v}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                view.bank.freeLines.map((l, i) => (
                  <Text key={i} style={s.bankFree}>{l}</Text>
                ))
              )}
            </View>
          )}

          {/* Footer — whitespace for the stamp/sign, then the signatory */}
          <View style={s.footer}>
            <Text style={s.footerText}>Thanking You</Text>
            <View style={s.signSpace} />
            <Text style={s.signName}>{view.seller.name.toUpperCase()}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

/** Render a CustomerInvoice (with customer, lines and order) to a PDF Buffer. */
export async function renderCustomerInvoicePDF(inv: PrintableInvoice): Promise<Buffer> {
  const view = await buildInvoiceView(inv);
  return renderToBuffer(<CustomerInvoiceDocument view={view} />);
}
