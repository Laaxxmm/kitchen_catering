-- Feedback collection allocation: a manager assigns a staff member to chase
-- the customer's feedback for an order. Additive + nullable.
ALTER TABLE "Order" ADD COLUMN "feedbackAssigneeId" TEXT;
ALTER TABLE "Order" ADD COLUMN "feedbackAssignedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "feedbackAssignedById" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_feedbackAssigneeId_fkey"
  FOREIGN KEY ("feedbackAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
