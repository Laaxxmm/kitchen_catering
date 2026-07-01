-- Let the chef raise a general/standalone stock requisition not tied to any
-- order. Make ChefRequisition.orderId nullable. Additive + safe: existing rows
-- keep their order link.
ALTER TABLE "ChefRequisition" ALTER COLUMN "orderId" DROP NOT NULL;
