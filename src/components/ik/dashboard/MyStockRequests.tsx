import Link from "next/link";
import { PurchaseRequisitionStatus } from "@prisma/client";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

interface PR {
  id: string;
  prNo: string;
  status: PurchaseRequisitionStatus;
  createdAt: string;
  submittedAt: string | null;
  lineCount: number;
  grandTotal: string;
}

interface Props {
  requests: PR[];
}

const LABEL: Record<PurchaseRequisitionStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PARTIALLY_ISSUED: "Partially issued",
  ISSUED: "PO issued",
  CANCELLED: "Cancelled",
};

const TONE: Record<PurchaseRequisitionStatus, "info" | "urgent" | "ok" | "muted" | "alert"> = {
  DRAFT: "muted",
  PENDING_APPROVAL: "urgent",
  APPROVED: "ok",
  ISSUED: "ok",
  PARTIALLY_ISSUED: "ok",
  REJECTED: "alert",
  CANCELLED: "muted",
};

const TONE_CLASS: Record<"info" | "urgent" | "ok" | "muted" | "alert", string> = {
  info: "bg-brand-50 text-brand-700",
  urgent: "bg-amber-wash text-amber",
  ok: "bg-positive-wash text-positive",
  muted: "bg-ik-paper-alt text-ik-ink-3",
  alert: "bg-alert-wash text-alert",
};

/**
 * Storekeeper dashboard panel — the user's own raised stock requests
 * with their current status. Lets them track an in-flight request
 * without navigating to the procurement section.
 */
export function MyStockRequests({ requests }: Props) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">My stock requests</h2>
        <Link href="/procurement/purchase-requisitions" className="text-[11.5px] text-brand hover:underline">
          See all →
        </Link>
      </div>
      {requests.length === 0 ? (
        <div className="rounded-md border border-ik-rule bg-ik-card p-4 text-[12.5px] text-ik-ink-2">
          You haven&apos;t raised any stock requests yet.{" "}
          <Link href="/procurement/purchase-requisitions/new" className="text-brand hover:underline">
            Raise one
          </Link>
          .
        </div>
      ) : (
        <ul className="grid gap-2">
          {requests.map((r) => {
            const t = TONE[r.status];
            return (
              <li key={r.id}>
                <Link
                  href={`/procurement/purchase-requisitions/${r.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-ik-rule bg-ik-card p-3 transition hover:border-brand-300"
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[12.5px] text-brand-700">{r.prNo}</span>
                      <span className={"shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium " + TONE_CLASS[t]}>
                        {LABEL[r.status]}
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-ik-ink-3">
                      {r.lineCount} line{r.lineCount === 1 ? "" : "s"} ·{" "}
                      {r.submittedAt
                        ? `Submitted ${formatIST(new Date(r.submittedAt), "EEE d MMM HH:mm")}`
                        : `Drafted ${formatIST(new Date(r.createdAt), "EEE d MMM HH:mm")}`}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[12.5px] text-ik-ink">
                    {formatINR(r.grandTotal)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
