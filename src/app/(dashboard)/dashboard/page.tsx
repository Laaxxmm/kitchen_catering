import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/server/auth";

export default async function DashboardPage() {
  const session = await auth();
  const name = session?.user?.name ?? "there";
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${name}`}
        description="Phase 1 will populate this dashboard with order, kitchen and delivery KPIs."
      />
      <p className="text-sm text-muted-foreground">
        Sidebar links are placeholder pages until each module is built.
      </p>
    </>
  );
}
