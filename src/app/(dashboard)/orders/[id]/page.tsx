import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import {
  cancelOrder,
  getOrder,
  managerApproveOrder,
  managerOverrideStoreRejection,
  storeApproveOrder,
  submitOrder,
} from "@/server/actions/orders";
import { createCustomerInvoiceFromOrder } from "@/server/actions/customer-invoices";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ApprovalBlock } from "./_components/ApprovalBlock";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, session] = await Promise.all([getOrder(id), auth()]);
  if (!order) notFound();
  const role = session?.user?.role;
  const isAdmin = role === Role.ADMIN;
  const isStore = role === Role.STORE_KEEPER || isAdmin;
  const isManager = role === Role.MANAGER || isAdmin;
  const isSales = role === Role.SALES || isAdmin || role === Role.MANAGER;

  // ─── Server-action shims so the client-side ApprovalBlock can invoke
  //     server actions without exposing the order id to the client. ─────
  async function doSubmit() {
    "use server";
    await submitOrder(id);
  }
  async function doStoreApprove(note: string) {
    "use server";
    await storeApproveOrder(id, { decision: "APPROVED", note });
  }
  async function doStoreReject(note: string) {
    "use server";
    await storeApproveOrder(id, { decision: "REJECTED", note });
  }
  async function doManagerApprove(note: string) {
    "use server";
    await managerApproveOrder(id, { decision: "APPROVED", note: note || undefined });
  }
  async function doManagerReject(note: string) {
    "use server";
    await managerApproveOrder(id, { decision: "REJECTED", note: note || undefined });
  }
  async function doOverride(reason: string) {
    "use server";
    await managerOverrideStoreRejection(id, { reason });
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
  let approvalBlock: React.ReactNode = null;
  if (order.status === OrderStatus.PENDING_STORE_APPROVAL && isStore) {
    approvalBlock = (
      <ApprovalBlock
        action="store"
        onApprove={doStoreApprove}
        onReject={doStoreReject}
      />
    );
  } else if (order.status === OrderStatus.PENDING_MANAGER_APPROVAL && isManager) {
    approvalBlock = (
      <ApprovalBlock
        action="manager"
        onApprove={doManagerApprove}
        onReject={doManagerReject}
      />
    );
  } else if (order.status === OrderStatus.REJECTED_BY_STORE && isManager) {
    approvalBlock = (
      <ApprovalBlock
        action="override"
        storeNote={order.storeApprovalNote}
        onOverride={doOverride}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Order"
        title={`${order.code} · ${order.customer.name}`}
        description={`${formatIST(order.eventDate, "EEE d MMM yyyy")} · ${order.mealType.toLowerCase()} for ${order.headcount} · ${formatINR(order.contractValue)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/orders"><Button variant="outline">Back</Button></Link>
            {order.status === OrderStatus.DRAFT && isSales && (
              <form action={doSubmit}>
                <Button type="submit">Submit for approval</Button>
              </form>
            )}
            {order.status === OrderStatus.DELIVERED && (role === Role.ACCOUNTS || isAdmin || isManager) && (
              <form action={doGenerateInvoice}>
                <Button type="submit">Generate invoice</Button>
              </form>
            )}
          </div>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-6">
          {/* Status timeline */}
          <section className="rounded-md border border-ik-rule bg-ik-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-[14px] text-ik-ink">Status</h3>
              <StatusBadge status={order.status} />
            </div>
            <ol className="grid gap-2 text-[12.5px]">
              <li>
                <span className="text-ik-ink-3">Created</span>{" "}
                <span className="font-mono">{formatIST(order.createdAt)}</span>
                {order.createdBy?.name && <span className="text-ik-ink-3"> · by {order.createdBy.name}</span>}
              </li>
              {order.submittedAt && (
                <li>
                  <span className="text-ik-ink-3">Submitted</span>{" "}
                  <span className="font-mono">{formatIST(order.submittedAt)}</span>
                </li>
              )}
              {order.storeReviewedAt && (
                <li>
                  <span className="text-ik-ink-3">Store {order.storeDecision?.toLowerCase()}</span>{" "}
                  <span className="font-mono">{formatIST(order.storeReviewedAt)}</span>
                  {order.storeReviewedBy?.name && <span className="text-ik-ink-3"> · {order.storeReviewedBy.name}</span>}
                  {order.storeApprovalNote && (
                    <div className="mt-1 border-l-2 border-ik-rule pl-2 italic text-ik-ink-2">
                      {order.storeApprovalNote}
                    </div>
                  )}
                </li>
              )}
              {order.managerReviewedAt && (
                <li>
                  <span className="text-ik-ink-3">Manager {order.managerDecision?.toLowerCase()}</span>{" "}
                  <span className="font-mono">{formatIST(order.managerReviewedAt)}</span>
                  {order.managerReviewedBy?.name && <span className="text-ik-ink-3"> · {order.managerReviewedBy.name}</span>}
                  {order.managerApprovalNote && (
                    <div className="mt-1 border-l-2 border-ik-rule pl-2 italic text-ik-ink-2">
                      {order.managerApprovalNote}
                    </div>
                  )}
                  {order.managerOverrideReason && (
                    <div className="mt-1 border-l-2 border-amber pl-2 italic text-amber">
                      Override reason: {order.managerOverrideReason}
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

          {/* Approval block */}
          {approvalBlock}

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
