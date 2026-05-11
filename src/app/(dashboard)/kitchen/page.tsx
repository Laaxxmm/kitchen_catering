import Link from "next/link";
import { ProductionJobStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listProductionJobs } from "@/server/actions/production-jobs";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

const COLUMNS: Array<{ status: ProductionJobStatus; label: string; tint: string }> = [
  { status: ProductionJobStatus.QUEUED, label: "Queued", tint: "bg-ik-paper-alt" },
  { status: ProductionJobStatus.PREP, label: "Prep", tint: "bg-amber-wash" },
  { status: ProductionJobStatus.COOKING, label: "Cooking", tint: "bg-amber-wash" },
  { status: ProductionJobStatus.READY, label: "Ready", tint: "bg-positive-wash" },
];

function hoursUntil(d: Date): string {
  const diff = d.getTime() - Date.now();
  if (diff < 0) return "overdue";
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const mins = Math.floor((diff % (60 * 60 * 1000)) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${mins}m`;
}

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: "today" | "tomorrow" | "thisweek" }>;
}) {
  const sp = await searchParams;
  const win = sp.window ?? "thisweek";
  const jobs = await listProductionJobs({ window: win });

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Kitchen board"
        description="Production jobs auto-created when an order reaches READY_FOR_PRODUCTION. Move items through QUEUED → PREP → COOKING → READY."
      />

      <div className="mb-4 flex gap-2">
        {(["today", "tomorrow", "thisweek"] as const).map((w) => (
          <Link
            key={w}
            href={`/kitchen?window=${w}`}
            className={
              "rounded-full px-3 py-1 text-[12px] " +
              (win === w
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {w === "thisweek" ? "This week" : w[0].toUpperCase() + w.slice(1)}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {COLUMNS.map((col) => {
          const inCol = jobs.filter((j) => j.status === col.status);
          return (
            <section key={col.status} className="flex flex-col gap-2">
              <div className={"rounded-md px-3 py-2 " + col.tint}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[13px] text-ik-ink">{col.label}</span>
                  <span className="font-mono text-[11px] text-ik-ink-3">{inCol.length}</span>
                </div>
              </div>
              {inCol.length === 0 ? (
                <p className="px-1 text-[12px] text-ik-ink-3">—</p>
              ) : (
                inCol.map((job) => (
                  <Link
                    key={job.id}
                    href={`/kitchen/${job.id}`}
                    className="rounded-md border border-ik-rule bg-ik-card p-3 hover:border-brand-200"
                  >
                    <div className="flex items-center justify-between font-mono text-[12px]">
                      <span className="font-medium text-brand-700">{job.jobNo}</span>
                      <span className="text-ik-ink-3">{hoursUntil(job.scheduledReady)}</span>
                    </div>
                    <div className="mt-1 text-[12.5px]">
                      <span className="font-mono text-ik-ink-3">{job.order.code}</span>{" "}
                      <span>{job.order.customer.name}</span>
                    </div>
                    <div className="text-[11.5px] text-ik-ink-3">
                      Event {formatIST(job.order.eventDate, "EEE d MMM HH:mm")}
                    </div>
                    <div className="mt-1 text-[11.5px] text-ik-ink-2">
                      {job.items.length} dish{job.items.length === 1 ? "" : "es"}
                    </div>
                  </Link>
                ))
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
