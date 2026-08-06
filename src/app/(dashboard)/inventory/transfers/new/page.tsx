import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listTransferItems, recordStockTransfer } from "@/server/actions/stock-transfer";
import { TransferForm } from "./_components/TransferForm";
import type { StockTransferInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewTransferPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);

  const items = await listTransferItems();

  async function submit(input: StockTransferInputT) {
    "use server";
    return recordStockTransfer(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Transfer stock between stores"
        description="One document, one movement: the source store goes down and the destination store goes up together, at the source's cost. Replaces adjusting one store down and the other up, which read as two unexplained corrections."
      />
      <TransferForm items={items} onSubmit={submit} />
    </>
  );
}
