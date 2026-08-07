import Link from "next/link";
import type { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listRecentAdjustments } from "@/server/actions/inventory";
import { canEditStockDirectly } from "@/lib/stock-movement";
import { formatIST } from "@/lib/time";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage() {
  const [session, adjustments] = await Promise.all([
    auth(),
    listRecentAdjustments({ limit: 200 }),
  ]);
  const role = session?.user?.role as Role | undefined;
  // The store keeper still reads this log — it is the record of what a
  // manager corrected under them — but can no longer post one.
  const canAdjust = canEditStockDirectly(role);

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Stock adjustments"
        description="Manual on-hand corrections — write-offs, opening fixes, spoilage. Every change is logged with who made it."
        actions={
          canAdjust ? (
            <Link href="/inventory/adjustments/new">
              <Button>Adjust stock</Button>
            </Link>
          ) : undefined
        }
      />
      <InventoryNav active="adjustments" role={role} />

      {!canAdjust && (
        <p className="mb-4 rounded-md border border-ik-rule bg-ik-card px-3 py-2 text-[13px] text-ik-ink-2">
          Correcting a stock figure by hand is a manager&rsquo;s call. Record what
          actually happened instead —{" "}
          <Link href="/inventory/receipts" className="text-brand hover:underline">goods received</Link>,{" "}
          <Link href="/inventory/issues" className="text-brand hover:underline">stock issued out</Link>{" "}
          or a{" "}
          <Link href="/inventory/returns" className="text-brand hover:underline">return from the kitchen</Link>.
          If the count still doesn&rsquo;t match after that, ask a manager to post the correction.
        </p>
      )}

      {adjustments.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No adjustments yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Before</TableHead>
              <TableHead className="text-right">Delta</TableHead>
              <TableHead className="text-right">After</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Adjusted by</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.map((a) => {
              const delta = a.delta.toString();
              const isPositive = !delta.startsWith("-");
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-[12px]">{formatIST(a.adjustedAt)}</TableCell>
                  <TableCell>
                    <Link href={`/inventory/ingredients/${a.ingredientId}`} className="text-brand hover:underline">
                      {a.ingredient.name}
                    </Link>
                    <span className="text-ik-ink-3"> · {a.ingredient.sku}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-ik-ink-3">
                    {a.beforeQty.toString()} {a.ingredient.unit}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right font-mono " + (isPositive ? "text-brand-700" : "text-alert")
                    }
                  >
                    {isPositive ? "+" : ""}
                    {delta} {a.ingredient.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {a.afterQty.toString()} {a.ingredient.unit}
                  </TableCell>
                  <TableCell>{a.reason}</TableCell>
                  <TableCell className="text-[12.5px] text-ik-ink-2">{a.adjustedBy.name}</TableCell>
                  <TableCell className="text-ik-ink-2">{a.note ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
