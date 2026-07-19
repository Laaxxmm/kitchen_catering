import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { formatINR, toDecimal } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { indefineAddress, indefineCompanyName } from "@/lib/org";

const BRAND = "#0F6E56";
const INK = "#1F2A24";
const INK_2 = "#516056";
const INK_3 = "#8C988F";
const RULE = "#D9DDD7";
const PAPER = "#FAFAF6";
const OUT_RED = "#B4322A";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: INK, fontFamily: "Helvetica", backgroundColor: PAPER },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  brandBlock: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: {
    width: 30, height: 30, borderRadius: 6, backgroundColor: BRAND,
    justifyContent: "center", alignItems: "center",
  },
  brandMarkText: { color: "#fff", fontSize: 15, fontFamily: "Helvetica-Bold" },
  brandName: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  brandAddr: { fontSize: 7.5, color: INK_3 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 8.5, color: INK_3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2 },
  period: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 8.5, color: INK_2 },

  // Summary cards
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  card: { flex: 1, borderWidth: 1, borderColor: RULE, borderRadius: 4, backgroundColor: "#fff", padding: 8 },
  cardLabel: { fontSize: 7.5, color: INK_3, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 },
  cardValue: { fontSize: 13, fontFamily: "Helvetica-Bold" },

  // Ledger table
  tableHead: {
    flexDirection: "row",
    backgroundColor: "#EEF1EC",
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: RULE,
    paddingVertical: 5, paddingHorizontal: 4,
  },
  th: { fontSize: 7.5, color: INK_2, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1, borderBottomColor: RULE,
    paddingVertical: 5, paddingHorizontal: 4,
  },
  td: { fontSize: 8.5, color: INK },
  cDate: { width: 60 },
  cRef: { width: 80, color: INK_2 },
  cFloat: { width: 78, color: INK_2 },
  cType: { width: 52 },
  cDetail: { flex: 1, paddingRight: 6 },
  cIn: { width: 66, textAlign: "right", color: BRAND },
  cOut: { width: 66, textAlign: "right", color: OUT_RED },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6, paddingHorizontal: 4,
    borderTopWidth: 1.5, borderTopColor: INK_3,
    marginTop: 2,
  },
  totalLabel: { flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold", color: INK },
  totalIn: { width: 66, textAlign: "right", fontSize: 9, fontFamily: "Helvetica-Bold", color: BRAND },
  totalOut: { width: 66, textAlign: "right", fontSize: 9, fontFamily: "Helvetica-Bold", color: OUT_RED },

  balHead: { fontSize: 8.5, color: INK_3, letterSpacing: 1, textTransform: "uppercase", marginTop: 18, marginBottom: 6 },
  balRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: RULE },
  balName: { fontSize: 9, color: INK },
  balValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },

  empty: { fontSize: 9, color: INK_3, fontStyle: "italic", padding: 12, textAlign: "center" },
  footer: {
    position: "absolute", bottom: 20, left: 36, right: 36,
    fontSize: 7, color: INK_3, textAlign: "center",
    paddingTop: 5, borderTopWidth: 1, borderTopColor: RULE,
  },
});

const KIND_LABEL: Record<string, string> = {
  VOUCHER_OUT: "Paid out",
  TOPUP_IN: "Top-up",
  REVERSAL_IN: "Reversal",
};

export interface ReportMovement {
  date: Date;
  kind: string;
  floatName: string;
  refNo: string | null;
  detail: string;
  paidTo: string | null;
  /** Signed: negative = out, positive = in. */
  amount: string;
}

export interface PettyCashReportPDFData {
  fromLabel: string;
  toLabel: string;
  floatName: string | null; // null = all floats
  movements: ReportMovement[];
  totals: { cashIn: string; cashOut: string; net: string };
  floats: Array<{ name: string; currentBalance: string }>;
  generatedAt: Date;
}

function ReportDocument({ data }: { data: PettyCashReportPDFData }) {
  const company = indefineCompanyName();
  const allFloats = data.floatName === null;
  const net = toDecimal(data.totals.net);
  return (
    <Document title={`Petty cash statement ${data.fromLabel}–${data.toLabel}`} author={company}>
      <Page size="A4" style={s.page} wrap>
        <View style={s.headerRow} fixed>
          <View style={s.brandBlock}>
            <View style={s.brandMark}><Text style={s.brandMarkText}>IK</Text></View>
            <View>
              <Text style={s.brandName}>{company}</Text>
              <Text style={s.brandAddr}>{indefineAddress().split("\n")[0]}</Text>
            </View>
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>Petty cash statement</Text>
            <Text style={s.period}>{data.fromLabel} – {data.toLabel}</Text>
            <Text style={s.meta}>{allFloats ? "All floats" : data.floatName}</Text>
          </View>
        </View>

        <View style={s.summaryRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Cash in (top-ups + reversals)</Text>
            <Text style={[s.cardValue, { color: BRAND }]}>{formatINR(data.totals.cashIn)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Cash out (vouchers)</Text>
            <Text style={[s.cardValue, { color: OUT_RED }]}>{formatINR(data.totals.cashOut)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Net movement</Text>
            <Text style={[s.cardValue, { color: net.gte(0) ? BRAND : OUT_RED }]}>{formatINR(data.totals.net)}</Text>
          </View>
        </View>

        <View style={s.tableHead} fixed>
          <Text style={[s.th, s.cDate]}>Date</Text>
          <Text style={[s.th, s.cRef]}>Ref</Text>
          {allFloats && <Text style={[s.th, s.cFloat]}>Float</Text>}
          <Text style={[s.th, s.cType]}>Type</Text>
          <Text style={[s.th, s.cDetail]}>Detail</Text>
          <Text style={[s.th, s.cIn]}>In</Text>
          <Text style={[s.th, s.cOut]}>Out</Text>
        </View>

        {data.movements.length === 0 ? (
          <Text style={s.empty}>No petty-cash movements in this period.</Text>
        ) : (
          data.movements.map((m, i) => {
            const amt = toDecimal(m.amount);
            const isOut = amt.lt(0);
            return (
              <View style={s.tr} key={i} wrap={false}>
                <Text style={[s.td, s.cDate]}>{formatIST(m.date, "dd MMM")}</Text>
                <Text style={[s.td, s.cRef]}>{m.refNo ?? "—"}</Text>
                {allFloats && <Text style={[s.td, s.cFloat]}>{m.floatName}</Text>}
                <Text style={[s.td, s.cType]}>{KIND_LABEL[m.kind] ?? m.kind}</Text>
                <Text style={[s.td, s.cDetail]}>
                  {m.detail}
                  {m.paidTo ? `  ·  ${m.paidTo}` : ""}
                </Text>
                <Text style={[s.td, s.cIn]}>{isOut ? "" : formatINR(amt.toString())}</Text>
                <Text style={[s.td, s.cOut]}>{isOut ? formatINR(amt.abs().toString()) : ""}</Text>
              </View>
            );
          })
        )}

        {data.movements.length > 0 && (
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Totals</Text>
            <Text style={s.totalIn}>{formatINR(data.totals.cashIn)}</Text>
            <Text style={s.totalOut}>{formatINR(data.totals.cashOut)}</Text>
          </View>
        )}

        <Text style={s.balHead}>Float balances (as of {formatIST(data.generatedAt, "dd MMM yyyy HH:mm")})</Text>
        {data.floats.map((f, i) => (
          <View style={s.balRow} key={i}>
            <Text style={s.balName}>{f.name}</Text>
            <Text style={[s.balValue, { color: toDecimal(f.currentBalance).lt(0) ? OUT_RED : INK }]}>
              {formatINR(f.currentBalance)}
            </Text>
          </View>
        ))}

        <Text style={s.footer} fixed>
          {company} · Petty cash statement {data.fromLabel} – {data.toLabel} · generated {formatIST(data.generatedAt, "dd MMM yyyy HH:mm")}
        </Text>
      </Page>
    </Document>
  );
}

/** Render a petty-cash period statement to a PDF Buffer. */
export async function renderPettyCashReportPDF(data: PettyCashReportPDFData): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} />);
}
