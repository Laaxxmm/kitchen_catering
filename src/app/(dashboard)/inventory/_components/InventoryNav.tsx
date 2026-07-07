import Link from "next/link";
import type { Role } from "@prisma/client";

interface Props {
  active: "ingredients" | "receipts" | "issues" | "adjustments" | "audit";
  role?: Role;
}

const BASE_TABS = [
  { key: "ingredients", label: "Ingredients", href: "/inventory/ingredients" },
  { key: "receipts", label: "Receipts (add stock)", href: "/inventory/receipts" },
  { key: "issues", label: "Issues", href: "/inventory/issues" },
  { key: "audit", label: "Monthly audit", href: "/inventory/audit" },
] as const;

const ADJUSTMENTS_TAB = {
  key: "adjustments",
  label: "Stock adjustments",
  href: "/inventory/adjustments",
} as const;

export function InventoryNav({ active, role }: Props) {
  // Adjustments: admin/manager always; the store keeper also gets the tab
  // (the action itself enforces the stock.storeDirectEdit admin toggle, so
  // with the toggle off they get a clear refusal message, not a dead end).
  const tabs =
    role === "ADMIN" || role === "MANAGER" || role === "STORE_KEEPER"
      ? [...BASE_TABS.slice(0, 3), ADJUSTMENTS_TAB, BASE_TABS[3]]
      : BASE_TABS;

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
