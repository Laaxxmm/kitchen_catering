import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentEntityType, PettyCashVoucherStatus } from "@prisma/client";
import { DocumentUploader } from "@/components/ik/DocumentUploader";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createPettyCashVoucher,
  getPettyCashFloat,
  reversePettyCashVoucher,
  topUpPettyCash,
} from "@/server/actions/petty-cash";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PettyCashFloatDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const float = await getPettyCashFloat(id);
  if (!float) notFound();

  async function newVoucher(formData: FormData) {
    "use server";
    const amount = String(formData.get("amount") ?? "");
    const category = String(formData.get("category") ?? "");
    const paidTo = String(formData.get("paidTo") ?? "");
    const reason = String(formData.get("reason") ?? "");
    if (!amount || !category || !paidTo || !reason) return;
    await createPettyCashVoucher({ floatId: id, amount, category, paidTo, reason });
  }
  async function newTopUp(formData: FormData) {
    "use server";
    const amount = String(formData.get("amount") ?? "");
    const source = String(formData.get("source") ?? "");
    const reference = String(formData.get("reference") ?? "").trim();
    if (!amount || !source) return;
    await topUpPettyCash({ floatId: id, amount, source, reference: reference || null });
  }
  async function reverse(voucherId: string, formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return;
    await reversePettyCashVoucher(voucherId, reason);
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
          <form action={newVoucher} className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="amount">Amount (₹)</Label>
                <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="category">Category</Label>
                <Input id="category" name="category" placeholder="fuel, subzi, tea-coffee…" required />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="paidTo">Paid to</Label>
              <Input id="paidTo" name="paidTo" required />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="reason">Reason</Label>
              <Input id="reason" name="reason" required />
            </div>
            <Button type="submit" size="sm">Record voucher</Button>
          </form>
        </section>

        <section className="rounded-md border border-ik-rule bg-ik-card p-4">
          <h3 className="mb-3 font-medium text-[14px] text-ik-ink">Top up</h3>
          <form action={newTopUp} className="grid gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="topupAmount">Amount (₹)</Label>
                <Input id="topupAmount" name="amount" type="number" step="0.01" min="0.01" required />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="source">Source</Label>
                <select id="source" name="source" required className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="OWNER_CONTRIB">Owner contribution</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="reference">Reference</Label>
              <Input id="reference" name="reference" placeholder="optional" />
            </div>
            <Button type="submit" size="sm">Add top-up</Button>
          </form>
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
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-[12px]">{v.voucherNo}</TableCell>
                  <TableCell className="font-mono text-[12px]">{formatIST(v.paidAt, "yyyy-MM-dd")}</TableCell>
                  <TableCell>{v.category}</TableCell>
                  <TableCell>{v.paidTo}</TableCell>
                  <TableCell className="text-[12px] text-ik-ink-2">{v.reason}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(v.amount)}</TableCell>
                  <TableCell>{v.status}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <DocumentUploader
                        entityType={DocumentEntityType.PETTY_CASH_VOUCHER}
                        entityId={v.id}
                        label="Attach bill"
                      />
                      {v.status === PettyCashVoucherStatus.POSTED && (
                        <form action={reverse.bind(null, v.id)} className="inline">
                          <input name="reason" placeholder="Reason" className="h-6 w-24 rounded border border-ik-rule bg-ik-card px-1 text-[11px]" />
                          <Button type="submit" size="sm" variant="outline" className="ml-1">Reverse</Button>
                        </form>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
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
