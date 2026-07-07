import Link from "next/link";
import { EmploymentType, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SalaryStructureForm } from "./_components/SalaryStructureForm";
import { gateRolePage } from "@/server/rbac";
import { listUsers } from "@/server/actions/users";
import { listSalaryStructures, upsertSalaryStructure } from "@/server/actions/salary";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { roleLabel } from "@/lib/role-labels";

export const dynamic = "force-dynamic";

export default async function SalaryStructuresPage() {
  await gateRolePage([Role.ADMIN]);
  const [structures, users] = await Promise.all([
    listSalaryStructures(),
    listUsers({ active: true }),
  ]);

  async function save(input: {
    employeeId: string;
    type: EmploymentType;
    hourlyRate: string | null;
    monthlySalary: string | null;
    effectiveFrom: string;
  }) {
    "use server";
    return await upsertSalaryStructure(input);
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

      <SalaryStructureForm
        employees={users.map((u) => ({ id: u.id, label: `${u.name} (${roleLabel(u.role)})` }))}
        onSubmit={save}
      />

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
                <TableCell className="text-[12px]">{roleLabel(s.employee.role)}</TableCell>
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
