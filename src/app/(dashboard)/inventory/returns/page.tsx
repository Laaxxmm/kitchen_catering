import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listRecentReturns } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { formatINR, toDecimal } from "@/lib/money";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const [session, returns] = await Promise.all([auth(), listRecentReturns({ limit: 100 })]);
  const role = session?.user?.role as Role | undefined;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Returns from kitchen"
        description="Ingredients the chef drew but didn't use, coming back to the store. Each line credits the order it was issued against, at the price it was issued at."
        actions={
          <Link href="/inventory/returns/new">
            <Button>Record return</Button>
          </Link>
        }
      />
      <InventoryNav active="returns" role={role} />

      {returns.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No returns yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Returned</TableHead>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Credited</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.flatMap((r) =>
              r.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-[12px]">{formatIST(r.returnedAt)}</TableCell>
                  <TableCell>{l.issue.ingredient.name}</TableCell>
                  <TableCell className="text-right font-mono">
                    {l.quantity.toString()} {l.issue.ingredient.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatINR(toDecimal(l.quantity).times(toDecimal(l.unitCost)))}
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
              )),
            )}
          </TableBody>
        </Table>
      )}
    </>
  );
}
