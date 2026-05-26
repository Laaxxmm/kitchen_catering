
-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('BANQUET', 'ODC', 'PACKET', 'ROOM_SERVICE', 'ALACARTE', 'MANAGEMENT');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "OrderChannel" NOT NULL DEFAULT 'BANQUET',
ADD COLUMN     "feedbackComment" TEXT,
ADD COLUMN     "feedbackRating" INTEGER,
ADD COLUMN     "feedbackSentAt" TIMESTAMP(3),
ADD COLUMN     "feedbackSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "feedbackToken" TEXT,
ADD COLUMN     "roomNumber" TEXT,
ADD COLUMN     "tableNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_feedbackToken_key" ON "Order"("feedbackToken");

