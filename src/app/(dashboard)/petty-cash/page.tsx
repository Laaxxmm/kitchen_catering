import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPettyCashFloats } from "@/server/actions/petty-cash";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PettyCashPage() {
  const floats = await listPettyCashFloats();
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Petty cash"
        description="Float ledger. Each float has a custodian, an opening balance, top-ups and vouchers. Balance updates atomically with every voucher / top-up."
        actions={<Link href="/petty-cash/new"><Button>New float</Button></Link>}
      />
      {floats.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No floats yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Custodian</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Vouchers</TableHead>
              <TableHead className="text-right">Top-ups</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {floats.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <Link href={`/petty-cash/floats/${f.id}`} className="text-brand hover:underline">{f.name}</Link>
                </TableCell>
                <TableCell>{f.custodian.name}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(f.openingBalance)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(f.currentBalance)}</TableCell>
                <TableCell className="text-right">{f._count.vouchers}</TableCell>
                <TableCell className="text-right">{f._count.topUps}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
