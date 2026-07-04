-- Overdue-receivables checks (nav badge, dashboard AR) filter on dueAt;
-- without an index every check scans the invoice table.
CREATE INDEX "CustomerInvoice_dueAt_idx" ON "CustomerInvoice"("dueAt");
