import Link from "next/link";
import { notFound } from "next/navigation";
import { Role, VendorPOStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  approveVendorPO,
  cancelVendorPO,
  closeVendorPO,
  recallVendorPOToDraft,
  getVendorPO,
  sendVendorPO,
  submitVendorPO,
  updateVendorPOLines,
} from "@/server/actions/procurement";
import { acknowledgeRevisedDocument } from "@/server/actions/orders";
import { db } from "@/server/db";
import { ORDER_STORE_ROLES } from "@/server/rbac";
import { billProgress, CLOSEABLE_PO_STATUSES, type BillProgress } from "@/lib/vendor-po-gates";
import { formatINR } from "@/lib/money";
import { Decimal } from "decimal.js";
import { formatIST } from "@/lib/time";
import {
  RevisionBanner,
  revisionOrderSelect,
} from "@/app/(dashboard)/requisitions/[id]/_components/RevisionBanner";
import { NotifyVendorBlock } from "./_components/NotifyVendorBlock";
import { EditPOLines } from "./_components/EditPOLines";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";

export const dynamic = "force-dynamic";

// Mirrors the server gate acknowledgeRevisedDocument applies to a vendor PO
// — no point offering a button that will be refused.
const REVISION_ACK_ROLES: Role[] = [...ORDER_STORE_ROLES, Role.MANAGER];

export default async function VendorPODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [po, session] = await Promise.all([getVendorPO(id), auth()]);
  if (!po) notFound();
  const role = session?.user?.role;
  const canSubmit = po.status === VendorPOStatus.DRAFT && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  // Two-step approval: Manager (or Admin) handles the first step; Admin
  // is required when the PO total is at-or-above the Settings threshold
  // (default ₹5000). Once Manager has approved, only Admin can finish.
  const managerStepDone = po.managerApprovedAt != null;
  const canApprove =
    po.status === VendorPOStatus.PENDING_APPROVAL &&
    (role === Role.ADMIN || (role === Role.MANAGER && !managerStepDone));
  // Draft line editing shares the createVendorPO gate — whoever can raise a
  // PO can fix its draft before it goes for approval. (No REJECTED state in
  // the schema; DRAFT is the only editable status.)
  const canEditLines =
    po.status === VendorPOStatus.DRAFT &&
    (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  const canSend = po.status === VendorPOStatus.APPROVED && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  // Recall a submitted PO to draft to fix a wrong unit/price before it goes
  // to the vendor — whoever can raise a PO can recall it.
  const canRecall =
    po.status === VendorPOStatus.PENDING_APPROVAL &&
    (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  // Store keeper may cancel a PO that hasn't left the building (draft /
  // awaiting approval); managers/admins can cancel any non-terminal PO.
  const canCancel =
    po.status !== VendorPOStatus.CANCELLED &&
    po.status !== VendorPOStatus.RECEIVED &&
    po.status !== VendorPOStatus.CLOSED &&
    (role === Role.ADMIN ||
      role === Role.MANAGER ||
      (role === Role.STORE_KEEPER &&
        (po.status === VendorPOStatus.DRAFT || po.status === VendorPOStatus.PENDING_APPROVAL)));
  const canReceive = (po.status === VendorPOStatus.APPROVED || po.status === VendorPOStatus.SENT || po.status === VendorPOStatus.PARTIALLY_RECEIVED) && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  // Mirrors BILL_WRITE_ROLES: the store keeper holds the physical bill at
  // goods-in, so they record it too. Approving and paying stay finance-only.
  const canRecordBill = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS || role === Role.STORE_KEEPER;
  // Retiring a PO writes off whatever the supplier never delivered — same
  // weight as approving it, so admin/manager only (APPROVE_ROLES in the
  // action). The action refuses over unbilled or unpaid money regardless.
  const canClose = CLOSEABLE_PO_STATUSES.includes(po.status) && (role === Role.ADMIN || role === Role.MANAGER);

  // getVendorPO carries only the order's id and code, so read the revision
  // stamps here. Skipped on a cancelled PO — nothing left to chase.
  const revisedOrder =
    po.order && po.status !== VendorPOStatus.CANCELLED
      ? await db.order.findUnique({ where: { id: po.order.id }, select: revisionOrderSelect })
      : null;
  // Before approval the PO is still ours to change; after it, the supplier
  // is holding a document we can't quietly rewrite.
  const poStillEditable =
    po.status === VendorPOStatus.DRAFT || po.status === VendorPOStatus.PENDING_APPROVAL;

  async function doAckRevision() {
    "use server";
    return await acknowledgeRevisedDocument("VENDOR_PO", id);
  }
  async function doSubmit() { "use server"; return await submitVendorPO(id); }
  async function doApprove() { "use server"; return await approveVendorPO(id); }
  async function doApproveVendor() {
    "use server";
    const { approveVendor } = await import("@/server/actions/vendors");
    return await approveVendor(po!.vendorId);
  }
  // Returns the result — ActionResultButton / NotifyVendorBlock check
  // `res.ok` and toast the failure.
  async function doMarkSent() { "use server"; return await sendVendorPO(id); }
  async function doCancel(reason: string) {
    "use server";
    return await cancelVendorPO(id, reason);
  }
  async function doClose(reason: string) {
    "use server";
    return await closeVendorPO(id, reason);
  }
  async function doRecall() {
    "use server";
    return await recallVendorPOToDraft(id);
  }
  async function doUpdateLines(
    lines: Array<{
      id: string;
      description: string;
      unit: string;
      quantity: string;
      unitPrice: string;
      gstRatePct: string;
    }>,
  ) {
    "use server";
    return await updateVendorPOLines({ poId: id, lines });
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title={po.poNo}
        description={`${po.vendor.name} · ${formatINR(po.grandTotal)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/procurement/purchase-orders"><Button variant="outline">Back</Button></Link>
            {canSubmit && <ActionResultButton action={doSubmit} successMessage="PO submitted for approval">Submit</ActionResultButton>}
            {canApprove && <ActionResultButton action={doApprove} successMessage="PO approved">Approve</ActionResultButton>}
            {canRecall && <ActionResultButton action={doRecall} variant="outline" successMessage="PO pulled back to draft — edit the lines, then submit again">Recall to draft</ActionResultButton>}
            {canSend && <ActionResultButton action={doMarkSent} variant="outline" successMessage="PO marked sent">Mark sent</ActionResultButton>}
            {canReceive && <Link href={`/procurement/grns/new?poId=${po.id}`}><Button>Receive (GRN)</Button></Link>}
          </div>
        }
      />
      <RevisionBanner
        order={revisedOrder}
        documentLabel="purchase order"
        createdAt={po.createdAt}
        ackAt={po.revisionAckAt}
        canAcknowledge={!!role && REVISION_ACK_ROLES.includes(role)}
        onAcknowledge={doAckRevision}
      >
        {poStillEditable ? (
          <p>
            <strong>What to do:</strong> this PO hasn&apos;t gone to the supplier yet, so it can
            still be changed.{" "}
            {po.status === VendorPOStatus.DRAFT
              ? "Fix the quantities in the lines below and save."
              : "Use “Recall to draft” at the top, fix the quantities, then submit it again."}
          </p>
        ) : (
          <>
            <p>
              <strong>The supplier already has this purchase order.</strong> Don&apos;t change it —
              they are working to the copy in their hands. If more is now needed, raise a second
              purchase order for the extra quantity only.
            </p>
            <p className="mt-1.5">
              <Link href="/procurement/purchase-orders/new" className="text-brand hover:underline">
                Raise an additional PO
              </Link>
            </p>
          </>
        )}
        {po.order && (
          <p className="mt-1.5">
            <Link href={`/orders/${po.order.id}`} className="text-brand hover:underline">
              Open order {po.order.code}
            </Link>{" "}
            to see what changed.
          </p>
        )}
      </RevisionBanner>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <StatusBadge status={po.status} />
        {po.procurementType !== "STANDARD" && (
          <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {po.procurementType === "LOCAL" ? "Local purchase" : "Online order"}
          </span>
        )}
        {po.status === VendorPOStatus.PENDING_APPROVAL && managerStepDone && (
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-amber-700">
            Manager approved · awaiting Admin
          </span>
        )}
        {po.order && (
          <span className="text-ik-ink-3">
            For order{" "}
            <Link href={`/orders/${po.order.id}`} className="font-mono text-brand hover:underline">
              {po.order.code}
            </Link>
          </span>
        )}
        <span className="text-ik-ink-3">Issued {formatIST(po.issueDate, "yyyy-MM-dd")}</span>
        {po.expectedDate && <span className="text-ik-ink-3">· Expected {formatIST(po.expectedDate, "yyyy-MM-dd")}</span>}
        {po.managerApprovedAt && (
          <span className="text-ik-ink-3">
            · Manager: {formatIST(po.managerApprovedAt)} ({po.managerApprovedBy?.name ?? "—"})
          </span>
        )}
        {po.adminApprovedAt && (
          <span className="text-ik-ink-3">
            · Admin: {formatIST(po.adminApprovedAt)} ({po.adminApprovedBy?.name ?? "—"})
          </span>
        )}
        {po.sentAt && <span className="text-ik-ink-3">· Sent {formatIST(po.sentAt)}</span>}
      </div>

      {/* Action panel — explains what happens now and surfaces the right
          buttons so the user never feels stranded mid-chain. */}
      {po.status === VendorPOStatus.APPROVED && canSend ? (
        <div className="mb-4">
          <NotifyVendorBlock
            vendor={{ name: po.vendor.name, phone: po.vendor.phone, email: po.vendor.email }}
            poNo={po.poNo}
            messageText={buildVendorMessage(po)}
            emailSubject={`Purchase order ${po.poNo} from Greenpath`}
            receiveHref={`/procurement/grns/new?poId=${po.id}`}
            onMarkSent={doMarkSent}
          />
        </div>
      ) : (
        <NextStep
          status={po.status}
          notes={po.notes}
          bills={billProgress(po.bills)}
          vendorPending={po.vendor.approvalStatus !== "APPROVED"}
          vendorName={po.vendor.name}
          approveVendorSlot={
            role === Role.ADMIN || role === Role.MANAGER ? (
              <ActionResultButton
                action={doApproveVendor}
                successMessage={`${po.vendor.name} approved — submit the PO`}
              >
                Approve vendor now
              </ActionResultButton>
            ) : undefined
          }
          canReceive={canReceive}
          canRecordBill={canRecordBill}
          receiveHref={`/procurement/grns/new?poId=${po.id}`}
          recordBillHref={`/procurement/vendor-bills/new?poId=${po.id}`}
        />
      )}


      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 grid gap-4">
          {/* Draft POs get an editable line table (the shortfall flow
              pre-fills catalogue unit + price — often not what the store
              actually buys); every other status shows the read-only view. */}
          {canEditLines ? (
            <EditPOLines
              action={doUpdateLines}
              lines={po.lines.map((l) => ({
                id: l.id,
                sku: l.sku,
                description: l.description,
                unit: l.unit,
                quantity: l.quantity.toString(),
                unitPrice: l.unitPrice.toString(),
                gstRatePct: l.gstRatePct.toString(),
                catalogueUnit: l.ingredient?.unit ?? l.banquetItem?.unit ?? null,
              }))}
            />
          ) : (
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Lines</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit ₹</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-[12px]">{l.sku}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right font-mono">{l.quantity.toString()} {l.unit}</TableCell>
                    <TableCell className="text-right font-mono">{l.receivedQty.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(() => {
              // The PO total is the ORDERED commitment. When receipts are
              // partial, also show the value of what actually arrived —
              // that's the amount the supplier's bill should carry (the
              // 3-way match checks the bill against received qty, so a
              // full-value bill for a short delivery gets flagged).
              const receivedValue = po.lines.reduce((sum, l) => {
                const qty = new Decimal(l.receivedQty.toString());
                const unit = new Decimal(l.unitPrice.toString());
                const gst = new Decimal(l.gstRatePct.toString()).div(100);
                return sum.plus(qty.times(unit).times(gst.plus(1)));
              }, new Decimal(0)).toDecimalPlaces(2);
              const ordered = new Decimal(po.grandTotal.toString());
              const partial = receivedValue.lt(ordered);
              return (
                <div className="mt-2 text-right font-mono text-[13px]">
                  <div><span className="text-ik-ink-3">Subtotal (ordered)</span> {po.subtotal.toString()}</div>
                  <div><span className="text-ik-ink-3">Tax (ordered)</span> {po.taxTotal.toString()}</div>
                  <div className="font-medium"><span className="text-ik-ink-3">Ordered total</span> {formatINR(po.grandTotal)}</div>
                  {partial && (
                    <>
                      <div className="mt-1 font-medium text-amber-700">
                        <span className="text-ik-ink-3">Received so far (incl. GST)</span> {formatINR(receivedValue.toString())}
                      </div>
                      <div className="text-[11.5px] text-ik-ink-3">
                        Supplier should bill the received value — the bill match checks against received qty, not ordered.
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
          )}

          {po.grns.length > 0 && (
            <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">GRNs</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.grns.map((g) => (
                  <li key={g.id}><Link href={`/procurement/grns/${g.id}`} className="font-mono text-brand hover:underline">{g.grnNo}</Link> · {g.status} · {formatIST(g.receivedAt, "yyyy-MM-dd")}</li>
                ))}
              </ul>
            </div>
          )}
          {po.bills.length > 0 && (
            <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vendor bills</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.bills.map((b) => (
                  <li key={b.id} className="flex items-center gap-1.5"><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link> <StatusBadge status={b.status} /></li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vendor</h3>
            <div><Link href={`/procurement/vendors/${po.vendor.id}`} className="text-brand hover:underline">{po.vendor.name}</Link></div>
            <div className="font-mono text-[12px] text-ik-ink-2">{po.vendor.code}</div>
            {po.vendor.gstin && <div className="font-mono text-[12px] text-ik-ink-2">{po.vendor.gstin}</div>}
            <div className="text-ik-ink-3">State {po.vendor.stateCode}</div>
          </div>
          {canCancel && (
            <ActionReasonForm
              action={doCancel}
              heading="Cancel PO"
              description={
                po.status === VendorPOStatus.PENDING_APPROVAL
                  ? "Withdraws the PO. To fix a wrong unit or price instead, use 'Recall to draft' and edit the lines."
                  : "Cancels this purchase order."
              }
              submitLabel="Cancel PO"
              successMessage="PO cancelled"
            />
          )}
          {canClose && (
            <ActionReasonForm
              action={doClose}
              tone="warning"
              heading="Close PO"
              description="Retires this PO — for when the supplier isn't going to deliver the rest. Anything still waiting on it goes back to the store to source another way. Refused while a bill on it is unpaid, or while received goods have no bill recorded."
              submitLabel="Close PO"
              successMessage="PO closed"
            />
          )}
        </aside>
      </div>
    </>
  );
}

interface NextStepProps {
  status: VendorPOStatus;
  /** Cancellation / closure reason — the only place it's readable. */
  notes: string | null;
  /** Where the supplier bill(s) actually got to; null when none exists yet. */
  bills: BillProgress | null;
  /** Vendor still awaiting manager sign-off — submit will refuse. */
  vendorPending: boolean;
  vendorName: string;
  /** One-tap approve, rendered only for admin/manager viewers. */
  approveVendorSlot?: React.ReactNode;
  canReceive: boolean;
  canRecordBill: boolean;
  receiveHref: string;
  recordBillHref: string;
}

/**
 * Status-specific guidance panel for the non-APPROVED states. APPROVED
 * gets the richer NotifyVendorBlock with WhatsApp/email/mark-sent actions;
 * everything else just needs a one-liner pointing at the next button.
 */
function NextStep({ status, notes, bills, vendorPending, vendorName, approveVendorSlot, canReceive, canRecordBill, receiveHref, recordBillHref }: NextStepProps) {
  // Retired POs: no next step, but say why — the reason lives on the PO and
  // this is the only place it's readable (the audit log keeps a hash).
  if (status === VendorPOStatus.CANCELLED || status === VendorPOStatus.CLOSED) {
    if (!notes) return null;
    return (
      <div className="mb-4 rounded-md border border-ik-rule bg-ik-paper-alt p-3 text-[13px] text-ik-ink-2">
        <strong>{status === VendorPOStatus.CLOSED ? "Closed:" : "Cancelled:"}</strong> {notes}
      </div>
    );
  }

  let body: React.ReactNode = null;

  // A newly added supplier can be drafted against, but nothing goes out until
  // a manager approves them — say so here rather than only failing on submit.
  // An admin/manager viewing the blocked PO gets the approve button right in
  // the banner, so unblocking is one tap instead of a hunt through /vendors.
  if (status === VendorPOStatus.DRAFT && vendorPending) {
    return (
      <div className="mb-5 rounded-2xl border border-amber bg-amber-wash p-4 text-[13px] text-amber-700 shadow-ik-card">
        <strong>Waiting on vendor approval:</strong> “{vendorName}” is a new supplier and a manager
        or admin must approve them before this PO can be submitted. Your draft is saved — they have
        been notified, and you can submit as soon as the vendor is approved.
        {approveVendorSlot && <div className="mt-3">{approveVendorSlot}</div>}
      </div>
    );
  }

  if (status === VendorPOStatus.DRAFT) {
    body = (
      <>
        <strong>Next:</strong> Submit this PO for approval. The Manager signs off; the Admin also signs off
        when the total is ₹5,000 or more. (POs created from an approved request skip this — they&apos;re
        already approved.)
      </>
    );
  } else if (status === VendorPOStatus.PENDING_APPROVAL) {
    body = (
      <>
        <strong>Next:</strong> Waiting on approval — Manager signs off, with Admin also required at ₹5,000
        and above. The Approve button appears in the header for the right approver.
      </>
    );
  } else if (status === VendorPOStatus.SENT) {
    body = (
      <>
        <strong>Next:</strong> Supplier has been notified — waiting on the delivery. When the goods arrive
        at the kitchen, the storekeeper presses the button below. Stock and average cost update
        automatically.
        <div className="mt-2">
          {canReceive && (
            <Link href={receiveHref}>
              <Button size="sm">Goods arrived — log delivery</Button>
            </Link>
          )}
        </div>
      </>
    );
  }

  // Buttons that go with a bill that already exists. `billId` is set only
  // when there's exactly one — with several, the Vendor bills panel further
  // down is the honest list.
  const billLinks = bills && (
    <>
      {bills.billId && (
        <Link href={`/procurement/vendor-bills/${bills.billId}`}>
          <Button size="sm" variant={bills.attention ? "default" : "outline"}>Open the bill</Button>
        </Link>
      )}
      {canRecordBill && (
        <Link href={recordBillHref}>
          <Button size="sm" variant="outline">Record another bill</Button>
        </Link>
      )}
    </>
  );

  if (status === VendorPOStatus.PARTIALLY_RECEIVED) {
    body = (
      <>
        <strong>{bills?.attention ? "Needs attention:" : "Next:"}</strong> Some items have arrived.
        Log another delivery when the rest comes in.{" "}
        {bills
          ? `${bills.headline}.${bills.next ? ` ${bills.next}` : ""}`
          : "The supplier's bill can wait until everything is in."}
        <div className="mt-2 flex flex-wrap gap-2">
          {canReceive && (
            <Link href={receiveHref}>
              <Button size="sm">Log another delivery</Button>
            </Link>
          )}
          {billLinks}
        </div>
      </>
    );
  } else if (status === VendorPOStatus.RECEIVED) {
    // The banner used to prompt "record the supplier bill" off role alone, so
    // a fully billed — even fully paid — PO still asked for a bill. Report
    // where the bill actually got to instead.
    body = bills ? (
      <>
        <strong>{bills.attention ? "Needs attention:" : "Next:"}</strong> All goods received.{" "}
        {bills.headline}.{bills.next ? ` ${bills.next}` : ""}
        <div className="mt-2 flex flex-wrap gap-2">{billLinks}</div>
      </>
    ) : canRecordBill ? (
      <>
        <strong>Next:</strong> All goods received. When the supplier sends the bill, record it — the
        system checks it against this PO + the delivery notes before letting accounts pay.
        <div className="mt-2">
          {/* Carry the PO so the bill form opens prefilled — vendor, linked
              PO and lines at the RECEIVED quantities. Without ?poId= it
              landed on a blank form and the whole PO had to be re-keyed. */}
          <Link href={recordBillHref}>
            <Button size="sm" variant="outline">Record supplier bill</Button>
          </Link>
        </div>
      </>
    ) : (
      <>
        <strong>Done:</strong> All goods received and stock updated. The finance desk takes it from here —
        they record the supplier bill and handle payment.
      </>
    );
  }

  if (!body) return null;

  return (
    <div
      className={
        "mb-4 rounded-md border p-3 text-[13px] " +
        (bills?.attention
          ? "border-amber bg-amber-wash text-amber-700"
          : "border-brand-200 bg-brand-50 text-ik-ink-2")
      }
    >
      {body}
    </div>
  );
}

/**
 * Compose the plain-text body that goes into WhatsApp / email when
 * notifying a supplier of a new order. Kept readable on a phone keyboard
 * — short greeting, bulleted item list, total, expected date.
 */
function buildVendorMessage(po: {
  poNo: string;
  vendor: { name: string };
  expectedDate: Date | null;
  grandTotal: { toString(): string };
  lines: Array<{
    description: string;
    quantity: { toString(): string };
    unit: string;
  }>;
}): string {
  const lines = po.lines
    .map((l) => `• ${l.description} — ${l.quantity.toString()} ${l.unit}`)
    .join("\n");
  const expected = po.expectedDate
    ? `\nExpected delivery: ${formatIST(po.expectedDate, "EEE d MMM yyyy")}`
    : "";
  return (
    `Hi ${po.vendor.name},\n\n` +
    `This is Greenpath. Please supply the following items against PO ${po.poNo}:\n\n` +
    `${lines}\n\n` +
    `Total (incl. GST): ₹${po.grandTotal.toString()}${expected}\n\n` +
    `Please confirm receipt of this order and the expected delivery time.\n\n` +
    `Thank you,\nGreenpath`
  );
}
