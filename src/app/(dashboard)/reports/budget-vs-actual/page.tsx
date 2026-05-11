import { PageHeader } from "@/components/ui/page-header";
import { getMonthlyVariance } from "@/server/actions/reports";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { Decimal } from "decimal.js";

export const dynamic = "force-dynamic";

function delta(now: string, before: string) {
  const d = new Decimal(now).minus(new Decimal(before));
  const pct = new Decimal(before).gt(0) ? d.div(before).times(100).toDecimalPlaces(1) : null;
  return { d, pct };
}

function Row({ label, now, before }: { label: string; now: string; before: string }) {
  const v = delta(now, before);
  const isMoney = !["Invoice count", "Order count"].includes(label);
  const tone = v.d.gt(0) ? "text-positive" : v.d.lt(0) ? "text-alert" : "text-ik-ink-3";
  return (
    <tr className="border-b border-ik-rule">
      <td className="py-2 pr-2">{label}</td>
      <td className="py-2 pr-2 text-right font-mono">{isMoney ? formatINR(now) : now}</td>
      <td className="py-2 pr-2 text-right font-mono text-ik-ink-3">{isMoney ? formatINR(before) : before}</td>
      <td className={`py-2 pr-2 text-right font-mono ${tone}`}>{isMoney ? formatINR(v.d) : v.d.toString()}</td>
      <td className={`py-2 pr-2 text-right font-mono ${tone}`}>{v.pct ? `${v.pct.toString()}%` : "—"}</td>
    </tr>
  );
}

export default async function MonthlyVarianceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month ? new Date(sp.month + "-01T00:00:00") : new Date();
  const data = await getMonthlyVariance(month);
  const monthInput = `${data.periodStart.getFullYear()}-${String(data.periodStart.getMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(data.periodStart);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevLabel = formatIST(prev, "MMMM yyyy");
  const thisLabel = formatIST(data.periodStart, "MMMM yyyy");

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title={`Monthly variance — ${thisLabel}`}
        description={`Comparison vs ${prevLabel}. Revenue is from issued non-cancelled invoices; ingredient cost is the rupee value of all IngredientIssues in the period; vendor billed is the total of bills issued in the period.`}
      />

      <form className="mb-4 flex items-end gap-2" action="/reports/budget-vs-actual">
        <label className="grid gap-1 text-[12px]">
          <span className="text-ik-ink-2">Month</span>
          <input type="month" name="month" defaultValue={monthInput} className="h-9 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]" />
        </label>
        <button type="submit" className="h-9 rounded-md border border-ik-rule bg-ik-paper-alt px-3 text-[13px]">Apply</button>
      </form>

      <table className="w-full max-w-3xl text-[13px]">
        <thead className="border-b border-ik-rule text-left text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
          <tr>
            <th className="py-2 pr-2">Metric</th>
            <th className="py-2 pr-2 text-right">{thisLabel}</th>
            <th className="py-2 pr-2 text-right">{prevLabel}</th>
            <th className="py-2 pr-2 text-right">Δ</th>
            <th className="py-2 pr-2 text-right">Δ %</th>
          </tr>
        </thead>
        <tbody>
          <Row label="Revenue (invoiced)" now={data.thisMonth.revenue} before={data.lastMonth.revenue} />
          <Row label="Revenue (collected)" now={data.thisMonth.collected} before={data.lastMonth.collected} />
          <Row label="Ingredient issued (₹)" now={data.thisMonth.ingredientIssued} before={data.lastMonth.ingredientIssued} />
          <Row label="Vendor billed (₹)" now={data.thisMonth.vendorBills} before={data.lastMonth.vendorBills} />
          <Row label="Invoice count" now={String(data.thisMonth.invoiceCount)} before={String(data.lastMonth.invoiceCount)} />
          <Row label="Order count" now={String(data.thisMonth.orderCount)} before={String(data.lastMonth.orderCount)} />
        </tbody>
      </table>
    </>
  );
}
