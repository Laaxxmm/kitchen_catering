"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel, OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import { chefApproveOrder } from "@/server/actions/orders";
import { markIngredientsAvailable } from "@/server/actions/chef-requisitions";
import { startCookingOrder, markOrderCooked } from "@/server/actions/production-jobs";

interface BoardItem {
  label: string;
  portions: string;
}

export interface ChefBoardOrder {
  id: string;
  code: string;
  status: OrderStatus;
  channel: OrderChannel;
  headcount: number | null;
  eventDate: string;
  roomNumber: string | null;
  tableNumber: string | null;
  customerName: string;
  items: BoardItem[];
}

interface Props {
  orders: ChefBoardOrder[];
}

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  ODC: "ODC",
  PACKET: "Packed food",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

// One coherent "what is this order waiting for" line per status, plus the
// visual tone of its card. Drives the order of the board (urgent first).
const STAGE: Partial<
  Record<OrderStatus, { rank: number; tone: "new" | "active" | "ready" | "wait"; line: string }>
> = {
  PENDING_CHEF_APPROVAL: { rank: 0, tone: "new", line: "New order — accept to begin" },
  CHEF_REQUISITION_PENDING: { rank: 1, tone: "active", line: "Accepted — do you have the ingredients?" },
  ISSUING: { rank: 2, tone: "wait", line: "Waiting on store to issue ingredients" },
  READY_FOR_PRODUCTION: { rank: 3, tone: "active", line: "Ingredients in — ready to cook" },
  IN_PREP: { rank: 4, tone: "active", line: "Cooking in progress" },
  READY: { rank: 5, tone: "ready", line: "Cooked — ready to dispatch" },
};

const TONE_CLASS: Record<"new" | "active" | "ready" | "wait", string> = {
  new: "border-amber bg-amber-wash",
  active: "border-brand-200 bg-brand-50",
  ready: "border-positive/40 bg-positive/5",
  wait: "border-ik-rule bg-ik-card",
};

// The four stages of the chef's day, each its own tab. An order lands in
// exactly one tab based on its status; the tab it's in tells the chef what
// kind of action it needs.
const TABS: { key: string; label: string; hint: string; statuses: OrderStatus[] }[] = [
  { key: "new", label: "New orders", hint: "Accept or reject", statuses: [OrderStatus.PENDING_CHEF_APPROVAL] },
  {
    key: "ingredients",
    label: "Ingredients",
    hint: "Confirm or request stock",
    statuses: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING],
  },
  {
    key: "cooking",
    label: "Cooking",
    hint: "Start & finish",
    statuses: [OrderStatus.READY_FOR_PRODUCTION, OrderStatus.IN_PREP],
  },
  { key: "dispatch", label: "Dispatch", hint: "Hand to delivery", statuses: [OrderStatus.READY] },
];

/**
 * The chef's whole job, split into four big tabs — New orders → Ingredients
 * → Cooking → Dispatch. Pick a tab and you see only the orders waiting on
 * that kind of work, soonest event first, with the next one to act on
 * highlighted. Every card carries its one action inline (Accept, Start
 * cooking, Mark done, …) so nothing needs a detail page. Kept deliberately
 * simple — it's for non-technical kitchen staff.
 */
export function ChefWorkScreen({ orders }: Props) {
  // Bucket each order into its tab, soonest event first (most urgent on top).
  const byTab = useMemo(() => {
    const map: Record<string, ChefBoardOrder[]> = {};
    for (const t of TABS) map[t.key] = [];
    for (const o of orders) {
      const tab = TABS.find((t) => t.statuses.includes(o.status));
      if (tab) map[tab.key].push(o);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
    }
    return map;
  }, [orders]);

  // Open on the first tab that actually has work waiting.
  const firstWithWork = TABS.find((t) => byTab[t.key].length > 0)?.key ?? TABS[0].key;
  const [active, setActive] = useState<string>(firstWithWork);
  const activeTab = TABS.find((t) => t.key === active) ?? TABS[0];
  const activeOrders = byTab[active] ?? [];

  return (
    <section>
      {/* Tab bar — big, labelled, with a live count per stage. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map((t) => {
          const count = byTab[t.key].length;
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "rounded-md border p-3 text-left transition " +
                (on
                  ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                  : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ik-ink">{t.label}</span>
                <span
                  className={
                    "grid min-h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 font-mono text-[11px] font-bold leading-none " +
                    (count > 0 ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-3")
                  }
                >
                  {count}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-ik-ink-3">{t.hint}</div>
            </button>
          );
        })}
      </div>

      {/* Orders in the selected stage. */}
      {activeOrders.length === 0 ? (
        <div className="rounded-md border border-ik-rule bg-ik-card p-5 text-[13px] text-ik-ink-2">
          Nothing in <strong>{activeTab.label}</strong> right now.
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {activeOrders.map((o, i) => (
            <ChefOrderCard key={o.id} order={o} highlight={i === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChefOrderCard({ order, highlight = false }: { order: ChefBoardOrder; highlight?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const stage = STAGE[order.status] ?? { tone: "wait" as const, line: order.status };
  const where =
    order.roomNumber ? `Room ${order.roomNumber}` : order.tableNumber ? `Table ${order.tableNumber}` : null;

  function run(fn: () => Promise<unknown>, successMsg: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMsg);
        setShowReject(false);
        setRejectNote("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <li
      className={
        "rounded-md border p-3 " +
        TONE_CLASS[stage.tone] +
        (highlight ? " ring-2 ring-brand-500" : "")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {highlight && (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Next up
            </span>
          )}
          <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
          <span className="rounded-full bg-ik-card px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">
            {CHANNEL_LABEL[order.channel]}
          </span>
          {where && <span className="text-[11.5px] font-medium text-ik-ink">{where}</span>}
        </div>
        <span className="text-[11.5px] text-ik-ink-3">
          {formatIST(new Date(order.eventDate), "EEE d MMM HH:mm")}
        </span>
      </div>

      <div className="mt-1 text-[13px] text-ik-ink">
        <strong>{order.customerName}</strong>
        {order.headcount ? <span className="text-ik-ink-3"> · {order.headcount} pax</span> : null}
      </div>

      <div className="mt-0.5 text-[12px] text-ik-ink-2">{stage.line}</div>

      {/* Dish list — compact, so the chef sees what to cook without drilling in. */}
      {order.items.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {order.items.map((it, i) => (
            <span key={i} className="rounded bg-ik-card px-1.5 py-0.5 text-[11px] text-ik-ink-2 ring-1 ring-ik-rule">
              {it.label} · {it.portions}
            </span>
          ))}
        </div>
      )}

      {/* Inline actions — one row, status-driven. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {order.status === OrderStatus.PENDING_CHEF_APPROVAL && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => chefApproveOrder(order.id, { decision: "APPROVED", note: "Accepted — confirmed for prep" }),
                  "Order accepted",
                )
              }
            >
              Accept
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowReject((v) => !v)}>
              Reject / suggest change
            </Button>
          </>
        )}

        {order.status === OrderStatus.CHEF_REQUISITION_PENDING && (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => markIngredientsAvailable(order.id), "Marked ingredients available — ready to cook")
              }
            >
              Ingredients ready (skip request)
            </Button>
            <Link href={`/orders/${order.id}/requisition`}>
              <Button size="sm" variant="outline">Raise ingredient request</Button>
            </Link>
          </>
        )}

        {order.status === OrderStatus.READY_FOR_PRODUCTION && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => startCookingOrder(order.id), "Cooking started")}
          >
            Start cooking
          </Button>
        )}

        {order.status === OrderStatus.IN_PREP && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => markOrderCooked(order.id), "Marked done — ready to dispatch")}
          >
            Mark done
          </Button>
        )}

        {order.status === OrderStatus.READY && (
          <Link href={`/deliveries/new?orderId=${order.id}`}>
            <Button size="sm">Dispatch</Button>
          </Link>
        )}

        {order.status === OrderStatus.ISSUING && (
          <span className="text-[11.5px] text-ik-ink-3">Store is gathering ingredients…</span>
        )}

        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">
          Open
        </Link>
      </div>

      {/* Reject path — a short note is required so the manager has context. */}
      {showReject && order.status === OrderStatus.PENDING_CHEF_APPROVAL && (
        <div className="mt-2 grid gap-2 rounded-md border border-ik-rule bg-ik-card p-2.5">
          <Textarea
            rows={2}
            placeholder="What's the issue? e.g. no samosa — suggest kachori"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !rejectNote.trim()}
              onClick={() =>
                run(
                  () => chefApproveOrder(order.id, { decision: "SUGGESTED_CHANGES", note: rejectNote }),
                  "Sent to manager for review",
                )
              }
            >
              Send to manager
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowReject(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
