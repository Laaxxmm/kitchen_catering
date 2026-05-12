-- AlterTable
ALTER TABLE "IngredientReceipt" ADD COLUMN     "recordedById" TEXT;

-- CreateTable
CREATE TABLE "IngredientAdjustment" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "beforeQty" DECIMAL(14,3) NOT NULL,
    "afterQty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "adjustedById" TEXT NOT NULL,
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngredientAdjustment_ingredientId_adjustedAt_idx" ON "IngredientAdjustment"("ingredientId", "adjustedAt");

-- CreateIndex
CREATE INDEX "IngredientAdjustment_adjustedById_idx" ON "IngredientAdjustment"("adjustedById");

-- CreateIndex
CREATE INDEX "IngredientReceipt_recordedById_idx" ON "IngredientReceipt"("recordedById");

-- AddForeignKey
ALTER TABLE "IngredientReceipt" ADD CONSTRAINT "IngredientReceipt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAdjustment" ADD CONSTRAINT "IngredientAdjustment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientAdjustment" ADD CONSTRAINT "IngredientAdjustment_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
