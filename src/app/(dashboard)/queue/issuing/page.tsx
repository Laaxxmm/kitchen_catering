import Link from "next/link";
import { ChefRequisitionStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function IssuingQueuePage() {
  const requisitions = await listChefRequisitions({
    status: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED],
  });

  return (
    <>
      <PageHeader
        eyebrow="Queue · Store"
        title="Awaiting fulfilment"
        description="Submitted and partially-issued chef requisitions. Click in to issue per line."
      />
      {requisitions.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Queue is clear.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {requisitions.map((r) => (
            <Link
              key={r.id}
              href={`/requisitions/${r.id}`}
              className="rounded-md border border-ik-rule bg-ik-card p-4 hover:border-brand-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[13px] font-medium text-brand-700">{r.requisitionNo}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-1 text-[12.5px] text-ik-ink-2">
                Order <span className="font-mono">{r.order.code}</span> · {r.order.customer.name}
              </div>
              <div className="mt-1 text-[11.5px] text-ik-ink-3">
                Event {formatIST(r.order.eventDate, "yyyy-MM-dd HH:mm")} · {r._count.lines} line{r._count.lines === 1 ? "" : "s"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
