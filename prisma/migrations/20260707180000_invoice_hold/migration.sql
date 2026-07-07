-- Billing hold: park an invoice (wrong address / client / items / payment
-- dispute) — no payments or emails until released.
ALTER TABLE "CustomerInvoice" ADD COLUMN "onHoldAt" TIMESTAMP(3);
ALTER TABLE "CustomerInvoice" ADD COLUMN "onHoldReason" TEXT;
ALTER TABLE "CustomerInvoice" ADD COLUMN "onHoldById" TEXT;
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_onHoldById_fkey" FOREIGN KEY ("onHoldById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
