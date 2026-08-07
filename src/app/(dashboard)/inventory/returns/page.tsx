import Link from "next/link";
import { IngredientReturnStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ik/StatusPill";
import { auth } from "@/server/auth";
import { listRecentReturns } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { formatINR, toDecimal } from "@/lib/money";
import { InventoryNav } from "../_components/InventoryNav";
import { RETURN_STATUS_META } from "./_components/status";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const [session, returns] = await Promise.all([auth(), listRecentReturns({ limit: 100 })]);
  const role = session?.user?.role as Role | undefined;
  // Each link mirrors the action behind it: recording direct is the stock
  // set, declaring is the chef set.
  const canRecord = role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER;
  const canDeclare = role === Role.ADMIN || role === Role.MANAGER || role === Role.KITCHEN_HEAD;
  const waiting = returns.filter((r) => r.status === IngredientReturnStatus.DECLARED).length;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Returns from kitchen"
        description="Ingredients the chef drew but didn't use, coming back to the store. The chef declares what they're sending, the store confirms what actually arrived — and that confirmation is what puts the stock back on hand and credits the order, at the price it was issued at."
        actions={
          <span className="flex flex-wrap gap-2">
            {canDeclare && (
              <Link href="/inventory/returns/declare">
                <Button variant="outline">Declare return</Button>
              </Link>
            )}
            {canRecord && (
              <Link href="/inventory/returns/new">
                <Button>Record return</Button>
              </Link>
            )}
          </span>
        }
      />
      <InventoryNav active="returns" role={role} />

      {waiting > 0 && (
        <p className="mb-3 rounded-md border border-amber bg-amber-wash px-3 py-2 text-[12.5px] font-medium text-amber-700">
          {waiting} declaration{waiting === 1 ? "" : "s"} waiting on the store — the stock hasn&apos;t
          moved and the order hasn&apos;t been credited until each one is confirmed.
        </p>
      )}

      {returns.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No returns yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Returned</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Declared</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Credited</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.flatMap((r) => {
              const meta = RETURN_STATUS_META[r.status];
              const confirmed = r.status === IngredientReturnStatus.CONFIRMED;
              return r.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-[12px]">
                    <Link href={`/inventory/returns/${r.id}`} className="text-brand hover:underline">
                      {formatIST(r.returnedAt)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                  </TableCell>
                  <TableCell>{l.issue.ingredient.name}</TableCell>
                  <TableCell className="text-right font-mono text-ik-ink-2">
                    {l.declaredQuantity
                      ? `${l.declaredQuantity.toString()} ${l.issue.ingredient.unit}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {l.quantity.toString()} {l.issue.ingredient.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {/* Only a confirmed return has credited anything. */}
                    {confirmed
                      ? formatINR(toDecimal(l.quantity).times(toDecimal(l.unitCost)))
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {l.issue.order ? (
                      <Link
                        href={`/orders/${l.issue.order.id}`}
                        className="font-mono text-brand hover:underline"
                      >
                        {l.issue.order.code}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-ik-ink-2">{l.reason}</TableCell>
                  <TableCell className="text-ik-ink-2">{r.recordedBy.name}</TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
