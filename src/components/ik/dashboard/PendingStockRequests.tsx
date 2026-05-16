import Link from "next/link";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

interface PR {
  id: string;
  prNo: string;
  raisedBy: string;
  submittedAt: string;
  lineCount: number;
  grandTotal: string;
}

interface Props {
  requests: PR[];
}

/**
 * Admin / manager dashboard panel — stock requests raised by the
 * storekeeper that need approval. Surfaces the raiser, line count, and
 * total value so the approver can act inline (click → open PR detail
 * → approve / reject).
 */
export function PendingStockRequests({ requests }: Props) {
  if (requests.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Stock requests for your approval</h2>
        <Link
          href="/procurement/purchase-requisitions?status=PENDING_APPROVAL"
          className="text-[11.5px] text-brand hover:underline"
        >
          See all →
        </Link>
      </div>
      <ul className="grid gap-2">
        {requests.map((r) => (
          <li key={r.id}>
            <Link
              href={`/procurement/purchase-requisitions/${r.id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-amber bg-amber-wash p-3 transition hover:border-amber"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[12.5px] text-amber">{r.prNo}</span>
                  <span className="text-[12.5px] text-ik-ink">
                    Raised by <strong>{r.raisedBy}</strong>
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] text-ik-ink-3">
                  {r.lineCount} line{r.lineCount === 1 ? "" : "s"} · Submitted{" "}
                  {formatIST(new Date(r.submittedAt), "EEE d MMM HH:mm")}
                </div>
              </div>
              <span className="shrink-0 font-mono text-[13px] text-ik-ink">
                {formatINR(r.grandTotal)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
