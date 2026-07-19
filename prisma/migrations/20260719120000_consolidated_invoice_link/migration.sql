-- Folio (consolidated in-house) invoices billed orders with no back-link,
-- so payment/cancel could never advance or revert the member orders.
ALTER TABLE "Order" ADD COLUMN "consolidatedInvoiceId" TEXT;
CREATE INDEX "Order_consolidatedInvoiceId_idx" ON "Order"("consolidatedInvoiceId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_consolidatedInvoiceId_fkey" FOREIGN KEY ("consolidatedInvoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
