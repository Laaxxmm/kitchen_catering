import type { Prisma } from "@prisma/client";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import type { ActionResult } from "@/lib/action-result";
import { computeRevisionBand, isStaleAfterRevision } from "@/lib/order-revision";
import { formatIST } from "@/lib/time";

/**
 * "The order changed under you" banner for the three documents a mid-flight
 * revision invalidates — chef requisition, F&B requisition, vendor PO. The
 * three detail pages are its only callers, so it lives with one of them
 * rather than in components/ik; move it up if a fourth turns up.
 *
 * Deliberately a solid, static banner: the flashing red/white version was
 * declined on safety grounds (photosensitive seizures — WCAG 2.3.1 caps
 * flashing at 3/sec). Never give this thing an infinite animation.
 */

/** Everything the banner needs off the order, in one narrow read. */
export const revisionOrderSelect = {
  lastRevisedAt: true,
  eventDate: true,
  status: true,
  orderRevisions: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      note: true,
      beforeHeadcount: true,
      afterHeadcount: true,
      beforeEventDate: true,
      afterEventDate: true,
      beforeMealType: true,
      afterMealType: true,
      lineChanges: true,
      revisedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

export type RevisionOrder = Prisma.OrderGetPayload<{ select: typeof revisionOrderSelect }>;

type LineChange = { kind: "added" | "removed" | "portions"; dish: string; from?: string; to?: string };

/** The revision as short plain-English phrases, most important first. */
function changePhrases(rev: RevisionOrder["orderRevisions"][number]): string[] {
  const meal = (m: string) => m.replace("_", " ").toLowerCase();
  const out: string[] = [];
  if (rev.beforeHeadcount !== rev.afterHeadcount) {
    out.push(`${rev.beforeHeadcount} → ${rev.afterHeadcount} pax`);
  }
  if (rev.beforeMealType !== rev.afterMealType) {
    out.push(`meal changed from ${meal(rev.beforeMealType)} to ${meal(rev.afterMealType)}`);
  }
  if (rev.beforeEventDate.getTime() !== rev.afterEventDate.getTime()) {
    out.push(
      `event moved from ${formatIST(rev.beforeEventDate, "EEE d MMM, HH:mm")} to ${formatIST(rev.afterEventDate, "EEE d MMM, HH:mm")}`,
    );
  }
  for (const c of (rev.lineChanges ?? []) as LineChange[]) {
    if (c.kind === "added") out.push(`added ${c.dish}${c.to ? ` — ${c.to} portions` : ""}`);
    else if (c.kind === "removed") out.push(`dropped ${c.dish}`);
    else out.push(`${c.dish} ${c.from} → ${c.to} portions`);
  }
  return out;
}

export function RevisionBanner({
  order,
  documentLabel,
  createdAt,
  ackAt,
  canAcknowledge,
  onAcknowledge,
  children,
}: {
  /** Null when the document has no order, or the page suppresses the check. */
  order: RevisionOrder | null;
  /** How this document is named in the copy, e.g. "requisition". */
  documentLabel: string;
  createdAt: Date;
  ackAt: Date | null;
  /** Mirrors the server gate on acknowledgeRevisedDocument for this type. */
  canAcknowledge: boolean;
  onAcknowledge: () => Promise<ActionResult>;
  /** What this team can actually do about it — supplied by the page. */
  children: React.ReactNode;
}) {
  const lastRevisedAt = order?.lastRevisedAt ?? null;
  if (!order || !lastRevisedAt) return null;
  if (!isStaleAfterRevision({ lastRevisedAt, ackAt, createdAt })) return null;

  const band = computeRevisionBand({ eventDate: order.eventDate, status: order.status });
  const loud = band !== "NORMAL";
  const rev = order.orderRevisions[0] ?? null;
  const [lead, ...rest] = rev ? changePhrases(rev) : [];

  return (
    <section
      className={`mb-5 rounded-2xl border p-4 shadow-ik-card ${
        loud ? "border-alert/40 bg-alert-wash" : "border-amber bg-amber-wash"
      }`}
    >
      <h2 className={`text-[14px] font-medium ${loud ? "text-alert" : "text-amber-700"}`}>
        {band === "CRITICAL" ? "Act now — the order has changed" : "The order has changed"}
      </h2>
      <p className="mt-1 text-[13px] text-ik-ink">
        This order changed after this {documentLabel} was raised{lead ? ` — ${lead}` : ""}.
      </p>
      {rest.length > 0 && (
        <ul className="mt-1.5 grid list-disc gap-1 pl-5 text-[13px] text-ik-ink-2">
          {rest.map((phrase, i) => (
            <li key={i}>{phrase}</li>
          ))}
        </ul>
      )}
      {rev?.note && (
        <p className="mt-2 rounded-md bg-ik-card px-2 py-1.5 text-[12.5px] italic text-ik-ink">
          “{rev.note}” <span className="not-italic text-ik-ink-3">— {rev.revisedBy.name}</span>
        </p>
      )}
      <p className="mt-1.5 text-[11.5px] text-ik-ink-3">
        Changed {formatIST(lastRevisedAt)}
        {rev ? ` by ${rev.revisedBy.name}` : ""}
      </p>

      <div className="mt-3 text-[13px] text-ik-ink-2">{children}</div>

      {canAcknowledge && (
        <div className="mt-3">
          <ActionResultButton
            action={onAcknowledge}
            variant="outline"
            size="sm"
            successMessage="Noted — this document is marked as re-checked"
          >
            Reviewed — no change needed
          </ActionResultButton>
        </div>
      )}
    </section>
  );
}
