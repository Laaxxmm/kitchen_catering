import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QuoteEventKind, QuoteStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  acceptQuote,
  convertQuoteToOrder,
  flagQuoteChangesRequested,
  getQuote,
  markQuoteLost,
  resendQuoteEmail,
  reviseQuote,
  sendQuote,
} from "@/server/actions/quotes";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, session] = await Promise.all([getQuote(id), auth()]);
  if (!quote) notFound();

  const role = session?.user?.role;
  const canEdit =
    role === Role.ADMIN || role === Role.MANAGER || role === Role.SALES;

  // Server-action shims — each RETURNS the action's result so the client
  // wrappers (ActionResultButton / ActionReasonForm) can toast refusals.
  async function doSend() { "use server"; return await sendQuote(id); }
  async function doResendEmail() { "use server"; return await resendQuoteEmail(id); }
  async function doAccept(note: string) {
    "use server";
    return await acceptQuote(id, note || undefined);
  }
  async function doMarkLost(reason: string) {
    "use server";
    return await markQuoteLost(id, reason);
  }
  async function doFlagChanges(note: string) {
    "use server";
    return await flagQuoteChangesRequested(id, note);
  }
  async function doRevise() {
    "use server";
    const r = await reviseQuote(id);
    if (!r.ok) return r;
    redirect(`/quotes/${r.id}`);
  }
  async function doConvert() {
    "use server";
    const r = await convertQuoteToOrder(id);
    if (!r.ok) return r;
    redirect(`/orders/${r.orderId}`);
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const publicUrl = `${baseUrl}/q/${quote.shareToken}`;

  const isOpen =
    quote.status === QuoteStatus.DRAFT ||
    quote.status === QuoteStatus.SENT ||
    quote.status === QuoteStatus.CHANGES_REQUESTED ||
    quote.status === QuoteStatus.NEGOTIATING ||
    quote.status === QuoteStatus.REVISED;

  return (
    <>
      <PageHeader
        eyebrow={`Quote · ${quote.customer.name}`}
        title={`${quote.quoteNo}${quote.version > 1 ? ` (v${quote.version})` : ""} · ${quote.title}`}
        description={
          quote.eventDate
            ? `Event ${formatIST(quote.eventDate, "EEE d MMM yyyy")} · ${formatINR(quote.grandTotal)}`
            : `${formatINR(quote.grandTotal)}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/quotes"><Button variant="outline">Back</Button></Link>
            {canEdit && quote.status === QuoteStatus.DRAFT && (
              <ActionResultButton action={doSend} successMessage="Quote sent to customer">Send to customer</ActionResultButton>
            )}
            {canEdit && quote.status === QuoteStatus.REVISED && (
              <ActionResultButton action={doSend} successMessage="Revised quote sent">Send revised quote</ActionResultButton>
            )}
            {canEdit && quote.status === QuoteStatus.ACCEPTED && !quote.orderId && (
              <ActionResultButton action={doConvert}>Convert to order</ActionResultButton>
            )}
            {canEdit && isOpen && quote.status !== QuoteStatus.DRAFT && quote.status !== QuoteStatus.REVISED && (
              <ActionResultButton action={doRevise} variant="outline">Revise (new version)</ActionResultButton>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
        <StatusBadge status={quote.status} />
        <span className="text-ik-ink-3">Created by {quote.createdBy?.name ?? "—"}</span>
        {quote.sentAt && <span className="text-ik-ink-3">· Sent {formatIST(quote.sentAt)}</span>}
        {quote.acceptedAt && <span className="text-ik-ink-3">· Accepted {formatIST(quote.acceptedAt)}</span>}
        {quote.convertedAt && quote.order && (
          <span className="text-ik-ink-3">
            · Converted to order{" "}
            <Link href={`/orders/${quote.order.id}`} className="font-mono text-brand hover:underline">
              {quote.order.code}
            </Link>
          </span>
        )}
        {quote.validUntil && (
          <span className="text-ik-ink-3">· Valid until {formatIST(quote.validUntil, "yyyy-MM-dd")}</span>
        )}
      </div>

      {/* Next-step banner */}
      <NextStepBanner status={quote.status} canEdit={canEdit} hasOrder={!!quote.orderId} publicUrl={publicUrl} />

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 grid gap-4">
          {/* Lines */}
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Lines</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit ₹</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.description}
                      {l.dish?.name && l.description !== l.dish.name && (
                        <span className="text-ik-ink-3"> · {l.dish.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {l.quantity.toString()} {l.unit}
                    </TableCell>
                    <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-3 text-right text-[13px] font-mono">
              <div><span className="text-ik-ink-3">Subtotal</span> {quote.subtotal.toString()}</div>
              <div><span className="text-ik-ink-3">Tax</span> {quote.taxTotal.toString()}</div>
              <div className="font-medium"><span className="text-ik-ink-3">Grand total</span> {formatINR(quote.grandTotal)}</div>
            </div>
          </div>

          {/* Timeline */}
          {quote.events.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Timeline</h3>
              <ol className="grid gap-2 text-[12.5px]">
                {quote.events.map((e) => (
                  <li key={e.id}>
                    <span className="text-ik-ink-3">{eventLabel(e.kind)}</span>{" "}
                    <span className="font-mono">{formatIST(e.at)}</span>
                    {e.actor?.name && <span className="text-ik-ink-3"> · {e.actor.name}</span>}
                    {e.note && (
                      <div className="mt-1 border-l-2 border-ik-rule pl-2 italic text-ik-ink-2">
                        {e.note}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Revisions */}
          {(quote.parentQuote || quote.revisions.length > 0) && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Versions</h3>
              <ul className="grid gap-1 text-[12.5px]">
                {quote.parentQuote && (
                  <li>
                    <span className="text-ik-ink-3">Previous version:</span>{" "}
                    <Link href={`/quotes/${quote.parentQuote.id}`} className="font-mono text-brand hover:underline">
                      {quote.parentQuote.quoteNo}
                    </Link>{" "}
                    <span className="text-ik-ink-3">(v{quote.parentQuote.version})</span>
                  </li>
                )}
                {quote.revisions.map((r) => (
                  <li key={r.id}>
                    <span className="text-ik-ink-3">Newer version:</span>{" "}
                    <Link href={`/quotes/${r.id}`} className="font-mono text-brand hover:underline">
                      {r.quoteNo}
                    </Link>{" "}
                    <span className="text-ik-ink-3">(v{r.version}) — {r.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          {/* Customer + share */}
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Customer</h3>
            <div>{quote.customer.name}</div>
            {quote.customer.email && <div className="font-mono text-[12px] text-ik-ink-2">{quote.customer.email}</div>}
            {quote.customer.phone && <div className="font-mono text-[12px] text-ik-ink-2">{quote.customer.phone}</div>}
          </div>

          {(quote.status !== QuoteStatus.DRAFT) && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Share with customer</h3>
              {quote.customer.email ? (
                <>
                  <p className="text-[12px] text-ik-ink-3">
                    Customer email on file: <span className="font-mono text-ik-ink-2">{quote.customer.email}</span>
                  </p>
                  {canEdit && (
                    <div className="mt-2">
                      <ActionResultButton action={doResendEmail} size="sm" successMessage="Quote re-sent by email">
                        Resend by email
                      </ActionResultButton>
                    </div>
                  )}
                </>
              ) : (
                <p className="rounded bg-amber-wash px-2 py-1 text-[12px] text-amber">
                  ⚠ No email on file — add one on the customer page if you want automated sends.
                </p>
              )}
              <div className="mt-3 border-t border-ik-rule pt-3">
                <p className="text-[12px] text-ik-ink-3">Or share this link manually (WhatsApp, SMS, etc.):</p>
                <Link
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block break-all rounded border border-ik-rule bg-ik-paper-alt px-2 py-1 text-[11.5px] text-brand hover:underline"
                >
                  {publicUrl}
                </Link>
              </div>
            </div>
          )}

          {/* Status-transition forms */}
          {canEdit && (quote.status === QuoteStatus.SENT || quote.status === QuoteStatus.NEGOTIATING || quote.status === QuoteStatus.CHANGES_REQUESTED || quote.status === QuoteStatus.REVISED) && (
            <ActionReasonForm
              action={doAccept}
              heading="Customer accepted"
              placeholder="Optional note (verbal confirmation, email reply, etc.)"
              submitLabel="Mark accepted"
              successMessage="Quote marked accepted"
              required={false}
              tone="brand"
              buttonVariant="default"
            />
          )}

          {canEdit && (quote.status === QuoteStatus.SENT || quote.status === QuoteStatus.NEGOTIATING) && (
            <ActionReasonForm
              action={doFlagChanges}
              heading="Customer wants changes"
              placeholder="What does the customer want changed?"
              submitLabel="Log change request"
              successMessage="Change request logged"
              tone="warning"
            />
          )}

          {canEdit && isOpen && (
            <ActionReasonForm
              action={doMarkLost}
              heading="Lost"
              placeholder="Reason — required"
              submitLabel="Mark lost"
              successMessage="Quote marked lost"
            />
          )}
        </aside>
      </div>
    </>
  );
}

function eventLabel(kind: QuoteEventKind): string {
  switch (kind) {
    case QuoteEventKind.SENT: return "Sent to customer";
    case QuoteEventKind.CUSTOMER_VIEWED: return "Customer viewed";
    case QuoteEventKind.CHANGES_REQUESTED: return "Customer requested changes";
    case QuoteEventKind.REVISION_ISSUED: return "New revision issued";
    case QuoteEventKind.NEGOTIATION: return "Negotiation note";
    case QuoteEventKind.ACCEPTED: return "Customer accepted";
    case QuoteEventKind.REJECTED: return "Quote lost";
    case QuoteEventKind.NOTE: return "Note";
    default: return kind;
  }
}

interface NextStepProps {
  status: QuoteStatus;
  canEdit: boolean;
  hasOrder: boolean;
  publicUrl: string;
}

function NextStepBanner({ status, canEdit, hasOrder, publicUrl }: NextStepProps) {
  let body: React.ReactNode = null;
  let tone: "info" | "urgent" | "muted" = "info";
  if (status === QuoteStatus.DRAFT) {
    body = (
      <>
        <strong>Next:</strong> Review the lines and hit <em>Send to customer</em> in the header. We&apos;ll
        email the quote to the customer automatically (if they have an email on file) and surface a
        public share link you can also paste into WhatsApp.
      </>
    );
    tone = canEdit ? "urgent" : "info";
  } else if (status === QuoteStatus.SENT) {
    body = (
      <>
        <strong>Next:</strong> Customer has been emailed. While you wait, you can resend, share the
        link below manually, or use the sidebar to mark the response when it comes in.
        <div className="mt-2 break-all font-mono text-[11.5px]">{publicUrl}</div>
      </>
    );
    tone = "info";
  } else if (status === QuoteStatus.CHANGES_REQUESTED) {
    body = (
      <>
        <strong>Next:</strong> Customer asked for changes. Hit <em>Revise (new version)</em> to clone
        this quote into a fresh draft, adjust the lines, and send the revised version.
      </>
    );
    tone = "urgent";
  } else if (status === QuoteStatus.REVISED) {
    body = (
      <>
        <strong>Next:</strong> This quote was revised — a newer version supersedes it. Either open the
        latest revision (under <em>Versions</em>) or send this one out again.
      </>
    );
    tone = "muted";
  } else if (status === QuoteStatus.ACCEPTED) {
    body = hasOrder ? (
      <>
        <strong>Done.</strong> This quote has already been converted to an order — see the link in the
        status row above.
      </>
    ) : (
      <>
        <strong>Next:</strong> Customer accepted. Hit <em>Convert to order</em> in the header to start
        the kitchen flow. The order goes straight to chef approval.
      </>
    );
    tone = hasOrder ? "muted" : "urgent";
  } else if (status === QuoteStatus.CONVERTED) {
    body = (
      <>
        <strong>Done.</strong> Converted to an order. The kitchen-side workflow takes over from here.
      </>
    );
    tone = "muted";
  } else if (status === QuoteStatus.LOST || status === QuoteStatus.EXPIRED) {
    body = (
      <>
        <strong>Closed.</strong> This quote is no longer active. The customer record keeps the history
        so future asks can reference it.
      </>
    );
    tone = "muted";
  }
  if (!body) return null;
  const palette =
    tone === "urgent"
      ? "border-amber bg-amber-wash text-ik-ink"
      : tone === "muted"
        ? "border-ik-rule bg-ik-paper-alt text-ik-ink-2"
        : "border-brand-200 bg-brand-50 text-ik-ink";
  return (
    <div className={"mb-5 rounded-md border p-3 text-[13px] " + palette}>
      {body}
    </div>
  );
}
