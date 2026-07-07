import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listAssignableUsers } from "@/server/actions/users";
import { createPettyCashFloat } from "@/server/actions/petty-cash";
import { gateRolePage } from "@/server/rbac";
import { roleLabel } from "@/lib/role-labels";
import { NewFloatForm } from "./_components/NewFloatForm";

export const dynamic = "force-dynamic";

export default async function NewPettyCashFloatPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const users = await listAssignableUsers();

  async function create(input: { custodianId: string; name: string; openingBalance: string }) {
    "use server";
    return await createPettyCashFloat(input);
  }

  return (
    <>
      <PageHeader eyebrow="Finance" title="New petty cash float" />
      <NewFloatForm
        users={users.map((u) => ({ id: u.id, label: `${u.name} (${roleLabel(u.role)})` }))}
        onSubmit={create}
      />
    </>
  );
}
