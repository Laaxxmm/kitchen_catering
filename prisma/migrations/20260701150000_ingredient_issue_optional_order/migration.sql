-- A standalone (order-less) chef requisition issues stock with no order.
-- Make IngredientIssue.orderId nullable. Additive + safe: existing rows keep
-- their order link.
ALTER TABLE "IngredientIssue" ALTER COLUMN "orderId" DROP NOT NULL;
