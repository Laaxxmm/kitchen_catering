-- Catalogue reset: wipe the working item lists and reload them from the
-- client's master sheet ("LIST OF ITEMS - SOFTWARE", Jul 2026).
--
-- Items are NOT blindly deleted: an ingredient/banquet item is referenced by
-- receipts, issues, adjustments, requisition lines, PO lines and recipes, so
-- deleting one with history would either fail on its foreign key or destroy
-- the audit trail (stock ledger, order trail, per-order P&L). Instead:
--   1. items with no history at all are hard-deleted (genuinely gone);
--   2. the rest have their on-hand zeroed (with an IngredientAdjustment row
--      so the stock ledger still reconciles) and are deactivated;
--   3. every item in the new sheet is then re-activated (if its name already
--      existed, keeping its history) or inserted fresh.
-- Net effect: the dropdowns show exactly the sheet's list at the sheet's
-- quantities, and nothing that an existing order/GRN points at is broken.

-- ── 1. Kitchen: drop items that carry no history whatsoever ──────────────
DELETE FROM "Ingredient" i
WHERE NOT EXISTS (SELECT 1 FROM "RecipeIngredient"       x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "IngredientReceipt"      x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "IngredientIssue"        x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "IngredientAdjustment"   x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "ChefRequisitionLine"    x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "PurchaseRequisitionLine" x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "OrderBudgetLine"        x WHERE x."ingredientId" = i.id)
  AND NOT EXISTS (SELECT 1 FROM "VendorPOLine"           x WHERE x."ingredientId" = i.id);

-- ── 2. Survivors: record the write-down, then zero + hide ────────────────
-- adjustedById is a required FK to User, so the write-down is attributed to
-- the oldest admin account. The EXISTS guard skips these rows entirely on a
-- DB with no admin rather than failing the migration on the FK.
INSERT INTO "IngredientAdjustment" ("id","ingredientId","delta","beforeQty","afterQty","reason","adjustedById","adjustedAt")
SELECT gen_random_uuid()::text, i.id, -i."onHandQty", i."onHandQty", 0,
       'Catalogue reset — stock cleared for master-list re-import',
       (SELECT u.id FROM "User" u WHERE u."role" = 'ADMIN'::"Role" ORDER BY u."createdAt" ASC LIMIT 1),
       NOW()
FROM "Ingredient" i
WHERE i."onHandQty" <> 0
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."role" = 'ADMIN'::"Role");

UPDATE "Ingredient" SET "onHandQty" = 0, "active" = false, "updatedAt" = NOW();

-- ── 3. Banquet / F&B: same treatment (no adjustment ledger on this side) ─
DELETE FROM "BanquetItem" b
WHERE NOT EXISTS (SELECT 1 FROM "BanquetReceiptLine"     x WHERE x."itemId" = b.id)
  AND NOT EXISTS (SELECT 1 FROM "BanquetIssueLine"       x WHERE x."itemId" = b.id)
  AND NOT EXISTS (SELECT 1 FROM "BanquetReturnLine"      x WHERE x."itemId" = b.id)
  AND NOT EXISTS (SELECT 1 FROM "BanquetRequisitionLine" x WHERE x."itemId" = b.id)
  AND NOT EXISTS (SELECT 1 FROM "VendorPOLine"           x WHERE x."banquetItemId" = b.id);

UPDATE "BanquetItem" SET "currentStock" = 0, "active" = false, "updatedAt" = NOW();



-- ── 4. Load the master list — reuse by name (keeps history) else insert ──

UPDATE "Ingredient" SET "active"=true,"unit"='Tray',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=7.5,"updatedAt"=NOW()
WHERE lower("name")=lower('EGG [ Rate - 7.2]');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0001','EGG [ Rate - 7.2]',NULL,'GROCERY'::"IngredientSubStore",'Tray',0,7.5,0,7.5,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG [ Rate - 7.2]'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=83.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Masoor Dal');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0002','Masoor Dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,83.0,0,83.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Masoor Dal'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=130.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Toor dal');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0003','Toor dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Toor dal'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=125.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Urad Dal/Uddin Bele R');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0004','Urad Dal/Uddin Bele R',NULL,'GROCERY'::"IngredientSubStore",'kg',0,125.0,0,125.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad Dal/Uddin Bele R'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=135.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Urad Dal whole');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0005','Urad Dal whole',NULL,'GROCERY'::"IngredientSubStore",'kg',0,135.0,0,135.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad Dal whole'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=120.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Yellow moong dal / Hesaru Bele Spl');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0006','Yellow moong dal / Hesaru Bele Spl',NULL,'GROCERY'::"IngredientSubStore",'kg',0,120.0,0,120.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Yellow moong dal / Hesaru Bele Spl'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=97.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Chana dal / Kadle Bele Reg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0007','Chana dal / Kadle Bele Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,97.0,0,97.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chana dal / Kadle Bele Reg'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=100.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Fried grams / Dried Chenna Reg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0008','Fried grams / Dried Chenna Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,100.0,0,100.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fried grams / Dried Chenna Reg'));

UPDATE "Ingredient" SET "active"=true,"unit"='Bag',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=1400.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Bullet Kolam Rice');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0009','Bullet Kolam Rice',NULL,'GROCERY'::"IngredientSubStore",'Bag',0,1400.0,0,1400.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Bullet Kolam Rice'));

UPDATE "Ingredient" SET "active"=true,"unit"='Bag',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=2472.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Golden Fish Kollam Rice 26kg / Rice Sona');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0010','Golden Fish Kollam Rice 26kg / Rice Sona',NULL,'GROCERY'::"IngredientSubStore",'Bag',0,2472.0,0,2472.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Golden Fish Kollam Rice 26kg / Rice Sona'));

UPDATE "Ingredient" SET "active"=true,"unit"='Bag',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=4140.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dawat Basmati rice');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0011','Dawat Basmati rice',NULL,'GROCERY'::"IngredientSubStore",'Bag',0,4140.0,0,4140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dawat Basmati rice'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=55.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Poha / Avalakki Reg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0012','Poha / Avalakki Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Poha / Avalakki Reg'));

UPDATE "Ingredient" SET "active"=true,"unit"='Bag',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=1222.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Orange Idli rice');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0013','Orange Idli rice',NULL,'GROCERY'::"IngredientSubStore",'Bag',0,1222.0,0,1222.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Idli rice'));

UPDATE "Ingredient" SET "active"=true,"unit"='Bag',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=950.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dosa Rice / Rice IR8');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0014','Dosa Rice / Rice IR8',NULL,'GROCERY'::"IngredientSubStore",'Bag',0,950.0,0,950.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dosa Rice / Rice IR8'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=45.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Orange Atta 50kg Bag / Atta Chakke');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0015','Orange Atta 50kg Bag / Atta Chakke',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Atta 50kg Bag / Atta Chakke'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=2100.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Maida');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0016','Maida',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2100.0,0,2100.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Maida'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=45.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Rice Flour');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0017','Rice Flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rice Flour'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=85.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Besan / Kadle Hittu');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0018','Besan / Kadle Hittu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Besan / Kadle Hittu'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=57.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ragi flour');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0019','Ragi flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,57.0,0,57.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ragi flour'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=50.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Corn flour');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0020','Corn flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,50.0,0,50.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Corn flour'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=48.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Chiroti rava');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0021','Chiroti rava',NULL,'GROCERY'::"IngredientSubStore",'kg',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chiroti rava'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=48.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Orange sooji(local rava) / Rave Uppitu Reg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0022','Orange sooji(local rava) / Rave Uppitu Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange sooji(local rava) / Rave Uppitu Reg'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=145.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Rajma chitra');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0023','Rajma chitra',NULL,'GROCERY'::"IngredientSubStore",'kg',0,145.0,0,145.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rajma chitra'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=147.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Red rajma');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0024','Red rajma',NULL,'GROCERY'::"IngredientSubStore",'kg',0,147.0,0,147.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Red rajma'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=118.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Black Urad Dal');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0025','Black Urad Dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,118.0,0,118.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black Urad Dal'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=115.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Green Moong Whole');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0026','Green Moong Whole',NULL,'GROCERY'::"IngredientSubStore",'kg',0,115.0,0,115.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green Moong Whole'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=82.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Black chana / Kadle Kalu');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0027','Black chana / Kadle Kalu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,82.0,0,82.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black chana / Kadle Kalu'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=145.0,"updatedAt"=NOW()
WHERE lower("name")=lower('White chana / Kabuli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0028','White chana / Kabuli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,145.0,0,145.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White chana / Kabuli'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=65.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Green peas dry');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0029','Green peas dry',NULL,'GROCERY'::"IngredientSubStore",'kg',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green peas dry'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=102.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Halasande');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0030','Halasande',NULL,'GROCERY'::"IngredientSubStore",'kg',0,102.0,0,102.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Halasande'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=150.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Millet/Navane');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0031','Millet/Navane',NULL,'GROCERY'::"IngredientSubStore",'kg',0,150.0,0,150.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Millet/Navane'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=210.0,"updatedAt"=NOW()
WHERE lower("name")=lower('White till');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0032','White till',NULL,'GROCERY'::"IngredientSubStore",'kg',0,210.0,0,210.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White till'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Black till');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0033','Black till',NULL,'GROCERY'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black till'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=960.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Badam seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0034','Badam seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,960.0,0,960.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Badam seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=2450.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Pista');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0035','Pista',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2450.0,0,2450.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pista'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=560.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Magaj');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0036','Magaj',NULL,'GROCERY'::"IngredientSubStore",'kg',0,560.0,0,560.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Magaj'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=185.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ground nuts/peanuts');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0037','Ground nuts/peanuts',NULL,'GROCERY'::"IngredientSubStore",'kg',0,185.0,0,185.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ground nuts/peanuts'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=102.86,"updatedAt"=NOW()
WHERE lower("name")=lower('Super Garam Masala 200gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0038','Super Garam Masala 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,102.86,0,102.86,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Super Garam Masala 200gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Everest Garam Masala 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0039','Everest Garam Masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Everest Garam Masala 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=90.0,"updatedAt"=NOW()
WHERE lower("name")=lower('MDH Garam masala 100gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0040','MDH Garam masala 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,90.0,0,90.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Garam masala 100gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=82.62,"updatedAt"=NOW()
WHERE lower("name")=lower('MDH Kashmiri CHILLI 100GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0041','MDH Kashmiri CHILLI 100GM',NULL,'GROCERY'::"IngredientSubStore",'pct',0,82.62,0,82.62,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Kashmiri CHILLI 100GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=944.76,"updatedAt"=NOW()
WHERE lower("name")=lower('Kashmiri chilli powder 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0042','Kashmiri chilli powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,944.76,0,944.76,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kashmiri chilli powder 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=130.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kibs Badam Feast Powder');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0043','Kibs Badam Feast Powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kibs Badam Feast Powder'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcts',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=105.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Yellow Chilly Powder 100gms');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0044','Yellow Chilly Powder 100gms',NULL,'GROCERY'::"IngredientSubStore",'pcts',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Yellow Chilly Powder 100gms'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=160.95,"updatedAt"=NOW()
WHERE lower("name")=lower('Shakti Chilly Powder 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0045','Shakti Chilly Powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,160.95,0,160.95,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Shakti Chilly Powder 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=160.0,"updatedAt"=NOW()
WHERE lower("name")=lower('MTR Chilly Powder 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0046','MTR Chilly Powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,160.0,0,160.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MTR Chilly Powder 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=143.81,"updatedAt"=NOW()
WHERE lower("name")=lower('Meat masala 200Gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0047','Meat masala 200Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,143.81,0,143.81,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Meat masala 200Gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=130.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Turmeric 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0048','Turmeric 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Turmeric 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=75.0,"updatedAt"=NOW()
WHERE lower("name")=lower('MDH Chunky Chat Masala 100gms');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0049','MDH Chunky Chat Masala 100gms',NULL,'GROCERY'::"IngredientSubStore",'pct',0,75.0,0,75.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Chunky Chat Masala 100gms'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Chat masala 200gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0050','Chat masala 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chat masala 200gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=311.43,"updatedAt"=NOW()
WHERE lower("name")=lower('chat masala 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0051','chat masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,311.43,0,311.43,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('chat masala 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=205.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tamarind Chap Spl');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0052','Tamarind Chap Spl',NULL,'GROCERY'::"IngredientSubStore",'kg',0,205.0,0,205.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tamarind Chap Spl'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MTR Samabar Powder 200 gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0053','MTR Samabar Powder 200 gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MTR Samabar Powder 200 gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=195.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sambar powder500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0054','Sambar powder500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,195.0,0,195.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sambar powder500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=395.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sambar powder 1KG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0055','Sambar powder 1KG',NULL,'GROCERY'::"IngredientSubStore",'pct',0,395.0,0,395.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sambar powder 1KG'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=110.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dhaniya powder 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0056','Dhaniya powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,110.0,0,110.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dhaniya powder 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=140.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dhaniya seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0057','Dhaniya seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,140.0,0,140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dhaniya seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=420.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Byadgi chilli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0058','Byadgi chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,420.0,0,420.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Byadgi chilli'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=420.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Round chilli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0059','Round chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,420.0,0,420.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Round chilli'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=360.95,"updatedAt"=NOW()
WHERE lower("name")=lower('Salem chilli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0060','Salem chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,360.95,0,360.95,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Salem chilli'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=310.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Chakke/Cinnamon stick');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0061','Chakke/Cinnamon stick',NULL,'GROCERY'::"IngredientSubStore",'kg',0,310.0,0,310.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chakke/Cinnamon stick'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=140.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Pulav leaves');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0062','Pulav leaves',NULL,'GROCERY'::"IngredientSubStore",'kg',0,140.0,0,140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pulav leaves'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=850.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Marati Moggu');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0063','Marati Moggu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Marati Moggu'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=310.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Lavanga');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0064','Lavanga',NULL,'GROCERY'::"IngredientSubStore",'kg',0,310.0,0,310.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Lavanga'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=1980.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Big elachi');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0065','Big elachi',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1980.0,0,1980.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Big elachi'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=3250.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Elachi');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0066','Elachi',NULL,'GROCERY'::"IngredientSubStore",'kg',0,3250.0,0,3250.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Elachi'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=2350.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jaypathra (Javitri)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0067','Jaypathra (Javitri)',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2350.0,0,2350.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaypathra (Javitri)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=1050.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jaypal / Jakai Pc');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0068','Jaypal / Jakai Pc',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1050.0,0,1050.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaypal / Jakai Pc'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=210.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sompu seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0069','Sompu seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,210.0,0,210.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sompu seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=112.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Mustard seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0070','Mustard seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,112.0,0,112.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mustard seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=850.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Black whole pepper');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0071','Black whole pepper',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black whole pepper'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=850.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Star Annise');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0072','Star Annise',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Star Annise'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=330.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jeera seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0073','Jeera seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,330.0,0,330.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jeera seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=42.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jeera powder 100gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0074','Jeera powder 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,42.0,0,42.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jeera powder 100gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=48.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Black pepper powder');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0075','Black pepper powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black pepper powder'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=27.61,"updatedAt"=NOW()
WHERE lower("name")=lower('White pepper powder 100Gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0076','White pepper powder 100Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,27.61,0,27.61,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White pepper powder 100Gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=95.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Methi seeds');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0077','Methi seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,95.0,0,95.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Methi seeds'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=1494.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ghus Ghus');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0078','Ghus Ghus',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1494.0,0,1494.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ghus Ghus'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=349.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kitchen King Masala 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0079','Kitchen King Masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,349.0,0,349.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kitchen King Masala 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=82.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kitchen King masala 100gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0080','Kitchen King masala 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,82.0,0,82.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kitchen King masala 100gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Maggie');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0081','Maggie',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Maggie'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=600.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kallu hoo/ lichen');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0082','Kallu hoo/ lichen',NULL,'GROCERY'::"IngredientSubStore",'kg',0,600.0,0,600.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kallu hoo/ lichen'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=45.23,"updatedAt"=NOW()
WHERE lower("name")=lower('Sugar');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0083','Sugar',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.23,0,45.23,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sugar'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=45.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jaggery Powder 500g');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0084','Jaggery Powder 500g',NULL,'GROCERY'::"IngredientSubStore",'pct',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaggery Powder 500g'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=56.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Jaggery ball');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0085','Jaggery ball',NULL,'GROCERY'::"IngredientSubStore",'kg',0,56.0,0,56.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaggery ball'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=175.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Aromatic mix');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0086','Aromatic mix',NULL,'GROCERY'::"IngredientSubStore",'pct',0,175.0,0,175.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Aromatic mix'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=105.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Soya bean');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0087','Soya bean',NULL,'GROCERY'::"IngredientSubStore",'kg',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Soya bean'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=460.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kismiss / Dry Grapes');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0088','Kismiss / Dry Grapes',NULL,'GROCERY'::"IngredientSubStore",'kg',0,460.0,0,460.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kismiss / Dry Grapes'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=590.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Baby cashewnut');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0089','Baby cashewnut',NULL,'GROCERY'::"IngredientSubStore",'kg',0,590.0,0,590.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Baby cashewnut'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=840.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Cashewnut 4p');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0090','Cashewnut 4p',NULL,'GROCERY'::"IngredientSubStore",'kg',0,840.0,0,840.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Cashewnut 4p'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=130.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Rasam powder 200gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0091','Rasam powder 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rasam powder 200gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=152.38,"updatedAt"=NOW()
WHERE lower("name")=lower('Bisibelebath powder 200Gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0092','Bisibelebath powder 200Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,152.38,0,152.38,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Bisibelebath powder 200Gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=135.24,"updatedAt"=NOW()
WHERE lower("name")=lower('Puliyogare powder 200gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0093','Puliyogare powder 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,135.24,0,135.24,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Puliyogare powder 200gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=390.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Puliyogare powder 1kg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0094','Puliyogare powder 1kg',NULL,'GROCERY'::"IngredientSubStore",'pct',0,390.0,0,390.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Puliyogare powder 1kg'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=65.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Splitz Tomato Ketchup');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0095','Splitz Tomato Ketchup',NULL,'GROCERY'::"IngredientSubStore",'pct',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Splitz Tomato Ketchup'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=24.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Vinegar');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0096','Vinegar',NULL,'GROCERY'::"IngredientSubStore",'btl',0,24.0,0,24.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Vinegar'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=41.9,"updatedAt"=NOW()
WHERE lower("name")=lower('Red chilli sauce');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0097','Red chilli sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,41.9,0,41.9,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Red chilli sauce'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=48.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Green chilli sauce');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0098','Green chilli sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green chilli sauce'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=48.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dark soya sauce');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0099','Dark soya sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dark soya sauce'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=71.2,"updatedAt"=NOW()
WHERE lower("name")=lower('Dry mango powder/Amchur powder');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0100','Dry mango powder/Amchur powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,71.2,0,71.2,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dry mango powder/Amchur powder'));

UPDATE "Ingredient" SET "active"=true,"unit"='tin',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=55.0,"updatedAt"=NOW()
WHERE lower("name")=lower('orange red bush');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0101','orange red bush',NULL,'GROCERY'::"IngredientSubStore",'tin',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('orange red bush'));

UPDATE "Ingredient" SET "active"=true,"unit"='tin',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=85.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kesari bush');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0102','Kesari bush',NULL,'GROCERY'::"IngredientSubStore",'tin',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kesari bush'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=52.5,"updatedAt"=NOW()
WHERE lower("name")=lower('Ingu(LG powder)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0103','Ingu(LG powder)',NULL,'GROCERY'::"IngredientSubStore",'btl',0,52.5,0,52.5,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ingu(LG powder)'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=62.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Keora water');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0104','Keora water',NULL,'GROCERY'::"IngredientSubStore",'btl',0,62.0,0,62.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Keora water'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=55.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Zaika gulabari / Rose Water');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0105','Zaika gulabari / Rose Water',NULL,'GROCERY'::"IngredientSubStore",'btl',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Zaika gulabari / Rose Water'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=29.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tata salt(powder)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0106','Tata salt(powder)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,29.0,0,29.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tata salt(powder)'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=19.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Stone salt');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0107','Stone salt',NULL,'GROCERY'::"IngredientSubStore",'pct',0,19.0,0,19.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Stone salt'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=275.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ajwin');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0108','Ajwin',NULL,'GROCERY'::"IngredientSubStore",'kg',0,275.0,0,275.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ajwin'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=110.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Mayonnaise');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0109','Mayonnaise',NULL,'GROCERY'::"IngredientSubStore",'pct',0,110.0,0,110.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mayonnaise'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Saffron');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0110','Saffron',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Saffron'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=80.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Kasuri methi 100gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0111','Kasuri methi 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,80.0,0,80.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kasuri methi 100gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=60.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Anil shavige Vermicelli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0112','Anil shavige Vermicelli',NULL,'GROCERY'::"IngredientSubStore",'pct',0,60.0,0,60.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Anil shavige Vermicelli'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=105.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Roasted vermicelli');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0113','Roasted vermicelli',NULL,'GROCERY'::"IngredientSubStore",'pct',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Roasted vermicelli'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Noodles');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0114','Noodles',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Noodles'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=61.9,"updatedAt"=NOW()
WHERE lower("name")=lower('Macroni Pasta 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0115','Macroni Pasta 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,61.9,0,61.9,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Macroni Pasta 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=385.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Roasted North papad(masala papad)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0116','Roasted North papad(masala papad)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,385.0,0,385.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Roasted North papad(masala papad)'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=58.57,"updatedAt"=NOW()
WHERE lower("name")=lower('Flavour papad(sago chilly)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0117','Flavour papad(sago chilly)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,58.57,0,58.57,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Flavour papad(sago chilly)'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=40.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Urad dal papad(lotus)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0118','Urad dal papad(lotus)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,40.0,0,40.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad dal papad(lotus)'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=174.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Rice papad 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0119','Rice papad 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,174.0,0,174.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rice papad 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=85.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Fryums');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0120','Fryums',NULL,'GROCERY'::"IngredientSubStore",'kg',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fryums'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=495.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tea powder-red label 950g');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0121','Tea powder-red label 950g',NULL,'GROCERY'::"IngredientSubStore",'pct',0,495.0,0,495.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tea powder-red label 950g'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=595.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Coffee powder-Bru Ins 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0122','Coffee powder-Bru Ins 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,595.0,0,595.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coffee powder-Bru Ins 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=360.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Coffee Cothas 500gm');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0123','Coffee Cothas 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,360.0,0,360.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coffee Cothas 500gm'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcts',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sunpure oil');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0124','Sunpure oil',NULL,'GROCERY'::"IngredientSubStore",'pcts',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sunpure oil'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=480.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Coconut oil');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0125','Coconut oil',NULL,'GROCERY'::"IngredientSubStore",'pct',0,480.0,0,480.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut oil'));

UPDATE "Ingredient" SET "active"=true,"unit"='tin',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=95.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Coconut milk');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0126','Coconut milk',NULL,'GROCERY'::"IngredientSubStore",'tin',0,95.0,0,95.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut milk'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=198.09,"updatedAt"=NOW()
WHERE lower("name")=lower('Mustard oil');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0127','Mustard oil',NULL,'GROCERY'::"IngredientSubStore",'btl',0,198.09,0,198.09,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mustard oil'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=370.47,"updatedAt"=NOW()
WHERE lower("name")=lower('Olive oil');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0128','Olive oil',NULL,'GROCERY'::"IngredientSubStore",'btl',0,370.47,0,370.47,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Olive oil'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=429.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dry Coconut');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0129','Dry Coconut',NULL,'GROCERY'::"IngredientSubStore",'kg',0,429.0,0,429.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dry Coconut'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=650.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ghee');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0130','Ghee',NULL,'GROCERY'::"IngredientSubStore",'kg',0,650.0,0,650.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ghee'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=167.61,"updatedAt"=NOW()
WHERE lower("name")=lower('Fruit jam');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0131','Fruit jam',NULL,'GROCERY'::"IngredientSubStore",'btl',0,167.61,0,167.61,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fruit jam'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=265.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Pickle 5kg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0132','Pickle 5kg',NULL,'GROCERY'::"IngredientSubStore",'btl',0,265.0,0,265.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pickle 5kg'));

UPDATE "Ingredient" SET "active"=true,"unit"='btl',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=405.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Honey Dabur 1kg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0133','Honey Dabur 1kg',NULL,'GROCERY'::"IngredientSubStore",'btl',0,405.0,0,405.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Honey Dabur 1kg'));

UPDATE "Ingredient" SET "active"=true,"unit"='tin',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=65.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tomato Puree');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0134','Tomato Puree',NULL,'GROCERY'::"IngredientSubStore",'tin',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tomato Puree'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=65.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sabudana');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0135','Sabudana',NULL,'GROCERY'::"IngredientSubStore",'kg',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sabudana'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=44.76,"updatedAt"=NOW()
WHERE lower("name")=lower('Nylon sabudana / Sago 500');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0136','Nylon sabudana / Sago 500',NULL,'GROCERY'::"IngredientSubStore",'kg',0,44.76,0,44.76,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Nylon sabudana / Sago 500'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Oregano Leaves 1kg');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0137','Oregano Leaves 1kg',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Oregano Leaves 1kg'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=56.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Whole Ragi');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0138','Whole Ragi',NULL,'GROCERY'::"IngredientSubStore",'kg',0,56.0,0,56.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Whole Ragi'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='GROCERY'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Coconut Milk Powder');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GR2-0139','Coconut Milk Powder',NULL,'GROCERY'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut Milk Powder'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA LEAVES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0140','BANANA LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA LEAVES'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CARROT Indian');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0141','CARROT Indian',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CARROT Indian'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CUCUMBER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0142','CUCUMBER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CUCUMBER'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CABBAGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0143','CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CABBAGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('LEMON');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0144','LEMON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LEMON'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GARLIC PEELED LOCAL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0145','GARLIC PEELED LOCAL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GARLIC PEELED LOCAL'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CAULIFLOWER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0146','CAULIFLOWER',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAULIFLOWER'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PAPAYA RAW');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0147','PAPAYA RAW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAPAYA RAW'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BRINJAL BIG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0148','BRINJAL BIG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BRINJAL BIG'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GINGER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0149','GINGER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GINGER'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RADDISH WHITE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0150','RADDISH WHITE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RADDISH WHITE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHILLI GREEN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0151','CHILLI GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHILLI GREEN'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('COCONUT WHOLE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0152','COCONUT WHOLE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT WHOLE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SWEET POTATO');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0153','SWEET POTATO',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET POTATO'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BOTTLE GOURD (LAUKI/DUDHI))');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0154','BOTTLE GOURD (LAUKI/DUDHI))',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BOTTLE GOURD (LAUKI/DUDHI))'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('JACKFRUIT ( KATHAL) RAW');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0155','JACKFRUIT ( KATHAL) RAW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('JACKFRUIT ( KATHAL) RAW'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BITTER GOURD (KARELA)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0156','BITTER GOURD (KARELA)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BITTER GOURD (KARELA)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHILLI BHAVNAGRI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0157','CHILLI BHAVNAGRI',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHILLI BHAVNAGRI'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RED CHILLI FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0158','RED CHILLI FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RED CHILLI FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA KELA PHOOL KG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0159','BANANA KELA PHOOL KG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA KELA PHOOL KG'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BEET ROOT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0160','BEET ROOT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BEET ROOT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BRINJAL SMALL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0161','BRINJAL SMALL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BRINJAL SMALL'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('LADY FINGER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0162','LADY FINGER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LADY FINGER'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('DRUM STICK (SINGH)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0163','DRUM STICK (SINGH)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRUM STICK (SINGH)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('POTATO SMALL (DUM ALOO)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0164','POTATO SMALL (DUM ALOO)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO SMALL (DUM ALOO)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GREEN PEAS FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0165','GREEN PEAS FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GREEN PEAS FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MADRAS ONION');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0166','MADRAS ONION',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MADRAS ONION'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PUMPKIN RED');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0167','PUMPKIN RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PUMPKIN RED'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOW CHOW VEG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0168','CHOW CHOW VEG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOW CHOW VEG'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('TENDER COCONUT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0169','TENDER COCONUT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TENDER COCONUT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SNAKE GOURD (PADVAL)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0170','SNAKE GOURD (PADVAL)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SNAKE GOURD (PADVAL)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MUSHROOM FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0171','MUSHROOM FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUSHROOM FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BEANS HARICOT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0172','BEANS HARICOT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BEANS HARICOT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SWEET CORN COB NOS (WHOLE)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0173','SWEET CORN COB NOS (WHOLE)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET CORN COB NOS (WHOLE)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ridgegourd');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0174','Ridgegourd',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ridgegourd'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SPRING ONION GREEN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0175','SPRING ONION GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SPRING ONION GREEN'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SPINACH FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0176','SPINACH FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SPINACH FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CORIANDER LEAVES (DHANIA)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0177','CORIANDER LEAVES (DHANIA)',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CORIANDER LEAVES (DHANIA)'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MINT LEAVES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0178','MINT LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINT LEAVES'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CURRY LEAVES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0179','CURRY LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CURRY LEAVES'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('METHI FRESH (FENUGREEK LEAVES)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0180','METHI FRESH (FENUGREEK LEAVES)',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI FRESH (FENUGREEK LEAVES)'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GONGURA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0181','GONGURA',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GONGURA'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('DILL FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0182','DILL FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DILL FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='bunch',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BABY SPINACH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0183','BABY SPINACH',NULL,'VEGETABLE'::"IngredientSubStore",'bunch',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BABY SPINACH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ONION RED BIG (8 TO 10 PC)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0184','ONION RED BIG (8 TO 10 PC)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ONION RED BIG (8 TO 10 PC)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('TOMATO HYBRID BIG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0185','TOMATO HYBRID BIG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TOMATO HYBRID BIG'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('POTATO LARGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0186','POTATO LARGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO LARGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CAPSICUM GREEN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0187','CAPSICUM GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM GREEN'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA ROBUSTA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0188','BANANA ROBUSTA',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA ROBUSTA'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('AVOCADO INDIAN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0189','AVOCADO INDIAN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('AVOCADO INDIAN'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GUAVAS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0190','GUAVAS',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GUAVAS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ORANGE IMP');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0191','ORANGE IMP',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ORANGE IMP'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0192','PINEAPPLE FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('WATER MELON');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0193','WATER MELON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('WATER MELON'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('APPLE GREEN IMP');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0194','APPLE GREEN IMP',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('APPLE GREEN IMP'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('APPLE RED');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0195','APPLE RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('APPLE RED'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GRAPE FRUIT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0196','GRAPE FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPE FRUIT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MANGO Alphonso');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0197','MANGO Alphonso',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MANGO Alphonso'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA Yelakki');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0198','BANANA Yelakki',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA Yelakki'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('POMEGRANATE FRUIT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0199','POMEGRANATE FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POMEGRANATE FRUIT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('DRAGON FRUIT RED');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0200','DRAGON FRUIT RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRAGON FRUIT RED'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PAPAYA RIPE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0201','PAPAYA RIPE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAPAYA RIPE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MUSK MELON');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0202','MUSK MELON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUSK MELON'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PASSION FRUIT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0203','PASSION FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PASSION FRUIT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GRAPES BLACK SEEDLESS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0204','GRAPES BLACK SEEDLESS',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPES BLACK SEEDLESS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GRAPES GREEN LOCAL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0205','GRAPES GREEN LOCAL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPES GREEN LOCAL'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHIKOO (SAPOTA)');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0206','CHIKOO (SAPOTA)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHIKOO (SAPOTA)'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Orange Local');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0207','Orange Local',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Local'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RADDISH RED');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0208','RADDISH RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RADDISH RED'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RIDGE GOURD');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0209','RIDGE GOURD',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RIDGE GOURD'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CUCUMBER EUROPEAN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0210','CUCUMBER EUROPEAN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CUCUMBER EUROPEAN'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CAPSICUM RED');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0211','CAPSICUM RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM RED'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BROCCOLI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0212','BROCCOLI',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BROCCOLI'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('LETTUCE ICEBERG');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0213','LETTUCE ICEBERG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LETTUCE ICEBERG'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BABY CORN FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0214','BABY CORN FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BABY CORN FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CAPSICUM YELLOW');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0215','CAPSICUM YELLOW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM YELLOW'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHINESE CABBAGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0216','CHINESE CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHINESE CABBAGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ZUCCHINI GREEN / SQUASH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0217','ZUCCHINI GREEN / SQUASH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ZUCCHINI GREEN / SQUASH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BASIL FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0218','BASIL FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BASIL FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RED CABBAGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0219','RED CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RED CABBAGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('LEMON GRASS FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0220','LEMON GRASS FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LEMON GRASS FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CELERY FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0221','CELERY FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CELERY FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ZUCCHINI YELLOW / SQUASH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0222','ZUCCHINI YELLOW / SQUASH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ZUCCHINI YELLOW / SQUASH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHERRY TOMATO');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0223','CHERRY TOMATO',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHERRY TOMATO'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='VEGETABLE'::"IngredientSubStore",
  "category"=NULL,"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PARSLEY FRESH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VG2-0224','PARSLEY FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PARSLEY FRESH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PANEER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0225','PANEER','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GREEN PEAS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0226','GREEN PEAS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GREEN PEAS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SWEET CORN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0227','SWEET CORN','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET CORN'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('UNSALTED BUTTER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0228','UNSALTED BUTTER','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('UNSALTED BUTTER'));

UPDATE "Ingredient" SET "active"=true,"unit"='litre',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FRESH CREAM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0229','FRESH CREAM','Frozen','OTHER'::"IngredientSubStore",'litre',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRESH CREAM'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHEESE BLOCKS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0230','CHEESE BLOCKS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE BLOCKS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHEESE SLICE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0231','CHEESE SLICE','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE SLICE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('KHOVA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0232','KHOVA','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KHOVA'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MINI PUNJABI SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0233','MINI PUNJABI SAMOSA','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINI PUNJABI SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CORN SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0234','CORN SAMOSA','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CORN SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHEESE CORN SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0235','CHEESE CORN SAMOSA','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE CORN SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG CUTLETS 18PIC');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0236','VEG CUTLETS 18PIC','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG CUTLETS 18PIC'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG NUGGETS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0237','VEG NUGGETS','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG NUGGETS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG CHEESE BALLS / POTATO KIEWS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0238','VEG CHEESE BALLS / POTATO KIEWS','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG CHEESE BALLS / POTATO KIEWS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG BREADED ROLL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0239','VEG BREADED ROLL','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG BREADED ROLL'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG SPRING ROLL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0240','VEG SPRING ROLL','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG SPRING ROLL'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG FINGERS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0241','VEG FINGERS','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG FINGERS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PANEER ROLLS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0242','PANEER ROLLS','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER ROLLS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG LOLLIPOP');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0243','VEG LOLLIPOP','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG LOLLIPOP'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FISH FINGERS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0244','FISH FINGERS','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FISH FINGERS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FRENCH FRIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0245','FRENCH FRIES','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRENCH FRIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ALOO TIKKI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0246','ALOO TIKKI','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALOO TIKKI'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Frozen',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('POTATO WEDGES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FZ2-0247','POTATO WEDGES','Frozen','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO WEDGES'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('WHOLE CHICKEN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0248','WHOLE CHICKEN','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('WHOLE CHICKEN'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN LOLLIPOP');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0249','CHICKEN LOLLIPOP','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN LOLLIPOP'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN BREAST');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0250','CHICKEN BREAST','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN BREAST'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN CURRY CUT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0251','CHICKEN CURRY CUT','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN CURRY CUT'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN BONELESS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0252','CHICKEN BONELESS','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN BONELESS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN LEG PIECE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0253','CHICKEN LEG PIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN LEG PIECE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FISH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0254','FISH','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FISH'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MUTTON LEG PIECE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0255','MUTTON LEG PIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUTTON LEG PIECE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MUTTON BIRIYANI PIIECE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0256','MUTTON BIRIYANI PIIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUTTON BIRIYANI PIIECE'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Non veg',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PRAWNS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NV2-0257','PRAWNS','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PRAWNS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANAN CAKE 25 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0258','BANANAN CAKE 25 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANAN CAKE 25 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA CAKE 40 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0259','BANANA CAKE 40 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA CAKE 40 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA CAKE 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0260','BANANA CAKE 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA CAKE 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BROWNIE 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0261','BROWNIE 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BROWNIE 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BROWNIE 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0262','BROWNIE 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BROWNIE 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BROWNIE 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0263','BROWNIE 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BROWNIE 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CAKE 25G');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0264','CHOCOLATE CAKE 25G','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CAKE 25G'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CAKE 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0265','CHOCOLATE CAKE 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CAKE 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0266','CHOCOLATE 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FRUIT CAKE 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0267','FRUIT CAKE 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRUIT CAKE 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FRUIT CAKE 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0268','FRUIT CAKE 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRUIT CAKE 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('FRUIT CAKE 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0269','FRUIT CAKE 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRUIT CAKE 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PLAIN CAKE 25 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0270','PLAIN CAKE 25 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PLAIN CAKE 25 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PLAIN CAKE 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0271','PLAIN CAKE 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PLAIN CAKE 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PLAIN CAKE 60 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0272','PLAIN CAKE 60 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PLAIN CAKE 60 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BLUE BERRY MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0273','BLUE BERRY MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLUE BERRY MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BLUE BERRY MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0274','BLUE BERRY MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLUE BERRY MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BLUE BERRY MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0275','BLUE BERRY MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLUE BERRY MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('STRAW BERRY MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0276','STRAW BERRY MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAW BERRY MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('STRAW BERRY MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0277','STRAW BERRY MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAW BERRY MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('STRAW BERRY MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0278','STRAW BERRY MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAW BERRY MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0279','CHOCOLATE MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0280','CHOCOLATE MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0281','CHOCOLATE MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0282','VANILLA MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0283','VANILLA MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA MUFFIN 60 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0284','VANILLA MUFFIN 60 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA MUFFIN 60 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0285','BANANA MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0286','BANANA MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BANANA MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0287','BANANA MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE MUFFIN 25 GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0288','PINEAPPLE MUFFIN 25 GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE MUFFIN 25 GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0289','PINEAPPLE MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0290','PINEAPPLE MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 25GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0291','CHOCOLATE CHIP MUFFIN 25GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 25GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0292','CHOCOLATE CHIP MUFFIN 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0293','CHOCOLATE CHIP MUFFIN 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CHIP MUFFIN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE PASTRY 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0294','PINEAPPLE PASTRY 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE PASTRY 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PINEAPPLE PASTRY 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0295','PINEAPPLE PASTRY 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE PASTRY 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BLACK FOREST PASTRY 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0296','BLACK FOREST PASTRY 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLACK FOREST PASTRY 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BLACK FOREST PASTRY 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0297','BLACK FOREST PASTRY 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLACK FOREST PASTRY 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE PASTRY 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0298','CHOCOLATE PASTRY 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE PASTRY 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE PASTRY 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0299','CHOCOLATE PASTRY 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE PASTRY 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BELGIAN CHOCOLATE PASTRY 40GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0300','BELGIAN CHOCOLATE PASTRY 40GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BELGIAN CHOCOLATE PASTRY 40GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BELGIAN CHOCOLATE PASTRY 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0301','BELGIAN CHOCOLATE PASTRY 60GM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BELGIAN CHOCOLATE PASTRY 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('POTATO CHIPS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0302','POTATO CHIPS','Bakery','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO CHIPS'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MULTI GRAIN COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0303','MULTI GRAIN COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MULTI GRAIN COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('OATS COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0304','OATS COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('OATS COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MASALA COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0305','MASALA COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MASALA COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('COCONUT COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0306','COCONUT COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHACOLATE COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0307','CHACOLATE COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHACOLATE COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('JEERA SALT COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0308','JEERA SALT COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('JEERA SALT COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CASHEW COOKIES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0309','CASHEW COOKIES','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CASHEW COOKIES'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SANDWICH BREAD');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0310','SANDWICH BREAD','Bakery','OTHER'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SANDWICH BREAD'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MILK BREAD');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0311','MILK BREAD','Bakery','OTHER'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MILK BREAD'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PAV BUN 60GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0312','PAV BUN 60GM','Bakery','OTHER'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAV BUN 60GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pct',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PAVBUN 80GM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0313','PAVBUN 80GM','Bakery','OTHER'::"IngredientSubStore",'pct',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAVBUN 80GM'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0314','SAMOSA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('KACHORI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0315','KACHORI','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KACHORI'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE CREAM BUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0316','CHOCOLATE CREAM BUN','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CREAM BUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA CREAM BUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0317','VANILLA CREAM BUN','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA CREAM BUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ALO BUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0318','ALO BUN','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALO BUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VEG PUFFS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0319','VEG PUFFS','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG PUFFS'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHICKEN PUFFS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0320','CHICKEN PUFFS','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN PUFFS'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('EGG PUFFS FULL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0321','EGG PUFFS FULL','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG PUFFS FULL'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('EGG PUFFS SEMI HALF');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0322','EGG PUFFS SEMI HALF','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG PUFFS SEMI HALF'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ONION SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0323','ONION SAMOSA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ONION SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ALO SAMOSA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0324','ALO SAMOSA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALO SAMOSA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('NORMAL BUN FOR GULKHAND');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0325','NORMAL BUN FOR GULKHAND','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('NORMAL BUN FOR GULKHAND'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PANEER PUFFS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0326','PANEER PUFFS','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER PUFFS'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('JALEBI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0327','JALEBI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('JALEBI'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('GULAB JAMUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0328','GULAB JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GULAB JAMUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('RASAMALAI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0329','RASAMALAI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RASAMALAI'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHAMPAKALI/ CHUM CHUM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0330','CHAMPAKALI/ CHUM CHUM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHAMPAKALI/ CHUM CHUM'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('DRY JAMUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0331','DRY JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRY JAMUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('COCONUT DRY JAMUN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0332','COCONUT DRY JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT DRY JAMUN'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MALPAV');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0333','MALPAV','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MALPAV'));

UPDATE "Ingredient" SET "active"=true,"unit"='pcs',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MINI CHUM CHUM DRY');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0334','MINI CHUM CHUM DRY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINI CHUM CHUM DRY'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('METHI CHAPATI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0335','METHI CHAPATI','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI CHAPATI'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHAPATI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0336','CHAPATI','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHAPATI'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PHULKA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0337','PHULKA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PHULKA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('METHI PHULKA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0338','METHI PHULKA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI PHULKA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('IDLY SML SIZE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0339','IDLY SML SIZE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('IDLY SML SIZE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('AKKI ROTTI');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0340','AKKI ROTTI','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('AKKI ROTTI'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('IDIYAPPAM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0341','IDIYAPPAM','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('IDIYAPPAM'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BELE HOLIGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0342','BELE HOLIGE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BELE HOLIGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('KAAYI HOLIGE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0343','KAAYI HOLIGE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KAAYI HOLIGE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CYLINDER HP GAS');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0344','CYLINDER HP GAS','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CYLINDER HP GAS'));

UPDATE "Ingredient" SET "active"=true,"unit"='kg',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ICE CUBES');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0345','ICE CUBES','Bakery','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ICE CUBES'));

UPDATE "Ingredient" SET "active"=true,"unit"='blocks',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA LITE 4L PLAIN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0346','VANILLA LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'blocks',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA LITE 4L PLAIN'));

UPDATE "Ingredient" SET "active"=true,"unit"='blocks',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('STRAWBERRY LITE 4L PLAIN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0347','STRAWBERRY LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'blocks',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAWBERRY LITE 4L PLAIN'));

UPDATE "Ingredient" SET "active"=true,"unit"='blocks',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('PISTA LITE 4L PLAIN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0348','PISTA LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'blocks',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PISTA LITE 4L PLAIN'));

UPDATE "Ingredient" SET "active"=true,"unit"='blocks',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BUTTER SCOTCH 4L PLAIN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0349','BUTTER SCOTCH 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'blocks',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BUTTER SCOTCH 4L PLAIN'));

UPDATE "Ingredient" SET "active"=true,"unit"='blocks',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE LITE 4L PLAIN');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0350','CHOCOLATE LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'blocks',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE LITE 4L PLAIN'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('BUTTERSCOTCH');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0351','BUTTERSCOTCH','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BUTTERSCOTCH'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCOLATE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0352','CHOCOLATE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0353','VANILLA','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCONUTZ');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0354','CHOCONUTZ','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCONUTZ'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('CHOCODREAM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0355','CHOCODREAM','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCODREAM'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MANGO CANDY');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0356','MANGO CANDY','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MANGO CANDY'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('TWISTER');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0357','TWISTER','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TWISTER'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('TRIPPLE SUNDAE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0358','TRIPPLE SUNDAE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TRIPPLE SUNDAE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MINI SUNDAE CHOCOLATE');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0359','MINI SUNDAE CHOCOLATE','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINI SUNDAE CHOCOLATE'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('VANILLA BALL');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0360','VANILLA BALL','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA BALL'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('ARABIAN DELIGHT');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0361','ARABIAN DELIGHT','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ARABIAN DELIGHT'));

UPDATE "Ingredient" SET "active"=true,"unit"='nos',"subStore"='OTHER'::"IngredientSubStore",
  "category"='Bakery',"onHandQty"=0,"avgUnitCost"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('MORE THAN AAM');
INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BK2-0362','MORE THAN AAM','Bakery','OTHER'::"IngredientSubStore",'nos',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MORE THAN AAM'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cups',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ripple cup 110ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ripple cup 110ml','FB2-0001','Cups','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ripple cup 110ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cups',"currentStock"=1575.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ripple cup 210 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ripple cup 210 ml','FB2-0002','Cups','nos',true,1575.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ripple cup 210 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cups',"currentStock"=500.0,"updatedAt"=NOW()
WHERE lower("name")=lower('White Plain CUPS 210 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'White Plain CUPS 210 ml','FB2-0003','Cups','nos',true,500.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('White Plain CUPS 210 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pcts',"category"='Paper Products',"currentStock"=319.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Printed Tissue Paper');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Printed Tissue Paper','FB2-0004','Paper Products','pcts',true,319.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Printed Tissue Paper'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Trays',"currentStock"=325.0,"updatedAt"=NOW()
WHERE lower("name")=lower('5 CP Meal Tray');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'5 CP Meal Tray','FB2-0005','Trays','nos',true,325.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('5 CP Meal Tray'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Trays',"currentStock"=800.0,"updatedAt"=NOW()
WHERE lower("name")=lower('3CP Meal Tray 10 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'3CP Meal Tray 10 inch','FB2-0006','Trays','nos',true,800.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('3CP Meal Tray 10 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=475.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Corn Starch Round Plates 10 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn Starch Round Plates 10 inch','FB2-0007','Plates','nos',true,475.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn Starch Round Plates 10 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Baggase 7 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Baggase 7 inch','FB2-0008','Plates','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Baggase 7 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='roll',"category"='Paper Products',"currentStock"=3.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Butter Paper Roll');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Butter Paper Roll','FB2-0009','Paper Products','roll',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Butter Paper Roll'));

UPDATE "BanquetItem" SET "active"=true,"unit"='sheets',"category"='Stickers',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Round Printed logo sticker');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Round Printed logo sticker','FB2-0010','Stickers','sheets',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Round Printed logo sticker'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Stickers',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Printed Square sticker');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Printed Square sticker','FB2-0011','Stickers','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Printed Square sticker'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Paper Products',"currentStock"=3.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Table Roll');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Table Roll','FB2-0012','Paper Products','nos',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Table Roll'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Foils & Wraps',"currentStock"=5.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Aluminium Foil');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminium Foil','FB2-0013','Foils & Wraps','nos',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminium Foil'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Foils & Wraps',"currentStock"=6.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Cling Wrap');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Cling Wrap','FB2-0014','Foils & Wraps','nos',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Cling Wrap'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=150.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Windsor 8 CP Meal Box');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Windsor 8 CP Meal Box','FB2-0015','Boxes','nos',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Windsor 8 CP Meal Box'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=600.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Windsor 5 CP Meal Box');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Windsor 5 CP Meal Box','FB2-0016','Boxes','nos',true,600.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Windsor 5 CP Meal Box'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=300.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Corn starch 8 CP Meal Box');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn starch 8 CP Meal Box','FB2-0017','Boxes','nos',true,300.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn starch 8 CP Meal Box'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cutlery',"currentStock"=1000.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Wooden Spoon 16mm');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Spoon 16mm','FB2-0018','Cutlery','nos',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Spoon 16mm'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cutlery',"currentStock"=1000.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Wooden Fork 16mm');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Fork 16mm','FB2-0019','Cutlery','nos',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Fork 16mm'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cutlery',"currentStock"=1000.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Wooden Stirrer');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Stirrer','FB2-0020','Cutlery','nos',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Stirrer'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Tapes',"currentStock"=84.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Cello Tape 1 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Cello Tape 1 inch','FB2-0021','Tapes','nos',true,84.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Cello Tape 1 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Tapes',"currentStock"=36.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Cello Tape 2.5 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Cello Tape 2.5 inch','FB2-0022','Tapes','nos',true,36.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Cello Tape 2.5 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Tapes',"currentStock"=6.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Brown Tape 2.5 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Tape 2.5 inch','FB2-0023','Tapes','nos',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Tape 2.5 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Tapes',"currentStock"=45.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Brown Tape 4.5 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Tape 4.5 inch','FB2-0024','Tapes','nos',true,45.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Tape 4.5 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Tapes',"currentStock"=3.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Double Tape 2 iinch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Double Tape 2 iinch','FB2-0025','Tapes','nos',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Double Tape 2 iinch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Containers',"currentStock"=150.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Plastic Container 100ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container 100ml','FB2-0026','Containers','nos',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container 100ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Containers',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Plastic Container 500ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container 500ml','FB2-0027','Containers','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container 500ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Containers',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Plastic Container 750 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container 750 ml','FB2-0028','Containers','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container 750 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Containers',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Agri leaf Container 500 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Agri leaf Container 500 ml','FB2-0029','Containers','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Agri leaf Container 500 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Containers',"currentStock"=66.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Agri leaf Container 750 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Agri leaf Container 750 ml','FB2-0030','Containers','nos',true,66.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Agri leaf Container 750 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Bowls',"currentStock"=250.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Bagasse Bowl 180 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Bagasse Bowl 180 ml','FB2-0031','Bowls','nos',true,250.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Bagasse Bowl 180 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Bowls',"currentStock"=100.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Bagasse Bowl 115 ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Bagasse Bowl 115 ml','FB2-0032','Bowls','nos',true,100.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Bagasse Bowl 115 ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='boxes',"category"='Boxes',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('White Cake Box');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'White Cake Box','FB2-0033','Boxes','boxes',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('White Cake Box'));

UPDATE "BanquetItem" SET "active"=true,"unit"='boxes',"category"='Boxes',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Brown Cake Box');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Cake Box','FB2-0034','Boxes','boxes',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Cake Box'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Bags',"currentStock"=660.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Brown Paper Bag 7*3');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Paper Bag 7*3','FB2-0035','Bags','nos',true,660.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Paper Bag 7*3'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Areca Round 3CP [9inch]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Areca Round 3CP [9inch]','FB2-0036','Plates','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Areca Round 3CP [9inch]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Areca Sqaure 3CP [10inch ]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Areca Sqaure 3CP [10inch ]','FB2-0037','Plates','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Areca Sqaure 3CP [10inch ]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pouch',"category"='Hygiene',"currentStock"=6.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Hair Net');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Hair Net','FB2-0038','Hygiene','pouch',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Hair Net'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pouch',"category"='Hygiene',"currentStock"=5.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Hand Gloves');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Hand Gloves','FB2-0039','Hygiene','pouch',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Hand Gloves'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Hygiene',"currentStock"=30.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tooth Pick');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tooth Pick','FB2-0040','Hygiene','nos',true,30.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tooth Pick'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=975.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Burger Clam Shell 6*6');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger Clam Shell 6*6','FB2-0041','Boxes','nos',true,975.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger Clam Shell 6*6'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=750.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Burger Clam Shell 8*8');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger Clam Shell 8*8','FB2-0042','Boxes','nos',true,750.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger Clam Shell 8*8'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=525.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Burger Clam Shell 9*9');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger Clam Shell 9*9','FB2-0043','Boxes','nos',true,525.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger Clam Shell 9*9'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Boxes',"currentStock"=1950.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Sandwich clam shell');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Sandwich clam shell','FB2-0044','Boxes','nos',true,1950.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Sandwich clam shell'));

UPDATE "BanquetItem" SET "active"=true,"unit"='tins',"category"='Miscellaneous',"currentStock"=22.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Fuel Wax');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Fuel Wax','FB2-0045','Miscellaneous','tins',true,22.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Fuel Wax'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cups',"currentStock"=200.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Disposable Plastic cups with Lid 300ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Disposable Plastic cups with Lid 300ml','FB2-0046','Cups','nos',true,200.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Disposable Plastic cups with Lid 300ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Cups',"currentStock"=50.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Disposable Plastic Cups Without Lid 300ml');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Disposable Plastic Cups Without Lid 300ml','FB2-0047','Cups','nos',true,50.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Disposable Plastic Cups Without Lid 300ml'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Straws',"currentStock"=668.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Paper Straw 8mm');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Paper Straw 8mm','FB2-0048','Straws','nos',true,668.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Paper Straw 8mm'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=180.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Aluminimum Paper Paltes 7 inch');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminimum Paper Paltes 7 inch','FB2-0049','Plates','nos',true,180.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminimum Paper Paltes 7 inch'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Plates',"currentStock"=105.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Aluminium paper Plate Small');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminium paper Plate Small','FB2-0050','Plates','nos',true,105.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminium paper Plate Small'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pcts',"category"=NULL,"currentStock"=7.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Ketchup Sachets');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ketchup Sachets','FB2-0051',NULL,'pcts',true,7.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ketchup Sachets'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pcts',"category"='Cereals',"currentStock"=5.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Chocos Kelloggs');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Chocos Kelloggs','FB2-0052','Cereals','pcts',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Chocos Kelloggs'));

UPDATE "BanquetItem" SET "active"=true,"unit"='pcts',"category"='Cereals',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Corn Flakes');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn Flakes','FB2-0053','Cereals','pcts',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn Flakes'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('High Ball Glass [8 oz]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'High Ball Glass [8 oz]','EQ2-0054','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('High Ball Glass [8 oz]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Juice Glass');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Juice Glass','EQ2-0055','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Juice Glass'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('AP Wine Glass');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Wine Glass','EQ2-0056','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Wine Glass'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Champagne Saucer');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Champagne Saucer','EQ2-0057','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Champagne Saucer'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tea Spoon');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Spoon','EQ2-0058','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Spoon'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tables');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tables','EQ2-0059','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tables'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Frills');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Frills','EQ2-0060','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Frills'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dust Bin');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dust Bin','EQ2-0061','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dust Bin'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Canopy with side wall [10 x 15]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Canopy with side wall [10 x 15]','EQ2-0062','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Canopy with side wall [10 x 15]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Canopy [10 x 15]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Canopy [10 x 15]','EQ2-0063','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Canopy [10 x 15]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=150.0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dinner Plates');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dinner Plates','EQ2-0064','Event Equipment','nos',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dinner Plates'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Full Plates [Melamine]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Full Plates [Melamine]','EQ2-0065','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Full Plates [Melamine]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Quarter Plates [Melamine]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Quarter Plates [Melamine]','EQ2-0066','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Quarter Plates [Melamine]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Half Plates [Melamine]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Half Plates [Melamine]','EQ2-0067','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Half Plates [Melamine]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Soup Bowl, Saucer, Spoon [Melamine]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Soup Bowl, Saucer, Spoon [Melamine]','EQ2-0068','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Soup Bowl, Saucer, Spoon [Melamine]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Dal Bowl [Melamine]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dal Bowl [Melamine]','EQ2-0069','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dal Bowl [Melamine]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tea Cup & Saucer [Bone China]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Cup & Saucer [Bone China]','EQ2-0070','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Cup & Saucer [Bone China]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('AP Spoon [Stainless Steel]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Spoon [Stainless Steel]','EQ2-0071','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Spoon [Stainless Steel]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('AP Fork [Stainless Steel]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Fork [Stainless Steel]','EQ2-0072','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Fork [Stainless Steel]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Service Ladles [Stainless Steel]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Service Ladles [Stainless Steel]','EQ2-0073','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Service Ladles [Stainless Steel]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Tea Kettle [Stainless Steel]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Kettle [Stainless Steel]','EQ2-0074','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Kettle [Stainless Steel]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Brass Chafing Dish [Brass]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brass Chafing Dish [Brass]','EQ2-0075','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brass Chafing Dish [Brass]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Rectangular Chafing Dish [Stainless Steel (SS)]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Rectangular Chafing Dish [Stainless Steel (SS)]','EQ2-0076','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Rectangular Chafing Dish [Stainless Steel (SS)]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Soup Tureen [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Soup Tureen [Serveware]','EQ2-0077','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Soup Tureen [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Salad Platter - Large [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Salad Platter - Large [Serveware]','EQ2-0078','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Salad Platter - Large [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Oval Platter [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Oval Platter [Serveware]','EQ2-0079','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Oval Platter [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Platter Bowl (Large) [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Platter Bowl (Large) [Serveware]','EQ2-0080','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Platter Bowl (Large) [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Round Salver [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Round Salver [Serveware]','EQ2-0081','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Round Salver [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Platter Tubs [Serveware]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Platter Tubs [Serveware]','EQ2-0082','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Platter Tubs [Serveware]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('SS Katori [Stainless Steel (SS)]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'SS Katori [Stainless Steel (SS)]','EQ2-0083','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('SS Katori [Stainless Steel (SS)]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Half Food Pan [Stainless Steel (SS)]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Half Food Pan [Stainless Steel (SS)]','EQ2-0084','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Half Food Pan [Stainless Steel (SS)]'));

UPDATE "BanquetItem" SET "active"=true,"unit"='nos',"category"='Event Equipment',"currentStock"=0,"updatedAt"=NOW()
WHERE lower("name")=lower('Full Food Pan [Stainless Steel (SS)]');
INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Full Food Pan [Stainless Steel (SS)]','EQ2-0085','Event Equipment','nos',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Full Food Pan [Stainless Steel (SS)]'));
