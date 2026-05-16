import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listTaskTemplates } from "@/server/actions/tasks";
import { TemplateManager } from "./_components/TemplateManager";

export const dynamic = "force-dynamic";

export default async function TaskTemplatesPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);

  const templates = await listTaskTemplates({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Admin"
        title="Task presets"
        description="Reusable task titles. Pick one when assigning instead of typing every time."
        actions={
          <Link href="/tasks/admin">
            <Button variant="outline" size="sm">← Back to tasks</Button>
          </Link>
        }
      />
      <TemplateManager templates={templates} />
    </>
  );
}
