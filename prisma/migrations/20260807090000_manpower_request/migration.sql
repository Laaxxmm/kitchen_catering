-- Manpower: casual labour hired in for a job, with money attached.
--
-- The chef / F&B team ask for N people for D days at roughly R a head a day,
-- optionally tagged to an order. The manager approves — possibly editing the
-- count or the rate down first — the job gets done, accounts settle what the
-- labour actually invoiced, and the money goes out.
--
-- Two things this table is deliberately shaped around:
--
-- 1. The requested* trio is never overwritten. The manager's edit lands in
--    the approved* trio instead, so the monthly report can read "asked for 6
--    at ₹500, approved 4 at ₹450". An in-place edit would destroy exactly
--    the number the report exists to show.
--
-- 2. The decisions are readable columns, not just an AuditLog payload hash:
--    who approved and when with their note, who rejected and why, who said
--    the job was done, who settled the actual cost, who paid. Nobody can
--    read a hash back six weeks later at invoice time.
--
-- "orderId" is nullable on purpose — the client asked for a standalone route
-- from the home screen alongside the order-tagged one. SET NULL on delete,
-- matching "Quote_orderId_fkey": losing an order must not take the labour
-- payment record with it.
--
-- New table only. Nothing on an existing table changes and Order.status is
-- untouched by this flow — the order never pauses for a manpower request.

CREATE TYPE "ManpowerRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'COMPLETED', 'PAID', 'REJECTED', 'CANCELLED');

CREATE TABLE "ManpowerRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "ManpowerRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "workDescription" TEXT NOT NULL,
    "notes" TEXT,
    "requestedPeople" INTEGER NOT NULL,
    "requestedDays" INTEGER NOT NULL,
    "requestedRate" DECIMAL(12,2) NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedPeople" INTEGER,
    "approvedDays" INTEGER,
    "approvedRate" DECIMAL(12,2),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "actualCost" DECIMAL(14,2),
    "settledById" TEXT,
    "settledAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PaymentMethod",
    "paymentReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManpowerRequest_pkey" PRIMARY KEY ("id")
);

-- status: the role queues ("what am I approving / paying today").
-- orderId: the panel inside an order.
-- createdAt: the month-scoped report window.
CREATE INDEX "ManpowerRequest_status_idx" ON "ManpowerRequest"("status");
CREATE INDEX "ManpowerRequest_orderId_idx" ON "ManpowerRequest"("orderId");
CREATE INDEX "ManpowerRequest_createdAt_idx" ON "ManpowerRequest"("createdAt");

ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT on the requester (the row must always name who asked for the
-- money, same as "VendorAdvance_recordedById_fkey"); SET NULL on the five
-- decision stamps, matching "VendorBill_approvedByUserId_fkey" — a leaver's
-- user row must not take the payment record with it.
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ManpowerRequest" ADD CONSTRAINT "ManpowerRequest_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
