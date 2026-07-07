"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

interface Props {
  users: Array<{ id: string; label: string }>;
  onSubmit: (input: {
    custodianId: string;
    name: string;
    openingBalance: string;
  }) => Promise<ActionResultWith<{ id: string }>>;
}

/**
 * New-float form. Calls the page's bound "use server" shim, toasts the
 * action's refusal (the old bare `<form action>` swallowed it), and
 * navigates to the new float on success.
 */
export function NewFloatForm({ users, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [name, setName] = useState("");
  const [custodianId, setCustodianId] = useState(users[0]?.id ?? "");
  const [openingBalance, setOpeningBalance] = useState("5000");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !custodianId) {
      toast.error("Please fill in a name and pick a custodian");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({ custodianId, name: name.trim(), openingBalance: openingBalance || "0" });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Float created");
        router.push(`/petty-cash/floats/${res.id}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      <div className="grid gap-1">
        <Label htmlFor="name">Float name</Label>
        <Input id="name" placeholder="Main kitchen float" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="custodianId">Custodian</Label>
        <select
          id="custodianId"
          value={custodianId}
          onChange={(e) => setCustodianId(e.target.value)}
          className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="openingBalance">Opening balance (₹)</Label>
        <Input id="openingBalance" type="number" step="0.01" min="0" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
      </div>
      <div>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create float"}</Button>
      </div>
    </form>
  );
}
