import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listRecentIssues } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const issues = await listRecentIssues({ limit: 100 });

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Issues"
        description="Stock issued to orders. Most are auto-posted by the Chef Requisition workflow; direct issues are reserved for emergencies."
      />
      <InventoryNav active="issues" />

      {issues.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No issues yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issued</TableHead>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Cost at issue</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-[12px]">{formatIST(i.issuedAt)}</TableCell>
                <TableCell>
                  {i.ingredient.name} <span className="text-ik-ink-3">· {i.ingredient.sku}</span>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {i.qty.toString()} {i.ingredient.unit}
                </TableCell>
                <TableCell className="text-right font-mono">₹{i.unitCostAtIssue.toString()}</TableCell>
                <TableCell>
                  {i.order?.code ? (
                    <Link href={`/orders/${i.orderId}`} className="text-brand hover:underline font-mono">
                      {i.order.code}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-ik-ink-2">{i.note ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
