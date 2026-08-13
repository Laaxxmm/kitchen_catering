import { notFound } from "next/navigation";
import { Decimal } from "decimal.js";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { getVendorPO, createGRN } from "@/server/actions/procurement";
import { listIngredients } from "@/server/actions/inventory";
import { listBanquetPickerItems } from "@/server/actions/banquet";
import { gateRolePage } from "@/server/rbac";
import { GRNForm, type GRNSubmitInput } from "./_components/GRNForm";

export const dynamic = "force-dynamic";

export default async function NewGRNPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  // The store keeper records goods receipt against their PO (+ manager / admin / accounts).
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER]);
  const { poId } = await searchParams;
  if (!poId) return <p className="p-4 text-[13px] text-ik-ink-3">Pass <code>?poId=&lt;id&gt;</code>.</p>;
  const po = await getVendorPO(poId);
  if (!po) notFound();

  // Both catalogues, for the "they also brought this" picker. The vendor
  // decides what turns up, not the PO, so the choice can't be narrowed to
  // what was ordered.
  const [ingredients, banquetItems] = await Promise.all([
    listIngredients({ active: true }),
    listBanquetPickerItems(),
  ]);

  // Returns the full result (id + optional unit-mismatch warnings) instead
  // of redirecting server-side — the form toasts the warnings first, then
  // navigates to the created GRN. A redirect() here would throw past the
  // client and the warnings would never be seen.
  async function create(input: GRNSubmitInput) {
    "use server";
    return await createGRN(input);
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
        catalogue={[
          ...ingredients.map((i) => ({
            key: `ing:${i.id}`,
            ingredientId: i.id,
            banquetItemId: null,
            label: `${i.sku} · ${i.name}`,
            unit: i.unit,
          })),
          ...banquetItems.map((b) => ({
            key: `fnb:${b.id}`,
            ingredientId: null,
            banquetItemId: b.id,
            label: `${b.sku ?? "—"} · ${b.name} (F&B)`,
            unit: b.unit,
          })),
        ]}
        onSubmit={create}
      />
    </>
  );
}
