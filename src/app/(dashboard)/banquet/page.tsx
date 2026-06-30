import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function BanquetLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY]);
  const [session, stock] = await Promise.all([auth(), getStoreStock("banquet")]);
  // Delivery preps event cutlery: they can issue to an event, but not record
  // vendor receipts or adjust stock (those stay with F&B / management).
  const isDelivery = session?.user?.role === Role.DELIVERY;

  return (
    <StoreLanding
      title="Banquet store"
      description={
        isDelivery
          ? "F&B disposables — cutlery, cups, trays, foil. Issue what you need for the event."
          : "F&B disposables — cups, trays, foil, takeaway boxes. What's low is up top."
      }
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
          {!isDelivery && (
            <>
              <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
              <Link href="/banquet/adjust"><Button variant="outline">Adjust stock</Button></Link>
            </>
          )}
        </div>
      }
      tabs={
        isDelivery
          ? [
              { label: "Items", href: "/banquet/items", active: true },
              { label: "Issues", href: "/banquet/issues" },
            ]
          : [
              { label: "Items", href: "/banquet/items", active: true },
              { label: "Receipts", href: "/banquet/receipts" },
              { label: "Issues", href: "/banquet/issues" },
              { label: "Adjust stock", href: "/banquet/adjust" },
              { label: "Reports", href: "/banquet/reports" },
            ]
      }
      stock={stock}
      itemsHref="/banquet/items"
    />
  );
}
