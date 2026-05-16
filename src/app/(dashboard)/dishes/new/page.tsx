import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { createDish } from "@/server/actions/dishes";
import { DishForm } from "../_components/DishForm";
import type { DishInputT } from "@/lib/validators";

export default async function NewDishPage() {
  // Sales / manager / admin own the menu catalogue. Chef gets a
  // read-only view at /dishes; this create page is locked to them so
  // they can't see (or set) pricing.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.SALES]);

  async function submit(input: DishInputT) {
    "use server";
    return createDish(input);
  }
  return (
    <>
      <PageHeader eyebrow="Sales · Dishes" title="New dish" />
      <DishForm onSubmit={submit} submitLabel="Create dish" redirectOnSuccess="/dishes/:id" />
    </>
  );
}
