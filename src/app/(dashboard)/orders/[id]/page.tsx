import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChefRequisitionStatus, IngredientReturnStatus, ManpowerRequestStatus, OrderChannel, OrderStatus, ProductionJobItemStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OrderStepper } from "@/components/ik/OrderStepper";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import {
  adminApproveOrder,
  cancelOrder,
  chefApproveOrder,
  closeOrder,
  forceDeliverOrder,
  getOrder,
  managerApproveChefSuggestion,
  submitOrder,
  swapOrderItemDish,
} from "@/server/actions/orders";
import { createCustomerInvoiceFromOrder } from "@/server/actions/customer-invoices";
import { getOrderBanquetLedger } from "@/server/actions/banquet";
import { listDishes } from "@/server/actions/dishes";
import { listAssignableUsers } from "@/server/actions/users";
import { listManpowerRequests } from "@/server/actions/manpower";
import { isEventDeliveryChannel, isImmediateChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { effectiveFigures, estimatedCost } from "@/lib/manpower";
import { computeRevisionBand, type RevisionBand } from "@/lib/order-revision";
import {
  FORCE_DELIVERABLE_ORDER_STATUSES,
  KITCHEN_COMMITTED_STATUSES,
  REQUISITION_ELIGIBLE_ORDER_STATUSES,
  REVISABLE_ORDER_STATUSES,
  STATUS_LABEL,
} from "@/lib/order-status";
import { formatINR, toDecimal } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";
import { HandoverChecklist } from "@/components/ik/HandoverChecklist";
import { StaffAllocation } from "@/components/ik/StaffAllocation";
import { LeftoverReturns } from "@/components/ik/LeftoverReturns";
import type { ActionResult } from "@/lib/action-result";
import { AdminApprovalBlock } from "./_components/AdminApprovalBlock";
import { ChefApprovalBlock } from "./_components/ChefApprovalBlock";
import { ManagerChangeBlock } from "./_components/ManagerChangeBlock";
import { OrderCostSummary } from "./_components/OrderCostSummary";
import { FeedbackAllocation } from "./_components/FeedbackAllocation";
import { RAISE_ROLES as MANPOWER_RAISE_ROLES, can } from "../../manpower/_components/gates";
import { STATUS_META as MANPOWER_STATUS_META } from "../../manpower/_components/display";
import { RETURN_STATUS_META } from "../../inventory/returns/_components/status";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, session] = await Promise.all([getOrder(id), auth()]);
  if (!order) notFound();
  // Only pull the dish catalogue when the chef-approval block is going
  // to render — saves a query on every other status.
  const dishesForSwap =
    order.status === "PENDING_CHEF_APPROVAL"
      ? await listDishes({ active: true })
      : [];
  // Hired labour tagged to this order. Read-only background information —
  // this page never reads a manpower status into any order decision, and
  // nothing below can change the order's own status.
  const manpowerRequests = await listManpowerRequests({
    orderId: order.id,
    statuses: Object.values(ManpowerRequestStatus),
  });
  const role = session?.user?.role;
  // In-house immediate channels skip admin sign-off and go straight to the
  // chef — the UI (button label, stepper, next-step hint) reflects that.
  const immediate = isImmediateChannel(order.channel);
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isAdmin || role === Role.MANAGER;
  // F&B Service (role DELIVERY / FNB_SERVICE) takes in-house room orders and
  // must be able to submit them too — otherwise their own drafts strand at
  // DRAFT with no action (they aren't sales, so the submit button was hidden).
  // submitOrder already admits these roles; only the button was gated wrong.
  // Catering submits still belong to sales / manager / admin.
  const isFnb = role === Role.DELIVERY || role === Role.FNB_SERVICE;
  const canSubmit = isSales || (isFnb && immediate);
  // Storekeeper (or admin/manager) issuing an ISSUING order: send them
  // straight to the still-open chef requisition. If every requisition was
  // cancelled there's nothing to issue against and the chef must re-raise.
  const canIssue = isManager || role === Role.STORE_KEEPER;
  const openRequisition = order.chefRequisitions.find(
    (r) =>
      r.status === ChefRequisitionStatus.SUBMITTED ||
      r.status === ChefRequisitionStatus.PARTIALLY_ISSUED,
  );
  // The order now advances to the kitchen once every requisition line has
  // been ACTED on (partial issues / shortfalls included), so an open
  // requisition can outlive ISSUING — keep the issue button up while there
  // is genuinely something left to issue and the order is still in play.
  const showIssueAction =
    canIssue &&
    openRequisition != null &&
    (
      [
        OrderStatus.ISSUING,
        OrderStatus.READY_FOR_PRODUCTION,
        OrderStatus.IN_PREP,
      ] as OrderStatus[]
    ).includes(order.status);

  // Feedback collection can be allocated once the order has been delivered.
  const feedbackEligible = (
    [OrderStatus.DELIVERED, OrderStatus.INVOICED, OrderStatus.PAID, OrderStatus.COMPLETED] as OrderStatus[]
  ).includes(order.status);
  const isAssignedForFeedback = order.feedbackAssigneeId === session?.user?.id;
  const showFeedback = feedbackEligible && (isManager || isAssignedForFeedback);
  // Only managers get the picker; load the staff list just for them.
  const feedbackUsers = showFeedback && isManager ? await listAssignableUsers() : [];

  // Pull any proforma invoice for this order so we can link it.
  const proforma = await db.customerInvoice.findFirst({
    where: { orderId: id, kind: "PROFORMA", status: { not: "CANCELLED" } },
    select: { id: true, invoiceNo: true, shareToken: true, emailedAt: true, emailedTo: true, grandTotal: true },
  });

  // ─── What came back from the event ───────────────────────────────────
  // Chef and manager read the kitchen side here without store access; the
  // record links mirror each action's own gate (recordIngredientReturn:
  // admin/manager/store keeper — recordBanquetReturn: those plus F&B).
  // Visibility is not permission: nothing on this panel records anything,
  // and none of it touches the order's status.
  const canRecordKitchenReturn = isManager || role === Role.STORE_KEEPER;
  // The chef's own half of the handover: declare what's going back. Mirrors
  // declareIngredientReturn's gate. Nothing here moves stock — the store's
  // confirmation does — which is exactly why the chef may do it.
  const canDeclareKitchenReturn = isManager || role === Role.KITCHEN_HEAD;
  const canRecordFnbReturn = isManager || isFnb || role === Role.STORE_KEEPER;
  // getOrderBanquetLedger has its own read gate — only call it for the roles
  // it admits, or the page throws for sales.
  const canSeeFnbLedger = canRecordFnbReturn || role === Role.ACCOUNTS;
  const [kitchenIssueCount, kitchenReturnLines, fnbLedger] = await Promise.all([
    db.ingredientIssue.count({ where: { orderId: id } }),
    db.ingredientReturnLine.findMany({
      where: { issue: { orderId: id } },
      orderBy: { return: { returnedAt: "desc" } },
      select: {
        id: true,
        quantity: true,
        declaredQuantity: true,
        reason: true,
        return: {
          select: {
            id: true,
            status: true,
            returnedAt: true,
            rejectionReason: true,
            recordedBy: { select: { name: true } },
          },
        },
        issue: { select: { ingredient: { select: { name: true, unit: true } } } },
      },
    }),
    canSeeFnbLedger ? getOrderBanquetLedger(id) : Promise.resolve([]),
  ]);
  // Nothing ever left the store for this order → nothing can come back.
  const showReturnsPanel = kitchenIssueCount > 0 || fnbLedger.length > 0;

  // ─── Kitchen → delivery handover (per dish) ──────────────────────────
  // Each dish is ticked the moment it's physically given to the delivery
  // team; the order-level handedToDeliveryAt completes when the last one is
  // ticked — so a late dish is attributable to the kitchen, not the driver.
  const productionJob = order.productionJobs[0] ?? null;
  const handoverItems = (productionJob?.items ?? []).map((it) => ({
    id: it.id,
    dishName: it.dish.name,
    portions: it.portions.toString(),
    status: it.status,
    handedOverAt: it.handedOverAt ? it.handedOverAt.toISOString() : null,
    handedOverBy: it.handedOverBy?.name ?? null,
  }));
  const READY_OR_LATER: OrderStatus[] = [
    OrderStatus.READY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.INVOICED,
    OrderStatus.PAID,
    OrderStatus.COMPLETED,
  ];
  const showHandoverChecklist =
    productionJob !== null &&
    handoverItems.length > 0 &&
    isEventDeliveryChannel(order.channel) &&
    READY_OR_LATER.includes(order.status);
  // Whether the viewer may actually tick items (server re-checks anyway).
  const canHandOver =
    isManager || isChef || role === Role.DELIVERY || role === Role.FNB_SERVICE;
  // Who may allocate / remove serving staff (server re-checks anyway). The
  // same set may log leftover returns.
  const canAllocateStaff =
    isManager || role === Role.FNB_SERVICE || role === Role.DELIVERY;
  // Raising a manpower request — a different thing from allocating our own
  // serving staff above, and a different role set (the chef raises these).
  const canRequestManpower = can(role, MANPOWER_RAISE_ROLES);
  // Leftover returns only apply to walk-up counter sales and outdoor catering.
  const showLeftovers =
    order.channel === OrderChannel.COUNTER_SALE || order.channel === OrderChannel.ODC;
  // Accountability timeline: every handed dish, in handover order.
  const handedTimeline = (productionJob?.items ?? [])
    .filter((it) => it.handedOverAt != null)
    .sort((a, b) => a.handedOverAt!.getTime() - b.handedOverAt!.getTime());
  // "Last dish handed over X min before/after the delivery window start" —
  // only meaningful once every live dish is out the door.
  const liveHandoverItems = (productionJob?.items ?? []).filter(
    (it) => it.status !== ProductionJobItemStatus.CANCELLED,
  );
  const allItemsHanded =
    liveHandoverItems.length > 0 && liveHandoverItems.every((it) => it.handedOverAt != null);
  const lastHandedAt = allItemsHanded
    ? handedTimeline[handedTimeline.length - 1].handedOverAt!
    : null;
  const windowDeltaMin =
    lastHandedAt != null
      ? Math.round((lastHandedAt.getTime() - order.deliveryWindowStart.getTime()) / 60000)
      : null;

  // ─── Server-action shims ───────────────────────────────────────────
  async function doSubmit() {
    "use server";
    return await submitOrder(id);
  }
  async function doChefApprove(note: string) {
    "use server";
    return await chefApproveOrder(id, { decision: "APPROVED", note });
  }
  async function doChefSuggest(note: string) {
    "use server";
    return await chefApproveOrder(id, { decision: "SUGGESTED_CHANGES", note });
  }
  async function doApplySwap(orderItemId: string, newDishId: string, reason: string) {
    "use server";
    return await swapOrderItemDish(id, orderItemId, newDishId, reason || null);
  }
  async function doManagerApproveChanges(note: string) {
    "use server";
    return await managerApproveChefSuggestion(id, { decision: "APPROVED", note: note || undefined });
  }
  async function doManagerRejectChanges(note: string) {
    "use server";
    return await managerApproveChefSuggestion(id, { decision: "REJECTED", note: note || undefined });
  }
  async function doAdminApprove(note: string) {
    "use server";
    return await adminApproveOrder(id, { decision: "APPROVED", note });
  }
  async function doAdminReject(note: string) {
    "use server";
    return await adminApproveOrder(id, { decision: "REJECTED", note });
  }
  async function doCancel(reason: string) {
    "use server";
    return await cancelOrder(id, reason);
  }
  async function doClose() {
    "use server";
    return await closeOrder(id);
  }
  async function doForceDeliver(reason: string) {
    "use server";
    return await forceDeliverOrder(id, reason);
  }
  async function doGenerateInvoice() {
    "use server";
    const result = await createCustomerInvoiceFromOrder(id);
    if (!result.ok) return result;
    redirect(`/invoices/${result.id}`);
  }
  async function doIngredientsAvailable() {
    "use server";
    const { markIngredientsAvailable } = await import(
      "@/server/actions/chef-requisitions"
    );
    return await markIngredientsAvailable(id);
  }
  async function doMarkServed() {
    "use server";
    const { markInHouseServed } = await import("@/server/actions/orders");
    return await markInHouseServed(id);
  }

  // ─── Approval block selection ────────────────────────────────────────
  // Chef sees the chef-approval block when order is PENDING_CHEF_APPROVAL.
  // Manager sees the changes-review block when order is CHANGES_PROPOSED_BY_CHEF.
  // First commercial gate is the manager's (admin may also act). The enum is
  // still named PENDING_ADMIN_APPROVAL for historical reasons.
  const showAdminBlock = isManager && order.status === OrderStatus.PENDING_ADMIN_APPROVAL;
  const showChefBlock = isChef && order.status === OrderStatus.PENDING_CHEF_APPROVAL;
  const showManagerChangesBlock = isManager && order.status === OrderStatus.CHANGES_PROPOSED_BY_CHEF;
  // The chef sees the order as a cooking brief — no pricing, no
  // invoices, no margin. They need dish + portions + notes only.
  const chefOnlyView = role === Role.KITCHEN_HEAD;

  // How loudly this order's revisions need reading — the same banding the
  // reviseOrder gate applies. A CRITICAL one is lifted out of the left column
  // and put above everything else: whoever opens this order has to see the
  // change before they act on anything stale below it.
  const revisionBand: RevisionBand | null =
    order.orderRevisions.length > 0
      ? computeRevisionBand({ eventDate: order.eventDate, status: order.status })
      : null;
  const revisionPanel = revisionBand && (
    <RevisionsPanel
      revisions={order.orderRevisions}
      band={revisionBand}
      chefOnlyView={chefOnlyView}
    />
  );

  return (
    <>
      <PageHeader
        eyebrow="Order"
        title={`${order.code} · ${order.customer.name}`}
        description={
          chefOnlyView
            ? `${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase().replaceAll("_", " ")} for ${order.headcount}`
            : `${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase().replaceAll("_", " ")} for ${order.headcount} · ${formatINR(order.contractValue)}`
        }
        actions={
          <div className="flex gap-2">
            <Link href="/orders"><Button variant="outline">Back</Button></Link>
            {!chefOnlyView && (
              <Link href={`/orders/${order.id}/pnl`}><Button variant="outline">P&amp;L</Button></Link>
            )}
            {(isManager || role === Role.ACCOUNTS) && (
              <Link href={`/orders/${order.id}/trail`}><Button variant="outline">Trail</Button></Link>
            )}
            {showIssueAction && openRequisition && (
              <Link href={`/requisitions/${openRequisition.id}`}>
                <Button>Issue ingredients</Button>
              </Link>
            )}
            {order.status === OrderStatus.DRAFT && canSubmit && (
              <ActionResultButton
                action={doSubmit}
                successMessage={immediate ? "Sent to the kitchen" : "Submitted for manager approval"}
              >
                {immediate ? "Submit to kitchen" : "Submit for manager approval"}
              </ActionResultButton>
            )}
            {/* Mid-flight quantity revision (client changed pax) — sales /
                manager / admin, while the order is still in the kitchen's
                hands. The action re-checks role, status and the 24h rule. */}
            {isSales && REVISABLE_ORDER_STATUSES.includes(order.status) && (
              <Link href={`/orders/${order.id}/revise`}>
                <Button variant="outline">Revise order</Button>
              </Link>
            )}
            {/* Past the point of no return, the button stays visible but dead
                with the reason on it — silently hiding it just sends people
                hunting for a control they remember being there. */}
            {isSales && KITCHEN_COMMITTED_STATUSES.includes(order.status) && (
              <Button
                variant="outline"
                disabled
                title={`Already ${STATUS_LABEL[order.status].toLowerCase()} — ingredients are issued and the kitchen is working to these numbers. Speak to the chef directly.`}
              >
                Revise order — already {STATUS_LABEL[order.status].toLowerCase()}
              </Button>
            )}
            {/* Tax invoice is generated manually by accounts/admin/manager
                once the order has been delivered. They then download +
                email the PDF to the customer from the invoice detail
                page. Payment-on-delivery (if any) is credited against
                the invoice when it's created. */}
            {order.status === OrderStatus.DELIVERED && (role === Role.ACCOUNTS || isAdmin || isManager) && (
              <ActionResultButton action={doGenerateInvoice}>
                Generate tax invoice
              </ActionResultButton>
            )}
          </div>
        }
      />

      {/* Horizontal flow stepper — visible to everyone */}
      <div className="mb-6">
        <OrderStepper current={order.status} immediate={immediate} />
      </div>

      {/* Status-aware "what happens next" panel. Always visible so anyone
          looking at the order knows whose move it is. */}
      <OrderNextStep
        status={order.status}
        orderId={order.id}
        orderCode={order.code}
        role={role}
        immediate={immediate}
        hasRequisitions={order.chefRequisitions.length > 0}
        openRequisitionId={openRequisition?.id ?? null}
        onIngredientsAvailable={doIngredientsAvailable}
        onMarkServed={doMarkServed}
      />

      {revisionBand === "CRITICAL" && <div className="mb-6">{revisionPanel}</div>}

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-6">
          {/* Approval blocks (conditional) */}
          {showAdminBlock && (
            <AdminApprovalBlock onApprove={doAdminApprove} onReject={doAdminReject} />
          )}
          {showChefBlock && (
            <ChefApprovalBlock
              onApprove={doChefApprove}
              onSuggest={doChefSuggest}
              onApplySwap={doApplySwap}
              orderItems={order.items.map((it) => ({
                id: it.id,
                label: it.dish.name,
                portions: `${it.portions.toString()} ${it.dish.unit}`,
              }))}
              dishes={dishesForSwap.map((d) => ({ id: d.id, name: d.name, code: d.code }))}
            />
          )}
          {showManagerChangesBlock && (
            <ManagerChangeBlock
              chefNote={order.chefSuggestionNotes ?? ""}
              chefName={order.chefReviewedBy?.name ?? "the chef"}
              onApprove={doManagerApproveChanges}
              onReject={doManagerRejectChanges}
            />
          )}

          {/* Kitchen → delivery handover checklist — per-dish ticks so a
              late dish is attributable to the kitchen, not the driver. */}
          {showHandoverChecklist && productionJob && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Handover to delivery</h3>
              <p className="mb-2 text-[11.5px] text-ik-ink-3">
                Tick each dish the moment it&apos;s physically handed to the delivery team. The
                order-level handover completes automatically when the last dish is ticked.
              </p>
              <HandoverChecklist
                jobId={productionJob.id}
                items={handoverItems}
                readOnly={!canHandOver}
              />
            </section>
          )}

          {/* Revisions — what the manager changed mid-flight, in plain words.
              A CRITICAL one is hoisted above the grid instead (see above), so
              only the calmer bands sit down here in the column. */}
          {revisionBand !== "CRITICAL" && revisionPanel}

          {/* Decision history */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Decision history</h3>
            <ol className="grid gap-2 text-[12.5px]">
              <li>
                <span className="text-ik-ink-3">Created</span>{" "}
                <span className="font-mono">{formatIST(order.createdAt)}</span>
                {order.createdBy?.name && <span className="text-ik-ink-3"> · by {order.createdBy.name}</span>}
              </li>
              {order.submittedAt && (
                <li>
                  <span className="text-ik-ink-3">Submitted for chef approval</span>{" "}
                  <span className="font-mono">{formatIST(order.submittedAt)}</span>
                </li>
              )}
              {order.chefReviewedAt && (
                <li>
                  <span className="text-ik-ink-3">Chef</span>{" "}
                  <span className="font-medium">
                    {order.chefDecision === "APPROVED" ? "approved" : "proposed changes"}
                  </span>{" "}
                  <span className="font-mono">{formatIST(order.chefReviewedAt)}</span>
                  {order.chefReviewedBy?.name && <span className="text-ik-ink-3"> · {order.chefReviewedBy.name}</span>}
                  {order.chefSuggestionNotes && (
                    <div className="mt-1 border-l-2 border-ik-rule pl-2 italic text-ik-ink-2">
                      {order.chefSuggestionNotes}
                    </div>
                  )}
                </li>
              )}
              {order.managerChangeReviewedAt && (
                <li>
                  <span className="text-ik-ink-3">Manager (on chef&apos;s changes)</span>{" "}
                  <span className="font-medium">
                    {order.managerChangeDecision === "APPROVED" ? "approved" : "rejected"}
                  </span>{" "}
                  <span className="font-mono">{formatIST(order.managerChangeReviewedAt)}</span>
                  {order.managerChangeReviewedBy?.name && (
                    <span className="text-ik-ink-3"> · {order.managerChangeReviewedBy.name}</span>
                  )}
                  {order.managerChangeNote && (
                    <div className="mt-1 border-l-2 border-ik-rule pl-2 italic text-ik-ink-2">
                      {order.managerChangeNote}
                    </div>
                  )}
                </li>
              )}
              {/* Per-item handover timeline — dish → time → by whom. Shows
                  up as soon as the first dish goes out, so a late dish is
                  visible (and attributable) immediately. */}
              {handedTimeline.map((it) => (
                <li key={it.id}>
                  <span className="text-ik-ink-3">Handed to delivery</span>{" "}
                  <span className="font-medium">{it.dish.name}</span>{" "}
                  <span className="font-mono">{formatIST(it.handedOverAt!, "HH:mm")}</span>
                  {it.handedOverBy?.name && (
                    <span className="text-ik-ink-3"> · by {it.handedOverBy.name}</span>
                  )}
                </li>
              ))}
              {windowDeltaMin != null && (
                <li
                  className={
                    windowDeltaMin <= 0
                      ? "text-positive"
                      : windowDeltaMin <= 15
                        ? "text-amber"
                        : "text-alert"
                  }
                >
                  Last dish handed over{" "}
                  <span className="font-mono">{Math.abs(windowDeltaMin)}</span> min{" "}
                  {windowDeltaMin <= 0 ? "before" : "after"} the delivery window start
                </li>
              )}
              {order.cancelledAt && (
                <li className="text-alert">
                  Cancelled · <span className="font-mono">{formatIST(order.cancelledAt)}</span>
                  {order.cancellationReason && <span> · {order.cancellationReason}</span>}
                </li>
              )}
            </ol>
          </section>

          {/* Items — pricing columns hidden for the chef, who only needs
              dish name + portions to plan production. */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">
              {chefOnlyView ? "Items to prepare" : "Items"}
            </h3>
            {(() => {
              // Package-priced channels (banquet / buffet / ODC / packet)
              // show items as sub-heads with no rate column — only the
              // package total applies. Chef view is already qty-only; the
              // per-dish channels keep full columns.
              const packageMode = isPackagePricedChannel(order.channel);
              if (packageMode) {
                return (
                  <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
                    <p className="mb-3 text-[12px] text-ik-ink-3">
                      {{ BANQUET: "Banquet", BUFFET: "Buffet", ODC: "Outdoor catering", PACKET: "Packet food" }[order.channel as string] ?? order.channel}{" "}
                      package — items included, no per-item pricing:
                    </p>
                    <ul className="grid list-disc gap-1 pl-5 text-[13px]">
                      {order.items.map((it) => (
                        <li key={it.id}>{it.dish.name}</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[12.5px] text-ik-ink-2">
                      Package total: <span className="font-mono">{order.contractValue.toString()}</span>
                    </p>
                  </div>
                );
              }
              return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dish</TableHead>
                      <TableHead className="text-right">Portions</TableHead>
                      {!chefOnlyView && <TableHead className="text-right">Unit ₹</TableHead>}
                      {!chefOnlyView && <TableHead className="text-right">Disc %</TableHead>}
                      {!chefOnlyView && <TableHead className="text-right">GST %</TableHead>}
                      {!chefOnlyView && <TableHead className="text-right">Total ₹</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>{it.dish.name}</TableCell>
                        <TableCell className="text-right font-mono">{it.portions.toString()}</TableCell>
                        {!chefOnlyView && <TableCell className="text-right font-mono">{it.unitPrice.toString()}</TableCell>}
                        {!chefOnlyView && <TableCell className="text-right font-mono">{it.discountPct.toString()}</TableCell>}
                        {!chefOnlyView && <TableCell className="text-right font-mono">{it.gstRatePct.toString()}</TableCell>}
                        {!chefOnlyView && <TableCell className="text-right font-mono">{it.lineTotal.toString()}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              );
            })()}
          </section>

          {/* Proforma invoice — financial document, hidden from the chef. */}
          {!chefOnlyView && proforma && (
            <section className="rounded-md border border-brand-200 bg-brand-50 p-4 text-[13px]">
              <h3 className="mb-2 font-medium text-brand-700">Proforma invoice</h3>
              <p className="mb-2 text-ik-ink-2">
                Auto-generated when the order was approved.{" "}
                {proforma.emailedAt ? (
                  <>
                    Emailed to <strong>{proforma.emailedTo}</strong> at{" "}
                    <span className="font-mono">{formatIST(proforma.emailedAt)}</span>.
                  </>
                ) : (
                  <span className="text-amber">Not emailed yet (check customer email on file).</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/invoices/${proforma.id}`}><Button size="sm" variant="outline">Open invoice</Button></Link>
                <Link href={`/api/invoices/${proforma.id}/pdf`} target="_blank"><Button size="sm" variant="outline">Download PDF</Button></Link>
                <Link href={`/i/${proforma.shareToken}`} target="_blank"><Button size="sm" variant="outline">Customer view</Button></Link>
              </div>
            </section>
          )}

          {/* Cost + profitability — admin / manager / accounts only. Chef
              and driver are intentionally kept out of the financial view. */}
          {(isAdmin || isManager || role === Role.ACCOUNTS) && (
            <OrderCostSummary orderId={order.id} />
          )}

          {showFeedback && (
            <FeedbackAllocation
              orderId={order.id}
              canAllocate={isManager}
              assigneeName={order.feedbackAssignee?.name ?? null}
              rating={order.feedbackRating}
              comment={order.feedbackComment}
              users={feedbackUsers.map((u) => ({ id: u.id, name: u.name }))}
            />
          )}

          {/* Chef requisition block */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Chef requisitions</h3>
            {order.chefRequisitions.length === 0 ? (
              <p className="text-[12.5px] text-ik-ink-3">No requisitions yet.</p>
            ) : (
              <ul className="grid gap-1 text-[13px]">
                {order.chefRequisitions.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requisitions/${r.id}`} className="font-mono text-brand hover:underline">
                      {r.requisitionNo}
                    </Link>
                    <span className="ml-2 text-ik-ink-3">· {r.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* Chef/admin can raise a requisition through the whole issuing +
                cooking window, not just at CHEF_REQUISITION_PENDING — a top-up
                is needed when a revision bumps pax after issuing/cooking began.
                Label reflects whether this is the first or an additional one. */}
            {isChef && REQUISITION_ELIGIBLE_ORDER_STATUSES.includes(order.status) && (
              <Link href={`/orders/${order.id}/requisition`} className="mt-2 inline-block">
                <Button size="sm">
                  {order.chefRequisitions.length > 0 ? "Raise another requisition" : "Raise requisition"}
                </Button>
              </Link>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="grid gap-4">
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Delivery</h3>
            <div className="grid gap-1">
              <div><span className="text-ik-ink-3">Address:</span> {order.deliveryAddress}</div>
              <div>
                <span className="text-ik-ink-3">Window:</span>{" "}
                <span className="font-mono">{formatIST(order.deliveryWindowStart, "HH:mm")} – {formatIST(order.deliveryWindowEnd, "HH:mm")}</span>
              </div>
              <div><span className="text-ik-ink-3">Place of supply:</span> {order.placeOfSupplyStateCode}</div>
            </div>
          </section>

          {/* Serving staff — the named F&B crew allocated to run the event.
              Visible to every role that can open the page; editable by
              admin / manager / F&B service / delivery. Our own people, no
              money: hired-in labour is the separate panel below. */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
            <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Serving staff</h3>
            <p className="mb-2 text-[12px] text-ik-ink-3">Our own crew, named for this event. No cost attached.</p>
            {order.staffAllocations.length === 0 && !canAllocateStaff && (
              <p className="text-[12.5px] text-ik-ink-3">No staff allocated yet.</p>
            )}
            <StaffAllocation
              orderId={order.id}
              staff={order.staffAllocations}
              canEdit={canAllocateStaff}
            />
          </section>

          {/* Hired manpower — casual labour brought in for this event, with a
              cost, a manager's approval and a payment. Deliberately alongside
              rather than in the order's flow: the request runs in the
              background and never holds the order up. */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
            <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Hired manpower</h3>
            <p className="mb-2 text-[12px] text-ik-ink-3">
              Casual labour hired in, at a cost, approved by a manager. Runs alongside this order — nothing here holds it up.
            </p>
            {manpowerRequests.length === 0 ? (
              <p className="text-[12.5px] text-ik-ink-3">None requested for this order.</p>
            ) : (
              <ul className="grid gap-2">
                {manpowerRequests.map((m) => {
                  const figures = effectiveFigures(m);
                  const meta = MANPOWER_STATUS_META[m.status];
                  return (
                    <li key={m.id} className="grid gap-0.5">
                      <Link href={`/manpower/${m.id}`} className="text-brand hover:underline">
                        {m.workDescription}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                        <span className="font-mono text-[12px] text-ik-ink-2">
                          {figures.people} × {figures.days}d · {formatINR(estimatedCost(m))}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {canRequestManpower && (
              <Link href={`/manpower/new?orderId=${order.id}`} className="mt-3 inline-block">
                <Button size="sm" variant="outline">Request manpower</Button>
              </Link>
            )}
          </section>

          {/* Leftovers returned — counter-sale / ODC only. A traceability log
              of surplus food and where it went; no stock movement. */}
          {showLeftovers && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Leftovers returned</h3>
              {order.leftoverReturns.length === 0 && !canAllocateStaff && (
                <p className="text-[12.5px] text-ik-ink-3">No leftovers logged.</p>
              )}
              <LeftoverReturns
                orderId={order.id}
                orderItems={order.items.map((it) => it.dish.name)}
                leftovers={order.leftoverReturns.map((l) => ({
                  id: l.id,
                  itemName: l.itemName,
                  quantity: l.quantity.toString(),
                  unit: l.unit,
                  disposition: l.disposition,
                  note: l.note,
                }))}
                canEdit={canAllocateStaff}
              />
            </section>
          )}

          {/* Returned to store — what physically came back from this event.
              ONE panel covering both stores rather than two more boxes: the
              chef hands surplus ingredients back and the F&B crew hands
              cutlery back in the same conversation with the store, and this
              column already carries four operational panels. It sits next to
              "Leftovers returned" so everything that comes back off an event
              reads together — leftovers being the food-traceability log, this
              being the stock that goes back on the shelf. */}
          {showReturnsPanel && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
              <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Returned to store</h3>
              <p className="mb-3 text-[12px] text-ik-ink-3">
                Stock handed back after the event. The chef declares what&apos;s going back, the store
                confirms what arrived — and that confirmation is what puts it on the shelf as
                sellable stock and credits this order.
              </p>

              {kitchenIssueCount > 0 && (
                <div className="grid gap-1">
                  <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                    Kitchen ingredients
                  </div>
                  {kitchenReturnLines.length === 0 ? (
                    <p className="text-[12.5px] text-ik-ink-3">Nothing returned yet.</p>
                  ) : (
                    <ul className="grid gap-1">
                      {kitchenReturnLines.map((l) => {
                        const meta = RETURN_STATUS_META[l.return.status];
                        const declared = l.declaredQuantity;
                        // Only worth spelling out when the store received
                        // something other than what was declared — that gap
                        // is the point of the two-step.
                        const short =
                          declared != null &&
                          l.return.status === IngredientReturnStatus.CONFIRMED &&
                          !toDecimal(l.quantity).eq(toDecimal(declared));
                        return (
                          <li key={l.id} className="grid gap-0.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span>
                                {l.issue.ingredient.name}
                                <span className="ml-1 text-[11.5px] text-ik-ink-3">
                                  {l.reason} · {formatIST(l.return.returnedAt, "d MMM")}
                                </span>
                              </span>
                              <span className="shrink-0 font-mono text-[12px]">
                                {l.quantity.toString()} {l.issue.ingredient.unit}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ik-ink-3">
                              <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                              {declared != null && (
                                <span>declared by {l.return.recordedBy.name}</span>
                              )}
                              {short && (
                                <span className="font-medium text-amber-700">
                                  declared {declared!.toString()} {l.issue.ingredient.unit}, received{" "}
                                  {l.quantity.toString()}
                                </span>
                              )}
                              {l.return.status === IngredientReturnStatus.REJECTED &&
                                l.return.rejectionReason && (
                                  <span className="text-alert">{l.return.rejectionReason}</span>
                                )}
                              <Link
                                href={`/inventory/returns/${l.return.id}`}
                                className="text-brand hover:underline"
                              >
                                open
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {canDeclareKitchenReturn && (
                      <Link href={`/inventory/returns/declare?orderId=${order.id}`}>
                        <Button size="sm" variant="outline">Declare leftover return</Button>
                      </Link>
                    )}
                    {canRecordKitchenReturn && (
                      <Link href={`/inventory/returns/new?orderId=${order.id}`}>
                        <Button size="sm" variant="outline">Record kitchen return</Button>
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {fnbLedger.length > 0 && (
                <div className={"grid gap-1" + (kitchenIssueCount > 0 ? " mt-4" : "")}>
                  <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                    F&amp;B store items
                  </div>
                  <ul className="grid gap-1">
                    {fnbLedger.map((r) => (
                      <li key={r.itemId} className="flex items-baseline justify-between gap-2">
                        <span>{r.name}</span>
                        <span className="shrink-0 font-mono text-[12px]">
                          {r.returned}/{r.issued} back
                          {Number(r.outstanding) > 0 && (
                            <span className="ml-1 text-amber-700">· {r.outstanding} out</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {canRecordFnbReturn && (
                    <Link href={`/banquet/returns/${order.id}`} className="mt-1 inline-block">
                      <Button size="sm" variant="outline">Record F&amp;B return</Button>
                    </Link>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Customer</h3>
            <div className="grid gap-1">
              {chefOnlyView ? (
                <span>{order.customer.name}</span>
              ) : (
                <Link href={`/customers/${order.customer.id}`} className="text-brand hover:underline">
                  {order.customer.name}
                </Link>
              )}
              {/* GSTIN + email-warning are sales/finance signals. Hide
                  them from the chef so the panel reads as a contact card. */}
              {!chefOnlyView && order.customer.gstin && (
                <div className="font-mono text-[12px] text-ik-ink-2">{order.customer.gstin}</div>
              )}
              {order.customer.contactName && <div>{order.customer.contactName}</div>}
              {order.customer.phone && <div className="text-ik-ink-2">{order.customer.phone}</div>}
              {!chefOnlyView && (order.customer.email ? (
                <div className="text-ik-ink-2">{order.customer.email}</div>
              ) : (
                <div className="rounded bg-amber-wash px-2 py-1 text-[11.5px] text-amber">
                  ⚠ No email on file — proforma won&apos;t be auto-sent. Add an email on the customer page.
                </div>
              ))}
            </div>
          </section>

          {(isAdmin || isManager) && order.status === OrderStatus.PAID && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
              <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Close order</h3>
              <p className="mb-3 text-ik-ink-2">
                Payment is settled. Close the order to move it to Completed.
              </p>
              <ActionResultButton action={doClose} successMessage="Order closed">
                Close order
              </ActionResultButton>
            </section>
          )}

          {/* Admin/manager escape hatch for an order the team actually
              completed while the paperwork stalled mid-flow. Skips the
              remaining steps straight to Delivered so it can be invoiced,
              and closes the open store/kitchen work behind it. */}
          {(isAdmin || isManager) && FORCE_DELIVERABLE_ORDER_STATUSES.includes(order.status) && (
            <ActionReasonForm
              action={doForceDeliver}
              heading="Mark as delivered (override)"
              description="Use when the event was cooked and served but the order stalled here. Jumps it to Delivered so you can raise the invoice, and clears any open store or kitchen work for it."
              placeholder="Why is this being forced through?"
              submitLabel="Mark delivered"
              successMessage="Order marked delivered — you can invoice it now"
              tone="warning"
            />
          )}

          {(isAdmin || isManager) &&
            order.status !== OrderStatus.CANCELLED &&
            order.status !== OrderStatus.PAID &&
            order.status !== OrderStatus.COMPLETED && (
              <ActionReasonForm
                action={doCancel}
                heading="Cancel order"
                description="Stops the event and closes any open store, kitchen and delivery work for it."
                submitLabel="Cancel order"
                successMessage="Order cancelled"
              />
            )}
        </aside>
      </div>
    </>
  );
}

type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

/** How each band dresses the revisions panel. No motion of any kind: a
 *  revision people miss is a real problem, but a flashing panel is a worse
 *  one (WCAG 2.3.1) — the weight comes from colour and position instead. */
const REVISION_SKIN: Record<RevisionBand, { shell: string; heading: string; pill: PillTone; pillLabel: string }> = {
  CRITICAL: { shell: "border-alert bg-alert-wash", heading: "text-alert", pill: "red", pillLabel: "Critical" },
  URGENT: { shell: "border-amber bg-amber-wash/60", heading: "text-amber-700", pill: "amber", pillLabel: "Urgent" },
  NORMAL: { shell: "border-amber/40 bg-amber-wash/30", heading: "text-amber-700", pill: "grey", pillLabel: "Revised" },
};

/**
 * What the manager changed mid-flight, in plain words. The chef cooks from
 * this, so it's visible to every role; only the money line is hidden from the
 * chef view. Banded by how much the change is going to hurt — CRITICAL is
 * rendered above the fold by the caller, not tucked into the column.
 */
function RevisionsPanel({
  revisions,
  band,
  chefOnlyView,
}: {
  revisions: OrderDetail["orderRevisions"];
  band: RevisionBand;
  chefOnlyView: boolean;
}) {
  const skin = REVISION_SKIN[band];
  return (
    <section className={"rounded-2xl border shadow-ik-card p-4 " + skin.shell}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className={"font-medium text-[14px] " + skin.heading}>
          Order revised {revisions.length > 1 ? `${revisions.length} times` : ""}
        </h3>
        <StatusPill tone={skin.pill}>{skin.pillLabel}</StatusPill>
      </div>
      {band === "CRITICAL" && (
        <p className="mb-3 text-[12.5px] text-ik-ink">
          The event is nearly here, or the kitchen is already working this order. Read this before
          acting on anything else on the page — the dishes and quantities below have changed.
        </p>
      )}
      <ol className="grid gap-3">
        {revisions.map((rev) => {
          const changes = (rev.lineChanges ?? []) as Array<{
            kind: "added" | "removed" | "portions";
            dish: string;
            from?: string;
            to?: string;
          }>;
          const paxChanged = rev.beforeHeadcount !== rev.afterHeadcount;
          const dateChanged = rev.beforeEventDate.getTime() !== rev.afterEventDate.getTime();
          const mealChanged = rev.beforeMealType !== rev.afterMealType;
          const valueChanged = rev.beforeContractValue.toString() !== rev.afterContractValue.toString();
          return (
            <li key={rev.id} className="rounded-xl border border-ik-rule bg-ik-card p-3 text-[12.5px]">
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ik-ink">{rev.revisedBy.name}</span>
                <span className="font-mono text-[11px] text-ik-ink-3">{formatIST(rev.createdAt)}</span>
              </div>
              <ul className="grid gap-1 text-ik-ink-2">
                {paxChanged && (
                  <li>
                    Pax: <s className="text-ik-ink-3">{rev.beforeHeadcount}</s>{" "}
                    <strong className="text-ik-ink">→ {rev.afterHeadcount}</strong>
                  </li>
                )}
                {dateChanged && (
                  <li>
                    Event: <s className="text-ik-ink-3">{formatIST(rev.beforeEventDate, "EEE d MMM HH:mm")}</s>{" "}
                    <strong className="text-ik-ink">→ {formatIST(rev.afterEventDate, "EEE d MMM HH:mm")}</strong>
                  </li>
                )}
                {mealChanged && (
                  <li>
                    Meal: <s className="text-ik-ink-3">{rev.beforeMealType.replace("_", " ")}</s>{" "}
                    <strong className="text-ik-ink">→ {rev.afterMealType.replace("_", " ")}</strong>
                  </li>
                )}
                {!chefOnlyView && valueChanged && (
                  <li>
                    Value: <s className="text-ik-ink-3">{formatINR(rev.beforeContractValue)}</s>{" "}
                    <strong className="text-ik-ink">→ {formatINR(rev.afterContractValue)}</strong>
                  </li>
                )}
                {changes.map((c, i) => (
                  <li key={i}>
                    {c.kind === "added" && (
                      <>Added <strong className="text-ik-ink">{c.dish}</strong> · {c.to} portions</>
                    )}
                    {c.kind === "removed" && (
                      <>Removed <s className="text-ik-ink-3">{c.dish}</s></>
                    )}
                    {c.kind === "portions" && (
                      <>
                        {c.dish}: <s className="text-ik-ink-3">{c.from}</s>{" "}
                        <strong className="text-ik-ink">→ {c.to} portions</strong>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {rev.note && (
                <p className="mt-2 rounded-md bg-ik-paper-alt px-2 py-1.5 italic text-ik-ink">
                  “{rev.note}” <span className="not-italic text-ik-ink-3">— {rev.revisedBy.name}</span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface OrderNextStepProps {
  status: OrderStatus;
  orderId: string;
  orderCode: string;
  role: Role | undefined;
  /** In-house immediate channel — submit goes straight to the chef. */
  immediate: boolean;
  hasRequisitions: boolean;
  /** The order's still-open chef requisition (SUBMITTED / PARTIALLY_ISSUED),
   *  or null if every one was cancelled — drives the ISSUING inline action. */
  openRequisitionId: string | null;
  /** Server action: chef skips the requisition because stock is on hand. */
  onIngredientsAvailable: () => Promise<ActionResult>;
  /** Server action: one-tap "served" for in-house orders (no driver). */
  onMarkServed: () => Promise<ActionResult>;
}

/**
 * Status-aware "what happens next" panel for the order detail page.
 * Tells every viewer who acts next and surfaces a one-click button when
 * the action belongs to *them*. Skips terminal states (DELIVERED handled
 * via the header button, PAID/COMPLETED/CANCELLED are read-only) and the
 * approval states (those use dedicated blocks above).
 */
function OrderNextStep({ status, orderId, orderCode, role, immediate, hasRequisitions, openRequisitionId, onIngredientsAvailable, onMarkServed }: OrderNextStepProps) {
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isManager;
  // Storekeeper + management may act on the store-issue step.
  const canIssue = isManager || role === Role.STORE_KEEPER;
  // F&B Service submits its own in-house (immediate) orders; catering submits
  // stay with sales/manager/admin. Mirrors `canSubmit` on the page.
  const canSubmit = isSales || ((role === Role.DELIVERY || role === Role.FNB_SERVICE) && immediate);
  // Who can mark an in-house order served: kitchen + F&B Service + management.
  const canServe = isAdmin || isManager || isChef || role === Role.FNB_SERVICE || role === Role.DELIVERY;

  let title = "";
  let body: React.ReactNode = null;
  let tone: "info" | "urgent" | "muted" = "info";

  switch (status) {
    case OrderStatus.DRAFT:
      title = immediate ? "Next: submit to the kitchen" : "Next: submit for manager approval";
      body = immediate ? (
        <>
          This is an in-house order (room service / à la carte / management), so it skips manager
          sign-off and goes straight to the chef when submitted from the header.{" "}
          {!canSubmit && <span className="text-ik-ink-3">(Submit action is for sales / F&amp;B / manager / admin.)</span>}
        </>
      ) : (
        <>
          Front desk / sales submits this order from the header. It goes to the manager for sign-off
          first, and only then to the chef.{" "}
          {!isSales && <span className="text-ik-ink-3">(Submit action is for sales / manager / admin.)</span>}
        </>
      );
      tone = "info";
      break;

    case OrderStatus.PENDING_ADMIN_APPROVAL:
      title = isManager
        ? "Next: review and approve (or reject) this order"
        : "Next: waiting on manager approval";
      body = isManager ? (
        <>
          This order is waiting on your sign-off. Approve to send it to the chef for feasibility
          review, or reject if it shouldn&apos;t proceed. Either way, leave a short note for the
          audit trail.
        </>
      ) : (
        <>
          The manager will review and either approve (passes to the chef) or reject. Self-approval is
          required even for manager-raised orders — there&apos;s no auto-pass.
        </>
      );
      tone = isManager ? "urgent" : "info";
      break;

    case OrderStatus.REJECTED_BY_ADMIN:
      title = "Rejected by admin";
      body = (
        <>
          This order didn&apos;t get past admin review. Raise a new draft if the customer wants to
          revise. The audit log keeps the original.
        </>
      );
      tone = "muted";
      break;

    case OrderStatus.CHEF_REQUISITION_PENDING:
      title = "Next: chef raises the ingredient requisition";
      body = (
        <>
          The chef should now list the ingredients the store needs to issue for this order.
          {isChef ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link href={`/orders/${orderId}/requisition`}>
                <Button size="sm">Raise ingredient requisition</Button>
              </Link>
              <ActionResultButton action={onIngredientsAvailable} variant="outline">
                Ingredients already available — skip to cooking
              </ActionResultButton>
            </div>
          ) : (
            <span className="text-ik-ink-3"> Waiting on the kitchen head.</span>
          )}
          {isChef && (
            <div className="mt-2 text-[11.5px] text-ik-ink-3">
              Use &ldquo;skip to cooking&rdquo; only when the kitchen
              already holds everything for this order — it moves the order
              straight to production with no store issue (so no ingredient
              cost is booked against this order&apos;s P&amp;L).
            </div>
          )}
        </>
      );
      tone = isChef ? "urgent" : "info";
      break;

    case OrderStatus.ISSUING:
      title = "Next: storekeeper issues the ingredients";
      body = (
        <>
          The store is issuing stock against the chef requisition. Once everything is issued, the order
          moves to the kitchen board automatically.
          {canIssue && openRequisitionId && (
            <div className="mt-2">
              <Link href={`/requisitions/${openRequisitionId}`}>
                <Button size="sm">Issue ingredients</Button>
              </Link>
            </div>
          )}
          {canIssue && !openRequisitionId && (
            <div className="mt-2 rounded-md border border-amber bg-amber-wash px-2.5 py-1.5 text-[12px] text-amber-700">
              The stock request was closed — the chef needs to raise a fresh requisition.
            </div>
          )}
          {!canIssue && hasRequisitions && (
            <div className="mt-2 text-[12px] text-ik-ink-3">
              Track progress on the requisition page (linked under &ldquo;Chef requisitions&rdquo; below).
            </div>
          )}
        </>
      );
      tone = canIssue ? "urgent" : "muted";
      break;

    case OrderStatus.READY_FOR_PRODUCTION:
      title = "Next: chef starts cooking";
      body = (
        <>
          All ingredients are issued. A cooking job has been placed on the{" "}
          <Link href="/kitchen" className="text-brand hover:underline">kitchen board</Link>.
          {isChef && (
            <div className="mt-2">
              <Link href="/kitchen">
                <Button size="sm">Open kitchen board</Button>
              </Link>
            </div>
          )}
        </>
      );
      tone = isChef ? "urgent" : "info";
      break;

    case OrderStatus.IN_PREP:
      title = "Cooking in progress";
      body = (
        <>
          Items are being prepped and cooked on the{" "}
          <Link href="/kitchen" className="text-brand hover:underline">kitchen board</Link>. The order
          will move to &ldquo;Ready&rdquo; automatically once every item is marked ready.
        </>
      );
      tone = "muted";
      break;

    case OrderStatus.READY:
      if (immediate) {
        // In-house: no driver — the plate goes straight to the room/table.
        // One tap marks it served, which makes it billable on the room
        // billing screen.
        title = "Next: mark it served";
        body = (
          <>
            Cooked and ready to take to the {role === Role.FNB_SERVICE || role === Role.DELIVERY ? "guest" : "room / table"}. Tap{" "}
            <em>Served</em> once it&apos;s handed over — then raise the bill from{" "}
            <Link href="/invoices/room-service" className="text-brand hover:underline">Room billing</Link>.
            {!canServe && <span className="text-ik-ink-3"> (Serve action is for kitchen / F&amp;B / management.)</span>}
            {canServe && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ActionResultButton action={onMarkServed} successMessage="Marked served">
                  Mark served
                </ActionResultButton>
                <Link href="/invoices/room-service">
                  <Button type="button" size="sm" variant="outline">Open room billing</Button>
                </Link>
              </div>
            )}
          </>
        );
        tone = canServe ? "urgent" : "info";
        break;
      }
      title = "Next: schedule a delivery";
      body = (
        <>
          The food is cooked and waiting. The manager or admin should now schedule a delivery — pick a
          driver, a vehicle, and a time. The driver confirms delivery from their phone when the goods
          are handed over, and the tax invoice is auto-emailed to the customer at that moment.{" "}
          {!isManager && <span className="text-ik-ink-3">(Action is for manager / admin.)</span>}
          {isManager && (
            <div className="mt-2">
              <Link href={`/deliveries/new?orderId=${orderId}`}>
                <Button size="sm">Schedule delivery for {orderCode}</Button>
              </Link>
            </div>
          )}
        </>
      );
      tone = isManager ? "urgent" : "info";
      break;

    case OrderStatus.OUT_FOR_DELIVERY:
      title = "Next: driver hands over the order";
      body = (
        <>
          A driver is on the way. When the goods are handed over, the driver taps <em>Confirm delivery</em>
          on their phone. If payment was collected at the door, the amount is recorded on the delivery
          and credited against the tax invoice when accounts generate it.
        </>
      );
      tone = "muted";
      break;

    case OrderStatus.DELIVERED:
      title = "Next: generate the tax invoice";
      body = (
        <>
          Goods delivered. Accounts / manager / admin generates the GST tax invoice from the header
          button above. The invoice opens with a Download PDF link and a Send-to-customer button —
          nothing is auto-sent. Payment-on-delivery is auto-credited if the driver collected at the door.
          {!(isManager || role === Role.ACCOUNTS) && (
            <span className="text-ik-ink-3"> (Action is for accounts / manager / admin.)</span>
          )}
        </>
      );
      tone = (isManager || role === Role.ACCOUNTS) ? "urgent" : "info";
      break;

    case OrderStatus.INVOICED:
      title = "Next: customer pays";
      body = (
        <>
          Tax invoice issued. Once the customer pays — via the public invoice link, bank transfer, or
          payment-on-delivery — the order will close.
        </>
      );
      tone = "muted";
      break;

    default:
      return null;
  }

  const palette =
    tone === "urgent"
      ? "border-amber bg-amber-wash text-ik-ink"
      : tone === "muted"
        ? "border-ik-rule bg-ik-paper-alt text-ik-ink-2"
        : "border-brand-200 bg-brand-50 text-ik-ink";

  return (
    <div className={"mb-6 rounded-md border p-3 text-[13px] " + palette}>
      <div className="font-medium">{title}</div>
      <div className="mt-1">{body}</div>
      {/* Top-up requisition — once past CHEF_REQUISITION_PENDING (which has its
          own button above) but still in an eligible state, let the chef raise
          another requisition for extra ingredients after an upward revision. */}
      {isChef &&
        status !== OrderStatus.CHEF_REQUISITION_PENDING &&
        REQUISITION_ELIGIBLE_ORDER_STATUSES.includes(status) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={`/orders/${orderId}/requisition`}>
              <Button size="sm" variant="outline">Raise another requisition</Button>
            </Link>
            <span className="text-[11.5px] text-ik-ink-3">
              Need more after a revision? Raise a top-up requisition for the extra.
            </span>
          </div>
        )}
    </div>
  );
}
