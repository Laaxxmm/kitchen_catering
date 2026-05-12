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
  cancelOrder,
  chefApproveOrder,
  getOrder,
  managerApproveChefSuggestion,
  submitOrder,
} from "@/server/actions/orders";
import { createCustomerInvoiceFromOrder } from "@/server/actions/customer-invoices";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ChefApprovalBlock } from "./_components/ChefApprovalBlock";
import { ManagerChangeBlock } from "./_components/ManagerChangeBlock";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, session] = await Promise.all([getOrder(id), auth()]);
  if (!order) notFound();
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
  const showChefBlock = isChef && order.status === OrderStatus.PENDING_CHEF_APPROVAL;
  const showManagerChangesBlock = isManager && order.status === OrderStatus.CHANGES_PROPOSED_BY_CHEF;

  return (
    <>
      <PageHeader
        eyebrow="Order"
        title={`${order.code} · ${order.customer.name}`}
        description={`${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase()} for ${order.headcount} · ${formatINR(order.contractValue)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/orders"><Button variant="outline">Back</Button></Link>
            <Link href={`/orders/${order.id}/pnl`}><Button variant="outline">P&amp;L</Button></Link>
            {order.status === OrderStatus.DRAFT && isSales && (
              <form action={doSubmit}>
                <Button type="submit">Send to chef for approval</Button>
              </form>
            )}
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

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-6">
          {/* Approval blocks (conditional) */}
          {showChefBlock && (
            <ChefApprovalBlock onApprove={doChefApprove} onSuggest={doChefSuggest} />
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

          {/* Items */}
          <section className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Items</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dish</TableHead>
                  <TableHead className="text-right">Portions</TableHead>
                  <TableHead className="text-right">Unit ₹</TableHead>
                  <TableHead className="text-right">Disc %</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.dish.name}</TableCell>
                    <TableCell className="text-right font-mono">{it.portions.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{it.unitPrice.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{it.discountPct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{it.gstRatePct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{it.lineTotal.toString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          {/* Proforma invoice */}
          {proforma && (
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
              <Link href={`/customers/${order.customer.id}`} className="text-brand hover:underline">
                {order.customer.name}
              </Link>
              {order.customer.gstin && <div className="font-mono text-[12px] text-ik-ink-2">{order.customer.gstin}</div>}
              {order.customer.contactName && <div>{order.customer.contactName}</div>}
              {order.customer.phone && <div className="text-ik-ink-2">{order.customer.phone}</div>}
              {order.customer.email ? (
                <div className="text-ik-ink-2">{order.customer.email}</div>
              ) : (
                <div className="rounded bg-amber-wash px-2 py-1 text-[11.5px] text-amber">
                  ⚠ No email on file — proforma won&apos;t be auto-sent. Add an email on the customer page.
                </div>
              )}
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
