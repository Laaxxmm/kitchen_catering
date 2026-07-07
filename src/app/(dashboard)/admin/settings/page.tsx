import { PageHeader } from "@/components/ui/page-header";
import { listSettings, upsertSetting } from "@/server/actions/settings";
import { SettingsEditor } from "./_components/SettingsEditor";
import { CleanSlate } from "./_components/CleanSlate";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const rows = await listSettings();

  async function upsert(key: string, value: unknown, notes: string | null) {
    "use server";
    return upsertSetting(key, value, notes);
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Key/value tunables. Booleans show a toggle; numbers a number input; the rest a JSON editor."
      />
      <SettingsEditor
        rows={rows.map((r) => ({
          key: r.key,
          value: r.value as unknown,
          notes: r.notes,
          updatedAt: r.updatedAt.toISOString(),
        }))}
        onSave={upsert}
      />
      <CleanSlate />
    </>
  );
}
