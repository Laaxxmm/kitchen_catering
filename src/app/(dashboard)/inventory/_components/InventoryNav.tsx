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
  // Adjustments tab is admin/manager only — storekeeper doesn't see it,
  // matching the middleware gate on /inventory/adjustments.
  const tabs =
    role === "ADMIN" || role === "MANAGER"
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
