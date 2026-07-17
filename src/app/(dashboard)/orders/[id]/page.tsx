import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderChannel, OrderStatus, ProductionJobItemStatus, Role } from "@prisma/client";
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
  getOrder,
  managerApproveChefSuggestion,
  submitOrder,
  swapOrderItemDish,
} from "@/server/actions/orders";
import { createCustomerInvoiceFromOrder } from "@/server/actions/customer-invoices";
import { listDishes } from "@/server/actions/dishes";
import { listAssignableUsers } from "@/server/actions/users";
import { isEventDeliveryChannel, isImmediateChannel, isPackagePricedChannel } from "@/lib/order-channels";
import { REVISABLE_ORDER_STATUSES } from "@/lib/order-status";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
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
  const role = session?.user?.role;
  // In-house immediate channels skip admin sign-off and go straight to the
  // chef — the UI (button label, stepper, next-step hint) reflects that.
  const immediate = isImmediateChannel(order.channel);
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isAdmin || role === Role.MANAGER;

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
            {order.status === OrderStatus.DRAFT && isSales && (
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
        onIngredientsAvailable={doIngredientsAvailable}
        onMarkServed={doMarkServed}
      />


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
            <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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

          {/* Decision history */}
          <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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
          <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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
                  <div className="rounded-md border border-ik-rule bg-ik-card p-4">
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
          <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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
            {order.status === OrderStatus.CHEF_REQUISITION_PENDING && (role === Role.KITCHEN_HEAD || isAdmin) && (
              <Link href={`/orders/${order.id}/requisition`} className="mt-2 inline-block">
                <Button size="sm">Raise requisition</Button>
              </Link>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="grid gap-4">
          <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
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
              admin / manager / F&B service / delivery. */}
          <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Serving staff</h3>
            {order.staffAllocations.length === 0 && !canAllocateStaff && (
              <p className="text-[12.5px] text-ik-ink-3">No staff allocated yet.</p>
            )}
            <StaffAllocation
              orderId={order.id}
              staff={order.staffAllocations}
              canEdit={canAllocateStaff}
            />
          </section>

          {/* Leftovers returned — counter-sale / ODC only. A traceability log
              of surplus food and where it went; no stock movement. */}
          {showLeftovers && (
            <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Leftovers returned</h3>
              {order.leftoverReturns.length === 0 && !canAllocateStaff && (
                <p className="text-[12.5px] text-ik-ink-3">No leftovers logged.</p>
              )}
              <LeftoverReturns
                orderId={order.id}
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

          <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
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

          {(isAdmin || isManager) &&
            order.status !== OrderStatus.CANCELLED &&
            order.status !== OrderStatus.PAID &&
            order.status !== OrderStatus.COMPLETED && (
              <ActionReasonForm
                action={doCancel}
                heading="Cancel order"
                submitLabel="Cancel order"
                successMessage="Order cancelled"
              />
            )}
        </aside>
      </div>
    </>
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
function OrderNextStep({ status, orderId, orderCode, role, immediate, hasRequisitions, onIngredientsAvailable, onMarkServed }: OrderNextStepProps) {
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isManager;
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
          {!isSales && <span className="text-ik-ink-3">(Submit action is for sales / manager / admin.)</span>}
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
          {hasRequisitions && (
            <div className="mt-2 text-[12px] text-ik-ink-3">
              Track progress on the requisition page (linked under &ldquo;Chef requisitions&rdquo; below).
            </div>
          )}
        </>
      );
      tone = "muted";
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
    </div>
  );
}
