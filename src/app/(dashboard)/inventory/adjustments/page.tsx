import Link from "next/link";
import type { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listRecentAdjustments } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage() {
  const [session, adjustments] = await Promise.all([
    auth(),
    listRecentAdjustments({ limit: 200 }),
  ]);
  const role = session?.user?.role as Role | undefined;

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Stock adjustments"
        description="Manual on-hand corrections — write-offs, opening fixes, spoilage. Every change is logged with who made it. (Store keeper edits need the admin toggle in Settings.)"
        actions={
          <Link href="/inventory/adjustments/new">
            <Button>Adjust stock</Button>
          </Link>
        }
      />
      <InventoryNav active="adjustments" role={role} />

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
