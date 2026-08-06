"use server";

import { Role, VendorBillStatus, VendorPOStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { notifyRoles } from "@/server/notification-core";
import { actionFailure, type ActionResultWith } from "@/server/action-result";
import { deferAfterResponse } from "@/server/defer";

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
  /** L10: bills flipped APPROVED → OVERDUE this run. */
  billsFlippedOverdue: number;
  /** M18: POs stuck in PENDING_APPROVAL nudged to their approver tier. */
  poApprovalNudges: number;
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

export async function runVendorPaymentReminders(): Promise<ActionResultWith<ReminderRunResult>> {
  // Admin/Manager/Accounts can trigger manually; cron route below skips
  // the auth gate by calling the internal runner directly.
  try {
    await requireRole([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
    const result = await runVendorPaymentRemindersInternal();
    return { ok: true, ...result };
  } catch (err) {
    return actionFailure(err);
  }
}

/** Internal runner — no auth check. Used by the cron API route. */
export async function runVendorPaymentRemindersInternal(): Promise<ReminderRunResult> {
  const now = new Date();
  const in3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const todayKey = ymd(now);

  // L10: flip past-due bills to OVERDUE first, so the AP donut / filters
  // reflect reality and the reminder scan below (which includes OVERDUE)
  // still nags about them. Guarded updateMany: only APPROVED moves — OVERDUE
  // is payable, so flipping an unapproved MATCHED bill into it would hand the
  // calendar the power to make a bill payable without anyone approving it.
  const overdueFlip = await db.vendorBill.updateMany({
    where: {
      status: VendorBillStatus.APPROVED,
      dueDate: { lt: now },
    },
    data: { status: VendorBillStatus.OVERDUE },
  });

  // M18: POs parked in PENDING_APPROVAL — nudge whoever owes the next
  // signature, once per day. Manager step not done yet → manager + admin;
  // manager done, waiting on the ≥₹5k admin step → admin only.
  const stuckPOs = await db.vendorPO.findMany({
    where: { status: VendorPOStatus.PENDING_APPROVAL },
    select: {
      id: true,
      poNo: true,
      grandTotal: true,
      managerApprovedAt: true,
      vendor: { select: { name: true } },
    },
  });
  for (const po of stuckPOs) {
    const roles = po.managerApprovedAt
      ? [Role.ADMIN]
      : [Role.MANAGER, Role.ADMIN];
    deferAfterResponse(`po-approval-nudge:${po.id}`, () =>
      notifyRoles(roles, {
        kind: "GENERIC",
        title: `PO ${po.poNo} is waiting for your approval`,
        body: `${po.vendor.name} · ₹${po.grandTotal.toString()}${po.managerApprovedAt ? " · manager has signed off — admin approval needed" : ""}. The vendor can't be sent anything until it's approved.`,
        link: `/procurement/purchase-orders/${po.id}`,
        dedupeKey: `po-approval-nudge:${po.id}:${todayKey}`,
      }),
    );
  }

  // Pull open bills with a due date in the next 7 days (covers both
  // the regular 3-day window and the statutory 7-day window). Filter
  // out PAID + DRAFT + CANCELLED. OVERDUE stays in the scan — flipping
  // a bill's status must not silence its payment reminders.
  const candidates = await db.vendorBill.findMany({
    where: {
      status: {
        in: [
          VendorBillStatus.MATCHED,
          VendorBillStatus.DISCREPANCY,
          VendorBillStatus.APPROVED,
          VendorBillStatus.OVERDUE,
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

    // Notify Accounts + Admin/Manager via the bell — after the response,
    // so a manual "Run reminders" click doesn't wait on N notification
    // inserts. dedupeKey keeps a re-run the same day a no-op.
    deferAfterResponse(`vendor-reminder:notify:${b.id}`, () =>
      notifyRoles([Role.ACCOUNTS, Role.ADMIN, Role.MANAGER], {
        kind: "VENDOR_PAYMENT_REMINDER",
        title: `${isStatutory ? "Statutory " : ""}Payment due: ${b.billNo}`,
        body: `${b.vendor.name} · ₹${outstanding}${dueDate ? ` · due ${ymd(dueDate)}` : ""}`,
        link: `/procurement/vendor-bills/${b.id}`,
        dedupeKey: taskDedupe,
      }),
    );
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
    billsFlippedOverdue: overdueFlip.count,
    poApprovalNudges: stuckPOs.length,
    bills: out,
  };
}
