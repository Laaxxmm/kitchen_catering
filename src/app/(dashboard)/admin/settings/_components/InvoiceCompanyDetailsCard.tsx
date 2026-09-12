"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface CompanyDetails {
  name: string;
  address: string;
  email: string;
  phone: string;
  mobile: string;
  gstin: string;
}

const EMPTY: CompanyDetails = { name: "", address: "", email: "", phone: "", mobile: "", gstin: "" };

/**
 * "Invoice company details" settings card — the seller block at the head of
 * every customer invoice PDF (name, address, email, phone, GSTIN). A blank
 * field falls back to the server's INDEFINE_* env value.
 */
export function InvoiceCompanyDetailsCard({
  defaults,
  onSave,
}: {
  defaults: Partial<CompanyDetails> | null;
  onSave: (input: CompanyDetails) => Promise<ActionResult>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [v, setV] = useState<CompanyDetails>({ ...EMPTY, ...defaults });

  function set<K extends keyof CompanyDetails>(key: K, value: string) {
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
        toast.success("Invoice company details saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 max-w-2xl">
      <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Invoice company details</h3>
      <p className="mb-3 text-[12px] text-ik-ink-3">
        Printed at the top of every customer invoice: name, address, email, phone and GSTIN.
        A blank field falls back to the server configuration.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="co-name">Company name</Label>
          <Input id="co-name" maxLength={120} value={v.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="co-address">Address (one line per row)</Label>
          <Textarea id="co-address" rows={2} maxLength={500} value={v.address} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="co-gstin">GSTIN</Label>
          <Input id="co-gstin" maxLength={15} value={v.gstin} onChange={(e) => set("gstin", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="co-email">Email</Label>
          <Input id="co-email" maxLength={120} value={v.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="co-phone">Phone</Label>
          <Input id="co-phone" maxLength={60} value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="co-mobile">Mobile</Label>
          <Input id="co-mobile" maxLength={60} value={v.mobile} onChange={(e) => set("mobile", e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save company details"}
        </Button>
      </div>
    </form>
  );
}
