"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmploymentType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  employees: Array<{ id: string; label: string }>;
  onSubmit: (input: {
    employeeId: string;
    type: EmploymentType;
    hourlyRate: string | null;
    monthlySalary: string | null;
    effectiveFrom: string;
  }) => Promise<ActionResult>;
}

/**
 * Set-structure form. Calls the page's bound "use server" shim and toasts
 * the action's refusal (e.g. validation on rate/salary combination)
 * instead of silently swallowing it like the old bare `<form action>`.
 */
export function SalaryStructureForm({ employees, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [type, setType] = useState<EmploymentType>(EmploymentType.HOURLY);
  const [hourlyRate, setHourlyRate] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) {
      toast.error("Please pick an employee");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          employeeId,
          type,
          hourlyRate: hourlyRate || null,
          monthlySalary: monthlySalary || null,
          effectiveFrom: effectiveFrom || new Date().toISOString().slice(0, 10),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Structure saved");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mb-6 grid max-w-3xl gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
      <h3 className="font-medium text-[14px] text-ik-ink">Set structure</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="employeeId">Employee</Label>
          <select
            id="employeeId"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            {employees.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as EmploymentType)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            {Object.values(EmploymentType).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="hourlyRate">Hourly rate (₹/hr)</Label>
          <Input id="hourlyRate" type="number" step="0.01" min="0" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="monthlySalary">Monthly salary (₹)</Label>
          <Input id="monthlySalary" type="number" step="0.01" min="0" value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </div>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Set structure"}</Button>
      </div>
    </form>
  );
}
