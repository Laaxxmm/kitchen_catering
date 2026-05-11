"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { EmploymentType, Role, SalaryRunStatus } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import { SalaryStructureInput, SalaryRunCreateInput } from "@/lib/validators";
import { salaryRunNo } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { istMonthStart, istMonthEnd } from "@/lib/time";

const ADMIN_ONLY = [Role.ADMIN];
const ADMIN_OR_MANAGER = [Role.ADMIN, Role.MANAGER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTS];
const APPROVAL_LARGE_THRESHOLD = new Decimal(500_000); // ≥ ₹5L needs ADMIN

// ─── Salary structures (per-employee) ────────────────────────────────────

export async function upsertSalaryStructure(raw: unknown) {
  const session = await requireRole(ADMIN_ONLY);
  const input = SalaryStructureInput.parse(raw);

  await db.$transaction(async (tx) => {
    const effFrom = new Date(input.effectiveFrom);
    // Close out any open structure for this employee.
    const open = await tx.salaryStructure.findFirst({
      where: { employeeId: input.employeeId, effectiveTo: null },
      orderBy: { effectiveFrom: "desc" },
    });
    if (open) {
      const closeAt = new Date(effFrom.getTime() - 1);
      await tx.salaryStructure.update({
        where: { id: open.id },
        data: { effectiveTo: closeAt },
      });
    }
    await tx.salaryStructure.create({
      data: {
        employeeId: input.employeeId,
        type: input.type as EmploymentType,
        hourlyRate: input.hourlyRate ?? null,
        monthlySalary: input.monthlySalary ?? null,
        effectiveFrom: effFrom,
        notes: input.notes ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SALARY_STRUCTURE_UPSERTED",
        entity: "SalaryStructure",
        entityId: input.employeeId,
        payloadHash: sha256Json({ employeeId: input.employeeId, type: input.type, effectiveFrom: input.effectiveFrom }),
      },
    });
  });
  revalidatePath("/salary/structures");
}

export async function listSalaryStructures() {
  await requireRole(READ_ROLES);
  return db.salaryStructure.findMany({
    where: { effectiveTo: null },
    include: { employee: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
}

// ─── Salary runs ─────────────────────────────────────────────────────────

/**
 * Create a salary run for a calendar month. For each employee with an
 * effective SalaryStructure:
 *   - HOURLY: gross = sum(approved time-entry minutes / 60) × hourlyRate
 *   - SALARIED: gross = monthlySalary (Phase 3 omits absence-proration;
 *     Phase 4 polish can add it from TimeEntry data)
 *   - deductions = 0 (PF/ESI/PT/IT deferred to Zoho Payroll integration)
 */
export async function createSalaryRun(raw: unknown) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  const input = SalaryRunCreateInput.parse(raw);
  const periodMonth = istMonthStart(new Date(input.periodMonth));
  const periodEnd = istMonthEnd(new Date(input.periodMonth));
  const runNo = salaryRunNo(periodMonth);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.salaryRun.findUnique({ where: { periodMonth } });
    if (existing) throw new Error(`Salary run already exists for ${runNo}`);

    // Find active structures effective at month-start
    const structures = await tx.salaryStructure.findMany({
      where: {
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodMonth } }],
      },
      include: { employee: { select: { id: true, name: true } } },
    });

    let totalAmount = new Decimal(0);
    const lines: Array<{
      employeeId: string;
      employeeName: string;
      hoursWorked: string | null;
      hourlyRate: string | null;
      monthlyBase: string | null;
      grossPay: string;
      netPay: string;
    }> = [];

    for (const s of structures) {
      let grossPay = new Decimal(0);
      let hoursWorked: string | null = null;
      let hourlyRate: string | null = null;
      let monthlyBase: string | null = null;

      if (s.type === EmploymentType.HOURLY && s.hourlyRate) {
        const entries = await tx.timeEntry.findMany({
          where: {
            employeeId: s.employeeId,
            status: "APPROVED",
            clockIn: { gte: periodMonth, lt: periodEnd },
          },
          select: { minutes: true },
        });
        const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0);
        const hrs = new Decimal(totalMinutes).div(60).toDecimalPlaces(2);
        grossPay = hrs.times(toDecimal(s.hourlyRate)).toDecimalPlaces(2);
        hoursWorked = hrs.toString();
        hourlyRate = s.hourlyRate.toString();
      } else if (s.type === EmploymentType.SALARIED && s.monthlySalary) {
        grossPay = toDecimal(s.monthlySalary).toDecimalPlaces(2);
        monthlyBase = s.monthlySalary.toString();
      }
      const netPay = grossPay; // deductions=0 in v1
      totalAmount = totalAmount.plus(grossPay);

      lines.push({
        employeeId: s.employeeId,
        employeeName: s.employee.name,
        hoursWorked,
        hourlyRate,
        monthlyBase,
        grossPay: grossPay.toString(),
        netPay: netPay.toString(),
      });
    }

    const run = await tx.salaryRun.create({
      data: {
        runNo,
        periodMonth,
        status: SalaryRunStatus.DRAFT,
        totalAmount: totalAmount.toDecimalPlaces(2).toString(),
        createdById: session.user.id,
        lines: { create: lines },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SALARY_RUN_CREATED",
        entity: "SalaryRun",
        entityId: run.id,
        payloadHash: sha256Json({ runNo, total: totalAmount.toString(), lines: lines.length }),
      },
    });

    return run;
  });

  revalidatePath("/salary/runs");
  return { id: result.id, runNo };
}

export async function approveSalaryRun(id: string) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  await db.$transaction(async (tx) => {
    const run = await tx.salaryRun.findUnique({ where: { id }, select: { status: true, totalAmount: true } });
    if (!run) throw new Error("Run not found");
    if (run.status !== SalaryRunStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT runs can be approved");
    }
    if (toDecimal(run.totalAmount).gte(APPROVAL_LARGE_THRESHOLD) && session.user.role !== Role.ADMIN) {
      throw new AuthorizationError(`Runs of ₹5L+ require ADMIN approval`);
    }
    await tx.salaryRun.update({
      where: { id },
      data: { status: SalaryRunStatus.APPROVED, approvedById: session.user.id, approvedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SALARY_RUN_APPROVED",
        entity: "SalaryRun",
        entityId: id,
      },
    });
  });
  revalidatePath(`/salary/runs/${id}`);
}

export async function postSalaryRun(id: string) {
  const session = await requireRole(ADMIN_OR_MANAGER);
  await db.$transaction(async (tx) => {
    const run = await tx.salaryRun.findUnique({ where: { id }, select: { status: true } });
    if (!run) throw new Error("Run not found");
    if (run.status !== SalaryRunStatus.APPROVED) {
      throw new AuthorizationError("Only APPROVED runs can be posted");
    }
    await tx.salaryRun.update({
      where: { id },
      data: { status: SalaryRunStatus.POSTED, postedAt: new Date() },
    });
    // We don't create AP payment rows here in Phase 3 — the salary lines
    // themselves are the source of truth, and disbursement is recorded
    // out-of-band via bank transfers logged by accounts. Future phases
    // could optionally create a VendorBill-style payable per employee.
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SALARY_RUN_POSTED",
        entity: "SalaryRun",
        entityId: id,
      },
    });
  });
  revalidatePath(`/salary/runs/${id}`);
}

export async function listSalaryRuns() {
  await requireRole(READ_ROLES);
  return db.salaryRun.findMany({
    include: {
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { periodMonth: "desc" },
    take: 100,
  });
}

export async function getSalaryRun(id: string) {
  await requireRole(READ_ROLES);
  return db.salaryRun.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lines: { orderBy: { employeeName: "asc" } },
    },
  });
}
