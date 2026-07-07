import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { deactivateUser, getUser, updateUser } from "@/server/actions/users";
import { UserForm } from "../_components/UserForm";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser(id);
  if (!user) notFound();

  async function update(input: { email: string; name: string; role: Role; phone: string | null; password: string | undefined; active?: boolean }) {
    "use server";
    return updateUser(id, input);
  }
  async function deactivate() {
    "use server";
    await deactivateUser(id);
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin · User"
        title={user.name}
        description={user.email}
        actions={
          <div className="flex gap-2">
            <Link href="/admin/users"><Button variant="outline">Back</Button></Link>
            {user.active && (
              <form action={deactivate}><Button type="submit" variant="outline">Deactivate</Button></form>
            )}
          </div>
        }
      />
      <UserForm
        defaults={{ name: user.name, email: user.email, role: user.role, phone: user.phone, active: user.active }}
        requirePassword={false}
        onSubmit={update}
        submitLabel="Save changes"
      />
    </>
  );
}
