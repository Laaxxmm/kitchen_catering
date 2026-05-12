import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { amountInWords } from "@/lib/amount-in-words";
import {
  indefineAddress,
  indefineBankDetails,
  indefineCompanyName,
  indefineGstin,
} from "@/lib/org";

const BRAND = "#0F6E56";
const INK = "#1F2A24";
const INK_2 = "#516056";
const INK_3 = "#8C988F";
const RULE = "#D9DDD7";
const PAPER = "#FAFAF6";

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    color: INK,
    fontFamily: "Helvetica",
    backgroundColor: PAPER,
  },
  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  brandBlock: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: BRAND,
    justifyContent: "center",
    alignItems: "center",
  },
  brandMarkText: { color: "#fff", fontSize: 16, fontFamily: "Helvetica-Bold" },
  brandName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK },
  brandTag: { fontSize: 8, color: INK_3, letterSpacing: 1 },
  invoiceTitleBlock: { alignItems: "flex-end" },
  invoiceTitle: {
    fontSize: 9,
    color: INK_3,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  invoiceNo: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  invoiceMeta: { fontSize: 9, color: INK_2 },
  // Address blocks
  addrRow: { flexDirection: "row", gap: 14, marginBottom: 14 },
  addrCol: {
    flex: 1,
    padding: 8,
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  addrLabel: {
    fontSize: 8,
    color: INK_3,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  addrName: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  addrLine: { fontSize: 9, color: INK_2, marginBottom: 2 },
  // Table
  table: { borderWidth: 1, borderColor: RULE, borderRadius: 4, backgroundColor: "#fff" },
  thead: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    backgroundColor: "#F4F4EE",
  },
  th: {
    fontSize: 8,
    color: INK_3,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontFamily: "Helvetica-Bold",
  },
  trow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  td: { fontSize: 9, color: INK },
  right: { textAlign: "right" },
  c_desc: { flex: 4 },
  c_qty: { flex: 1.2, textAlign: "right" },
  c_unit: { flex: 0.8 },
  c_rate: { flex: 1.2, textAlign: "right" },
  c_gst: { flex: 0.8, textAlign: "right" },
  c_total: { flex: 1.5, textAlign: "right" },
  // Totals
  totalsRow: { flexDirection: "row", marginTop: 12 },
  totalsLeft: { flex: 1, paddingRight: 12 },
  totalsRight: { width: 200 },
  totalsItem: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: INK_3 },
  totalsValue: { fontSize: 10, color: INK },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  grandLabel: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 12, color: BRAND, fontFamily: "Helvetica-Bold" },
  inWords: { fontSize: 8.5, fontStyle: "italic", color: INK_2, marginTop: 4 },
  // Bank + footer
  bankBlock: {
    marginTop: 16,
    padding: 8,
    backgroundColor: "#fff",
    borderRadius: 4,
    borderWidth: 1,
    borderColor: RULE,
  },
  bankLabel: {
    fontSize: 8,
    color: INK_3,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 7.5,
    color: INK_3,
    textAlign: "center",
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
});

interface InvoiceLine {
  description: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  gstRatePct: string | number;
  lineTotal: string | number;
}

interface InvoicePDFData {
  invoiceNo: string;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  orderCode?: string | null;
  placeOfSupplyStateCode: string;
  irn?: string | null;
  ackNo?: string | null;
  ackDate?: Date | null;

  seller: {
    name: string;
    gstin: string;
    address: string;
    bankDetails: string;
  };
  customer: {
    name: string;
    gstin?: string | null;
    address: string;
    stateCode: string;
  };

  lines: InvoiceLine[];
  subtotal: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  taxTotal: string | number;
  grandTotal: string | number;
  amountPaid: string | number;
  notes?: string | null;
  terms?: string | null;
}

function CustomerInvoiceDocument({ data }: { data: InvoicePDFData }) {
  const isIntraState = Number(data.cgst) > 0 || Number(data.sgst) > 0;
  return (
    <Document title={`Invoice ${data.invoiceNo}`} author={data.seller.name}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerRow}>
          <View style={s.brandBlock}>
            <View style={s.brandMark}>
              <Text style={s.brandMarkText}>IK</Text>
            </View>
            <View>
              <Text style={s.brandName}>{data.seller.name}</Text>
              <Text style={s.brandTag}>CATERING OPERATIONS</Text>
            </View>
          </View>
          <View style={s.invoiceTitleBlock}>
            <Text style={s.invoiceTitle}>Tax invoice</Text>
            <Text style={s.invoiceNo}>{data.invoiceNo}</Text>
            {data.issuedAt && (
              <Text style={s.invoiceMeta}>Issued {formatIST(data.issuedAt, "dd MMM yyyy")}</Text>
            )}
            {data.dueAt && (
              <Text style={s.invoiceMeta}>Due {formatIST(data.dueAt, "dd MMM yyyy")}</Text>
            )}
            {data.orderCode && (
              <Text style={s.invoiceMeta}>Order {data.orderCode}</Text>
            )}
          </View>
        </View>

        {/* Address blocks */}
        <View style={s.addrRow}>
          <View style={s.addrCol}>
            <Text style={s.addrLabel}>From</Text>
            <Text style={s.addrName}>{data.seller.name}</Text>
            <Text style={s.addrLine}>{data.seller.address}</Text>
            <Text style={s.addrLine}>GSTIN: {data.seller.gstin}</Text>
          </View>
          <View style={s.addrCol}>
            <Text style={s.addrLabel}>Bill to</Text>
            <Text style={s.addrName}>{data.customer.name}</Text>
            <Text style={s.addrLine}>{data.customer.address}</Text>
            {data.customer.gstin && (
              <Text style={s.addrLine}>GSTIN: {data.customer.gstin}</Text>
            )}
            <Text style={s.addrLine}>State code: {data.customer.stateCode}</Text>
          </View>
          <View style={s.addrCol}>
            <Text style={s.addrLabel}>Place of supply</Text>
            <Text style={s.addrName}>State {data.placeOfSupplyStateCode}</Text>
            <Text style={s.addrLine}>
              {isIntraState ? "Intra-state · CGST + SGST" : "Inter-state · IGST"}
            </Text>
            {data.irn && (
              <>
                <Text style={[s.addrLabel, { marginTop: 6 }]}>E-invoice</Text>
                <Text style={[s.addrLine, { fontSize: 7 }]}>IRN {data.irn.slice(0, 32)}…</Text>
                {data.ackNo && <Text style={s.addrLine}>Ack {data.ackNo}</Text>}
              </>
            )}
          </View>
        </View>

        {/* Items table */}
        <View style={s.table}>
          <View style={s.thead}>
            <Text style={[s.th, s.c_desc]}>Description</Text>
            <Text style={[s.th, s.c_qty]}>Qty</Text>
            <Text style={[s.th, s.c_unit]}>Unit</Text>
            <Text style={[s.th, s.c_rate]}>Rate ₹</Text>
            <Text style={[s.th, s.c_gst]}>GST %</Text>
            <Text style={[s.th, s.c_total]}>Amount ₹</Text>
          </View>
          {data.lines.map((l, idx) => (
            <View key={idx} style={s.trow}>
              <Text style={[s.td, s.c_desc]}>{l.description}</Text>
              <Text style={[s.td, s.c_qty]}>{String(l.quantity)}</Text>
              <Text style={[s.td, s.c_unit]}>{l.unit}</Text>
              <Text style={[s.td, s.c_rate]}>{String(l.unitPrice)}</Text>
              <Text style={[s.td, s.c_gst]}>{String(l.gstRatePct)}</Text>
              <Text style={[s.td, s.c_total]}>{String(l.lineTotal)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={s.totalsRow}>
          <View style={s.totalsLeft}>
            {data.notes && (
              <>
                <Text style={s.totalsLabel}>Notes</Text>
                <Text style={[s.td, { marginBottom: 6 }]}>{data.notes}</Text>
              </>
            )}
            {data.terms && (
              <>
                <Text style={s.totalsLabel}>Terms</Text>
                <Text style={s.td}>{data.terms}</Text>
              </>
            )}
          </View>
          <View style={s.totalsRight}>
            <View style={s.totalsItem}>
              <Text style={s.totalsLabel}>Subtotal</Text>
              <Text style={s.totalsValue}>{String(data.subtotal)}</Text>
            </View>
            {Number(data.cgst) > 0 && (
              <View style={s.totalsItem}>
                <Text style={s.totalsLabel}>CGST</Text>
                <Text style={s.totalsValue}>{String(data.cgst)}</Text>
              </View>
            )}
            {Number(data.sgst) > 0 && (
              <View style={s.totalsItem}>
                <Text style={s.totalsLabel}>SGST</Text>
                <Text style={s.totalsValue}>{String(data.sgst)}</Text>
              </View>
            )}
            {Number(data.igst) > 0 && (
              <View style={s.totalsItem}>
                <Text style={s.totalsLabel}>IGST</Text>
                <Text style={s.totalsValue}>{String(data.igst)}</Text>
              </View>
            )}
            <View style={s.grand}>
              <Text style={s.grandLabel}>Grand total</Text>
              <Text style={s.grandValue}>{formatINR(data.grandTotal)}</Text>
            </View>
            {Number(data.amountPaid) > 0 && (
              <View style={s.totalsItem}>
                <Text style={[s.totalsLabel, { color: "#3B6D11" }]}>Paid</Text>
                <Text style={[s.totalsValue, { color: "#3B6D11" }]}>{String(data.amountPaid)}</Text>
              </View>
            )}
            <Text style={s.inWords}>
              In words: {amountInWords(data.grandTotal)}
            </Text>
          </View>
        </View>

        {/* Bank details */}
        {data.seller.bankDetails && (
          <View style={s.bankBlock} wrap={false}>
            <Text style={s.bankLabel}>Bank details</Text>
            <Text style={s.td}>{data.seller.bankDetails}</Text>
          </View>
        )}

        {/* Footer */}
        <Text style={s.footer} fixed>
          {data.seller.name} · {data.seller.gstin} · Generated by Indefine Kitchen catering operations
        </Text>
      </Page>
    </Document>
  );
}

/**
 * Render a CustomerInvoice (with its lines) to a PDF Buffer.
 * Pulls seller-side fields from src/lib/org.ts.
 */
export async function renderCustomerInvoicePDF(input: {
  invoiceNo: string;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  orderCode?: string | null;
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
  const data: InvoicePDFData = {
    invoiceNo: input.invoiceNo,
    issuedAt: input.issuedAt,
    dueAt: input.dueAt,
    orderCode: input.orderCode,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    irn: input.irn,
    ackNo: input.ackNo,
    ackDate: input.ackDate,
    seller: {
      name: indefineCompanyName(),
      gstin: indefineGstin(),
      address: indefineAddress(),
      bankDetails: indefineBankDetails(),
    },
    customer: {
      name: input.customer.name,
      gstin: input.customer.gstin,
      address: input.customer.billingAddress,
      stateCode: input.customer.stateCode,
    },
    lines: input.lines,
    subtotal: input.subtotal,
    cgst: input.cgst,
    sgst: input.sgst,
    igst: input.igst,
    taxTotal: input.taxTotal,
    grandTotal: input.grandTotal,
    amountPaid: input.amountPaid,
    notes: input.notes,
    terms: input.terms,
  };
  return renderToBuffer(<CustomerInvoiceDocument data={data} />);
}
