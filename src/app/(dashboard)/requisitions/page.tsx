import Link from "next/link";
import { ChefRequisitionStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

type Group = "issue" | "done" | "other";

const STATUS_META: Record<ChefRequisitionStatus, { group: Group; label: string; tone: PillTone }> = {
  DRAFT: { group: "other", label: "Draft", tone: "grey" },
  SUBMITTED: { group: "issue", label: "Needs issuing", tone: "amber" },
  PARTIALLY_ISSUED: { group: "issue", label: "Part issued", tone: "amber" },
  FULLY_ISSUED: { group: "done", label: "Fully issued", tone: "green" },
  CANCELLED: { group: "other", label: "Cancelled", tone: "grey" },
};

type Req = Awaited<ReturnType<typeof listChefRequisitions>>[number];

export default async function RequisitionsPage() {
  const requisitions = await listChefRequisitions();

  const needIssuing = requisitions.filter((r) => STATUS_META[r.status].group === "issue");
  const done = requisitions.filter((r) => STATUS_META[r.status].group === "done");
  const other = requisitions.filter((r) => STATUS_META[r.status].group === "other");

  return (
    <>
      <PageHeader
        eyebrow="Make & deliver"
        title="Requisitions"
        description="Kitchen → store. What needs issuing is up top."
      />

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Needs issuing", value: needIssuing.length, tone: needIssuing.length > 0 ? "amber" : "grey" },
            { label: "Fully issued", value: done.length, tone: "green" },
          ]}
        />
      </div>

      {requisitions.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No requisitions yet.</p>
      ) : (
        <div className="grid gap-5">
          {needIssuing.length > 0 && <ReqSection title="Needs issuing" rows={needIssuing} />}
          {done.length > 0 && <ReqSection title="Fully issued" rows={done} />}
          {other.length > 0 && <ReqSection title="Draft & cancelled" rows={other} />}
        </div>
      )}
    </>
  );
}

function ReqSection({ title, rows }: { title: string; rows: Req[] }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title} · {rows.length}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Req no</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Event</TableHead>
            <TableHead className="text-right">Lines</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/requisitions/${r.id}`} className="font-mono text-brand hover:underline">{r.requisitionNo}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.orderId}`} className="font-mono text-[12px] text-brand hover:underline">{r.order.code}</Link>
                </TableCell>
                <TableCell>{r.order.customer.name}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(r.order.eventDate, "yyyy-MM-dd")}</TableCell>
                <TableCell className="text-right">{r._count.lines}</TableCell>
                <TableCell><StatusPill tone={meta.tone}>{meta.label}</StatusPill></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
