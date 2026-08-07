import Link from "next/link";
import { notFound } from "next/navigation";
import { IngredientReturnStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ik/StatusPill";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";
import { auth } from "@/server/auth";
import { gateRolePage } from "@/server/rbac";
import {
  confirmIngredientReturn,
  getIngredientReturn,
  rejectIngredientReturnDeclaration,
} from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { formatINR, toDecimal } from "@/lib/money";
import { RETURN_STATUS_META } from "../_components/status";
import { ConfirmForm } from "./_components/ConfirmForm";

export const dynamic = "force-dynamic";

/**
 * One kitchen return document. While it's DECLARED this is the store's
 * counter screen — count what arrived, confirm, and the stock moves. Once
 * it's CONFIRMED or REJECTED it's the record of what happened, which is
 * what the chef opens to see whether their handover landed.
 */
export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Matches the middleware rule for this route exactly. The chef is here to
  // see whether their own handover landed; the two actions keep their own,
  // narrower gates and the controls below mirror them.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD]);
  const [doc, session] = await Promise.all([getIngredientReturn(id), auth()]);
  if (!doc) notFound();

  const role = session?.user?.role as Role | undefined;
  const pending = doc.status === IngredientReturnStatus.DECLARED;
  // Mirrors confirmIngredientReturn's gate exactly — no control that would
  // be refused.
  const canConfirm =
    pending && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  // And rejectIngredientReturnDeclaration's: the confirm set, plus the chef
  // who raised this one, for their own row only.
  const canReject =
    canConfirm || (pending && role === Role.KITCHEN_HEAD && doc.recordedById === session?.user?.id);
  const isOwnDeclaration = doc.recordedById === session?.user?.id;
  // /inventory/returns itself stays store-only — don't offer the chef a link
  // that lands on /forbidden.
  const canSeeReturnsList =
    role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER;
  const meta = RETURN_STATUS_META[doc.status];
  const orderId = doc.lines.find((l) => l.issue.order)?.issue.order?.id ?? null;

  async function confirm(input: {
    note: string | null;
    lines: { lineId: string; receivedQty: string }[];
  }) {
    "use server";
    return confirmIngredientReturn({ id, ...input });
  }
  async function reject(reason: string) {
    "use server";
    return rejectIngredientReturnDeclaration(id, reason);
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations · Kitchen return"
        title={pending ? "Confirm what arrived" : "Kitchen return"}
        description={
          pending
            ? "The chef says this is coming back. Count what physically reached the counter and confirm — that, and only that, puts the stock back on hand and credits the order."
            : "What was declared, what was received, and who booked it in."
        }
        actions={
          canSeeReturnsList ? (
            <Link href="/inventory/returns">
              <Button variant="outline" size="sm">← All returns</Button>
            </Link>
          ) : null
        }
      />

      <div className="mb-4 grid gap-1 text-[13px]">
        <div className="flex items-center gap-2">
          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
          <span className="text-ik-ink-2">
            {doc.lines.some((l) => l.declaredQuantity != null)
              ? `Declared by ${doc.recordedBy.name}`
              : `Recorded by ${doc.recordedBy.name}`}{" "}
            · {formatIST(doc.returnedAt)}
          </span>
        </div>
        {doc.notes && <p className="text-ik-ink-2">Chef&apos;s note: {doc.notes}</p>}
        {doc.confirmedAt && (
          <p className="text-ik-ink-2">
            Confirmed by {doc.confirmedBy?.name ?? "—"} · {formatIST(doc.confirmedAt)}
            {doc.confirmationNote ? ` · ${doc.confirmationNote}` : ""}
          </p>
        )}
        {doc.rejectedAt && (
          <p className="text-alert">
            {doc.rejectedById === doc.recordedById ? "Withdrawn" : "Turned down"} by{" "}
            {doc.rejectedBy?.name ?? "—"} · {formatIST(doc.rejectedAt)} · {doc.rejectionReason}
          </p>
        )}
      </div>

      {canConfirm ? (
        <ConfirmForm
          lines={doc.lines.map((l) => ({
            id: l.id,
            ingredientName: l.issue.ingredient.name,
            unit: l.issue.ingredient.unit,
            declaredQty: (l.declaredQuantity ?? l.quantity).toString(),
            reason: l.reason,
            orderCode: l.issue.order?.code ?? null,
          }))}
          onSubmit={confirm}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Declared</TableHead>
              <TableHead className="text-right">
                {doc.status === IngredientReturnStatus.CONFIRMED ? "Received" : "Pending"}
              </TableHead>
              <TableHead className="text-right">Credited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {doc.lines.map((l) => {
              const short =
                l.declaredQuantity != null &&
                doc.status === IngredientReturnStatus.CONFIRMED &&
                !toDecimal(l.quantity).eq(toDecimal(l.declaredQuantity));
              return (
                <TableRow key={l.id}>
                  <TableCell>{l.issue.ingredient.name}</TableCell>
                  <TableCell className="font-mono text-[12px]">
                    {l.issue.order ? l.issue.order.code : "—"}
                  </TableCell>
                  <TableCell className="text-ik-ink-2">{l.reason}</TableCell>
                  <TableCell className="text-right font-mono">
                    {l.declaredQuantity ? `${l.declaredQuantity.toString()} ${l.issue.ingredient.unit}` : "—"}
                  </TableCell>
                  <TableCell className={"text-right font-mono" + (short ? " text-amber-700" : "")}>
                    {l.quantity.toString()} {l.issue.ingredient.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {doc.status === IngredientReturnStatus.CONFIRMED
                      ? formatINR(toDecimal(l.quantity).times(toDecimal(l.unitCost)))
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {canReject && (
        <div className="mt-5 max-w-md">
          <ActionReasonForm
            action={reject}
            heading={isOwnDeclaration ? "Withdraw this declaration" : "Nothing arrived — turn it down"}
            description={
              isOwnDeclaration
                ? "You're not sending this back after all. Nothing has moved, so nothing is reversed."
                : "Use this when the stock never reached the counter. Nothing has moved, so nothing is reversed — and what this was holding against the issue is free again."
            }
            submitLabel={isOwnDeclaration ? "Withdraw" : "Turn down"}
            successMessage={isOwnDeclaration ? "Declaration withdrawn" : "Declaration turned down"}
            placeholder="e.g. only the veg trolley came back, the paneer never left the kitchen"
            redirectTo={
              orderId ? `/orders/${orderId}` : canSeeReturnsList ? "/inventory/returns" : "/dashboard"
            }
          />
        </div>
      )}
    </>
  );
}
