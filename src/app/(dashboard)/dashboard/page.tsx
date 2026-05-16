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
import { MyDeliveries } from "@/components/ik/dashboard/MyDeliveries";
import { MyStockRequests } from "@/components/ik/dashboard/MyStockRequests";
import { PendingStockRequests } from "@/components/ik/dashboard/PendingStockRequests";
import { MyTasksPanel } from "@/components/ik/dashboard/MyTasksPanel";
import { TasksAdminPanel } from "@/components/ik/dashboard/TasksAdminPanel";
import { HousekeepingPanel } from "@/components/ik/dashboard/HousekeepingPanel";
import { MaintenancePanel } from "@/components/ik/dashboard/MaintenancePanel";
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

  // Other roles fall through to the operational dashboard. Loaded here so
  // the housekeeping branch above doesn't pay the cost of the heavy query.
  const summary = await getDashboardSummary();

  // Drivers get a focused, single-purpose dashboard: just the deliveries
  // assigned to them. None of the order-map, AR, or procurement panels
  // apply to their work.
  if (isDriver) {
    return (
      <>
        <PageHeader
          eyebrow="Overview"
          title={`Welcome, ${name}`}
          description="Your assigned deliveries for today. Tap a row to dispatch or confirm hand-over."
        />
        <div className="grid gap-5">
          <MyTasksPanel />
          <MyDeliveries deliveries={summary.driver?.deliveries ?? []} />
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

        {/* 1 ─ Personal task tray. Surfaces what's been assigned to *me*
            outside the operational workflow (one-off line-management
            asks). Hidden when the user has no tasks. */}
        <MyTasksPanel />

        {/* 1a ─ Team task oversight for admin / manager. Counts +
            long-pending list. Hidden when no tasks exist. */}
        {isManagerScope && <TasksAdminPanel />}

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

        {/* 1c ─ Storekeeper's own raised requests, with live status —
            no need to dig into the procurement section. Always render
            (the panel handles the empty-state gracefully). */}
        {role === "STORE_KEEPER" && summary.storekeeperPRs && (
          <MyStockRequests requests={summary.storekeeperPRs} />
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
