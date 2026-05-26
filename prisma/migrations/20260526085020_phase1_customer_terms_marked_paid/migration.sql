-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "billingCompanyName" TEXT,
ADD COLUMN     "creditDays" INTEGER NOT NULL DEFAULT 0;
