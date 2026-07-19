import { PageHeader } from "@/components/ui/page-header";
import { listSettings, upsertSetting } from "@/server/actions/settings";
import { saveInvoiceBankDetails } from "@/server/actions/invoice-settings";
import { getSetting } from "@/lib/settings";
import type { InvoiceBankDetailsT } from "@/lib/validators";
import { SettingsEditor } from "./_components/SettingsEditor";
import { InvoiceBankDetailsCard } from "./_components/InvoiceBankDetailsCard";
import { CleanSlate } from "./_components/CleanSlate";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [rows, bankDetails] = await Promise.all([
    listSettings(),
    getSetting<InvoiceBankDetailsT>("invoice.bankDetails"),
  ]);

  async function upsert(key: string, value: unknown, notes: string | null) {
    "use server";
    return upsertSetting(key, value, notes);
  }
  async function saveBank(input: InvoiceBankDetailsT) {
    "use server";
    return saveInvoiceBankDetails(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Key/value tunables. Booleans show a toggle; numbers a number input; the rest a JSON editor."
      />
      <div className="mb-6">
        <InvoiceBankDetailsCard defaults={bankDetails} onSave={saveBank} />
      </div>
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
