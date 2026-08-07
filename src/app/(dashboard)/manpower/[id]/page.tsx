import Link from "next/link";
import { notFound } from "next/navigation";
import { ManpowerRequestStatus, PaymentMethod } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ik/StatusPill";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";
import { gateRolePage } from "@/server/rbac";
import {
  approveManpowerRequest,
  cancelManpowerRequest,
  completeManpowerRequest,
  getManpowerRequest,
  payManpowerRequest,
  rejectManpowerRequest,
  settleManpowerCost,
} from "@/server/actions/manpower";
import {
  costVariance,
  effectiveFigures,
  payRefusal,
  requestedFigures,
  settleRefusal,
  transitionRefusal,
  wasEditedAtApproval,
} from "@/lib/manpower";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { APPROVE_ROLES, MONEY_ROLES, RAISE_ROLES, VIEW_ROLES, can } from "../_components/gates";
import { STATUS_META, figureLine } from "../_components/display";
import { ApproveForm } from "./_components/ApproveForm";
import { SettleForm } from "./_components/SettleForm";
import { PayForm } from "./_components/PayForm";

export const dynamic = "force-dynamic";

const S = ManpowerRequestStatus;

export default async function ManpowerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await gateRolePage(VIEW_ROLES);
  const request = await getManpowerRequest(id);
  if (!request) notFound();

  const role = session.user.role;
  const isRequester = request.requestedById === session.user.id;
  const canRaise = can(role, RAISE_ROLES);
  const canApprove = can(role, APPROVE_ROLES);
  const canMoney = can(role, MONEY_ROLES);

  async function doApprove(input: {
    people: number;
    days: number;
    ratePerPersonPerDay: string;
    note: string | null;
  }) {
    "use server";
    return await approveManpowerRequest({ id, ...input });
  }
  async function doReject(reason: string) {
    "use server";
    return await rejectManpowerRequest(id, reason);
  }
  async function doComplete() {
    "use server";
    return await completeManpowerRequest(id);
  }
  async function doSettle(input: { actualCost: string; note: string | null }) {
    "use server";
    return await settleManpowerCost({ id, ...input });
  }
  async function doPay(input: { method: PaymentMethod; reference: string | null; paidAt: string }) {
    "use server";
    return await payManpowerRequest({ id, ...input });
  }
  async function doCancel() {
    "use server";
    return await cancelManpowerRequest(id);
  }

  // Every control below is gated on the same helpers the action calls, so a
  // button only appears when the server would actually take it.
  const showApprove = canApprove && !transitionRefusal(request.status, S.APPROVED);
  const showComplete = canRaise && !transitionRefusal(request.status, S.COMPLETED);
  // Cancel: management can call anything off, everyone else only their own.
  const showCancel =
    (canApprove || (canRaise && isRequester)) && !transitionRefusal(request.status, S.CANCELLED);
  const settleBlocked = settleRefusal(request.status);
  const payBlocked = payRefusal(request.status, request.actualCost?.toString() ?? null);

  const asked = requestedFigures(request);
  const effective = effectiveFigures(request);
  const edited = wasEditedAtApproval(request);
  const variance = costVariance(request);
  const meta = STATUS_META[request.status];
  const approved = request.approvedAt != null;

  return (
    <>
      <PageHeader
        eyebrow={
          request.order ? `Manpower · Order ${request.order.code}` : "Manpower · No order"
        }
        title={request.workDescription}
        description={
          request.order
            ? `${request.order.customer.name} · event ${formatIST(request.order.eventDate, "d MMM yyyy")}`
            : "Standalone request — hired labour not tied to any order."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/manpower"><Button variant="outline" size="sm">← Back</Button></Link>
            {request.order && (
              <Link href={`/orders/${request.orderId}`}><Button variant="outline" size="sm">Open order</Button></Link>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        <span className="text-ik-ink-3">
          Raised by {request.requestedBy?.name ?? "—"} · {formatIST(request.createdAt)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          {/* Both figures, always. The gap between what was asked for and
              what was approved is the thing the client wants visible. */}
          <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[13px] shadow-ik-card">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">The numbers</h3>
            <dl className="grid gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <dt className="w-24 shrink-0 text-ik-ink-3">Asked for</dt>
                <dd className="font-mono">{figureLine(asked.people, asked.days, asked.rate)}</dd>
              </div>
              {approved && (
                <div className="flex flex-wrap items-baseline gap-2">
                  <dt className="w-24 shrink-0 text-ik-ink-3">Approved</dt>
                  <dd className="font-mono">
                    {figureLine(effective.people, effective.days, effective.rate)}
                  </dd>
                </div>
              )}
            </dl>
            {edited && (
              <p className="mt-2 rounded border border-amber bg-amber-wash px-2 py-1 text-[12px] text-amber">
                The manager changed the figures before approving.
              </p>
            )}
            {request.notes && (
              <p className="mt-3 text-[12.5px] text-ik-ink-2">
                <span className="text-ik-ink-3">Notes: </span>{request.notes}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[13px] shadow-ik-card">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Cost</h3>
            <dl className="grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Estimate</dt>
                <dd className="font-mono text-[16px]">{formatINR(variance.estimate)}</dd>
              </div>
              <div>
                <dt className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Actual</dt>
                <dd className="font-mono text-[16px]">
                  {variance.actual === null
                    ? <span className="text-[13px] text-ik-ink-3">Not settled yet</span>
                    : formatINR(variance.actual)}
                </dd>
              </div>
              <div>
                <dt className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Variance</dt>
                <dd className={"font-mono text-[16px] " + (variance.overrun ? "text-alert" : "")}>
                  {variance.variance === null
                    ? <span className="text-[13px] text-ik-ink-3">—</span>
                    : `${variance.overrun ? "+" : ""}${formatINR(variance.variance)}`}
                </dd>
              </div>
            </dl>
            {variance.overrun && (
              <p className="mt-2 text-[12px] text-alert">Came in over the approved estimate.</p>
            )}
          </section>

          {/* Lifecycle controls, in the order they actually happen. */}
          {showApprove && (
            <ApproveForm
              people={asked.people}
              days={asked.days}
              rate={asked.rate}
              onApprove={doApprove}
            />
          )}

          {canMoney && !settleBlocked && (
            <SettleForm
              estimate={variance.estimate.toString()}
              current={request.actualCost?.toString() ?? null}
              onSettle={doSettle}
            />
          )}

          {canMoney && !payBlocked && (
            <PayForm amountLabel={formatINR(variance.actual)} onPay={doPay} />
          )}

          {/* Why the money desk can't act yet — the same sentence the server
              would have thrown back, shown before they click. */}
          {canMoney && payBlocked && request.status !== S.PAID && (
            <p className="text-[12.5px] text-ik-ink-3">{payBlocked}</p>
          )}
        </div>

        <aside className="grid gap-4">
          <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[13px] shadow-ik-card">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">History</h3>
            <ul className="grid gap-1.5 text-[12.5px]">
              <li>
                <span className="text-ik-ink-3">Raised </span>
                {formatIST(request.createdAt)} · {request.requestedBy?.name ?? "—"}
              </li>
              {request.approvedAt && (
                <li>
                  <span className="text-ik-ink-3">Approved </span>
                  {formatIST(request.approvedAt)} · {request.approvedBy?.name ?? "—"}
                  {request.approvalNote && (
                    <div className="text-ik-ink-2">“{request.approvalNote}”</div>
                  )}
                </li>
              )}
              {request.rejectedAt && (
                <li>
                  <span className="text-ik-ink-3">Turned down </span>
                  {formatIST(request.rejectedAt)} · {request.rejectedBy?.name ?? "—"}
                  {request.rejectionReason && (
                    <div className="text-alert">“{request.rejectionReason}”</div>
                  )}
                </li>
              )}
              {request.completedAt && (
                <li>
                  <span className="text-ik-ink-3">Job done </span>
                  {formatIST(request.completedAt)} · {request.completedBy?.name ?? "—"}
                </li>
              )}
              {request.settledAt && (
                <li>
                  <span className="text-ik-ink-3">Cost settled </span>
                  {formatIST(request.settledAt)} · {request.settledBy?.name ?? "—"}
                </li>
              )}
              {request.paidAt && (
                <li>
                  <span className="text-ik-ink-3">Paid </span>
                  {formatIST(request.paidAt)} · {request.paidBy?.name ?? "—"}
                  <div className="text-ik-ink-2">
                    {request.paymentMethod}
                    {request.paymentReference ? ` · ${request.paymentReference}` : ""}
                  </div>
                </li>
              )}
              {request.cancelledAt && (
                <li>
                  <span className="text-ik-ink-3">Called off </span>
                  {formatIST(request.cancelledAt)}
                </li>
              )}
            </ul>
          </section>

          {showComplete && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[13px] shadow-ik-card">
              <h3 className="mb-1 font-medium text-[14px] text-ik-ink">The job is done</h3>
              <p className="mb-3 text-ik-ink-2">
                Mark it done once the labour has worked. Accounts can settle and pay only after this.
              </p>
              <ActionResultButton action={doComplete} successMessage="Marked done — accounts can settle it now">
                Mark job done
              </ActionResultButton>
            </section>
          )}

          {showCancel && (
            <section className="rounded-2xl border border-ik-rule bg-ik-card p-4 text-[13px] shadow-ik-card">
              <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Call it off</h3>
              <p className="mb-3 text-ik-ink-2">
                Nobody has worked yet, so nothing is owed. Once the job is done this stops being possible.
              </p>
              <ActionResultButton action={doCancel} variant="outline" successMessage="Request called off">
                Cancel request
              </ActionResultButton>
            </section>
          )}

          {showApprove && (
            <ActionReasonForm
              action={doReject}
              heading="Turn it down"
              description="The person who raised it is told the reason."
              submitLabel="Reject request"
              successMessage="Request turned down"
              placeholder="Why (required)"
            />
          )}
        </aside>
      </div>
    </>
  );
}
