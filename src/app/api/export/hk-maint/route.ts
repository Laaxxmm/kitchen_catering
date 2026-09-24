import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { buildWorkbook, xlsxResponse } from "@/lib/exports/excel";
import { gateExport, parseRange } from "@/lib/exports/report-util";

export const dynamic = "force-dynamic";

/** Prisma Decimal → number, null-safe (minStock is optional). */
const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));

/**
 * Housekeeping + maintenance, one workbook. The two stock sheets are
 * snapshots; issues, activities and the hand adjustments take the date
 * range. Read straight off the tables, like the stock export — and open to
 * the two department heads as well as management, since it is their book.
 */
export async function GET(req: Request) {
  const denied = await gateExport([
    Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER,
  ]);
  if (denied) return denied;
  const { from, to, label } = parseRange(req.url);
  const inRange = { gte: from, lte: to };
  const nameOnly = { select: { name: true } };

  const [hkItems, hkIssues, hkAdjustments, mtItems, mtActivities, mtAdjustments] = await Promise.all([
    db.housekeepingItem.findMany({
      where: { active: true },
      select: { name: true, unit: true, currentStock: true, inCirculation: true, minStock: true },
      orderBy: { name: "asc" },
    }),
    db.housekeepingIssue.findMany({
      where: { issuedAt: inRange },
      select: {
        issuedAt: true,
        room: { select: { number: true } },
        staff: nameOnly,
        lines: { select: { quantity: true, item: nameOnly } },
      },
      orderBy: { issuedAt: "desc" },
      take: 5000,
    }),
    db.housekeepingAdjustment.findMany({
      where: { at: inRange },
      select: { at: true, kind: true, delta: true, reason: true, note: true, item: nameOnly, by: nameOnly },
      orderBy: { at: "desc" },
      take: 5000,
    }),
    db.maintenanceItem.findMany({
      where: { active: true },
      select: { name: true, category: true, unit: true, currentStock: true, minStock: true },
      orderBy: { name: "asc" },
    }),
    db.maintenanceActivity.findMany({
      where: { performedAt: inRange },
      select: {
        performedAt: true,
        room: { select: { number: true } },
        staff: nameOnly,
        category: true,
        status: true,
        issueReported: true,
        workDone: true,
      },
      orderBy: { performedAt: "desc" },
      take: 5000,
    }),
    db.maintenanceAdjustment.findMany({
      where: { at: inRange },
      select: { at: true, kind: true, delta: true, reason: true, note: true, item: nameOnly, by: nameOnly },
      orderBy: { at: "desc" },
      take: 5000,
    }),
  ]);

  const adjustmentHeader = ["Date", "Kind", "Item", "Delta", "Reason", "Note", "By"];
  const adjustmentWidths = [12, 12, 28, 10, 24, 28, 18];

  const buf = await buildWorkbook([
    {
      name: "HK stock",
      header: ["Item", "Unit", "On hand", "In circulation", "Min"],
      rows: hkItems.map((i) => [i.name, i.unit, num(i.currentStock), num(i.inCirculation), num(i.minStock)]),
      widths: [28, 8, 12, 14, 10],
    },
    {
      name: "HK issues",
      header: ["Date", "Room", "Staff", "Item", "Qty"],
      rows: hkIssues.flatMap((s) =>
        s.lines.map((l) => [s.issuedAt, s.room.number, s.staff.name, l.item.name, num(l.quantity)]),
      ),
      widths: [12, 10, 20, 28, 10],
    },
    {
      name: "HK adjustments",
      header: adjustmentHeader,
      rows: hkAdjustments.map((a) => [a.at, a.kind, a.item.name, num(a.delta), a.reason, a.note, a.by.name]),
      widths: adjustmentWidths,
    },
    {
      name: "Maintenance stock",
      header: ["Item", "Category", "Unit", "On hand", "Min"],
      rows: mtItems.map((i) => [i.name, i.category, i.unit, num(i.currentStock), num(i.minStock)]),
      widths: [28, 12, 8, 12, 10],
    },
    {
      name: "Maintenance activities",
      header: ["Date", "Room", "Staff", "Category", "Status", "Issue", "Work done"],
      rows: mtActivities.map((a) => [
        a.performedAt, a.room.number, a.staff.name, a.category, a.status, a.issueReported, a.workDone,
      ]),
      widths: [12, 10, 20, 12, 12, 32, 32],
    },
    {
      name: "Maintenance adjustments",
      header: adjustmentHeader,
      rows: mtAdjustments.map((a) => [a.at, a.kind, a.item.name, num(a.delta), a.reason, a.note, a.by.name]),
      widths: adjustmentWidths,
    },
  ]);
  return xlsxResponse(buf, `housekeeping-maintenance-${label}.xlsx`);
}
