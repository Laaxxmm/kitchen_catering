import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OrderStatus, Role } from "@prisma/client";
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
} from "@/server/actions/orders";
import { createCustomerInvoiceFromOrder } from "@/server/actions/customer-invoices";
import { listDishes } from "@/server/actions/dishes";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { AdminApprovalBlock } from "./_components/AdminApprovalBlock";
import { ChefApprovalBlock } from "./_components/ChefApprovalBlock";
import { ManagerChangeBlock } from "./_components/ManagerChangeBlock";
import { OrderCostSummary } from "./_components/OrderCostSummary";

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
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isAdmin || role === Role.MANAGER;

  // Pull any proforma invoice for this order so we can link it.
  const proforma = await db.customerInvoice.findFirst({
    where: { orderId: id, kind: "PROFORMA", status: { not: "CANCELLED" } },
    select: { id: true, invoiceNo: true, shareToken: true, emailedAt: true, emailedTo: true, grandTotal: true },
  });

  // ─── Server-action shims ───────────────────────────────────────────
  async function doSubmit() {
    "use server";
    await submitOrder(id);
  }
  async function doChefApprove(note: string) {
    "use server";
    await chefApproveOrder(id, { decision: "APPROVED", note });
  }
  async function doChefSuggest(note: string) {
    "use server";
    await chefApproveOrder(id, { decision: "SUGGESTED_CHANGES", note });
  }
  async function doManagerApproveChanges(note: string) {
    "use server";
    await managerApproveChefSuggestion(id, { decision: "APPROVED", note: note || undefined });
  }
  async function doManagerRejectChanges(note: string) {
    "use server";
    await managerApproveChefSuggestion(id, { decision: "REJECTED", note: note || undefined });
  }
  async function doAdminApprove(note: string) {
    "use server";
    await adminApproveOrder(id, { decision: "APPROVED", note });
  }
  async function doAdminReject(note: string) {
    "use server";
    await adminApproveOrder(id, { decision: "REJECTED", note });
  }
  async function doCancel(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return;
    await cancelOrder(id, reason);
  }
  async function doGenerateInvoice() {
    "use server";
    const result = await createCustomerInvoiceFromOrder(id);
    redirect(`/invoices/${result.id}`);
  }

  // ─── Approval block selection ────────────────────────────────────────
  // Chef sees the chef-approval block when order is PENDING_CHEF_APPROVAL.
  // Manager sees the changes-review block when order is CHANGES_PROPOSED_BY_CHEF.
  const showAdminBlock = isAdmin && order.status === OrderStatus.PENDING_ADMIN_APPROVAL;
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
            ? `${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase()} for ${order.headcount}`
            : `${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase()} for ${order.headcount} · ${formatINR(order.contractValue)}`
        }
        actions={
          <div className="flex gap-2">
            <Link href="/orders"><Button variant="outline">Back</Button></Link>
            {!chefOnlyView && (
              <Link href={`/orders/${order.id}/pnl`}><Button variant="outline">P&amp;L</Button></Link>
            )}
            {order.status === OrderStatus.DRAFT && isSales && (
              <form action={doSubmit}>
                <Button type="submit">Submit for admin approval</Button>
              </form>
            )}
            {/* Tax invoice is generated manually by accounts/admin/manager
                once the order has been delivered. They then download +
                email the PDF to the customer from the invoice detail
                page. Payment-on-delivery (if any) is credited against
                the invoice when it's created. */}
            {order.status === OrderStatus.DELIVERED && (role === Role.ACCOUNTS || isAdmin || isManager) && (
              <form action={doGenerateInvoice}>
                <Button type="submit">Generate tax invoice</Button>
              </form>
            )}
          </div>
        }
      />

      {/* Horizontal flow stepper — visible to everyone */}
      <div className="mb-6">
        <OrderStepper current={order.status} />
      </div>

      {/* Status-aware "what happens next" panel. Always visible so anyone
          looking at the order knows whose move it is. */}
      <OrderNextStep
        status={order.status}
        orderId={order.id}
        orderCode={order.code}
        role={role}
        hasRequisitions={order.chefRequisitions.length > 0}
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
              orderItems={order.items.map((it) => ({
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
              // Workflow doc: ODC + Packet show items as sub-heads with no
              // rate/qty column — only the package total applies. Chef
              // view is already qty-only; the financial channels keep
              // full columns.
              const packageMode =
                order.channel === "ODC" || order.channel === "PACKET";
              if (packageMode) {
                return (
                  <div className="rounded-md border border-ik-rule bg-ik-card p-4">
                    <p className="mb-3 text-[12px] text-ik-ink-3">
                      {order.channel === "ODC" ? "Outdoor catering" : "Packet food"}{" "}
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
              <form action={doCancel} className="rounded-md border border-alert-wash bg-alert-wash p-4 text-[13px]">
                <h3 className="mb-2 font-medium text-alert">Cancel order</h3>
                <textarea
                  name="reason"
                  rows={2}
                  placeholder="Reason"
                  className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]"
                />
                <Button type="submit" variant="outline" size="sm">Cancel order</Button>
              </form>
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
  hasRequisitions: boolean;
}

/**
 * Status-aware "what happens next" panel for the order detail page.
 * Tells every viewer who acts next and surfaces a one-click button when
 * the action belongs to *them*. Skips terminal states (DELIVERED handled
 * via the header button, PAID/COMPLETED/CANCELLED are read-only) and the
 * approval states (those use dedicated blocks above).
 */
function OrderNextStep({ status, orderId, orderCode, role, hasRequisitions }: OrderNextStepProps) {
  const isAdmin = role === Role.ADMIN;
  const isManager = role === Role.MANAGER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;
  const isSales = role === Role.SALES || isManager;

  let title = "";
  let body: React.ReactNode = null;
  let tone: "info" | "urgent" | "muted" = "info";

  switch (status) {
    case OrderStatus.DRAFT:
      title = "Next: submit for admin approval";
      body = (
        <>
          Front desk / sales submits this order from the header. It goes to the admin for sign-off
          first, and only then to the chef.{" "}
          {!isSales && <span className="text-ik-ink-3">(Submit action is for sales / manager / admin.)</span>}
        </>
      );
      tone = "info";
      break;

    case OrderStatus.PENDING_ADMIN_APPROVAL:
      title = isAdmin
        ? "Next: review and approve (or reject) this order"
        : "Next: waiting on admin approval";
      body = isAdmin ? (
        <>
          This order is waiting on your sign-off. Approve to send it to the chef for feasibility
          review, or reject if it shouldn&apos;t proceed. Either way, leave a short note for the
          audit trail.
        </>
      ) : (
        <>
          The admin will review and either approve (passes to the chef) or reject. Self-approval is
          required even for admin-raised orders — there&apos;s no auto-pass.
        </>
      );
      tone = isAdmin ? "urgent" : "info";
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
            <div className="mt-2">
              <Link href={`/orders/${orderId}/requisition`}>
                <Button size="sm">Raise ingredient requisition</Button>
              </Link>
            </div>
          ) : (
            <span className="text-ik-ink-3"> Waiting on the kitchen head.</span>
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
