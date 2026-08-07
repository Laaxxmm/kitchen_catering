import Link from "next/link";
import type { Role } from "@prisma/client";
import { canEditStockDirectly } from "@/lib/stock-movement";

interface Props {
  active: "ingredients" | "receipts" | "issues" | "returns" | "transfers" | "adjustments" | "audit";
  role?: Role;
}

const BASE_TABS = [
  { key: "ingredients", label: "Ingredients", href: "/inventory/ingredients" },
  { key: "receipts", label: "Receipts (add stock)", href: "/inventory/receipts" },
  { key: "issues", label: "Issues", href: "/inventory/issues" },
  { key: "audit", label: "Stock count (bulk)", href: "/inventory/audit" },
] as const;

// Stock-movement tabs, same gate as issues (ADMIN/MANAGER/STORE_KEEPER).
const STOCK_TABS = [
  { key: "returns", label: "Returns from kitchen", href: "/inventory/returns" },
  { key: "transfers", label: "Store transfers", href: "/inventory/transfers" },
  { key: "adjustments", label: "Stock adjustments", href: "/inventory/adjustments" },
] as const;

export function InventoryNav({ active, role }: Props) {
  // Tabs match what the middleware actually lets each role open — a tab
  // that lands on /forbidden is worse than no tab.
  //   receipts: ADMIN/MANAGER/STORE_KEEPER/ACCOUNTS
  //   issues / returns / transfers: ADMIN/MANAGER/STORE_KEEPER
  //   adjustments: ADMIN/MANAGER/STORE_KEEPER — the store keeper reads the
  //     log (that page says who to ask); posting one is admin/manager
  //   audit (bulk count): ADMIN/MANAGER — it sets on-hand by hand
  const canStock = role === "ADMIN" || role === "MANAGER" || role === "STORE_KEEPER";
  const tabs = [
    BASE_TABS[0],
    ...(canStock || role === "ACCOUNTS" ? [BASE_TABS[1]] : []),
    ...(canStock ? [BASE_TABS[2], ...STOCK_TABS] : []),
    ...(canEditStockDirectly(role) ? [BASE_TABS[3]] : []),
  ];

  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-ik-rule text-[13px]">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={
              "px-3 py-2 " +
              (isActive
                ? "border-b-2 border-brand-500 font-medium text-ik-ink"
                : "text-ik-ink-2 hover:text-ik-ink")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
