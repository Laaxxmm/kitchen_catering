-- Recurring order templates (manager-only) + vendor advance payments.
CREATE TABLE "OrderTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "mealType" "MealType" NOT NULL,
    "headcount" INTEGER NOT NULL,
    "packageTotal" DECIMAL(14,2),
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderTemplate_active_idx" ON "OrderTemplate"("active");
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "portions" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    CONSTRAINT "OrderTemplateItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderTemplateItem_templateId_idx" ON "OrderTemplateItem"("templateId");
ALTER TABLE "OrderTemplateItem" ADD CONSTRAINT "OrderTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderTemplateItem" ADD CONSTRAINT "OrderTemplateItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "VendorAdvance" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "poId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "appliedToBillId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorAdvance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VendorAdvance_vendorId_appliedToBillId_idx" ON "VendorAdvance"("vendorId", "appliedToBillId");
ALTER TABLE "VendorAdvance" ADD CONSTRAINT "VendorAdvance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorAdvance" ADD CONSTRAINT "VendorAdvance_poId_fkey" FOREIGN KEY ("poId") REFERENCES "VendorPO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VendorAdvance" ADD CONSTRAINT "VendorAdvance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorAdvance" ADD CONSTRAINT "VendorAdvance_appliedToBillId_fkey" FOREIGN KEY ("appliedToBillId") REFERENCES "VendorBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
