"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { MealType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { EventDateBadge } from "@/components/ik/EventDateBadge";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import type { RevisionBand, RevisionDocumentType, RevisionScope } from "@/lib/order-revision";
import { acknowledgeOrderRevision, acknowledgeRevisedDocument } from "@/server/actions/orders";

/** One entry of the revision's `lineChanges` JSON column. */
export interface RevisionLineChange {
  kind: "added" | "removed" | "portions";
  dish: string;
  from?: string;
  to?: string;
}

/** Board-side shape of `RevisedOrderRow` — dates as ISO, like every other
 *  board prop. The dashboard page maps rows into this. */
export interface RevisedOrderCard {
  id: string;
  code: string;
  customerName: string;
  eventDate: string;
  headcount: number;
  band: RevisionBand;
  revision: {
    note: string | null;
    beforeHeadcount: number;
    afterHeadcount: number;
    beforeEventDate: string;
    afterEventDate: string;
    beforeMealType: MealType;
    afterMealType: MealType;
    lineChanges: RevisionLineChange[];
  } | null;
  documents: { type: RevisionDocumentType; id: string; number: string; status: string }[];
}

const DOC: Record<RevisionDocumentType, { label: string; href: (id: string) => string }> = {
  CHEF_REQUISITION: { label: "Ingredient request", href: (id) => `/requisitions/${id}` },
  BANQUET_REQUISITION: { label: "Banquet request", href: (id) => `/banquet/requisitions/${id}` },
  VENDOR_PO: { label: "Purchase order", href: (id) => `/procurement/purchase-orders/${id}` },
};

/** Red for anything the kitchen can't quietly absorb, amber for the rest. */
export function revisedCardClass(band: RevisionBand): string {
  return band === "NORMAL" ? "border-amber bg-amber-wash" : "border-alert bg-alert-wash";
}

/** The badge that marks a changed order wherever it appears — the revised
 *  tab, and the same order's card in Cooking / Ingredients / PO tabs. */
export function RevisedBadge({ band }: { band: RevisionBand }) {
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white " +
        (band === "NORMAL" ? "bg-amber" : "bg-alert")
      }
    >
      Revised
    </span>
  );
}

/**
 * One ~2s glow as the alert appears, then it settles solid. Deliberately not
 * a repeating flash: strobes above 3/s are a photosensitive-seizure risk
 * (WCAG 2.3.1) and get tuned out within a week. `motion-safe:` drops the
 * glow entirely when the viewer asks for reduced motion.
 */
function useFirstGlow(ms = 2000): string {
  const [glow, setGlow] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setGlow(false), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return (
    "motion-safe:transition-shadow motion-safe:duration-700 " +
    (glow ? "motion-safe:shadow-[0_0_18px_3px_var(--ik-alert)]" : "")
  );
}

const fmtWhen = (iso: string) => formatIST(new Date(iso), "EEE d MMM, HH:mm");
const mealWords = (m: MealType) => m.toLowerCase().replace(/_/g, " ");

/** The revision in sentences a cook can read at a glance — no JSON, no jargon. */
function changeLines(order: RevisedOrderCard): string[] {
  const r = order.revision;
  if (!r) return ["This order was changed — open it and check the current details."];
  const out: string[] = [];
  if (r.beforeHeadcount !== r.afterHeadcount) {
    out.push(`${r.beforeHeadcount} → ${r.afterHeadcount} pax`);
  }
  if (r.beforeEventDate !== r.afterEventDate) {
    out.push(`Moved from ${fmtWhen(r.beforeEventDate)} to ${fmtWhen(r.afterEventDate)}`);
  }
  if (r.beforeMealType !== r.afterMealType) {
    out.push(`Meal changed from ${mealWords(r.beforeMealType)} to ${mealWords(r.afterMealType)}`);
  }
  for (const c of r.lineChanges) {
    if (c.kind === "added") out.push(`Added: ${c.dish}${c.to ? ` ×${c.to}` : ""}`);
    else if (c.kind === "removed") out.push(`Removed: ${c.dish}`);
    else out.push(`${c.dish} ${c.from ?? "?"} → ${c.to ?? "?"}`);
  }
  if (out.length === 0) out.push("Details were changed — open the order and check.");
  return out;
}

function useAckRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>, successMsg: string, after?: () => void) =>
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMsg);
        after?.();
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  return { run, pending };
}

/**
 * The changed-orders list, shared by the chef board and the store board so
 * both teams read exactly the same words. Per order: what changed, the
 * manager's note, and every document raised before the change that now needs
 * re-reading. Acknowledging is the record that the team saw it.
 */
export function RevisedOrdersPanel({
  orders,
  scope,
}: {
  orders: RevisedOrderCard[];
  scope: RevisionScope;
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-ik-rule bg-ik-card p-5 text-[13px] text-ik-ink-2 shadow-ik-card">
        No changed orders. Everything here is still as it was ordered.
      </div>
    );
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {orders.map((o) => (
        <RevisedCard key={o.id} order={o} scope={scope} />
      ))}
    </ul>
  );
}

function RevisedCard({ order, scope }: { order: RevisedOrderCard; scope: RevisionScope }) {
  const { run, pending } = useAckRunner();
  const glow = useFirstGlow();

  return (
    <li className={"rounded-md border p-3 " + revisedCardClass(order.band) + " " + glow}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <RevisedBadge band={order.band} />
          <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
        </div>
        <EventDateBadge target={order.eventDate} />
      </div>

      <div className="mt-1.5 text-[13px] text-ik-ink">
        <strong>{order.customerName}</strong>
        <span className="text-ik-ink-3"> · {order.headcount} pax now</span>
      </div>
      <div className="text-[11.5px] text-ik-ink-2">Event {fmtWhen(order.eventDate)}</div>

      <div className="mt-2 rounded-md border border-ik-rule bg-ik-card p-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ik-ink-3">
          What changed
        </div>
        <ul className="mt-1 grid gap-0.5 text-[13px] font-medium text-ik-ink">
          {changeLines(order).map((line, i) => (
            <li key={i}>• {line}</li>
          ))}
        </ul>
        {order.revision?.note && (
          <p className="mt-2 border-t border-ik-rule pt-2 text-[12.5px] text-ik-ink-2">
            Manager&apos;s note: {order.revision.note}
          </p>
        )}
      </div>

      {order.documents.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ik-ink-3">
            Redo these — they were made before the change
          </div>
          <ul className="mt-1 grid gap-1.5">
            {order.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-ik-rule bg-ik-card px-2.5 py-1.5"
              >
                <Link href={DOC[d.type].href(d.id)} className="text-[12.5px] text-brand hover:underline">
                  {DOC[d.type].label} {d.number} →
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => run(() => acknowledgeRevisedDocument(d.type, d.id), "Marked re-checked")}
                >
                  Re-checked
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => acknowledgeOrderRevision(order.id, scope), "Thanks — noted")}
        >
          Seen — I&apos;ll adjust
        </Button>
        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">
          Open order
        </Link>
      </div>
    </li>
  );
}

/**
 * CRITICAL revisions stop the board until a human presses the button — the
 * order is already cooking or hours from its event, so a badge on a tab is
 * not enough. No close control and no outside-click/Escape dismissal: the
 * press IS the accountability record.
 */
export function CriticalRevisionModal({
  orders,
  scope,
}: {
  orders: RevisedOrderCard[];
  scope: RevisionScope;
}) {
  // A row keeps coming back from the server while any of its documents are
  // still unread, so the order-level acknowledgement is remembered here for
  // the session — the remaining work stays visible in the revised tab.
  const [acked, setAcked] = useState<string[]>([]);
  const target = orders.find((o) => o.band === "CRITICAL" && !acked.includes(o.id));
  if (!target) return null;
  return (
    <CriticalDialog
      key={target.id}
      order={target}
      scope={scope}
      onAcked={() => setAcked((xs) => [...xs, target.id])}
    />
  );
}

function CriticalDialog({
  order,
  scope,
  onAcked,
}: {
  order: RevisedOrderCard;
  scope: RevisionScope;
  onAcked: () => void;
}) {
  const { run, pending } = useAckRunner();
  const glow = useFirstGlow();
  const btnRef = useRef<HTMLButtonElement>(null);
  const titleId = `critical-revision-${order.id}`;

  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // The button is the only focusable thing in here, so swallowing Tab
        // is the whole focus trap.
        onKeyDown={(e) => {
          if (e.key === "Tab") e.preventDefault();
        }}
        className={"w-full max-w-lg rounded-lg border-2 p-4 " + revisedCardClass(order.band) + " " + glow}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <RevisedBadge band={order.band} />
          <h2 id={titleId} className="text-[15px] font-bold text-ik-ink">
            {order.code} was changed
          </h2>
        </div>
        <p className="mt-1 text-[13px] text-ik-ink">
          <strong>{order.customerName}</strong> · {fmtWhen(order.eventDate)}
        </p>

        <div className="mt-2.5 rounded-md border border-ik-rule bg-ik-card p-3">
          <ul className="grid gap-1 text-[14px] font-medium text-ik-ink">
            {changeLines(order).map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
          {order.revision?.note && (
            <p className="mt-2 border-t border-ik-rule pt-2 text-[13px] text-ik-ink-2">
              Manager&apos;s note: {order.revision.note}
            </p>
          )}
        </div>

        <Button
          ref={btnRef}
          className="mt-3 h-11 w-full"
          disabled={pending}
          onClick={() => run(() => acknowledgeOrderRevision(order.id, scope), "Thanks — noted", onAcked)}
        >
          Seen — I&apos;ll adjust
        </Button>
      </div>
    </div>
  );
}
