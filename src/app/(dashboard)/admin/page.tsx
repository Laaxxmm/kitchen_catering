import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";

const SECTIONS = [
  { href: "/admin/users", title: "Users & roles", desc: "Create, update, deactivate users. ADMIN only." },
  { href: "/admin/settings", title: "Settings", desc: "Key/value tunables (recipe gate, email provider, branding, …)." },
  { href: "/admin/audit", title: "Audit log", desc: "Read-only audit trail of every consequential mutation." },
];

export default async function AdminPage() {
  await gateRolePage([Role.ADMIN]);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Operations admin" description="ADMIN-gated. Configure users, system settings, and inspect audit history." />
      <div className="grid gap-3 sm:grid-cols-2 max-w-3xl">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 hover:border-brand-200"
          >
            <div className="font-medium text-[14px] text-ik-ink">{s.title}</div>
            <div className="mt-1 text-[12.5px] text-ik-ink-2">{s.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
