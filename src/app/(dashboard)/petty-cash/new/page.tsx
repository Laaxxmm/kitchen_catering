import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listUsers } from "@/server/actions/users";
import { createPettyCashFloat } from "@/server/actions/petty-cash";
import { gateRolePage } from "@/server/rbac";
import { roleLabel } from "@/lib/role-labels";

export const dynamic = "force-dynamic";

export default async function NewPettyCashFloatPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const users = await listUsers({ active: true });

  async function create(formData: FormData) {
    "use server";
    const custodianId = String(formData.get("custodianId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const openingBalance = String(formData.get("openingBalance") ?? "0");
    if (!custodianId || !name) return;
    const r = await createPettyCashFloat({ custodianId, name, openingBalance });
    redirect(`/petty-cash/floats/${r.id}`);
  }

  return (
    <>
      <PageHeader eyebrow="Finance" title="New petty cash float" />
      <form action={create} className="grid max-w-xl gap-4">
        <div className="grid gap-1">
          <Label htmlFor="name">Float name</Label>
          <Input id="name" name="name" placeholder="Main kitchen float" required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="custodianId">Custodian</Label>
          <select id="custodianId" name="custodianId" className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({roleLabel(u.role)})</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="openingBalance">Opening balance (₹)</Label>
          <Input id="openingBalance" name="openingBalance" type="number" step="0.01" min="0" defaultValue="5000" />
        </div>
        <div>
          <Button type="submit">Create float</Button>
        </div>
      </form>
    </>
  );
}
