import { PageHeader } from "@/components/ui/page-header";
import { createVendor } from "@/server/actions/vendors";
import { VendorForm } from "../_components/VendorForm";
import type { VendorInputT } from "@/lib/validators";

export default function NewVendorPage() {
  async function submit(input: VendorInputT) {
    "use server";
    const r = await createVendor(input);
    return { id: r.id };
  }
  return (
    <>
      <PageHeader eyebrow="Procurement · Vendors" title="New vendor" />
      <VendorForm onSubmit={submit} submitLabel="Create vendor" redirectOnSuccess="/procurement/vendors/:id" />
    </>
  );
}
