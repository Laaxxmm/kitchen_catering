import { PageHeader } from "@/components/ui/page-header";
import { createDish } from "@/server/actions/dishes";
import { DishForm } from "../_components/DishForm";
import type { DishInputT } from "@/lib/validators";

export default function NewDishPage() {
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
