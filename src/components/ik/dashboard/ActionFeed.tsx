import Link from "next/link";
import type { Role } from "@prisma/client";

interface KitchenCounts {
  awaitingChefApproval: number;
  requisitionPending: number;
  waitingOnStore: number;
  readyToCook: number;
  inProduction: number;
  readyToDispatch: number;
  awaitingAdminApproval?: number;
}
interface ProcurementCounts {
  prPendingApproval: number;
  prApprovedNoPO: number;
  poPendingApproval: number;
  poSentNotReceived: number;
  grnPendingBill: number;
  billsPendingMatch: number;
  billsPendingPayment: number;
}

interface StoreKeeperCounts {
  openChefRequisitions: number;
  poAwaitingReceipt: number;
  lowStock: number;
}

interface Props {
  role: Role | undefined;
  kitchen: KitchenCounts | null;
  procurement: ProcurementCounts | null;
  storeKeeper: StoreKeeperCounts | null;
  ar: { overdue: string } | null;
  todayDeliveries: number;
  lowStockCount: number;
}

interface Item {
  text: string;
  href: string;
  /** "urgent" → amber (needs you), "info" → brand-green (heads up). */
  tone: "urgent" | "info";
}

/**
 * Role-aware "what needs you right now" feed for the dashboard. Translates
 * counts into sentences with a click-through. Items with count = 0 are
 * dropped, so the panel collapses to "All clear" on a quiet day.
 *
 * Order of items matters — most urgent / blocking first.
 */
export function ActionFeed({ role, kitchen, procurement, storeKeeper, ar, todayDeliveries, lowStockCount }: Props) {
  const items: Item[] = [];
  const isAdmin = role === "ADMIN";
  const isManager = role === "MANAGER" || isAdmin;
  const isChef = role === "KITCHEN_HEAD" || isAdmin;
  const isStore = role === "STORE_KEEPER" || isAdmin;
  const isAccounts = role === "ACCOUNTS" || isManager;

  // — Admin gate (workflow v3) — top priority since nothing else moves
  // until admin signs off. Only shown to admin.
  if (isAdmin && kitchen?.awaitingAdminApproval) {
    items.push({
      text: line(kitchen.awaitingAdminApproval, "order", "waiting on your approval"),
      href: "/queue/admin-approvals",
      tone: "urgent",
    });
  }

  // — Chef-side actions —
  if (isChef && kitchen) {
    if (kitchen.awaitingChefApproval > 0) {
      items.push({
        text: line(kitchen.awaitingChefApproval, "order", "awaiting your chef approval"),
        href: "/queue/chef-approvals",
        tone: "urgent",
      });
    }
    if (kitchen.requisitionPending > 0) {
      items.push({
        text: line(kitchen.requisitionPending, "approved order", "ready — raise the ingredient requisition"),
        href: "/orders?status=CHEF_REQUISITION_PENDING",
        tone: "urgent",
      });
    }
    if (kitchen.readyToCook > 0) {
      items.push({
        text: line(kitchen.readyToCook, "order", "ready to cook — start on the kitchen board"),
        href: "/kitchen",
        tone: "urgent",
      });
    }
  }

  // — Manager-side actions —
  if (isManager && procurement) {
    if (procurement.prPendingApproval > 0) {
      items.push({
        text: line(procurement.prPendingApproval, "stock request", "waiting on your approval"),
        href: "/procurement/purchase-requisitions?status=PENDING_APPROVAL",
        tone: "urgent",
      });
    }
    if (procurement.poPendingApproval > 0) {
      items.push({
        text: line(procurement.poPendingApproval, "purchase order", "waiting on your approval"),
        href: "/procurement/purchase-orders?status=PENDING_APPROVAL",
        tone: "urgent",
      });
    }
    if (procurement.prApprovedNoPO > 0) {
      items.push({
        text: line(procurement.prApprovedNoPO, "approved request", "ready — issue a PO"),
        href: "/procurement/purchase-requisitions?status=APPROVED",
        tone: "info",
      });
    }
    if (procurement.billsPendingMatch > 0) {
      items.push({
        text: line(procurement.billsPendingMatch, "supplier bill", "needs a 3-way match"),
        href: "/procurement/vendor-bills?status=PENDING_MATCH",
        tone: "urgent",
      });
    }
  }

  if (isManager && kitchen && kitchen.readyToDispatch > 0) {
    items.push({
      text: line(kitchen.readyToDispatch, "order", "ready to dispatch — schedule a delivery"),
      href: "/deliveries/new",
      tone: "urgent",
    });
  }

  // — Storekeeper-side actions —
  if (isStore && storeKeeper) {
    if (storeKeeper.openChefRequisitions > 0) {
      items.push({
        text: line(storeKeeper.openChefRequisitions, "chef requisition", "waiting on you to issue stock"),
        href: "/requisitions",
        tone: "urgent",
      });
    }
    if (storeKeeper.poAwaitingReceipt > 0) {
      items.push({
        text: line(storeKeeper.poAwaitingReceipt, "purchase order", "out to suppliers — log goods when they arrive"),
        href: "/procurement/purchase-orders?status=SENT",
        tone: "info",
      });
    }
  }

  // — Accounts-side actions —
  if (isAccounts) {
    if (procurement && procurement.billsPendingPayment > 0) {
      items.push({
        text: line(procurement.billsPendingPayment, "supplier bill", "to pay"),
        href: "/payments/payables",
        tone: "info",
      });
    }
    if (ar && parseFloat(ar.overdue) > 0) {
      items.push({
        text: `Overdue receivables — ₹${ar.overdue} pending`,
        href: "/payments/receivables?overdue=1",
        tone: "urgent",
      });
    }
  }

  // — Today's deliveries —
  if (todayDeliveries > 0 && (isManager || role === "DELIVERY")) {
    items.push({
      text: line(todayDeliveries, "delivery", "scheduled for today"),
      href: "/deliveries",
      tone: "info",
    });
  }

  // — Inventory health —
  if (lowStockCount > 0 && (isStore || isManager)) {
    items.push({
      text: line(lowStockCount, "ingredient", "below reorder level"),
      href: "/inventory/ingredients?low=1",
      tone: "info",
    });
  }

  if (items.length === 0) {
    return (
      <section className="rounded-md border border-brand-200 bg-brand-50 p-5">
        <div className="text-[14px] font-medium text-brand-700">All clear.</div>
        <p className="mt-1 text-[12.5px] text-ik-ink-2">
          Nothing needs your immediate attention. Keep an eye on the live order map below.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <h2 className="border-b border-ik-rule px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
        What needs you right now
      </h2>
      <ul>
        {items.map((it, i) => (
          <li
            key={i}
            className={
              "flex items-center justify-between gap-3 border-b border-ik-rule px-4 py-3 last:border-b-0 " +
              (it.tone === "urgent" ? "bg-amber-wash/40" : "bg-transparent")
            }
          >
            <div className="flex items-start gap-3 text-[13px] text-ik-ink">
              <span
                className={
                  "mt-1.5 inline-block h-2 w-2 rounded-full " +
                  (it.tone === "urgent" ? "bg-amber" : "bg-brand-500")
                }
              />
              <span>{it.text}</span>
            </div>
            <Link
              href={it.href}
              className="shrink-0 rounded-md border border-ik-rule bg-ik-card px-3 py-1 text-[12px] font-medium text-brand-700 hover:border-brand-500"
            >
              Open →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function line(n: number, singular: string, suffix: string): string {
  return `${n} ${n === 1 ? singular : pluralise(singular)} ${suffix}`;
}

/**
 * English pluralisation good enough for the words we use ("order",
 * "delivery", "request", "PO", "bill", "ingredient"). Handles -y → -ies.
 */
function pluralise(word: string): string {
  if (/[bcdfghjklmnpqrstvwxz]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}
