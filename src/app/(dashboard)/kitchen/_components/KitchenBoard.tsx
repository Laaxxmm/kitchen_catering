"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import { startCookingOrder, markOrderCooked } from "@/server/actions/production-jobs";
import { handToDelivery } from "@/server/actions/deliveries";
import { markInHouseServed } from "@/server/actions/orders";
import { isImmediateChannel } from "@/lib/order-channels";
import type { OrderChannel, ProductionJobItemStatus } from "@prisma/client";
import { HandoverChecklist } from "@/components/ik/HandoverChecklist";

type Stage = "QUEUED" | "PREP" | "COOKING" | "READY";

export interface KitchenJobItem {
  id: string;
  dishName: string;
  portions: string;
  ready: boolean;
  status: ProductionJobItemStatus;
  handedOverAt: string | null;
  handedOverBy: string | null;
}

export interface KitchenJob {
  id: string;
  orderId: string;
  status: Stage;
  code: string;
  channel: OrderChannel;
  handedToDelivery: boolean;
  customerName: string;
  scheduledReady: string;
  items: KitchenJobItem[];
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "QUEUED", label: "Queued" },
  { key: "PREP", label: "Prep" },
  { key: "COOKING", label: "Cooking" },
  { key: "READY", label: "Ready" },
];

function timing(iso: string): { label: string; cls: string } {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) {
    const m = Math.floor(-diff / 60000);
    const label = m >= 60 ? `${Math.floor(m / 60)}h late` : `${m}m late`;
    return { label, cls: "bg-alert text-white" };
  }
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60000);
  const label = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h >= 1 ? `${h}h ${m}m` : `${m}m`;
  if (diff < 2 * 3_600_000) return { label, cls: "bg-amber text-white" };
  if (diff < 6 * 3_600_000) return { label, cls: "bg-amber-wash text-amber-700" };
  return { label, cls: "bg-ik-paper-alt text-ik-ink-3" };
}

export function KitchenBoard({ jobs }: { jobs: KitchenJob[] }) {
  const counts = STAGES.map((s) => ({ ...s, count: jobs.filter((j) => j.status === s.key).length }));

  return (
    <div className="grid gap-5">
      {/* Compact stage-count strip (replaces the four big columns). */}
      <div className="flex flex-wrap gap-2">
        {counts.map((s) => (
          <div
            key={s.key}
            className={
              "min-w-[110px] flex-1 rounded-md border p-3 " +
              (s.count > 0 ? "border-brand-200 bg-brand-50" : "border-ik-rule bg-ik-paper-alt")
            }
          >
            <div className={"font-mono text-[20px] leading-none " + (s.count > 0 ? "text-brand-700" : "text-ik-ink-3")}>{s.count}</div>
            <div className="mt-1 text-[11px] text-ik-ink-3">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Job cards grouped under their stage. */}
      {STAGES.map((s) => {
        const inStage = jobs.filter((j) => j.status === s.key);
        if (inStage.length === 0) return null;
        return (
          <section key={s.key}>
            <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{s.label} · {inStage.length}</h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {inStage.map((job) => <JobCard key={job.id} job={job} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function JobCard({ job }: { job: KitchenJob }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = timing(job.scheduledReady);
  const readyCount = job.items.filter((i) => i.ready).length;
  const portions = job.items.reduce((s, i) => s + Number(i.portions), 0);
  const isReady = job.status === "READY";

  function run(fn: () => Promise<unknown>, msg: string) {
    startTransition(async () => {
      try {
        const res = (await fn()) as ActionResult | undefined;
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success(msg);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  // One stage-appropriate primary action per card. In-house orders (room
  // service / à la carte / management) skip the driver dispatch — once
  // ready they're served straight to the room/table. Ready delivery orders
  // with per-dish items get the handover checklist instead of a button:
  // each dish is ticked as it's physically handed over.
  const inHouse = isImmediateChannel(job.channel);
  const itemizedHandover = isReady && !inHouse && job.items.length > 0;
  let action: { label: string; fn: () => Promise<unknown>; msg: string } | null;
  if (job.status === "QUEUED") action = { label: "Start cooking", fn: () => startCookingOrder(job.orderId), msg: "Cooking started" };
  else if (isReady && inHouse) action = { label: "Mark served", fn: () => markInHouseServed(job.orderId), msg: "Served — ready to bill" };
  else if (itemizedHandover) action = null; // checklist below drives it
  else if (isReady && job.handedToDelivery) action = { label: "✓ Delivery informed", fn: () => handToDelivery(job.orderId), msg: "Delivery reminded" };
  else if (isReady) action = { label: "Send to dispatch", fn: () => handToDelivery(job.orderId), msg: "Delivery team notified" };
  else action = { label: "Mark ready", fn: () => markOrderCooked(job.orderId), msg: "Marked ready" };
  // const binding so the narrowing survives into the onClick closure.
  const primaryAction = action;

  return (
    <div className={"rounded-md border bg-ik-card p-3 " + (isReady ? "border-positive/50" : "border-ik-rule")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-ik-ink">{job.customerName}</div>
          <div className="font-mono text-[11.5px] text-ik-ink-3">{job.code}</div>
        </div>
        <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium " + t.cls}>{t.label}</span>
      </div>

      <div className="mt-2 text-[11.5px] text-ik-ink-2">
        Ready by <span className="font-mono text-ik-ink">{formatIST(new Date(job.scheduledReady), "EEE HH:mm")}</span>
      </div>

      <div className="mt-2 grid gap-1 text-[11.5px] text-ik-ink-2">
        {job.items.slice(0, 3).map((it) => (
          <div key={it.id} className="flex items-baseline justify-between gap-2">
            <span className="truncate">{it.dishName}</span>
            <span className="shrink-0 font-mono text-ik-ink-3">{it.portions}</span>
          </div>
        ))}
        {job.items.length > 3 && <div className="text-[10.5px] text-ik-ink-3">+ {job.items.length - 3} more…</div>}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ik-ink-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ik-rule">
          <div className="h-full bg-brand-500" style={{ width: job.items.length ? `${(readyCount / job.items.length) * 100}%` : "0%" }} />
        </div>
        <span className="whitespace-nowrap">{readyCount}/{job.items.length} ready · {portions} pax</span>
      </div>

      {/* Per-dish handover checklist replaces the one-shot dispatch button
          — tick each dish the moment it's physically handed to delivery. */}
      {itemizedHandover && (
        <div className="mt-2.5">
          <HandoverChecklist
            compact
            jobId={job.id}
            items={job.items.map((it) => ({
              id: it.id,
              dishName: it.dishName,
              portions: it.portions,
              status: it.status,
              handedOverAt: it.handedOverAt,
              handedOverBy: it.handedOverBy,
            }))}
          />
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {primaryAction && (
          <Button
            size="sm"
            variant={isReady && job.handedToDelivery && !inHouse ? "outline" : "default"}
            disabled={pending}
            onClick={() => run(primaryAction.fn, primaryAction.msg)}
          >
            {primaryAction.label}
          </Button>
        )}
        <Link href={`/kitchen/${job.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open checklist</Link>
      </div>
    </div>
  );
}
