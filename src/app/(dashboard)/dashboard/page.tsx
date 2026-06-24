import type { Role } from "@prisma/client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
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
import { listReadyForDispatch, listMyActiveDeliveries } from "@/server/actions/deliveries";
import { SalesBoard } from "@/components/ik/dashboard/SalesBoard";
import { StoreBoard } from "@/components/ik/dashboard/StoreBoard";
import { ManagerApprovalsBoard } from "@/components/ik/dashboard/ManagerApprovalsBoard";
import { AccountsBoard } from "@/components/ik/dashboard/AccountsBoard";
import { listOrders } from "@/server/actions/orders";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { listPurchaseRequisitions } from "@/server/actions/purchase-requisitions";
import { listVendorPOs, listVendorBills } from "@/server/actions/procurement";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { LogBoard, type LogBucket } from "@/components/ik/dashboard/LogBoard";
import { listHousekeepingIssues } from "@/server/actions/housekeeping";
import { listMaintenanceActivities } from "@/server/actions/maintenance";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";
import {
  ChefRequisitionStatus, PurchaseRequisitionStatus, VendorPOStatus, OrderStatus,
  CustomerInvoiceStatus, VendorBillStatus,
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
  const isAccounts = role === "ACCOUNTS";

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
        <PageHeader
          eyebrow="Finance"
          title={`Welcome, ${name}`}
          description="Money to collect and money to pay, in two tabs. Mark anything paid right here."
        />
        <div className="grid gap-5">
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
        <PageHeader
          eyebrow="Housekeeping"
          title={`Welcome, ${name}`}
          description="Every issue-to-room, grouped by Today / This week / Earlier. Record new issues and receipts up top."
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
        <PageHeader
          eyebrow="Maintenance"
          title={`Welcome, ${name}`}
          description="Every electrical / mechanical activity, grouped by Today / This week / Earlier. Log new activities and receipts up top."
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/maintenance/activities/new"><Button>Log activity</Button></Link>
              <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            </div>
          }
        />
        <div className="grid gap-5">
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

  // ─── Admin / Manager launcher ─────────────────────────────────────────
  const firstName = name.split(" ")[0];
  const greeting = formatIST(new Date(), "EEEE, d MMMM · h:mm a");

  const proc = summary.procurement;
  const needPO = proc?.prApprovedNoPO ?? 0;
  const needMatch = proc?.billsPendingMatch ?? 0;
  const needPay = proc?.billsPendingPayment ?? 0;
  const needReorder = summary.lowStockCount;
  const attnCount = needPO + needMatch + needPay + needReorder;
  const attnBreakdown = [
    needPO ? `${needPO} PO` : null,
    needMatch ? `${needMatch} ${needMatch === 1 ? "bill" : "bills"} to match` : null,
    needPay ? `${needPay} to pay` : null,
    needReorder ? `${needReorder} to reorder` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const kWait = summary.kitchen?.waitingOnStore ?? 0;
  const billsToAction = needMatch + needPay;
  const tiles: TaskTile[] = [
    { key: "orders", icon: "orders", label: "Orders", status: `${summary.todayOrders} active today`, href: "/orders" },
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
    { label: "Raise stock request", href: "/procurement/purchase-requisitions/new" },
    { label: "Record supplier bill", href: "/procurement/vendor-bills/new" },
    { label: "Add stock receipt", href: "/inventory/receipts/new" },
    { label: "Assign task", href: "/tasks/admin" },
  ];

  return (
    <div className="grid gap-5">
      {/* 1 ─ Greeting (compact) */}
      <div>
        <div className="text-[12px] text-ik-ink-3">{greeting}</div>
        <h1 className="mt-0.5 text-[22px] font-medium text-ik-ink">Hi {firstName}</h1>
      </div>

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

      {/* 3a ─ Approvals: chef-proposed order changes, stock requests, POs —
          approve/reject inline. Self-hides when nothing is waiting. */}
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
