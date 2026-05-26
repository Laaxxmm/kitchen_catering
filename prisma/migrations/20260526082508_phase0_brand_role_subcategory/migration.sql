-- CreateEnum
CREATE TYPE "IngredientSubStore" AS ENUM ('VEGETABLE', 'GROCERY', 'MILK', 'WATER', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FNB_SERVICE';

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "subStore" "IngredientSubStore" NOT NULL DEFAULT 'OTHER';

-- CreateIndex
CREATE INDEX "Ingredient_subStore_idx" ON "Ingredient"("subStore");
