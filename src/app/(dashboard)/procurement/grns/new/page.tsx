import { notFound, redirect } from "next/navigation";
import { Decimal } from "decimal.js";
import { PageHeader } from "@/components/ui/page-header";
import { getVendorPO, createGRN } from "@/server/actions/procurement";
import { GRNForm } from "./_components/GRNForm";

export const dynamic = "force-dynamic";

export default async function NewGRNPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  const { poId } = await searchParams;
  if (!poId) return <p className="p-4 text-[13px] text-ik-ink-3">Pass <code>?poId=&lt;id&gt;</code>.</p>;
  const po = await getVendorPO(poId);
  if (!po) notFound();

  async function create(input: { poId: string; notes: string | null; lines: Array<{ poLineId: string; acceptedQty: string; rejectedQty: string; reason: string | null }> }) {
    "use server";
    const r = await createGRN(input);
    redirect(`/procurement/grns/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`GRN · PO ${po.poNo}`}
        title="Receive goods"
        description={`Vendor: ${po.vendor.name}. Fill accepted / rejected qty per line. Accepted qty posts to inventory atomically.`}
      />
      <GRNForm
        poId={po.id}
        lines={po.lines.map((l) => ({
          id: l.id,
          description: l.description,
          unit: l.unit,
          ordered: l.quantity.toString(),
          alreadyReceived: l.receivedQty.toString(),
          remaining: new Decimal(l.quantity.toString()).minus(new Decimal(l.receivedQty.toString())).toString(),
        }))}
        onSubmit={create}
      />
    </>
  );
}
