-- CreateEnum
CREATE TYPE "DishMenu" AS ENUM ('BANQUET', 'SERVICE', 'BOTH');

-- AlterTable
ALTER TABLE "Dish" ADD COLUMN     "menu" "DishMenu" NOT NULL DEFAULT 'BOTH';

-- CreateIndex
CREATE INDEX "Dish_menu_idx" ON "Dish"("menu");

