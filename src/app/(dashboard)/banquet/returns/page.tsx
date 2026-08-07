import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listOrdersWithBanquetStockOut } from "@/server/actions/banquet";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The F&B store's return worklist. The team hands stock back order by order,
 * so the way in is an order — not a flat list of issues to hunt through.
 * Same gate as recordBanquetReturn (ISSUE_ROLES): whoever can book the
 * movement can open the list.
 */
export default async function BanquetReturnsPage() {
  await gateRolePage([
    Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER,
  ]);
  const orders = await listOrdersWithBanquetStockOut();

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Returns"
        description="Stock IN — items coming back from an event. Pick the order the stock came from; only what actually went out on that order can come back."
        actions={<Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>}
      />

      {orders.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          Nothing is out with a client — every item issued to an order has come back.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Last issued</TableHead>
              <TableHead>Items still out</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.orderId}>
                <TableCell className="font-mono text-[12px]">
                  <Link href={`/orders/${o.orderId}`} className="text-brand hover:underline">
                    {o.code}
                  </Link>
                </TableCell>
                <TableCell className="text-[12.5px]">{o.customer}</TableCell>
                <TableCell className="font-mono text-[12px]">
                  {formatIST(o.lastIssuedAt, "dd MMM yyyy")}
                </TableCell>
                <TableCell className="text-[12.5px]">{o.itemsOut}</TableCell>
                <TableCell>
                  <Link href={`/banquet/returns/${o.orderId}`}>
                    <Button size="sm" variant="outline">Record return</Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
