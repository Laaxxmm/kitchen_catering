import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * The one strong-colour element on the launcher: a single banner summing up
 * everything that needs action. Red when there's work, a calm "all caught
 * up" state when the count is zero. "Review" links to the buy-side queue
 * where these items are handled.
 */
export function AttentionBanner({
  count,
  breakdown,
  reviewHref,
}: {
  count: number;
  breakdown: string;
  reviewHref: string;
}) {
  if (count === 0) {
    return (
      <section className="flex items-center gap-3 rounded-md border border-positive/30 bg-positive/5 p-4">
        <CheckCircle2 size={20} className="shrink-0 text-positive" />
        <div className="text-[14px] font-medium text-ik-ink">You&apos;re all caught up.</div>
      </section>
    );
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-alert/40 bg-alert-wash p-4">
      <div className="flex items-center gap-3">
        <AlertTriangle size={20} className="shrink-0 text-alert" />
        <div>
          <div className="text-[15px] font-semibold text-ik-ink">
            {count} {count === 1 ? "thing needs" : "things need"} you
          </div>
          <div className="text-[12.5px] text-ik-ink-2">{breakdown}</div>
        </div>
      </div>
      <Link
        href={reviewHref}
        className="inline-flex h-11 items-center rounded-md bg-alert px-5 text-[13px] font-medium text-white transition hover:opacity-90"
      >
        Review
      </Link>
    </section>
  );
}
