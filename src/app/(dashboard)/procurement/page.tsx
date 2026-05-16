import Link from "next/link";
import type { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/server/auth";

interface Card {
  href: string;
  title: string;
  desc: string;
  // Roles allowed to see this card on the landing page. Tighter than the
  // route's own RBAC: we don't want a storekeeper staring at "Vendor PO
  // approval tiers" on their daily homepage.
  roles: Role[];
}

const CARDS: Card[] = [
  {
    href: "/procurement/grns",
    title: "Receive goods",
    desc: "When goods arrive from a supplier, log a receipt here. Stock and average cost update automatically.",
    roles: ["ADMIN", "MANAGER", "STORE_KEEPER"],
  },
  {
    href: "/procurement/vendors",
    title: "Vendors",
    desc: "Supplier master — GSTIN, payment terms, contact details.",
    roles: ["ADMIN", "MANAGER", "ACCOUNTS"],
  },
  {
    href: "/procurement/purchase-requisitions",
    title: "Raise stock request",
    desc: "Ask to buy stock when running low. Manager approves the request before a purchase order goes out.",
    roles: ["ADMIN", "MANAGER", "STORE_KEEPER"],
  },
  {
    href: "/procurement/purchase-orders",
    title: "Purchase orders",
    desc: "Orders we have placed with suppliers. Tiered approval (auto / manager / admin) by value.",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    href: "/procurement/vendor-bills",
    title: "Supplier bills",
    desc: "Bills from suppliers, matched against the PO and goods receipt. Pay through Payments.",
    roles: ["ADMIN", "MANAGER", "ACCOUNTS"],
  },
];

const TAGLINE: Partial<Record<Role, string>> = {
  STORE_KEEPER: "Raise a stock request when you need to buy something, and log goods when they arrive.",
  ACCOUNTS: "Match bills against POs and receipts before paying.",
  MANAGER: "Storekeeper raises request → you approve → issue PO → goods arrive → bill recorded → pay.",
  ADMIN: "Storekeeper raises request → manager approves → issue PO → goods arrive → bill recorded → pay.",
};

export default async function ProcurementHubPage() {
  const session = await auth();
  const role = (session?.user?.role as Role | undefined) ?? "ADMIN";
  const visible = CARDS.filter((c) => c.roles.includes(role));

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title={role === "STORE_KEEPER" ? "Stock requests & deliveries" : "Vendor pipeline"}
        description={TAGLINE[role] ?? TAGLINE.ADMIN}
      />
      <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
        {visible.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-md border border-ik-rule bg-ik-card p-4 hover:border-brand-200"
          >
            <div className="font-medium text-[14px] text-ik-ink">{c.title}</div>
            <div className="mt-1 text-[12.5px] text-ik-ink-2">{c.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
