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
import { indefineAddress, indefineCompanyName } from "@/lib/org";

const BRAND = "#0F6E56";
const INK = "#1F2A24";
const INK_2 = "#516056";
const INK_3 = "#8C988F";
const RULE = "#D9DDD7";
const PAPER = "#FAFAF6";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: INK, fontFamily: "Helvetica", backgroundColor: PAPER },
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
  brandAddr: { fontSize: 8, color: INK_3 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 9, color: INK_3, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 2 },
  voucherNo: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 9, color: INK_2 },
  // Detail grid
  grid: {
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 4,
    backgroundColor: "#fff",
    marginBottom: 14,
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: RULE },
  rowLast: { flexDirection: "row" },
  cellLabel: {
    width: 130,
    padding: 8,
    fontSize: 8,
    color: INK_3,
    letterSpacing: 1,
    textTransform: "uppercase",
    borderRightWidth: 1,
    borderRightColor: RULE,
    backgroundColor: "#F4F4EE",
  },
  cellValue: { flex: 1, padding: 8, fontSize: 10, color: INK },
  // Amount block
  amountBlock: {
    borderWidth: 1,
    borderColor: RULE,
    borderRadius: 4,
    backgroundColor: "#fff",
    padding: 10,
    marginBottom: 20,
  },
  amountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amountLabel: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold" },
  amountValue: { fontSize: 16, color: BRAND, fontFamily: "Helvetica-Bold" },
  inWords: { fontSize: 8.5, fontStyle: "italic", color: INK_2, marginTop: 6 },
  // Sign-off
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  signCol: { width: 180, alignItems: "center" },
  signLine: { borderTopWidth: 1, borderTopColor: INK_3, width: "100%", marginBottom: 4 },
  signLabel: { fontSize: 8, color: INK_3, letterSpacing: 1, textTransform: "uppercase" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: INK_3,
    textAlign: "center",
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
});

export interface VoucherPDFData {
  voucherNo: string;
  paidAt: Date;
  floatName: string;
  paidTo: string;
  category: string;
  reason: string;
  amount: string | number;
  recordedBy: string;
  status: string;
}

function PettyCashVoucherDocument({ data }: { data: VoucherPDFData }) {
  const company = indefineCompanyName();
  return (
    <Document title={`Petty cash voucher ${data.voucherNo}`} author={company}>
      <Page size="A5" orientation="landscape" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.brandBlock}>
            <View style={s.brandMark}>
              <Text style={s.brandMarkText}>IK</Text>
            </View>
            <View>
              <Text style={s.brandName}>{company}</Text>
              <Text style={s.brandAddr}>{indefineAddress().split("\n")[0]}</Text>
            </View>
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>Petty cash voucher</Text>
            <Text style={s.voucherNo}>{data.voucherNo}</Text>
            <Text style={s.meta}>{formatIST(data.paidAt, "dd MMM yyyy")}</Text>
            {data.status !== "POSTED" && <Text style={s.meta}>{data.status}</Text>}
          </View>
        </View>

        <View style={s.grid}>
          <View style={s.row}>
            <Text style={s.cellLabel}>Float</Text>
            <Text style={s.cellValue}>{data.floatName}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.cellLabel}>Paid to</Text>
            <Text style={s.cellValue}>{data.paidTo}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.cellLabel}>Purpose / category</Text>
            <Text style={s.cellValue}>{data.category}</Text>
          </View>
          <View style={s.rowLast}>
            <Text style={s.cellLabel}>Reason</Text>
            <Text style={s.cellValue}>{data.reason}</Text>
          </View>
        </View>

        <View style={s.amountBlock}>
          <View style={s.amountRow}>
            <Text style={s.amountLabel}>Amount paid</Text>
            <Text style={s.amountValue}>{formatINR(data.amount)}</Text>
          </View>
          <Text style={s.inWords}>In words: {amountInWords(data.amount)}</Text>
        </View>

        <View style={s.signRow}>
          <View style={s.signCol}>
            <View style={s.signLine} />
            <Text style={s.signLabel}>Recorded by: {data.recordedBy}</Text>
          </View>
          <View style={s.signCol}>
            <View style={s.signLine} />
            <Text style={s.signLabel}>Approved / signed</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {company} · Petty cash voucher {data.voucherNo}
        </Text>
      </Page>
    </Document>
  );
}

/** Render a petty-cash voucher to a PDF Buffer. */
export async function renderPettyCashVoucherPDF(data: VoucherPDFData): Promise<Buffer> {
  return renderToBuffer(<PettyCashVoucherDocument data={data} />);
}
