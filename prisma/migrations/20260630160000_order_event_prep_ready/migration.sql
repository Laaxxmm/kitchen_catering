-- Delivery-team event prep (cutlery / crockery / arrangements) readiness for
-- off-site catering orders (banquet / ODC / packed). Additive + nullable.
ALTER TABLE "Order" ADD COLUMN "eventPrepReadyAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "eventPrepReadyById" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_eventPrepReadyById_fkey"
  FOREIGN KEY ("eventPrepReadyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
