import { PageHeader } from "@/components/ui/page-header";

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Coming soon"
        title="Admin"
        description="Users, roles, settings, audit log."
      />
      <p className="text-sm text-muted-foreground">This module is being built.</p>
    </>
  );
}
