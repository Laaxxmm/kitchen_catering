-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('PO_AWAITING_ADMIN', 'PO_APPROVED', 'VENDOR_BILL_PAID', 'CUSTOMER_INVOICE_PAID', 'TASK_ASSIGNED', 'TASK_SUBMITTED', 'CHEF_REQUISITION_FULFILLED', 'FEEDBACK_RECEIVED', 'VENDOR_PAYMENT_REMINDER', 'GENERIC');
-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "isStatutory" BOOLEAN NOT NULL DEFAULT false;
-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
