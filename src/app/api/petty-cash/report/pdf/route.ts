import { renderPettyCashReportPDF } from "@/server/pdf/petty-cash-report";
import { getPettyCashReport } from "@/server/actions/petty-cash";
import { formatIST, istMonthStart, istMonthEnd, istToUtc } from "@/lib/time";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/petty-cash/report/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&float=<id>
 * Streams the full petty-cash statement for the period as a PDF.
 *
 * Auth + date handling mirror the /petty-cash/report page exactly:
 * getPettyCashReport applies the finance read gate (PETTY_MANAGE), and a
 * missing/malformed range falls back to the current IST month.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const now = new Date();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromStr = fromParam && DATE_RE.test(fromParam) ? fromParam : formatIST(istMonthStart(now), "yyyy-MM-dd");
  const toStr = toParam && DATE_RE.test(toParam) ? toParam : formatIST(istMonthEnd(now), "yyyy-MM-dd");
  const from = istToUtc(fromStr);
  const to = istToUtc(`${toStr}T23:59:59.999`);
  const floatId = url.searchParams.get("float") || undefined;

  const report = await getPettyCashReport({ floatId, from, to });
  const selectedFloat = floatId ? report.floats.find((f) => f.id === floatId) : undefined;

  const buf = await renderPettyCashReportPDF({
    fromLabel: formatIST(from, "dd MMM yyyy"),
    toLabel: formatIST(to, "dd MMM yyyy"),
    floatName: selectedFloat ? selectedFloat.name : null,
    movements: report.movements.map((m) => ({
      date: m.date,
      kind: m.kind,
      floatName: m.floatName,
      refNo: m.refNo,
      detail: m.detail,
      paidTo: m.paidTo,
      amount: m.amount,
    })),
    totals: report.totals,
    floats: report.floats.map((f) => ({ name: f.name, currentBalance: f.currentBalance })),
    generatedAt: now,
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="petty-cash-${fromStr}_to_${toStr}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
