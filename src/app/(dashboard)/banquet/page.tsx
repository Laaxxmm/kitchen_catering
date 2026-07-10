import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function BanquetLandingPage() {
  // The F&B Service team (role DELIVERY, FNB_SERVICE its retired alias) runs
  // the banquet store end to end — catalogue, receipts, issues, adjustments.
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const stock = await getStoreStock("banquet");
  // "Raise requisition" is for the F&B team asking the store for stock — the
  // store keeper IS the store, so they fulfil requests (Requisitions) rather
  // than raise them against themselves. Hide it for the store keeper.
  const canRaiseRequisition = session.user.role !== Role.STORE_KEEPER;

  return (
    <StoreLanding
      title="Banquet store"
      description="F&B disposables — cutlery, cups, trays, foil, takeaway boxes. What's low is up top."
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
          <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          <Link href="/banquet/adjust"><Button variant="outline">Adjust stock</Button></Link>
          <Link href="/banquet/stock-count"><Button variant="outline">Stock count (bulk)</Button></Link>
          <Link href="/banquet/requisitions"><Button variant="outline">Requisitions</Button></Link>
          {canRaiseRequisition && (
            <Link href="/banquet/request"><Button variant="outline">Raise requisition</Button></Link>
          )}
        </div>
      }
      tabs={[
        { label: "Items", href: "/banquet/items", active: true },
        { label: "Requisitions", href: "/banquet/requisitions" },
        { label: "Receipts", href: "/banquet/receipts" },
        { label: "Issues", href: "/banquet/issues" },
        { label: "Adjust stock", href: "/banquet/adjust" },
        { label: "Stock count (bulk)", href: "/banquet/stock-count" },
        { label: "Reports", href: "/banquet/reports" },
      ]}
      stock={stock}
      itemsHref="/banquet/items"
    />
  );
}
