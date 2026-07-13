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
  recallVendorPOToDraft,
  getVendorPO,
  sendVendorPO,
  submitVendorPO,
  updateVendorPOLines,
} from "@/server/actions/procurement";
import { formatINR } from "@/lib/money";
import { Decimal } from "decimal.js";
import { formatIST } from "@/lib/time";
import { NotifyVendorBlock } from "./_components/NotifyVendorBlock";
import { EditPOLines } from "./_components/EditPOLines";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";

export const dynamic = "force-dynamic";

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
  // Supplier bills are finance-only — store keepers never record them.
  const canRecordBill = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;

  async function doSubmit() { "use server"; return await submitVendorPO(id); }
  async function doApprove() { "use server"; return await approveVendorPO(id); }
  // Returns the result — ActionResultButton / NotifyVendorBlock check
  // `res.ok` and toast the failure.
  async function doMarkSent() { "use server"; return await sendVendorPO(id); }
  async function doCancel(reason: string) {
    "use server";
    return await cancelVendorPO(id, reason);
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
          canReceive={canReceive}
          canRecordBill={canRecordBill}
          receiveHref={`/procurement/grns/new?poId=${po.id}`}
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
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
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
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">GRNs</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.grns.map((g) => (
                  <li key={g.id}><Link href={`/procurement/grns/${g.id}`} className="font-mono text-brand hover:underline">{g.grnNo}</Link> · {g.status} · {formatIST(g.receivedAt, "yyyy-MM-dd")}</li>
                ))}
              </ul>
            </div>
          )}
          {po.bills.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vendor bills</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.bills.map((b) => (
                  <li key={b.id}><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link> · {b.status}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
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
        </aside>
      </div>
    </>
  );
}

interface NextStepProps {
  status: VendorPOStatus;
  canReceive: boolean;
  canRecordBill: boolean;
  receiveHref: string;
}

/**
 * Status-specific guidance panel for the non-APPROVED states. APPROVED
 * gets the richer NotifyVendorBlock with WhatsApp/email/mark-sent actions;
 * everything else just needs a one-liner pointing at the next button.
 */
function NextStep({ status, canReceive, canRecordBill, receiveHref }: NextStepProps) {
  if (status === VendorPOStatus.CANCELLED || status === VendorPOStatus.CLOSED) return null;

  let body: React.ReactNode = null;

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
  } else if (status === VendorPOStatus.PARTIALLY_RECEIVED) {
    body = (
      <>
        <strong>Next:</strong> Some items have arrived. Log another delivery when the rest comes in. The
        supplier&apos;s bill can wait until everything is in.
        <div className="mt-2">
          {canReceive && (
            <Link href={receiveHref}>
              <Button size="sm">Log another delivery</Button>
            </Link>
          )}
        </div>
      </>
    );
  } else if (status === VendorPOStatus.RECEIVED) {
    body = canRecordBill ? (
      <>
        <strong>Next:</strong> All goods received. When the supplier sends the bill, record it — the
        system checks it against this PO + the delivery notes before letting accounts pay.
        <div className="mt-2">
          <Link href="/procurement/vendor-bills/new">
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
    <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
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
