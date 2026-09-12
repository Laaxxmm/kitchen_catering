-- The client's tax invoice: "No of Pax × Rate × No Of Days" per line, a
-- service date per line when the bill spans dates, and the buyer's vendor
-- code in the TO block.
ALTER TABLE "Customer" ADD COLUMN "vendorCode" TEXT;

ALTER TABLE "CustomerInvoiceLine"
  ADD COLUMN "days" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "serviceDate" TIMESTAMP(3);
