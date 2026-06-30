-- Kitchen "hand to delivery" intimation timestamp. Additive + nullable.
ALTER TABLE "Order" ADD COLUMN "handedToDeliveryAt" TIMESTAMP(3);
