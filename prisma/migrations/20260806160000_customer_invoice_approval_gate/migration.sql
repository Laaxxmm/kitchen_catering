-- An invoice may only be handed to the customer once a manager or admin has
-- signed off the numbers on it ("only after the approval from the admin or
-- manager, the invoice needs to be given to the customer"). Accounts prepare
-- and edit the draft; the sign-off is a separate pair of eyes. The decision
-- has to be readable afterwards: AuditLog stores a payload hash, so the
-- approver, the time and the note go on the invoice itself.
--
-- "finalHeadcount" is the pax the invoice is billed for — 100 ordered, 120
-- turned up. It is snapshotted from the order at creation and editable while
-- the invoice is a draft, so the printed pax and the derived rate come from
-- the invoice's own numbers and can never disagree with its own totals.
--
-- All columns nullable, no backfill: existing invoices carry NULL. A NULL
-- "approvedAt" reads as "not signed off", which is exactly right — every
-- live DRAFT now needs a manager before it can be issued. A NULL
-- "finalHeadcount" falls back to the order's headcount, i.e. today's
-- behaviour, so no already-issued document changes.

ALTER TABLE "CustomerInvoice" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "CustomerInvoice" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "CustomerInvoice" ADD COLUMN "approvalNote" TEXT;
ALTER TABLE "CustomerInvoice" ADD COLUMN "finalHeadcount" INTEGER;

-- SET NULL on delete, matching "CustomerInvoice_onHoldById_fkey": losing a
-- leaver's user row must not take the invoice's financial record with it.
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
