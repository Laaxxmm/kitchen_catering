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
  onSubmit: (input: { periodMonth: string }) => Promise<ActionResultWith<{ id: string }>>;
}

/**
 * New-salary-run form. Calls the page's bound "use server" shim, toasts
 * the action's refusal (e.g. "run already exists for this month") and
 * navigates to the created run on success.
 */
export function NewSalaryRunForm({ onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [month, setMonth] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!month) {
      toast.error("Please pick a month");
      return;
    }
    startTransition(async () => {
      try {
        // <input type="month"> returns "YYYY-MM"; convert to ISO date string.
        const res = await onSubmit({ periodMonth: `${month}-01T00:00:00` });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Salary run created");
        router.push(`/salary/runs/${res.id}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-xs gap-4">
      <div className="grid gap-1">
        <Label htmlFor="periodMonth">Period (month)</Label>
        <Input id="periodMonth" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create run"}</Button>
    </form>
  );
}
