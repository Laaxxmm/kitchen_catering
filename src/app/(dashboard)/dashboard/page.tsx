import type { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/server/auth";
import { getDashboardSummary } from "@/server/actions/dashboard";
import { ActionFeed } from "@/components/ik/dashboard/ActionFeed";
import { OrderJourneyStrip } from "@/components/ik/dashboard/OrderJourneyStrip";
import { ProcurementStrip } from "@/components/ik/dashboard/ProcurementStrip";
import { ARDonut } from "@/components/ik/dashboard/ARDonut";
import { APDonut } from "@/components/ik/dashboard/APDonut";
import { TodayTimeline } from "@/components/ik/dashboard/TodayTimeline";
import { QuickActions } from "@/components/ik/dashboard/QuickActions";
import { StockSnapshot } from "@/components/ik/dashboard/StockSnapshot";
import { PendingStockRequests } from "@/components/ik/dashboard/PendingStockRequests";
import { MyTasksPanel } from "@/components/ik/dashboard/MyTasksPanel";
import { TasksAdminPanel } from "@/components/ik/dashboard/TasksAdminPanel";
import { HousekeepingPanel } from "@/components/ik/dashboard/HousekeepingPanel";
import { MaintenancePanel } from "@/components/ik/dashboard/MaintenancePanel";
import { BanquetPanel } from "@/components/ik/dashboard/BanquetPanel";
import { StoresOverviewPanel } from "@/components/ik/dashboard/StoresOverviewPanel";
import { ChefWorkScreen } from "@/components/ik/dashboard/ChefWorkScreen";
import { listChefBoardOrders } from "@/server/actions/production-jobs";
import { DriverWorkScreen } from "@/components/ik/dashboard/DriverWorkScreen";
import { listReadyForDispatch, listMyActiveDeliveries } from "@/server/actions/deliveries";
import { SalesBoard } from "@/components/ik/dashboard/SalesBoard";
import { StoreBoard } from "@/components/ik/dashboard/StoreBoard";
import { ManagerApprovalsBoard } from "@/components/ik/dashboard/ManagerApprovalsBoard";
import { listOrders } from "@/server/actions/orders";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { listPurchaseRequisitions } from "@/server/actions/purchase-requisitions";
import { listVendorPOs } from "@/server/actions/procurement";
import { ChefRequisitionStatus, PurchaseRequisitionStatus, VendorPOStatus, OrderStatus } from "@prisma/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Visual dashboard — three layered blocks:
 *
 *   1. ActionFeed       — role-aware "what needs you right now" list.
 *   2. OrderJourneyStrip — the live order map, every active order parked
 *                          on its current stage of the chain.
 *   3. Money + Today    — AR donut + today's orders plotted on a timeline.
 *
 * For admin/manager we also surface the buy-side ProcurementStrip below
 * the order map. Everything is clickable; clicking a stop drills into
 * the matching filtered list.
 */
export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user?.name ?? "there";
  const role = session?.user?.role as Role | undefined;
  const isManagerScope = role === "ADMIN" || role === "MANAGER";
  const isDriver = role === "DELIVERY";
  const isHousekeeping = role === "HOUSEKEEPING_MANAGER";
  const isMaintenance = role === "MAINTENANCE_MANAGER";
  const isFnb = role === "FNB_SERVICE";
  const isChef = role === "KITCHEN_HEAD";
  const isSales = role === "SALES";
  const isStore = role === "STORE_KEEPER";

  // Kitchen head gets the action-first work-screen: every active order is a
  // card with its single next action inline (accept / raise request /
  // start cooking / mark done / dispatch). No drilling into detail pages.
  if (isChef) {
    const board = await listChefBoardOrders();
    return (
      <>
        <PageHeader
          eyebrow="Kitchen"
          title={`Welcome, ${name}`}
          description="Every order that needs you, with the next action on the card. Accept it, get ingredients, cook, mark done — then hand to delivery."
        />
        <div className="grid gap-5">
          <MyTasksPanel />
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
              customerName: o.customer.name,
              items: o.items.map((it) => ({ label: it.dish.name, portions: it.portions.toString() })),
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
        <PageHeader
          eyebrow="Sales"
          title={`Welcome, ${name}`}
          description="Your orders by stage. Submit drafts here; tap any order to see the detail."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/orders/new"><Button>Take new order</Button></Link>
              <Link href="/quotes/new"><Button variant="outline">Draft quote</Button></Link>
            </div>
          }
        />
        <div className="grid gap-5">
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
    const [chefReqs, prs] = await Promise.all([
      listChefRequisitions({
        status: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED],
      }),
      listPurchaseRequisitions({
        status: [
          PurchaseRequisitionStatus.DRAFT,
          PurchaseRequisitionStatus.PENDING_APPROVAL,
          PurchaseRequisitionStatus.APPROVED,
        ],
      }),
    ]);
    return (
      <>
        <PageHeader
          eyebrow="Store"
          title={`Welcome, ${name}`}
          description="Ingredient requests from the kitchen, and the stock requests you've raised. Open a request to issue line by line."
        />
        <div className="grid gap-5">
          <MyTasksPanel />
          <StoreBoard
            chefReqs={chefReqs.map((r) => ({
              id: r.id,
              requisitionNo: r.requisitionNo,
              status: r.status,
              orderCode: r.order.code,
              customerName: r.order.customer.name,
              eventDate: r.order.eventDate.toISOString(),
              lines: r._count.lines,
            }))}
            prs={prs.map((p) => ({
              id: p.id,
              prNo: p.prNo,
              status: p.status,
              requestedBy: p.requestedBy?.name ?? "—",
              lines: p._count.lines,
            }))}
          />
        </div>
      </>
    );
  }

  // Housekeeping manager gets a focused dashboard scoped to their module.
  // Skips the heavy operational getDashboardSummary call entirely.
  if (isHousekeeping) {
    return (
      <>
        <PageHeader
          eyebrow="Overview"
          title={`Welcome, ${name}`}
          description="Hotel-side stockroom. Record what maintenance hands over, then log every issue-to-room."
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
        <div className="grid gap-5">
          <MyTasksPanel />
          <HousekeepingPanel />
        </div>
      </>
    );
  }

  // Maintenance manager — same shape as housekeeping. Spares store + room
  // work-log live here; nothing else from the operational dashboard applies.
  if (isMaintenance) {
    return (
      <>
        <PageHeader
          eyebrow="Overview"
          title={`Welcome, ${name}`}
          description="Maintenance store + room work-log. Track every electrical / mechanical activity and which spares were used."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/maintenance/activities/new"><Button>Log activity</Button></Link>
              <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            </div>
          }
        />
        <div className="grid gap-5">
          <MyTasksPanel />
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
        <PageHeader
          eyebrow="Overview"
          title={`Welcome, ${name}`}
          description="Banquet store + service desk. Record stock IN from vendors and stock OUT to today's events."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
              <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            </div>
          }
        />
        <div className="grid gap-5">
          <MyTasksPanel />
          <BanquetPanel />
        </div>
      </>
    );
  }

  // Other roles fall through to the operational dashboard. Loaded here so
  // the housekeeping branch above doesn't pay the cost of the heavy query.
  const summary = await getDashboardSummary();

  // Admin / manager: pull the three approval queues for the inline
  // approvals board at the top of the operational dashboard.
  const approvals = isManagerScope
    ? await Promise.all([
        listOrders({ status: [OrderStatus.CHANGES_PROPOSED_BY_CHEF] }),
        listPurchaseRequisitions({ status: [PurchaseRequisitionStatus.PENDING_APPROVAL] }),
        listVendorPOs({ status: [VendorPOStatus.PENDING_APPROVAL] }),
      ])
    : null;

  // Drivers get a focused, single-purpose dashboard: just the deliveries
  // assigned to them. None of the order-map, AR, or procurement panels
  // apply to their work.
  if (isDriver) {
    const [pickups, myDeliveries] = await Promise.all([
      listReadyForDispatch(),
      listMyActiveDeliveries(),
    ]);
    return (
      <>
        <PageHeader
          eyebrow="Delivery"
          title={`Welcome, ${name}`}
          description="Your whole run in three tabs — take a cooked order, dispatch it, then mark it delivered. Every action is on the card."
        />
        <div className="grid gap-5">
          <MyTasksPanel />
          <DriverWorkScreen
            pickups={pickups.map((o) => ({
              id: o.id,
              code: o.code,
              channel: o.channel,
              eventDate: o.eventDate.toISOString(),
              roomNumber: o.roomNumber,
              deliveryAddress: o.deliveryAddress,
              customerName: o.customer.name,
            }))}
            deliveries={myDeliveries.map((d) => ({
              id: d.id,
              deliveryNo: d.deliveryNo,
              status: d.status,
              scheduledAt: d.scheduledAt.toISOString(),
              orderCode: d.order.code,
              channel: d.order.channel,
              roomNumber: d.order.roomNumber,
              deliveryAddress: d.order.deliveryAddress,
              customerName: d.order.customer.name,
            }))}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${name}`}
        description="Live map of today's operations. Click any stop to drill in."
      />

      <div className="grid gap-5">
        {/* 0 ─ Quick-create shortcuts. Top of the page so common
            create-flows (Take order, Add customer, Schedule delivery)
            are one click away. */}
        <QuickActions role={role} />

        {/* 0a ─ Manager/admin approvals board: chef-proposed order changes,
            stock requests, and POs — approve/reject inline. Hides itself
            when there's nothing waiting. */}
        {approvals && (
          <ManagerApprovalsBoard
            orderChanges={approvals[0].map((o) => ({
              id: o.id,
              code: o.code,
              customerName: o.customer.name,
              eventDate: o.eventDate.toISOString(),
              note: o.chefSuggestionNotes ?? null,
            }))}
            stockRequests={approvals[1].map((p) => ({
              id: p.id,
              prNo: p.prNo,
              requestedBy: p.requestedBy?.name ?? "—",
              orderCode: p.order?.code ?? null,
              lines: p._count.lines,
            }))}
            purchaseOrders={approvals[2].map((po) => ({
              id: po.id,
              poNo: po.poNo,
              vendor: po.vendor.name,
              grandTotal: po.grandTotal.toString(),
            }))}
          />
        )}

        {/* 1 ─ Personal task tray. Surfaces what's been assigned to *me*
            outside the operational workflow (one-off line-management
            asks). Hidden when the user has no tasks. */}
        <MyTasksPanel />

        {/* 1a ─ Team task oversight for admin / manager. Counts +
            long-pending list. Hidden when no tasks exist. */}
        {isManagerScope && <TasksAdminPanel />}

        {/* Cross-store consumption — admin/manager only. Hidden when
            none of the stores have any items yet. */}
        {isManagerScope && <StoresOverviewPanel />}

        {/* 1 ─ What needs you right now */}
        <ActionFeed
          role={role}
          kitchen={summary.kitchen}
          procurement={summary.procurement}
          storeKeeper={summary.storeKeeper}
          ar={summary.ar}
          todayDeliveries={summary.todayDeliveries}
          lowStockCount={summary.lowStockCount}
        />

        {/* 1b ─ Stock requests waiting on the admin / manager. Surfaces
            them as soon as the storekeeper raises one. */}
        {summary.adminPendingPRs && summary.adminPendingPRs.length > 0 && (
          <PendingStockRequests requests={summary.adminPendingPRs} />
        )}

        {/* 2 ─ Live order map. Falls back to the kitchen pipeline when
            the user is not admin/manager (chefs see kitchen counts as
            stage counts via `kitchen` instead of `stageCounts`). */}
        {(summary.stageCounts || summary.kitchen) && (
          <OrderJourneyStrip
            stageCounts={
              summary.stageCounts ??
              // Convert kitchen counts into the stageCounts shape so the
              // chef sees the same visual.
              {
                PENDING_CHEF_APPROVAL: summary.kitchen?.awaitingChefApproval ?? 0,
                CHEF_REQUISITION_PENDING: summary.kitchen?.requisitionPending ?? 0,
                ISSUING: summary.kitchen?.waitingOnStore ?? 0,
                READY_FOR_PRODUCTION: summary.kitchen?.readyToCook ?? 0,
                IN_PREP: summary.kitchen?.inProduction ?? 0,
                READY: summary.kitchen?.readyToDispatch ?? 0,
              }
            }
            stageStuck={summary.stageStuck}
          />
        )}

        {/* 3 ─ Today's orders + money. */}
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TodayTimeline orders={summary.todayOrdersList} />
          </div>
          {summary.ar ? (
            <ARDonut ar={summary.ar} />
          ) : summary.storeKeeper ? (
            <StockSnapshot storeKeeper={summary.storeKeeper} />
          ) : (
            <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[12.5px] text-ik-ink-3">
              Receivables panel is visible to admin / manager / accounts.
            </section>
          )}
        </div>

        {/* 3b ─ Money out (vendor payables) — same row as AR for the
            financial-facing roles. */}
        {summary.ap && (
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Cashflow KPI strip: this-month money-in vs money-out. */}
            <div className="lg:col-span-2 rounded-md border border-ik-rule bg-ik-card p-4">
              <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Cashflow this month</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11.5px] text-ik-ink-3">Money in (from customers)</div>
                  <div className="font-mono text-[20px] text-positive">₹{summary.ar?.collectedThisMonth ?? "0.00"}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-ik-ink-3">Money out (to vendors)</div>
                  <div className="font-mono text-[20px] text-ik-ink">₹{summary.ap.paidThisMonth}</div>
                </div>
              </div>
              <p className="mt-3 text-[11.5px] text-ik-ink-3">
                Click the donuts to drill into the relevant invoice / bill list.
              </p>
            </div>
            <APDonut ap={summary.ap} />
          </div>
        )}

        {/* 4 ─ Procurement chain (admin/manager only). */}
        {isManagerScope && summary.procurement && (
          <ProcurementStrip procurement={summary.procurement} />
        )}
      </div>
    </>
  );
}
