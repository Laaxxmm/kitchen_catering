import Link from "next/link";
import type { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listRecentReceipts } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const [session, receipts] = await Promise.all([auth(), listRecentReceipts({ limit: 100 })]);
  const role = session?.user?.role as Role | undefined;

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Receipts — add new stock"
        description="Every receipt updates on-hand quantity and moving-average cost atomically. The recorder is logged for every entry."
        actions={
          <Link href="/inventory/receipts/new">
            <Button>Add stock</Button>
          </Link>
        }
      />
      <InventoryNav active="receipts" role={role} />

      {receipts.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No receipts yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Recorded by</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-[12px]">{formatIST(r.receivedAt)}</TableCell>
                <TableCell>
                  <Link href={`/inventory/ingredients/${r.ingredientId}`} className="text-brand hover:underline">
                    {r.ingredient.name}
                  </Link>
                  <span className="text-ik-ink-3"> · {r.ingredient.sku}</span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {r.qty.toString()} {r.ingredient.unit}
                </TableCell>
                <TableCell className="text-right font-mono">₹{r.unitCost.toString()}</TableCell>
                <TableCell>{r.supplier ?? "—"}</TableCell>
                <TableCell className="text-[12.5px] text-ik-ink-2">{r.recordedBy?.name ?? "—"}</TableCell>
                <TableCell className="text-ik-ink-2">{r.note ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
