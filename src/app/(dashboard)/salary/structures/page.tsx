import Link from "next/link";
import { EmploymentType, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listUsers } from "@/server/actions/users";
import { listSalaryStructures, upsertSalaryStructure } from "@/server/actions/salary";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function SalaryStructuresPage() {
  await gateRolePage([Role.ADMIN]);
  const [structures, users] = await Promise.all([
    listSalaryStructures(),
    listUsers({ active: true }),
  ]);

  async function save(formData: FormData) {
    "use server";
    const employeeId = String(formData.get("employeeId") ?? "");
    const type = String(formData.get("type") ?? "") as "HOURLY" | "SALARIED";
    const hourlyRate = formData.get("hourlyRate") ? String(formData.get("hourlyRate")) : null;
    const monthlySalary = formData.get("monthlySalary") ? String(formData.get("monthlySalary")) : null;
    const effectiveFrom = String(formData.get("effectiveFrom") ?? new Date().toISOString().slice(0, 10));
    if (!employeeId || !type) return;
    await upsertSalaryStructure({ employeeId, type, hourlyRate, monthlySalary, effectiveFrom });
  }

  return (
    <>
      <PageHeader
        eyebrow="Finance · Salary"
        title="Salary structures"
        description="Per-employee. Setting a new effectiveFrom closes the previous structure for that employee. ADMIN only."
      />
      <div className="mb-6 flex gap-2 text-[12.5px]">
        <Link href="/salary/runs" className="rounded-full bg-ik-paper-alt px-3 py-1">Runs</Link>
        <Link href="/salary/structures" className="rounded-full bg-brand-500 px-3 py-1 text-white">Structures</Link>
      </div>

      <form action={save} className="mb-6 grid max-w-3xl gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <h3 className="font-medium text-[14px] text-ik-ink">Set structure</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="employeeId">Employee</Label>
            <select id="employeeId" name="employeeId" className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="type">Type</Label>
            <select id="type" name="type" className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {Object.values(EmploymentType).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="hourlyRate">Hourly rate (₹/hr)</Label>
            <Input id="hourlyRate" name="hourlyRate" type="number" step="0.01" min="0" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="monthlySalary">Monthly salary (₹)</Label>
            <Input id="monthlySalary" name="monthlySalary" type="number" step="0.01" min="0" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="effectiveFrom">Effective from</Label>
            <Input id="effectiveFrom" name="effectiveFrom" type="date" />
          </div>
        </div>
        <div><Button type="submit" size="sm">Set structure</Button></div>
      </form>

      <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Active structures</h3>
      {structures.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No structures yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Hourly</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead>Effective from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {structures.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.employee.name}</TableCell>
                <TableCell className="text-[12px]">{s.employee.role}</TableCell>
                <TableCell>{s.type}</TableCell>
                <TableCell className="text-right font-mono">{s.hourlyRate ? formatINR(s.hourlyRate) : "—"}</TableCell>
                <TableCell className="text-right font-mono">{s.monthlySalary ? formatINR(s.monthlySalary) : "—"}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(s.effectiveFrom, "yyyy-MM-dd")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
