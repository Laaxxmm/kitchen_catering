import { auth } from "@/server/auth";
import { roleLabel } from "@/lib/role-labels";

export const dynamic = "force-dynamic";

export default async function MobileMePage() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <>
      <h1 className="mb-1 text-[18px] font-medium">Your account</h1>
      <p className="mb-4 text-[12.5px] text-ik-ink-3">Signed-in user details. Use the bottom Sign out to leave the app.</p>
      <dl className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Name</dt>
          <dd>{session.user.name}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Email</dt>
          <dd className="font-mono text-[12px]">{session.user.email}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Role</dt>
          <dd>{roleLabel(session.user.role)}</dd>
        </div>
      </dl>
    </>
  );
}
