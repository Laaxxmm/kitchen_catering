import Link from "next/link";

interface Props {
  active: "ingredients" | "receipts" | "issues" | "audit";
}

const TABS = [
  { key: "ingredients", label: "Ingredients", href: "/inventory/ingredients" },
  { key: "receipts", label: "Receipts", href: "/inventory/receipts" },
  { key: "issues", label: "Issues", href: "/inventory/issues" },
  { key: "audit", label: "Monthly audit", href: "/inventory/audit" },
] as const;

export function InventoryNav({ active }: Props) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-ik-rule text-[13px]">
      {TABS.map((t) => {
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
