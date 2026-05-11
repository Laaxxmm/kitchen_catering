import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { createUser } from "@/server/actions/users";
import { UserForm } from "../_components/UserForm";

export default function NewUserPage() {
  async function submit(input: { email: string; name: string; role: Role; phone: string | null; password: string | undefined }) {
    "use server";
    return createUser({
      email: input.email,
      name: input.name,
      role: input.role,
      phone: input.phone,
      password: input.password,
    });
  }
  return (
    <>
      <PageHeader eyebrow="Admin · Users" title="New user" />
      <UserForm onSubmit={submit} requirePassword submitLabel="Create user" redirectOnSuccess="/admin/users/:id" />
    </>
  );
}
