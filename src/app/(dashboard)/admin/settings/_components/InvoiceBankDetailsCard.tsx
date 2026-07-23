"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface BankDetails {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankBranch: string;
  upiId: string;
}

const EMPTY: BankDetails = { accountName: "", accountNumber: "", ifsc: "", bankBranch: "", upiId: "" };

/**
 * "Invoice bank details" settings card — the payment block printed on
 * customer invoice PDFs. Leave everything blank to omit the block.
 */
export function InvoiceBankDetailsCard({
  defaults,
  onSave,
}: {
  defaults: Partial<BankDetails> | null;
  onSave: (input: BankDetails) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [v, setV] = useState<BankDetails>({ ...EMPTY, ...defaults });

  function set<K extends keyof BankDetails>(key: K, value: string) {
    setV((p) => ({ ...p, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await onSave(v);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Invoice bank details saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 max-w-2xl">
      <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Invoice bank details</h3>
      <p className="mb-3 text-[12px] text-ik-ink-3">
        Printed in the &quot;Payment details&quot; box on customer invoice PDFs. Leave all fields
        blank to leave the box off invoices.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="bd-accountName">Account name</Label>
          <Input id="bd-accountName" maxLength={120} value={v.accountName} onChange={(e) => set("accountName", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bd-accountNumber">Account number</Label>
          <Input id="bd-accountNumber" maxLength={40} value={v.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bd-ifsc">IFSC</Label>
          <Input id="bd-ifsc" maxLength={20} value={v.ifsc} onChange={(e) => set("ifsc", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bd-bankBranch">Bank &amp; branch</Label>
          <Input id="bd-bankBranch" maxLength={160} value={v.bankBranch} onChange={(e) => set("bankBranch", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="bd-upiId">UPI id</Label>
          <Input id="bd-upiId" maxLength={120} value={v.upiId} onChange={(e) => set("upiId", e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save bank details"}
        </Button>
      </div>
    </form>
  );
}
