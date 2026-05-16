import Link from "next/link";
import type { Role } from "@prisma/client";

interface Props {
  role: Role | undefined;
}

interface Action {
  label: string;
  href: string;
  icon: string;
  /** Roles that should see this shortcut. */
  roles: Role[];
  /** Primary actions get a filled brand button; secondary get an outline. */
  primary?: boolean;
}

const ACTIONS: Action[] = [
  {
    label: "Take new order",
    href: "/orders/new",
    icon: "➕",
    roles: ["ADMIN", "MANAGER", "SALES"],
    primary: true,
  },
  {
    label: "Draft quote",
    href: "/quotes/new",
    icon: "📨",
    roles: ["ADMIN", "MANAGER", "SALES"],
  },
  {
    label: "Add customer",
    href: "/customers/new",
    icon: "👤",
    roles: ["ADMIN", "MANAGER", "SALES"],
  },
  {
    label: "Schedule delivery",
    href: "/deliveries/new",
    icon: "🛵",
    roles: ["ADMIN", "MANAGER"],
  },
  {
    label: "Raise stock request",
    href: "/procurement/purchase-requisitions/new",
    icon: "📋",
    roles: ["ADMIN", "MANAGER", "STORE_KEEPER"],
  },
  {
    label: "Record supplier bill",
    href: "/procurement/vendor-bills/new",
    icon: "🧾",
    roles: ["ADMIN", "MANAGER", "ACCOUNTS"],
  },
  {
    label: "Add stock receipt",
    href: "/inventory/receipts/new",
    icon: "📦",
    roles: ["ADMIN", "MANAGER", "STORE_KEEPER", "ACCOUNTS"],
  },
  {
    label: "Assign task",
    href: "/tasks/admin",
    icon: "✅",
    roles: ["ADMIN", "MANAGER"],
  },
];

/**
 * Quick-action row that surfaces the most common create-flows for the
 * current user's role, right on the dashboard. The user no longer has
 * to navigate Sales → Orders → New to take a new order.
 *
 * "Take new order" is the headline action for anyone who can submit
 * orders (admin / manager / sales) and is rendered as a primary
 * brand-coloured button so it pops on the page.
 */
export function QuickActions({ role }: Props) {
  if (!role) return null;
  const visible = ACTIONS.filter((a) => a.roles.includes(role));
  if (visible.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Quick actions</h2>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className={
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition " +
              (a.primary
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "border border-ik-rule bg-ik-card text-ik-ink-2 hover:border-brand-200 hover:text-brand-700")
            }
          >
            <span aria-hidden className="text-[15px]">{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
