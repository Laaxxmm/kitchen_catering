-- Schema/DB drift (audit M13): these relations went optional in July
-- migrations but their FKs kept ON DELETE RESTRICT from init. Recreate
-- with SET NULL so DB semantics match the Prisma schema.
ALTER TABLE "ChefRequisition" DROP CONSTRAINT IF EXISTS "ChefRequisition_orderId_fkey";
ALTER TABLE "ChefRequisition" ADD CONSTRAINT "ChefRequisition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IngredientIssue" DROP CONSTRAINT IF EXISTS "IngredientIssue_orderId_fkey";
ALTER TABLE "IngredientIssue" ADD CONSTRAINT "IngredientIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
