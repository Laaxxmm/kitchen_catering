import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomersWithLifecycle } from "@/server/actions/customers";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

type Lifecycle = "active" | "dormant" | "prospect";

const LIFECYCLE_PILL: Record<Lifecycle, { tone: PillTone; label: string }> = {
  active: { tone: "green", label: "Active" },
  dormant: { tone: "amber", label: "Dormant" },
  prospect: { tone: "grey", label: "Prospect" },
};

// Likely payment gateways / aggregators that get mistaken for customers.
const GATEWAYS = ["razorpay", "payu", "paytm", "cashfree", "stripe", "ccavenue", "billdesk", "phonepe", "instamojo", "easebuzz"];
function looksLikeGateway(name: string) {
  const n = name.toLowerCase();
  return GATEWAYS.some((g) => n.includes(g));
}

const SEGMENTS = [
  { key: "active", label: "Active" },
  { key: "prospect", label: "Prospects" },
  { key: "dormant", label: "Dormant" },
  { key: "all", label: "All" },
] as const;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; inactive?: string; seg?: string }>;
}) {
  const sp = await searchParams;
  const includeInactive = sp.inactive === "1";
  const seg = (SEGMENTS.find((s) => s.key === sp.seg)?.key ?? "active") as (typeof SEGMENTS)[number]["key"];

  const all = await listCustomersWithLifecycle({
    query: sp.q,
    active: includeInactive ? undefined : true,
  });

  const counts = {
    active: all.filter((c) => c.lifecycle === "active").length,
    prospect: all.filter((c) => c.lifecycle === "prospect").length,
    dormant: all.filter((c) => c.lifecycle === "dormant").length,
  };
  const shown = seg === "all" ? all : all.filter((c) => c.lifecycle === seg);

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (sp.q) p.set("q", sp.q);
    if (includeInactive) p.set("inactive", "1");
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/customers?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Customers"
        description="Who's active, who's gone quiet, and who's never ordered — with each customer's order count and revenue."
        actions={<Link href="/customers/new"><Button>New customer</Button></Link>}
      />

      <div className="mb-4">
        <SummaryStrip
          chips={[
            { label: "Active", value: counts.active, tone: "green", href: qs({ seg: "active" }) },
            { label: "Prospects · no orders", value: counts.prospect, tone: "grey", href: qs({ seg: "prospect" }) },
            { label: "Dormant · 90d+", value: counts.dormant, tone: counts.dormant > 0 ? "amber" : "grey", href: qs({ seg: "dormant" }) },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {SEGMENTS.map((s) => (
          <Link
            key={s.key}
            href={qs({ seg: s.key })}
            className={
              "rounded-full px-3 py-1 text-[12px] " +
              (seg === s.key ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {s.label}
          </Link>
        ))}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/customers">
        <input type="hidden" name="seg" value={seg} />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name, GSTIN, contact…"
          className="h-9 w-72 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="inactive" value="1" defaultChecked={includeInactive} />
          Include inactive
        </label>
        <Button type="submit" variant="outline" size="sm">Search</Button>
      </form>

      {shown.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No customers in this segment.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>History</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead>Lifecycle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((c) => {
              const pill = LIFECYCLE_PILL[c.lifecycle];
              const gateway = c.orderCount === 0 && !c.gstin && looksLikeGateway(c.name);
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/customers/${c.id}`} className="text-ik-ink hover:text-brand hover:underline">
                      <strong>{c.name}</strong>
                    </Link>
                    {c.gstin && <span className="ml-2 text-[11px] text-positive" title={`GSTIN ${c.gstin}`}>GSTIN ✓</span>}
                    {gateway && <span className="ml-2 text-[11px] text-amber-700">check — gateway?</span>}
                  </TableCell>
                  <TableCell className="text-[12.5px] text-ik-ink-2">
                    {c.orderCount === 0
                      ? "No orders yet"
                      : `${c.orderCount} ${c.orderCount === 1 ? "order" : "orders"}${c.lastOrderAt ? ` · last ${formatIST(new Date(c.lastOrderAt), "d MMM yyyy")}` : ""}`}
                  </TableCell>
                  <TableCell className="text-right font-mono">{c.orderCount > 0 ? formatINRWhole(c.totalRevenue) : "—"}</TableCell>
                  <TableCell><StatusPill tone={pill.tone}>{pill.label}</StatusPill></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
