import Link from "next/link";
import { notFound } from "next/navigation";
import { PettyCashVoucherStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VoucherForm } from "./_components/VoucherForm";
import { TopUpForm } from "./_components/TopUpForm";
import { VoucherRow } from "./_components/VoucherRow";
import {
  createPettyCashVoucher,
  deletePettyCashVoucher,
  getPettyCashFloat,
  topUpPettyCash,
  updatePettyCashVoucher,
} from "@/server/actions/petty-cash";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PettyCashFloatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const float = await getPettyCashFloat(id);
  if (!float) notFound();

  async function newVoucher(input: { amount: string; category: string; paidTo: string; reason: string; paidAt: string }) {
    "use server";
    return await createPettyCashVoucher({ floatId: id, ...input });
  }
  async function editVoucher(
    voucherId: string,
    input: { amount: string; category: string; paidTo: string; reason: string; paidAt: string },
  ) {
    "use server";
    return await updatePettyCashVoucher(voucherId, input);
  }
  async function removeVoucher(voucherId: string, reason: string) {
    "use server";
    return await deletePettyCashVoucher(voucherId, reason);
  }
  async function newTopUp(input: { amount: string; source: string; reference: string | null }) {
    "use server";
    return await topUpPettyCash({ floatId: id, ...input });
  }

  return (
    <>
      <PageHeader
        eyebrow="Petty cash"
        title={float.name}
        description={`Custodian: ${float.custodian.name} · Current balance: ${formatINR(float.currentBalance)}`}
        actions={<Link href="/petty-cash"><Button variant="outline">Back</Button></Link>}
      />

      <div className="grid gap-6 md:grid-cols-2 max-w-5xl">
        <section className="rounded-md border border-ik-rule bg-ik-card p-4">
          <h3 className="mb-3 font-medium text-[14px] text-ik-ink">Record voucher</h3>
          <VoucherForm onSubmit={newVoucher} />
        </section>

        <section className="rounded-md border border-ik-rule bg-ik-card p-4">
          <h3 className="mb-3 font-medium text-[14px] text-ik-ink">Top up</h3>
          <TopUpForm onSubmit={newTopUp} />
        </section>
      </div>

      <section className="mt-6">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vouchers</h3>
        {float.vouchers.length === 0 ? (
          <p className="text-[13px] text-ik-ink-3">No vouchers yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid to</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {float.vouchers.map((v) => (
                <VoucherRow
                  key={v.id}
                  voucher={{
                    id: v.id,
                    voucherNo: v.voucherNo,
                    dateLabel: formatIST(v.paidAt, "yyyy-MM-dd"),
                    category: v.category,
                    paidTo: v.paidTo,
                    reason: v.reason,
                    amountLabel: formatINR(v.amount),
                    status: v.status,
                    editable: v.status !== PettyCashVoucherStatus.REVERSED,
                    edit: {
                      amount: v.amount.toString(),
                      category: v.category,
                      paidTo: v.paidTo,
                      reason: v.reason,
                      paidAt: formatIST(v.paidAt, "yyyy-MM-dd'T'HH:mm"),
                    },
                  }}
                  onUpdate={editVoucher.bind(null, v.id)}
                  onDelete={removeVoucher.bind(null, v.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Top-ups</h3>
        {float.topUps.length === 0 ? (
          <p className="text-[13px] text-ik-ink-3">No top-ups yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Approved by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {float.topUps.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-[12px]">{formatIST(t.createdAt, "yyyy-MM-dd")}</TableCell>
                  <TableCell>{t.source}</TableCell>
                  <TableCell className="font-mono text-[12px]">{t.reference ?? "—"}</TableCell>
                  <TableCell>{t.approvedBy?.name ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(t.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
