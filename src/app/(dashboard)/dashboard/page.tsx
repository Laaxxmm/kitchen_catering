import type { Role } from "@prisma/client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { LauncherGreeting } from "@/components/ik/dashboard/LauncherGreeting";
import { auth } from "@/server/auth";
import { getDashboardSummary } from "@/server/actions/dashboard";
import { AttentionBanner } from "@/components/ik/dashboard/launcher/AttentionBanner";
import { TaskTiles, type TaskTile } from "@/components/ik/dashboard/launcher/TaskTiles";
import { StoresStrip } from "@/components/ik/dashboard/launcher/StoresStrip";
import { MoreActionsMenu } from "@/components/ik/dashboard/launcher/MoreActionsMenu";
import { MyTasksPanel } from "@/components/ik/dashboard/MyTasksPanel";
import { HousekeepingPanel } from "@/components/ik/dashboard/HousekeepingPanel";
import { MaintenancePanel } from "@/components/ik/dashboard/MaintenancePanel";
import { BanquetPanel } from "@/components/ik/dashboard/BanquetPanel";
import { ChefWorkScreen } from "@/components/ik/dashboard/ChefWorkScreen";
import { listChefBoardOrders } from "@/server/actions/production-jobs";
import { DriverWorkScreen } from "@/components/ik/dashboard/DriverWorkScreen";
import { listReadyForDispatch, listMyActiveDeliveries, listEventPrepQueue, listUpcomingEventOrders } from "@/server/actions/deliveries";
import { SalesBoard } from "@/components/ik/dashboard/SalesBoard";
import { StoreBoard } from "@/components/ik/dashboard/StoreBoard";
import { StoreUpcoming } from "@/components/ik/dashboard/StoreUpcoming";
import { ManagerApprovalsBoard } from "@/components/ik/dashboard/ManagerApprovalsBoard";
import { AccountsBoard } from "@/components/ik/dashboard/AccountsBoard";
import { listOrders, listUpcomingOrdersForStore } from "@/server/actions/orders";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { listVendorPOs, listVendorBills } from "@/server/actions/procurement";
import { listBanquetRequisitions } from "@/server/actions/banquet";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { LogBoard, type LogBucket } from "@/components/ik/dashboard/LogBoard";
import { listHousekeepingIssues } from "@/server/actions/housekeeping";
import { listMaintenanceActivities } from "@/server/actions/maintenance";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { formatIST, istDayWindow, istScopeWindow, istWeekWindow, type EventDateScope } from "@/lib/time";
import { EventScopePills } from "@/components/ik/EventScopePills";
import {
  ChefRequisitionStatus, VendorPOStatus, OrderStatus,
  CustomerInvoiceStatus, VendorBillStatus, BanquetRequisitionStatus,
} from "@prisma/client";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Group a record by IST calendar: today / within 7 days / earlier. */
function logBucket(date: Date): LogBucket {
  const today = formatIST(new Date(), "yyyy-MM-dd");
  if (formatIST(date, "yyyy-MM-dd") === today) return "today";
  if (Date.now() - date.getTime() <= 7 * 24 * 60 * 60 * 1000) return "week";
  return "earlier";
}

/**
 * Role-aware launcher dashboard. Each role gets a focused screen (chef work
 * board, sales pipeline, store fulfilment, accounts, driver run, etc.);
 * admin/manager fall through to the operational launcher — an attention
 * banner, the inline approvals board (chef-change + PO sign-off), task
 * tiles, and a money-this-month strip. Everything is clickable.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; date?: string }>;
}) {
  const session = await auth();
  const name = session?.user?.name ?? "there";
  const firstName = name.split(" ")[0];
  const role = session?.user?.role as Role | undefined;
  const isManagerScope = role === "ADMIN" || role === "MANAGER";
  const isDriver = role === "DELIVERY";
  const isHousekeeping = role === "HOUSEKEEPING_MANAGER";
  const isMaintenance = role === "MAINTENANCE_MANAGER";
  const isFnb = role === "FNB_SERVICE";
  const isChef = role === "KITCHEN_HEAD";
  const isSales = role === "SALES";
  const isStore = role === "STORE_KEEPER";
  const isAccounts = role === "ACCOUNTS";

  // Kitchen head gets the action-first work-screen: every active order is a
  // card with its single next action inline (accept / raise request /
  // start cooking / mark done / dispatch). No drilling into detail pages.
  if (isChef) {
    // Event-date scope from the URL — defaults to TODAY so the chef opens
    // onto today's cooking, with pills to widen (tomorrow / week / all / a
    // specific date). Same ?scope=/?date= contract as /kitchen.
    const sp = await searchParams;
    const scope: EventDateScope =
      sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
        ? "date"
        : sp.scope === "tomorrow" || sp.scope === "week" || sp.scope === "all"
          ? sp.scope
          : "today";
    const window = istScopeWindow(sp.scope, sp.date);
    // Scoped board for the cards + unscoped list for pill counts, so the
    // chef sees "Tomorrow (2)" at a glance instead of an empty Today with
    // no hint that work is queued ahead.
    const [board, allBoard] = await Promise.all([
      listChefBoardOrders(window ?? undefined),
      listChefBoardOrders(),
    ]);
    const inWindow = (d: Date, w: { from: Date; toExclusive: Date }) =>
      d.getTime() >= w.from.getTime() && d.getTime() < w.toExclusive.getTime();
    const todayW = istDayWindow();
    const tomorrowW = istDayWindow(new Date(), 1);
    const weekW = istWeekWindow();
    const pillCounts = {
      today: allBoard.filter((o) => inWindow(o.eventDate, todayW)).length,
      tomorrow: allBoard.filter((o) => inWindow(o.eventDate, tomorrowW)).length,
      week: allBoard.filter((o) => inWindow(o.eventDate, weekW)).length,
      all: allBoard.length,
    };
    const tomorrowNew = allBoard.filter(
      (o) => o.status === OrderStatus.PENDING_CHEF_APPROVAL && inWindow(o.eventDate, tomorrowW),
    ).length;
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Every order that needs you, with the next action on the card — accept, get ingredients, cook, hand to delivery."
          actions={<Link href="/requisitions/new"><Button variant="outline">New stock request</Button></Link>}
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <EventScopePills basePath="/dashboard" scope={scope} date={sp.date} counts={pillCounts} />
            <Link href="/dashboard?scope=all" className="text-[12px] text-brand hover:underline">
              All orders →
            </Link>
          </div>
          {scope === "today" && tomorrowNew > 0 && (
            <Link
              href="/dashboard?scope=tomorrow"
              className="rounded-md border border-amber bg-amber-wash px-3 py-2 text-[12.5px] font-medium text-amber-700 hover:underline"
            >
              ⏰ {tomorrowNew} new order{tomorrowNew === 1 ? "" : "s"} for tomorrow waiting for your acceptance — review now →
            </Link>
          )}
          {board.length === 0 && scope !== "all" && (
            <p className="text-[12.5px] text-ik-ink-3">
              Nothing {scope === "today" ? "for today" : "in this window"} —{" "}
              <Link href="/dashboard?scope=all" className="text-brand hover:underline">
                see all orders
              </Link>{" "}
              to check what&apos;s coming up.
            </p>
          )}
          <ChefWorkScreen
            orders={board.map((o) => ({
              id: o.id,
              code: o.code,
              status: o.status,
              channel: o.channel,
              headcount: o.headcount,
              eventDate: o.eventDate.toISOString(),
              roomNumber: o.roomNumber,
              tableNumber: o.tableNumber,
              handedToDelivery: o.handedToDeliveryAt != null,
              customerName: o.customer.name,
              items: o.items.map((it) => ({ label: it.dish.name, portions: it.portions.toString() })),
              handover: o.productionJobs[0]
                ? {
                    jobId: o.productionJobs[0].id,
                    items: o.productionJobs[0].items.map((it) => ({
                      id: it.id,
                      dishName: it.dish.name,
                      portions: it.portions.toString(),
                      status: it.status,
                      handedOverAt: it.handedOverAt ? it.handedOverAt.toISOString() : null,
                      handedOverBy: it.handedOverBy?.name ?? null,
                    })),
                  }
                : null,
            }))}
          />
        </div>
      </>
    );
  }

  // Sales: their order pipeline in four tabs — Drafts (submit), In review,
  // In kitchen, Out/done. Submit is inline; everything else opens the order.
  if (isSales) {
    const orders = await listOrders();
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Your orders by stage. Submit drafts here; tap any order to see the detail."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/orders/new"><Button>Take new order</Button></Link>
              <Link href="/quotes/new"><Button variant="outline">Draft quote</Button></Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <SalesBoard
            orders={orders.map((o) => ({
              id: o.id,
              code: o.code,
              status: o.status,
              channel: o.channel,
              customerName: o.customer.name,
              eventDate: o.eventDate.toISOString(),
            }))}
          />
        </div>
      </>
    );
  }

  // Store keeper: chef ingredient requests to fulfil + their own stock
  // requests, grouped in tabs. Issuing is line-level so cards open the
  // fulfilment page.
  if (isStore) {
    // #5: event-date scope for the "Upcoming orders" planning view — same
    // ?scope=/?date= contract as the chef / F&B branches. Defaults to "all"
    // (the whole forward book) since the store plans ahead, not just today.
    const sp = await searchParams;
    const scope: EventDateScope =
      sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
        ? "date"
        : sp.scope === "today" || sp.scope === "tomorrow" || sp.scope === "week"
          ? sp.scope
          : "all";
    const window = istScopeWindow(scope, sp.date);
    const [chefReqs, fnbReqs, pos, upcoming, allUpcoming] = await Promise.all([
      listChefRequisitions({
        status: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED],
        activeOrderOnly: true,
      }),
      // Open F&B banquet-store requests — surfaced beside the chef requests
      // so they're not missed inside Banquet → Requisitions.
      listBanquetRequisitions({
        status: [BanquetRequisitionStatus.SUBMITTED, BanquetRequisitionStatus.PARTIALLY_ISSUED],
      }),
      // The store's open purchase orders — so they can submit drafts, watch
      // for the manager's approval, then send to the vendor + record the GRN.
      listVendorPOs({
        status: [
          VendorPOStatus.DRAFT,
          VendorPOStatus.PENDING_APPROVAL,
          VendorPOStatus.APPROVED,
          VendorPOStatus.SENT,
          VendorPOStatus.PARTIALLY_RECEIVED,
        ],
      }),
      // Windowed forward view for the cards + unscoped list for pill counts
      // (mirrors the chef branch), so "This week (5)" shows at a glance.
      listUpcomingOrdersForStore(window ?? undefined),
      listUpcomingOrdersForStore(),
    ]);
    const inWindow = (iso: string, w: { from: Date; toExclusive: Date }) => {
      const t = new Date(iso).getTime();
      return t >= w.from.getTime() && t < w.toExclusive.getTime();
    };
    const pillCounts = {
      today: allUpcoming.filter((o) => inWindow(o.eventDate, istDayWindow())).length,
      tomorrow: allUpcoming.filter((o) => inWindow(o.eventDate, istDayWindow(new Date(), 1))).length,
      week: allUpcoming.filter((o) => inWindow(o.eventDate, istWeekWindow())).length,
      all: allUpcoming.length,
    };
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Requests from the kitchen and the F&B team, and the purchase orders you've raised. Open a request to issue line by line."
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <StoreBoard
            chefReqs={chefReqs.map((r) => ({
              id: r.id,
              requisitionNo: r.requisitionNo,
              status: r.status,
              orderCode: r.order?.code ?? null,
              customerName: r.order?.customer.name ?? "Kitchen stock request",
              eventDate: r.order?.eventDate.toISOString() ?? null,
              createdAt: r.createdAt.toISOString(),
              lines: r._count.lines,
            }))}
            fnbReqs={fnbReqs.map((r) => ({
              id: r.id,
              requisitionNo: r.requisitionNo,
              status: r.status,
              requestedBy: r.createdBy.name ?? "F&B Service",
              orderCode: r.order?.code ?? null,
              eventDate: r.order?.eventDate.toISOString() ?? null,
              createdAt: r.createdAt.toISOString(),
              lines: r._count.lines,
            }))}
            pos={pos.map((p) => ({
              id: p.id,
              poNo: p.poNo,
              status: p.status,
              vendor: p.vendor.name,
              total: p.grandTotal.toString(),
            }))}
          />
          {/* #5: forward planning view — confirmed orders the store still
              needs to stock for, scoped by the pills. Read-only; cards open
              the order. Kept distinct from the action board above. */}
          <section className="rounded-lg border border-ik-rule bg-ik-paper-alt/40 p-4">
            <div className="mb-2">
              <h2 className="text-[14px] font-semibold text-ik-ink">Upcoming orders</h2>
              <p className="text-[12px] text-ik-ink-3">
                Confirmed catering orders to pre-arrange stock for.
              </p>
            </div>
            {/* Day filter up top — pick the window, then read the cards below. */}
            <div className="mb-3 border-b border-ik-rule pb-3">
              <EventScopePills basePath="/dashboard" scope={scope} date={sp.date} counts={pillCounts} />
            </div>
            <StoreUpcoming orders={upcoming} />
          </section>
        </div>
      </>
    );
  }

  // Accounts: money to collect (customer invoices) + money to pay (vendor
  // bills) in two tabs, with "Mark paid" inline.
  if (isAccounts) {
    const [invoices, bills] = await Promise.all([
      listCustomerInvoices({ status: [CustomerInvoiceStatus.ISSUED, CustomerInvoiceStatus.PARTIAL] }),
      listVendorBills({
        status: [
          VendorBillStatus.MATCHED,
          VendorBillStatus.APPROVED,
          VendorBillStatus.DISCREPANCY,
          VendorBillStatus.OVERDUE,
        ],
      }),
    ]);
    const receivables = invoices
      .map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        customerName: inv.customer.name,
        orderCode: inv.order?.code ?? null,
        outstanding: toDecimal(inv.grandTotal).minus(toDecimal(inv.amountPaid)),
      }))
      .filter((r) => r.outstanding.gt(0));
    const payables = bills
      .map((b) => ({
        id: b.id,
        billNo: b.billNo,
        vendorName: b.vendor.name,
        outstanding: toDecimal(b.grandTotal).minus(toDecimal(b.amountPaid)),
      }))
      .filter((p) => p.outstanding.gt(0));
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Money to collect and money to pay, in two tabs. Mark anything paid right here."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/customers/new"><Button>Add customer</Button></Link>
              <Link href="/customers"><Button variant="outline">Customers</Button></Link>
              <Link href="/invoices"><Button variant="outline">Invoices</Button></Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <AccountsBoard
            receivables={receivables.map((r) => ({ ...r, outstanding: r.outstanding.toFixed(2) }))}
            payables={payables.map((p) => ({ ...p, outstanding: p.outstanding.toFixed(2) }))}
          />
        </div>
      </>
    );
  }

  // Housekeeping manager gets a focused dashboard scoped to their module.
  // Skips the heavy operational getDashboardSummary call entirely.
  if (isHousekeeping) {
    const issues = await listHousekeepingIssues({ limit: 100 });
    const rows = issues.map((iss) => ({
      id: iss.id,
      bucket: logBucket(iss.issuedAt),
      primary: iss.room ? `Room ${iss.room.number}${iss.room.name ? ` · ${iss.room.name}` : ""}` : "Issue to room",
      secondary: iss.staff?.name ? `Handed to ${iss.staff.name}` : null,
      time: iss.issuedAt.toISOString(),
      person: iss.recordedBy?.name ?? null,
      items: iss.lines.map((l) => `${l.item.name} · ${l.quantity.toString()} ${l.item.unit}`),
    }));
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Every issue-to-room, grouped by Today / This week / Earlier. Record new issues and receipts up top."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/housekeeping/issues/new">
                <Button>New issue to room</Button>
              </Link>
              <Link href="/housekeeping/receipts/new">
                <Button variant="outline">Record receipt</Button>
              </Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <LogBoard rows={rows} unit="issues" />
          <HousekeepingPanel />
        </div>
      </>
    );
  }

  // Maintenance manager — same shape as housekeeping. Spares store + room
  // work-log live here; nothing else from the operational dashboard applies.
  if (isMaintenance) {
    const activities = await listMaintenanceActivities({ limit: 100 });
    const rows = activities.map((a) => ({
      id: a.id,
      bucket: logBucket(a.performedAt),
      primary: a.room ? `Room ${a.room.number}${a.room.name ? ` · ${a.room.name}` : ""}` : a.category,
      secondary: [a.category, a.notes].filter(Boolean).join(" · ") || null,
      time: a.performedAt.toISOString(),
      person: a.staff?.name ?? a.recordedBy?.name ?? null,
      items: a.lines.map((l) => `${l.item.name} · ${l.quantity.toString()} ${l.item.unit}`),
    }));
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Every electrical / mechanical activity, grouped by Today / This week / Earlier. Log new activities and receipts up top."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/maintenance/activities/new"><Button>Log activity</Button></Link>
              <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <LogBoard rows={rows} unit="activities" />
          <MaintenancePanel />
        </div>
      </>
    );
  }

  // F&B service — focused dashboard for the banquet store + tasks.
  // Order-channel UI (room service, alacarte, management) lands in
  // Phase 4 and will surface here too.
  if (isFnb) {
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Banquet store + service desk. Record stock IN from vendors and stock OUT to today's events."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
              <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <BanquetPanel />
        </div>
      </>
    );
  }

  // F&B Service (merged role): their delivery run + event-cutlery prep in the
  // work-screen, the banquet store below, and quick actions to take an in-house
  // order or issue to an event. One team, one screen. Handled BEFORE the heavy
  // getDashboardSummary() below — they don't use it, and it shouldn't be able
  // to blank their dashboard if it hiccups.
  if (isDriver) {
    // Event-date scope pills, same contract as the chef dashboard — F&B
    // opens onto today's events with counts showing where the rest of the
    // load sits (tomorrow / this week / all / a date).
    const sp = await searchParams;
    const scope: EventDateScope =
      sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
        ? "date"
        : sp.scope === "tomorrow" || sp.scope === "week" || sp.scope === "all"
          ? sp.scope
          : "today";
    const window = istScopeWindow(sp.scope, sp.date);
    const [allEventPrep, allPickups, allDeliveries, upcoming] = await Promise.all([
      listEventPrepQueue(),
      listReadyForDispatch(),
      listMyActiveDeliveries(),
      // #18: read-only heads-up — confirmed event orders in the next 7 days.
      listUpcomingEventOrders(),
    ]);
    const within = (iso: string | Date, w: { from: Date; toExclusive: Date } | null) => {
      if (!w) return true;
      const t = new Date(iso).getTime();
      return t >= w.from.getTime() && t < w.toExclusive.getTime();
    };
    const eventPrep = allEventPrep.filter((o) => within(o.eventDate, window));
    const pickups = allPickups.filter((o) => within(o.eventDate, window));
    const myDeliveries = allDeliveries.filter((d) => within(d.scheduledAt, window));
    const todayW = istDayWindow();
    const tomorrowW = istDayWindow(new Date(), 1);
    const weekW = istWeekWindow();
    const countIn = (w: { from: Date; toExclusive: Date } | null) =>
      allEventPrep.filter((o) => within(o.eventDate, w)).length +
      allPickups.filter((o) => within(o.eventDate, w)).length +
      allDeliveries.filter((d) => within(d.scheduledAt, w)).length;
    const pillCounts = {
      today: countIn(todayW),
      tomorrow: countIn(tomorrowW),
      week: countIn(weekW),
      all: countIn(null),
    };
    const tomorrowPrep = allEventPrep.filter(
      (o) => !o.prepReadyAt && within(o.eventDate, tomorrowW),
    ).length;
    return (
      <>
        <LauncherGreeting
          firstName={firstName}
          subtitle="Your run and the banquet store in one place — take an order, ready the event cutlery, dispatch, and mark delivered. Every action is on the card."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/orders/new"><Button>Take order</Button></Link>
              <Link href="/banquet/issues/new"><Button variant="outline">Issue to event</Button></Link>
              <Link href="/banquet/request"><Button variant="outline">Raise requisition</Button></Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-5">
          <MyTasksPanel />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <EventScopePills basePath="/dashboard" scope={scope} date={sp.date} counts={pillCounts} />
            <Link href="/dashboard?scope=all" className="text-[12px] text-brand hover:underline">
              All events →
            </Link>
          </div>
          {scope === "today" && tomorrowPrep > 0 && (
            <Link
              href="/dashboard?scope=tomorrow"
              className="rounded-md border border-amber bg-amber-wash px-3 py-2 text-[12.5px] font-medium text-amber-700 hover:underline"
            >
              ⏰ {tomorrowPrep} event{tomorrowPrep === 1 ? "" : "s"} tomorrow still need{tomorrowPrep === 1 ? "s" : ""} cutlery prep — get ahead now →
            </Link>
          )}
          {eventPrep.length + pickups.length + myDeliveries.length === 0 && scope !== "all" && (
            <p className="text-[12.5px] text-ik-ink-3">
              Nothing {scope === "today" ? "for today" : "in this window"} —{" "}
              <Link href="/dashboard?scope=all" className="text-brand hover:underline">
                see all events
              </Link>{" "}
              to check what&apos;s coming up.
            </p>
          )}
          <DriverWorkScreen
            eventPrep={eventPrep}
            pickups={pickups.map((o) => ({
              id: o.id,
              code: o.code,
              channel: o.channel,
              headcount: o.headcount,
              eventDate: o.eventDate.toISOString(),
              roomNumber: o.roomNumber,
              deliveryAddress: o.deliveryAddress,
              customerName: o.customer.name,
              items: (o.items ?? []).map((it) => ({ label: it.dish?.name ?? "—", portions: it.portions.toString() })),
              staff: o.staffAllocations,
            }))}
            deliveries={myDeliveries.map((d) => ({
              id: d.id,
              deliveryNo: d.deliveryNo,
              status: d.status,
              scheduledAt: d.scheduledAt.toISOString(),
              orderCode: d.order.code,
              channel: d.order.channel,
              headcount: d.order.headcount,
              roomNumber: d.order.roomNumber,
              deliveryAddress: d.order.deliveryAddress,
              customerName: d.order.customer.name,
              items: (d.order.items ?? []).map((it) => ({ label: it.dish?.name ?? "—", portions: it.portions.toString() })),
            }))}
            upcoming={upcoming}
          />
          <BanquetPanel />
        </div>
      </>
    );
  }

  // Other roles fall through to the operational dashboard. Loaded here so
  // the housekeeping / F&B branches above don't pay the cost of the heavy query.
  const summary = await getDashboardSummary();

  // Admin / manager: pull the three approval queues for the inline
  // approvals board at the top of the operational dashboard.
  const approvals = isManagerScope
    ? await Promise.all([
        listOrders({ status: [OrderStatus.PENDING_ADMIN_APPROVAL] }),
        listOrders({ status: [OrderStatus.CHANGES_PROPOSED_BY_CHEF] }),
        listVendorPOs({ status: [VendorPOStatus.PENDING_APPROVAL] }),
      ])
    : null;

  // ─── Admin / Manager launcher ─────────────────────────────────────────
  const proc = summary.procurement;
  // Orders waiting on the manager's commercial sign-off — the most urgent
  // thing, since nothing moves to the kitchen until it's approved.
  const needApproval = summary.kitchen?.awaitingAdminApproval ?? 0;
  const needPOApproval = proc?.poPendingApproval ?? 0;
  const needMatch = proc?.billsPendingMatch ?? 0;
  const needPay = proc?.billsPendingPayment ?? 0;
  const needReorder = summary.lowStockCount;
  const attnCount = needApproval + needPOApproval + needMatch + needPay + needReorder;
  const attnBreakdown = [
    needApproval ? `${needApproval} order${needApproval === 1 ? "" : "s"} to approve` : null,
    needPOApproval ? `${needPOApproval} PO${needPOApproval === 1 ? "" : "s"} to approve` : null,
    needMatch ? `${needMatch} ${needMatch === 1 ? "bill" : "bills"} to match` : null,
    needPay ? `${needPay} to pay` : null,
    needReorder ? `${needReorder} to reorder` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const kWait = summary.kitchen?.waitingOnStore ?? 0;
  const billsToAction = needMatch + needPay;
  const tiles: TaskTile[] = [
    needApproval > 0
      ? { key: "orders", icon: "orders", label: "Orders", status: `${needApproval} to approve`, href: "/queue/admin-approvals", tone: "red" }
      : { key: "orders", icon: "orders", label: "Orders", status: `${summary.dueOrders} due`, href: "/orders" },
    { key: "kitchen", icon: "kitchen", label: "Kitchen", status: `${kWait} waiting on stock`, href: "/kitchen", tone: kWait > 0 ? "amber" : "default" },
    { key: "stock", icon: "stock", label: "Stock", status: `${needReorder} to reorder`, href: "/inventory/ingredients", tone: needReorder > 0 ? "red" : "default" },
    { key: "bills", icon: "bills", label: "Bills & pay", status: `${billsToAction} to action`, href: "/payments", tone: billsToAction > 0 ? "amber" : "default" },
    { key: "customers", icon: "customers", label: "Customers", status: "Quotes & contacts", href: "/customers" },
    { key: "deliveries", icon: "deliveries", label: "Deliveries", status: `${summary.deliveredToday} delivered today`, href: "/deliveries" },
  ];
  const moreActions = [
    { label: "Draft quote", href: "/quotes/new" },
    { label: "Add customer", href: "/customers/new" },
    { label: "Schedule delivery", href: "/deliveries/new" },
    { label: "Raise purchase order", href: "/procurement/purchase-orders/new" },
    { label: "Record supplier bill", href: "/procurement/vendor-bills/new" },
    { label: "Add stock receipt", href: "/inventory/receipts/new" },
    { label: "Assign task", href: "/tasks/admin" },
  ];

  return (
    // grid-cols-1 is load-bearing: it sizes the single track as
    // minmax(0, 1fr). A bare `grid` gives an auto track, whose max is
    // max-content — so one wide child (a long approvals row, a wide table)
    // stretches the track and drags every other section off-screen with it.
    <div className="grid grid-cols-1 gap-5">
      {/* 1 ─ Greeting (compact) */}
      <LauncherGreeting firstName={firstName} />

      {/* 2 ─ Attention banner — the only strong-colour element on the page */}
      <AttentionBanner count={attnCount} breakdown={attnBreakdown} reviewHref="/review" />

      {/* 3 ─ Primary action + everything else behind "More" */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/orders/new"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-brand-500 px-5 text-[14px] font-semibold text-white transition hover:bg-brand-600 sm:flex-none sm:min-w-[240px]"
        >
          <Plus size={17} /> Take a new order
        </Link>
        <MoreActionsMenu items={moreActions} />
      </div>

      {/* 3a ─ Approvals: chef-proposed order changes + POs — approve/reject
          inline. Self-hides when nothing is waiting. */}
      {approvals && (
          <ManagerApprovalsBoard
            ordersToApprove={approvals[0].map((o) => ({
              id: o.id,
              code: o.code,
              customerName: o.customer.name,
              eventDate: o.eventDate.toISOString(),
              channel: o.channel,
              headcount: o.headcount,
              contractValue: o.contractValue.toString(),
            }))}
            orderChanges={approvals[1].map((o) => ({
              id: o.id,
              code: o.code,
              customerName: o.customer.name,
              eventDate: o.eventDate.toISOString(),
              note: o.chefSuggestionNotes ?? null,
            }))}
            purchaseOrders={approvals[2]
              // Admin only signs off spend that actually needs them (≥ the
              // ₹5k tier — those wait as PENDING_APPROVAL after the manager's
              // first approval). The manager handles the first step on all the
              // rest. So each role sees only its own queue, not the other's.
              .filter((po) =>
                role === "ADMIN" ? po.managerApprovedAt != null : po.managerApprovedAt == null,
              )
              .map((po) => ({
                id: po.id,
                poNo: po.poNo,
                vendor: po.vendor.name,
                grandTotal: po.grandTotal.toString(),
                awaitingAdmin: po.managerApprovedAt != null,
              }))}
            viewerIsAdmin={role === "ADMIN"}
          />
        )}

        {/* 1 ─ Personal task tray. Surfaces what's been assigned to *me*
            outside the operational workflow (one-off line-management
            asks). Hidden when the user has no tasks. */}
        <MyTasksPanel />

        {/* 4 ─ Task tiles — the launcher's main grid */}
        <TaskTiles tiles={tiles} />

        {/* 5 ─ Stores strip — lighter reference row */}
        <StoresStrip />

        {/* 6 ─ Money this month — one quiet strip at the bottom */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ik-rule bg-ik-paper-alt p-4">
          <span className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Money this month</span>
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[13px]">
            <span><span className="text-ik-ink-3">In </span><span className="text-positive">{formatINRWhole(summary.ar?.collectedThisMonth ?? 0)}</span></span>
            <span><span className="text-ik-ink-3">Out </span><span className="text-ik-ink">{formatINRWhole(summary.ap?.paidThisMonth ?? 0)}</span></span>
            <span><span className="text-ik-ink-3">Due </span><span className="text-alert">{formatINRWhole(summary.ar?.pending ?? summary.outstandingAR)}</span></span>
          </div>
        </section>
      </div>
  );
}
