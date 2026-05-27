"use server";

import { Role, VendorBillStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { notifyRoles } from "@/server/actions/notifications";

/**
 * Workflow doc:
 *   "Also for statutory and direct regular vendor payment (service
 *    vendors) Reminder to be given 3 days prior."
 *
 * The job here scans vendor bills and creates an Accounts-targeted
 * Task + bell notification for anything that's:
 *   (a) status != PAID, AND
 *   (b) dueDate is within the next 3 days, OR
 *   (c) the vendor is flagged isStatutory and any open bill of theirs
 *       is past-due or due within 7 days (statutory bills get more
 *       lead time + a louder nudge).
 *
 * The job is idempotent — both the Task and the Notification use a
 * dedupeKey of (billId|YYYY-MM-DD) so re-running on the same day is a
 * no-op. Safe to call daily (Railway cron) or on-demand via the admin
 * "Run reminders" button.
 */

interface ReminderRunResult {
  scanned: number;
  notified: number;
  tasksCreated: number;
  bills: Array<{
    billId: string;
    billNo: string;
    vendor: string;
    dueDate: Date | null;
    outstanding: string;
    isStatutory: boolean;
  }>;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runVendorPaymentReminders(): Promise<ReminderRunResult> {
  // Admin/Manager/Accounts can trigger manually; cron route below skips
  // the auth gate by calling the internal runner directly.
  await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  return runVendorPaymentRemindersInternal();
}

/** Internal runner — no auth check. Used by the cron API route. */
export async function runVendorPaymentRemindersInternal(): Promise<ReminderRunResult> {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  // Pull open bills with a due date in the next 7 days (covers both
  // the regular 3-day window and the statutory 7-day window). Filter
  // out PAID + DRAFT + CANCELLED.
  const candidates = await db.vendorBill.findMany({
    where: {
      status: {
        in: [
          VendorBillStatus.MATCHED,
          VendorBillStatus.DISCREPANCY,
          VendorBillStatus.APPROVED,
        ],
      },
      OR: [
        { dueDate: { lte: in7Days } },
        { dueDate: { lt: now } }, // already past due
      ],
    },
    include: {
      vendor: { select: { name: true, isStatutory: true } },
    },
  });

  const todayKey = ymd(now);
  const out: ReminderRunResult["bills"] = [];
  let tasksCreated = 0;
  let notified = 0;
  const adminUsers = await db.user.findMany({
    where: { role: Role.ADMIN, active: true },
    select: { id: true },
    take: 1,
  });
  const assignedById = adminUsers[0]?.id;

  for (const b of candidates) {
    const dueDate = b.dueDate;
    const isStatutory = !!b.vendor.isStatutory;
    const shouldRemind =
      // Regular: due within 3 days
      (dueDate && dueDate <= in3Days) ||
      // Statutory: due within 7 days OR past due
      (isStatutory && (!dueDate || dueDate <= in7Days || dueDate < now));
    if (!shouldRemind) continue;

    const outstanding = (Number(b.grandTotal) - Number(b.amountPaid)).toFixed(2);
    if (Number(outstanding) <= 0) continue;

    // Create a single Task per (bill, day). Re-running same day is a
    // no-op via the dedupe key on Notification + the title uniqueness
    // check on Task (we look up first).
    const taskDedupe = `vendor-reminder:${b.id}:${todayKey}`;

    // Notify Accounts + Admin/Manager via the bell.
    await notifyRoles([Role.ACCOUNTS, Role.ADMIN, Role.MANAGER], {
      kind: "VENDOR_PAYMENT_REMINDER",
      title: `${isStatutory ? "Statutory " : ""}Payment due: ${b.billNo}`,
      body: `${b.vendor.name} · ₹${outstanding}${dueDate ? ` · due ${ymd(dueDate)}` : ""}`,
      link: `/procurement/vendor-bills/${b.id}`,
      dedupeKey: taskDedupe,
    });
    notified++;

    // Also create a Task for someone in Accounts to action it.
    if (assignedById) {
      const accountsUser = await db.user.findFirst({
        where: { role: Role.ACCOUNTS, active: true },
        select: { id: true },
      });
      if (accountsUser) {
        const existing = await db.task.findFirst({
          where: {
            assignedToId: accountsUser.id,
            title: `Pay ${b.vendor.name} — ${b.billNo}`,
          },
          select: { id: true },
        });
        if (!existing) {
          await db.task.create({
            data: {
              title: `Pay ${b.vendor.name} — ${b.billNo}`,
              description: `Outstanding ₹${outstanding}${dueDate ? `, due ${ymd(dueDate)}` : ""}.${isStatutory ? " (Statutory)" : ""}`,
              priority: isStatutory ? "HIGH" : "NORMAL",
              targetDate: dueDate ?? in3Days,
              assignedToId: accountsUser.id,
              assignedById,
            },
          });
          tasksCreated++;
        }
      }
    }

    out.push({
      billId: b.id,
      billNo: b.billNo,
      vendor: b.vendor.name,
      dueDate,
      outstanding,
      isStatutory,
    });
  }

  return {
    scanned: candidates.length,
    notified,
    tasksCreated,
    bills: out,
  };
}
