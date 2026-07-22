-- Master item import from "LIST OF ITEMS - SOFTWARE" (7 lists, 417 items).
-- Kitchen sheets -> Ingredient (chef/store dropdown); F&B sheets -> BanquetItem
-- (F&B/banquet dropdown). Guarded + idempotent: an item whose NAME already
-- exists (case-insensitive) is skipped, so this never duplicates the earlier
-- kitchen-store / Ninjacart imports and is safe to re-run.
-- Costs: Dheer rate primary, Eshwar as fallback (groceries only).
-- Units: sheet value for groceries; kg for veg/frozen/non-veg; pcs for bakery.
-- F&B quantities load as opening stock; kitchen items start at 0.


INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-001','EGG [ Rate - 7.2]',NULL,'GROCERY'::"IngredientSubStore",'Tray',0,7.5,0,7.5,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG [ Rate - 7.2]'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-001');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-002','Masoor Dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,83.0,0,83.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Masoor Dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-002');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-003','Toor dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Toor dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-003');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-004','Urad Dal/Uddin Bele R',NULL,'GROCERY'::"IngredientSubStore",'kg',0,125.0,0,125.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad Dal/Uddin Bele R'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-004');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-005','Urad Dal whole',NULL,'GROCERY'::"IngredientSubStore",'kg',0,135.0,0,135.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad Dal whole'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-005');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-006','Yellow moong dal / Hesaru Bele Spl',NULL,'GROCERY'::"IngredientSubStore",'kg',0,120.0,0,120.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Yellow moong dal / Hesaru Bele Spl'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-006');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-007','Chana dal / Kadle Bele Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,97.0,0,97.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chana dal / Kadle Bele Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-007');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-008','Fried grams / Dried Chenna Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,100.0,0,100.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fried grams / Dried Chenna Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-008');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-009','Bullet Kolam Rice',NULL,'GROCERY'::"IngredientSubStore",'bag',0,1400.0,0,1400.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Bullet Kolam Rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-009');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-010','Golden Fish Kollam Rice 26kg / Rice Sona',NULL,'GROCERY'::"IngredientSubStore",'bag',0,2472.0,0,2472.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Golden Fish Kollam Rice 26kg / Rice Sona'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-010');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-011','Dawat Basmati rice',NULL,'GROCERY'::"IngredientSubStore",'bag',0,4140.0,0,4140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dawat Basmati rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-011');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-012','Poha / Avalakki Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Poha / Avalakki Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-012');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-013','Orange Idli rice',NULL,'GROCERY'::"IngredientSubStore",'bag',0,1222.0,0,1222.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Idli rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-013');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-014','Dosa Rice / Rice IR8',NULL,'GROCERY'::"IngredientSubStore",'bag',0,950.0,0,950.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dosa Rice / Rice IR8'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-014');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-015','Orange Atta 50kg Bag / Atta Chakke',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Atta 50kg Bag / Atta Chakke'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-015');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-016','Maida',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2100.0,0,2100.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Maida'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-016');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-017','Rice Flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rice Flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-017');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-018','Besan / Kadle Hittu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Besan / Kadle Hittu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-018');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-019','Ragi flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,57.0,0,57.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ragi flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-019');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-020','Corn flour',NULL,'GROCERY'::"IngredientSubStore",'kg',0,50.0,0,50.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Corn flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-020');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-021','Chiroti rava',NULL,'GROCERY'::"IngredientSubStore",'kg',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chiroti rava'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-021');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-022','Orange sooji(local rava) / Rave Uppitu Reg',NULL,'GROCERY'::"IngredientSubStore",'kg',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange sooji(local rava) / Rave Uppitu Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-022');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-023','Rajma chitra',NULL,'GROCERY'::"IngredientSubStore",'kg',0,145.0,0,145.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rajma chitra'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-023');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-024','Red rajma',NULL,'GROCERY'::"IngredientSubStore",'kg',0,147.0,0,147.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Red rajma'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-024');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-025','Black Urad Dal',NULL,'GROCERY'::"IngredientSubStore",'kg',0,118.0,0,118.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black Urad Dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-025');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-026','Green Moong Whole',NULL,'GROCERY'::"IngredientSubStore",'kg',0,115.0,0,115.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green Moong Whole'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-026');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-027','Black chana / Kadle Kalu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,82.0,0,82.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black chana / Kadle Kalu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-027');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-028','White chana / Kabuli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,145.0,0,145.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White chana / Kabuli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-028');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-029','Green peas dry',NULL,'GROCERY'::"IngredientSubStore",'kg',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green peas dry'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-029');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-030','Halasande',NULL,'GROCERY'::"IngredientSubStore",'kg',0,102.0,0,102.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Halasande'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-030');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-031','Millet/Navane',NULL,'GROCERY'::"IngredientSubStore",'kg',0,150.0,0,150.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Millet/Navane'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-031');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-032','White till',NULL,'GROCERY'::"IngredientSubStore",'kg',0,210.0,0,210.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White till'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-032');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-033','Black till',NULL,'GROCERY'::"IngredientSubStore",'kg',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black till'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-033');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-034','Badam seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,960.0,0,960.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Badam seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-034');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-035','Pista',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2450.0,0,2450.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pista'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-035');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-036','Magaj',NULL,'GROCERY'::"IngredientSubStore",'kg',0,560.0,0,560.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Magaj'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-036');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-037','Ground nuts/peanuts',NULL,'GROCERY'::"IngredientSubStore",'kg',0,185.0,0,185.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ground nuts/peanuts'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-037');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-038','Super Garam Masala 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,102.86,0,102.86,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Super Garam Masala 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-038');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-039','Everest Garam Masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Everest Garam Masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-039');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-040','MDH Garam masala 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,90.0,0,90.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Garam masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-040');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-041','MDH Kashmiri CHILLI 100GM',NULL,'GROCERY'::"IngredientSubStore",'pct',0,82.62,0,82.62,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Kashmiri CHILLI 100GM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-041');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-042','Kashmiri chilli powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,944.76,0,944.76,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kashmiri chilli powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-042');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-043','Kibs Badam Feast Powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kibs Badam Feast Powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-043');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-044','Yellow Chilly Powder 100gms',NULL,'GROCERY'::"IngredientSubStore",'pcts',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Yellow Chilly Powder 100gms'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-044');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-045','Shakti Chilly Powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,160.95,0,160.95,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Shakti Chilly Powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-045');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-046','MTR Chilly Powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,160.0,0,160.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MTR Chilly Powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-046');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-047','Meat masala 200Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,143.81,0,143.81,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Meat masala 200Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-047');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-048','Turmeric 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Turmeric 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-048');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-049','MDH Chunky Chat Masala 100gms',NULL,'GROCERY'::"IngredientSubStore",'pct',0,75.0,0,75.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MDH Chunky Chat Masala 100gms'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-049');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-050','Chat masala 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chat masala 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-050');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-051','chat masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,311.43,0,311.43,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('chat masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-051');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-052','Tamarind Chap Spl',NULL,'GROCERY'::"IngredientSubStore",'kg',0,205.0,0,205.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tamarind Chap Spl'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-052');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-053','MTR Samabar Powder 200 gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MTR Samabar Powder 200 gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-053');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-054','Sambar powder500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,195.0,0,195.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sambar powder500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-054');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-055','Sambar powder 1KG',NULL,'GROCERY'::"IngredientSubStore",'pct',0,395.0,0,395.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sambar powder 1KG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-055');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-056','Dhaniya powder 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,110.0,0,110.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dhaniya powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-056');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-057','Dhaniya seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,140.0,0,140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dhaniya seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-057');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-058','Byadgi chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,420.0,0,420.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Byadgi chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-058');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-059','Round chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,420.0,0,420.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Round chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-059');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-060','Salem chilli',NULL,'GROCERY'::"IngredientSubStore",'kg',0,360.95,0,360.95,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Salem chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-060');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-061','Chakke/Cinnamon stick',NULL,'GROCERY'::"IngredientSubStore",'kg',0,310.0,0,310.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chakke/Cinnamon stick'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-061');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-062','Pulav leaves',NULL,'GROCERY'::"IngredientSubStore",'kg',0,140.0,0,140.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pulav leaves'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-062');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-063','Marati Moggu',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Marati Moggu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-063');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-064','Lavanga',NULL,'GROCERY'::"IngredientSubStore",'kg',0,310.0,0,310.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Lavanga'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-064');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-065','Big elachi',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1980.0,0,1980.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Big elachi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-065');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-066','Elachi',NULL,'GROCERY'::"IngredientSubStore",'kg',0,3250.0,0,3250.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Elachi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-066');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-067','Jaypathra (Javitri)',NULL,'GROCERY'::"IngredientSubStore",'kg',0,2350.0,0,2350.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaypathra (Javitri)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-067');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-068','Jaypal / Jakai Pc',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1050.0,0,1050.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaypal / Jakai Pc'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-068');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-069','Sompu seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,210.0,0,210.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sompu seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-069');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-070','Mustard seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,112.0,0,112.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mustard seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-070');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-071','Black whole pepper',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black whole pepper'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-071');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-072','Star Annise',NULL,'GROCERY'::"IngredientSubStore",'kg',0,850.0,0,850.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Star Annise'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-072');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-073','Jeera seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,330.0,0,330.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jeera seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-073');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-074','Jeera powder 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,42.0,0,42.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jeera powder 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-074');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-075','Black pepper powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Black pepper powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-075');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-076','White pepper powder 100Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,27.61,0,27.61,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('White pepper powder 100Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-076');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-077','Methi seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,95.0,0,95.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Methi seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-077');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-078','Ghus Ghus',NULL,'GROCERY'::"IngredientSubStore",'kg',0,1494.0,0,1494.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ghus Ghus'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-078');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-079','Kitchen King Masala 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,349.0,0,349.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kitchen King Masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-079');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-080','Kitchen King masala 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,82.0,0,82.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kitchen King masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-080');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-081','Chunky chat masala 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Chunky chat masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-081');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-082','Kallu hoo/ lichen',NULL,'GROCERY'::"IngredientSubStore",'kg',0,600.0,0,600.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kallu hoo/ lichen'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-082');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-083','Sugar',NULL,'GROCERY'::"IngredientSubStore",'kg',0,45.23,0,45.23,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sugar'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-083');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-084','Jaggery Powder 500g',NULL,'GROCERY'::"IngredientSubStore",'pct',0,45.0,0,45.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaggery Powder 500g'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-084');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-085','Jaggery ball',NULL,'GROCERY'::"IngredientSubStore",'kg',0,56.0,0,56.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Jaggery ball'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-085');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-086','Aromatic mix',NULL,'GROCERY'::"IngredientSubStore",'pct',0,175.0,0,175.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Aromatic mix'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-086');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-087','Soya bean',NULL,'GROCERY'::"IngredientSubStore",'kg',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Soya bean'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-087');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-088','Kismiss / Dry Grapes',NULL,'GROCERY'::"IngredientSubStore",'kg',0,460.0,0,460.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kismiss / Dry Grapes'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-088');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-089','Baby cashewnut',NULL,'GROCERY'::"IngredientSubStore",'kg',0,590.0,0,590.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Baby cashewnut'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-089');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-090','Cashewnut 4p',NULL,'GROCERY'::"IngredientSubStore",'kg',0,840.0,0,840.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Cashewnut 4p'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-090');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-091','Rasam powder 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,130.0,0,130.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rasam powder 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-091');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-092','Bisibelebath powder 200Gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,152.38,0,152.38,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Bisibelebath powder 200Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-092');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-093','Puliyogare powder 200gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,135.24,0,135.24,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Puliyogare powder 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-093');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-094','Puliyogare powder 1kg',NULL,'GROCERY'::"IngredientSubStore",'pct',0,390.0,0,390.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Puliyogare powder 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-094');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-095','Splitz Tomato Ketchup',NULL,'GROCERY'::"IngredientSubStore",'pct',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Splitz Tomato Ketchup'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-095');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-096','Vinegar',NULL,'GROCERY'::"IngredientSubStore",'btl',0,24.0,0,24.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Vinegar'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-096');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-097','Red chilli sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,41.9,0,41.9,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Red chilli sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-097');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-098','Green chilli sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Green chilli sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-098');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-099','Dark soya sauce',NULL,'GROCERY'::"IngredientSubStore",'btl',0,48.0,0,48.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dark soya sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-099');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-100','Dry mango powder/Amchur powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,71.2,0,71.2,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dry mango powder/Amchur powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-100');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-101','orange red bush',NULL,'GROCERY'::"IngredientSubStore",'tin',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('orange red bush'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-101');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-102','Kesari bush',NULL,'GROCERY'::"IngredientSubStore",'tin',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kesari bush'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-102');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-103','Ingu(LG powder)',NULL,'GROCERY'::"IngredientSubStore",'btl',0,52.5,0,52.5,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ingu(LG powder)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-103');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-104','Keora water',NULL,'GROCERY'::"IngredientSubStore",'btl',0,62.0,0,62.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Keora water'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-104');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-105','Zaika gulabari / Rose Water',NULL,'GROCERY'::"IngredientSubStore",'btl',0,55.0,0,55.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Zaika gulabari / Rose Water'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-105');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-106','Tata salt(powder)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,29.0,0,29.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tata salt(powder)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-106');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-107','Stone salt',NULL,'GROCERY'::"IngredientSubStore",'pct',0,19.0,0,19.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Stone salt'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-107');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-108','Ajwin',NULL,'GROCERY'::"IngredientSubStore",'kg',0,275.0,0,275.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ajwin'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-108');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-109','Mayonnaise',NULL,'GROCERY'::"IngredientSubStore",'pct',0,110.0,0,110.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mayonnaise'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-109');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-110','Saffron',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Saffron'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-110');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-111','Kasuri methi 100gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,80.0,0,80.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Kasuri methi 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-111');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-112','Anil shavige Vermicelli',NULL,'GROCERY'::"IngredientSubStore",'pct',0,60.0,0,60.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Anil shavige Vermicelli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-112');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-113','Roasted vermicelli',NULL,'GROCERY'::"IngredientSubStore",'pct',0,105.0,0,105.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Roasted vermicelli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-113');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-114','Noodles',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Noodles'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-114');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-115','Macroni Pasta 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,61.9,0,61.9,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Macroni Pasta 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-115');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-116','Roasted North papad(masala papad)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,385.0,0,385.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Roasted North papad(masala papad)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-116');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-117','Flavour papad(sago chilly)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,58.57,0,58.57,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Flavour papad(sago chilly)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-117');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-118','Urad dal papad(lotus)',NULL,'GROCERY'::"IngredientSubStore",'pct',0,40.0,0,40.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Urad dal papad(lotus)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-118');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-119','Rice papad 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,174.0,0,174.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Rice papad 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-119');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-120','Fryums',NULL,'GROCERY'::"IngredientSubStore",'kg',0,85.0,0,85.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fryums'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-120');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-121','Tea powder-red label 950g',NULL,'GROCERY'::"IngredientSubStore",'pct',0,495.0,0,495.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tea powder-red label 950g'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-121');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-122','Coffee powder-Bru Ins 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,595.0,0,595.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coffee powder-Bru Ins 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-122');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-123','Coffee Cothas 500gm',NULL,'GROCERY'::"IngredientSubStore",'pct',0,360.0,0,360.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coffee Cothas 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-123');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-124','Sunpure oil',NULL,'GROCERY'::"IngredientSubStore",'pcts',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sunpure oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-124');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-125','Coconut oil',NULL,'GROCERY'::"IngredientSubStore",'pct',0,480.0,0,480.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-125');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-126','Coconut milk',NULL,'GROCERY'::"IngredientSubStore",'tin',0,95.0,0,95.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut milk'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-126');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-127','Mustard oil',NULL,'GROCERY'::"IngredientSubStore",'btl',0,198.09,0,198.09,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Mustard oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-127');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-128','Olive oil',NULL,'GROCERY'::"IngredientSubStore",'btl',0,370.47,0,370.47,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Olive oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-128');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-129','Dry Coconut',NULL,'GROCERY'::"IngredientSubStore",'kg',0,429.0,0,429.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Dry Coconut'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-129');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-130','Ghee',NULL,'GROCERY'::"IngredientSubStore",'pct',0,650.0,0,650.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ghee'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-130');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-131','Fruit jam',NULL,'GROCERY'::"IngredientSubStore",'btl',0,167.61,0,167.61,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Fruit jam'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-131');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-132','Pickle 5kg',NULL,'GROCERY'::"IngredientSubStore",'btl',0,265.0,0,265.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Pickle 5kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-132');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-133','Honey Dabur 1kg',NULL,'GROCERY'::"IngredientSubStore",'btl',0,405.0,0,405.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Honey Dabur 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-133');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-134','Tomato Puree',NULL,'GROCERY'::"IngredientSubStore",'tin',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Tomato Puree'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-134');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-135','Sabudana',NULL,'GROCERY'::"IngredientSubStore",'pct',0,65.0,0,65.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Sabudana'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-135');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-136','Nylon sabudana / Sago 500',NULL,'GROCERY'::"IngredientSubStore",'pct',0,44.76,0,44.76,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Nylon sabudana / Sago 500'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-136');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-137','Oregano Leaves 1kg',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Oregano Leaves 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-137');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-138','Whole Ragi',NULL,'GROCERY'::"IngredientSubStore",'pct',0,56.0,0,56.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Whole Ragi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-138');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-139','Coconut Milk Powder',NULL,'GROCERY'::"IngredientSubStore",'pct',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Coconut Milk Powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-139');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'GRC-140','Poppy Seeds',NULL,'GROCERY'::"IngredientSubStore",'kg',0,0.0,0,0.0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Poppy Seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='GRC-140');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-001','BANANA LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA LEAVES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-001');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-002','CARROT Indian',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CARROT Indian'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-002');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-003','CUCUMBER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CUCUMBER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-003');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-004','CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CABBAGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-004');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-005','LEMON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LEMON'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-005');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-006','GARLIC PEELED LOCAL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GARLIC PEELED LOCAL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-006');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-007','CAULIFLOWER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAULIFLOWER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-007');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-008','PAPAYA RAW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAPAYA RAW'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-008');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-009','BRINJAL BIG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BRINJAL BIG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-009');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-010','GINGER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GINGER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-010');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-011','RADDISH WHITE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RADDISH WHITE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-011');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-012','CHILLI GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHILLI GREEN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-012');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-013','COCONUT WHOLE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT WHOLE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-013');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-014','SWEET POTATO',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET POTATO'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-014');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-015','BOTTLE GOURD (LAUKI/DUDHI))',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BOTTLE GOURD (LAUKI/DUDHI))'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-015');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-016','JACKFRUIT ( KATHAL) RAW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('JACKFRUIT ( KATHAL) RAW'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-016');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-017','BITTER GOURD (KARELA)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BITTER GOURD (KARELA)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-017');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-018','CHILLI BHAVNAGRI',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHILLI BHAVNAGRI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-018');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-019','RED CHILLI FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RED CHILLI FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-019');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-020','BANANA KELA PHOOL KG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA KELA PHOOL KG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-020');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-021','BEET ROOT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BEET ROOT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-021');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-022','BRINJAL SMALL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BRINJAL SMALL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-022');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-023','LADY FINGER',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LADY FINGER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-023');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-024','DRUM STICK (SINGH)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRUM STICK (SINGH)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-024');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-025','POTATO SMALL (DUM ALOO)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO SMALL (DUM ALOO)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-025');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-026','GREEN PEAS FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GREEN PEAS FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-026');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-027','MADRAS ONION',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MADRAS ONION'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-027');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-028','PUMPKIN RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PUMPKIN RED'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-028');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-029','CHOW CHOW VEG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOW CHOW VEG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-029');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-030','TENDER COCONUT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TENDER COCONUT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-030');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-031','SNAKE GOURD (PADVAL)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SNAKE GOURD (PADVAL)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-031');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-032','MUSHROOM FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUSHROOM FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-032');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-033','BEANS HARICOT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BEANS HARICOT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-033');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-034','SWEET CORN COB NOS (WHOLE)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET CORN COB NOS (WHOLE)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-034');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-035','Ridgegourd',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Ridgegourd'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-035');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-036','SPRING ONION GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SPRING ONION GREEN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-036');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-037','SPINACH FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SPINACH FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-037');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-038','CORIANDER LEAVES (DHANIA)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CORIANDER LEAVES (DHANIA)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-038');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-039','MINT LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINT LEAVES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-039');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-040','CURRY LEAVES',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CURRY LEAVES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-040');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-041','METHI FRESH (FENUGREEK LEAVES)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI FRESH (FENUGREEK LEAVES)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-041');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-042','GONGURA',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GONGURA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-042');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-043','DILL FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DILL FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-043');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-044','BABY SPINACH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BABY SPINACH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-044');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-045','ONION RED BIG (8 TO 10 PC)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ONION RED BIG (8 TO 10 PC)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-045');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-046','TOMATO HYBRID BIG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TOMATO HYBRID BIG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-046');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-047','POTATO LARGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO LARGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-047');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-048','CAPSICUM GREEN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM GREEN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-048');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-049','BANANA ROBUSTA',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA ROBUSTA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-049');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-050','AVOCADO INDIAN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('AVOCADO INDIAN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-050');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-051','GUAVAS',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GUAVAS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-051');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-052','ORANGE IMP',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ORANGE IMP'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-052');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-053','PINEAPPLE FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-053');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-054','WATER MELON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('WATER MELON'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-054');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-055','APPLE GREEN IMP',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('APPLE GREEN IMP'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-055');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-056','APPLE RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('APPLE RED'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-056');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-057','GRAPE FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPE FRUIT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-057');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-058','MANGO Alphonso',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MANGO Alphonso'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-058');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-059','BANANA Yelakki',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA Yelakki'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-059');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-060','POMEGRANATE FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POMEGRANATE FRUIT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-060');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-061','DRAGON FRUIT RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRAGON FRUIT RED'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-061');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-062','PAPAYA RIPE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PAPAYA RIPE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-062');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-063','MUSK MELON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUSK MELON'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-063');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-064','PASSION FRUIT',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PASSION FRUIT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-064');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-065','GRAPES BLACK SEEDLESS',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPES BLACK SEEDLESS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-065');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-066','GRAPES GREEN LOCAL',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GRAPES GREEN LOCAL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-066');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-067','CHIKOO (SAPOTA)',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHIKOO (SAPOTA)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-067');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-068','WATER MELON',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('WATER MELON'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-068');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-069','Orange Local',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('Orange Local'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-069');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-070','RADDISH RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RADDISH RED'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-070');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-071','redage gard',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('redage gard'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-071');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-072','CUCUMBER EUROPEAN',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CUCUMBER EUROPEAN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-072');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-073','CAPSICUM RED',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM RED'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-073');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-074','BROCCOLI',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BROCCOLI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-074');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-075','LETTUCE ICEBERG',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LETTUCE ICEBERG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-075');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-076','BABY CORN FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BABY CORN FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-076');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-077','CAPSICUM YELLOW',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CAPSICUM YELLOW'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-077');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-078','CHINESE CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHINESE CABBAGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-078');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-079','ZUCCHINI GREEN / SQUASH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ZUCCHINI GREEN / SQUASH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-079');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-080','BASIL FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BASIL FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-080');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-081','RED CABBAGE',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RED CABBAGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-081');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-082','LEMON GRASS FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('LEMON GRASS FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-082');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-083','CELERY FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CELERY FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-083');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-084','ZUCCHINI YELLOW / SQUASH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ZUCCHINI YELLOW / SQUASH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-084');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-085','CHERRY TOMATO',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHERRY TOMATO'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-085');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'VEG-086','PARSLEY FRESH',NULL,'VEGETABLE'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PARSLEY FRESH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='VEG-086');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-001','PANEER','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-001');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-002','GREEN PEAS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GREEN PEAS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-002');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-003','SWEET CORN','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SWEET CORN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-003');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-004','UNSALTED BUTTER','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('UNSALTED BUTTER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-004');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-005','GHEE','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GHEE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-005');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-006','FRESH CREAM','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRESH CREAM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-006');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-007','CHEESE BLOCKS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE BLOCKS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-007');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-008','CHEESE SLICE','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE SLICE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-008');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-009','KHOVA','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KHOVA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-009');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-010','MINI PUNJABI SAMOSA','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINI PUNJABI SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-010');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-011','CORN SAMOSA','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CORN SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-011');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-012','CHEESE CORN SAMOSA','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHEESE CORN SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-012');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-013','VEG CUTLETS 18PIC','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG CUTLETS 18PIC'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-013');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-014','VEG NUGGETS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG NUGGETS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-014');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-015','VEG CHEESE BALLS / POTATO KIEWS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG CHEESE BALLS / POTATO KIEWS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-015');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-016','VEG BREADED ROLL','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG BREADED ROLL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-016');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-017','VEG SPRING ROLL','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG SPRING ROLL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-017');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-018','VEG FINGERS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG FINGERS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-018');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-019','PANEER ROLLS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER ROLLS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-019');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-020','VEG LOLLIPOP','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG LOLLIPOP'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-020');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-021','FISH FINGERS','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FISH FINGERS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-021');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-022','FRENCH FRIES','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRENCH FRIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-022');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-023','ALOO TIKKI','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALOO TIKKI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-023');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'FRZ-024','POTATO WEDGES','Frozen','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO WEDGES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='FRZ-024');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-001','CHICKEN CURRY CUT','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN CURRY CUT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-001');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-002','CHICKEN BONELESS','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN BONELESS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-002');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-003','CHICKEN LEG PIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN LEG PIECE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-003');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-004','FISH','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FISH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-004');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-005','MUTTUN LEG PIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUTTUN LEG PIECE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-005');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-006','MUTTUN BIRIYANI PIIECE','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUTTUN BIRIYANI PIIECE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-006');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'NVG-007','PRAWNS','Non veg','OTHER'::"IngredientSubStore",'kg',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PRAWNS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='NVG-007');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-001','BANANA CAKE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA CAKE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-001');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-002','CARROT CAKE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CARROT CAKE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-002');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-003','PLAIN CAKE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PLAIN CAKE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-003');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-004','FRUIT CAKE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('FRUIT CAKE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-004');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-005','CHOCOLATE CAKE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CAKE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-005');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-006','BLUE BERRY MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLUE BERRY MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-006');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-007','STRAW BERRY MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAW BERRY MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-007');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-008','CHOCOLATE MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-008');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-009','VANILLA MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-009');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-010','BANANA MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BANANA MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-010');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-011','PINEAPPLE MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPPLE MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-011');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-012','CHOCOALTE CHIP MUFFIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOALTE CHIP MUFFIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-012');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-013','PINEAPLE PASTRY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PINEAPLE PASTRY'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-013');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-014','BLACK FOREST PASTRY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BLACK FOREST PASTRY'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-014');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-015','CHOCOLATE PASTRY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE PASTRY'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-015');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-016','BELGIAN CHOCOLATE PASTRY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BELGIAN CHOCOLATE PASTRY'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-016');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-017','POTATO CHIPS','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('POTATO CHIPS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-017');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-018','MULTI GRAIN COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MULTI GRAIN COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-018');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-019','OATS COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('OATS COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-019');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-020','MASALA COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MASALA COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-020');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-021','COCONUT COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-021');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-022','CHACOLATE COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHACOLATE COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-022');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-023','JEERA SALT COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('JEERA SALT COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-023');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-024','CASHEW COOKIES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CASHEW COOKIES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-024');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-025','SANDWICH BREAD','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SANDWICH BREAD'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-025');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-026','MILK BREAD','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MILK BREAD'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-026');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-027','MUMBAI PAV BUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MUMBAI PAV BUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-027');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-028','SAMOSA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-028');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-029','KACHORI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KACHORI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-029');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-030','CHOCOLATE CREAM BUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE CREAM BUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-030');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-031','VANILLA CREAM BUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA CREAM BUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-031');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-032','ALO BUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALO BUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-032');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-033','VEG PUFFS','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VEG PUFFS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-033');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-034','CHICKEN PUFFS','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHICKEN PUFFS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-034');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-035','EGG PUFFS FULL','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG PUFFS FULL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-035');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-036','EGG PUFFS SEMI HALF','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('EGG PUFFS SEMI HALF'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-036');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-037','ONION SAMOSA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ONION SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-037');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-038','ALO SAMOSA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ALO SAMOSA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-038');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-039','NORMAL BUN FOR GULKHAND','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('NORMAL BUN FOR GULKHAND'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-039');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-040','PANEER PUFFS','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PANEER PUFFS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-040');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-041','GULAB JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('GULAB JAMUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-041');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-042','RASAMALAI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('RASAMALAI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-042');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-043','CHAMPAKALI/ CHUM CHUM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHAMPAKALI/ CHUM CHUM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-043');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-044','DRY JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('DRY JAMUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-044');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-045','COCONUT DRY JAMUN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('COCONUT DRY JAMUN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-045');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-046','MALPAV','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MALPAV'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-046');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-047','METHI CHAPATI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI CHAPATI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-047');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-048','CHAPATI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHAPATI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-048');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-049','PHULKA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PHULKA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-049');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-050','METHI PHULKA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('METHI PHULKA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-050');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-051','IDLY SML SIZE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('IDLY SML SIZE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-051');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-052','AKKI ROTTI','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('AKKI ROTTI'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-052');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-053','IDIYAPPAM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('IDIYAPPAM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-053');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-054','BELE HOLIGE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BELE HOLIGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-054');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-055','KAAYI HOLIGE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('KAAYI HOLIGE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-055');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-056','CYLINDER HP GAS','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CYLINDER HP GAS'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-056');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-057','ICE CUBES','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ICE CUBES'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-057');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-058','VANILLA LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA LITE 4L PLAIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-058');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-059','STRAWBERRY LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('STRAWBERRY LITE 4L PLAIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-059');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-060','PISTA LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('PISTA LITE 4L PLAIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-060');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-061','BUTTER SCOTCH 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BUTTER SCOTCH 4L PLAIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-061');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-062','CHOCOLATE LITE 4L PLAIN','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE LITE 4L PLAIN'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-062');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-063','BUTTERSCOTCH','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('BUTTERSCOTCH'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-063');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-064','CHOCOLATE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCOLATE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-064');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-065','VANILLA','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-065');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-066','CHOCONUTZ','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCONUTZ'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-066');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-067','CHOCODREAM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('CHOCODREAM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-067');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-068','MANGO CANDY','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MANGO CANDY'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-068');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-069','TWISTER','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TWISTER'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-069');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-070','TRIPPLE SUNDAE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('TRIPPLE SUNDAE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-070');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-071','MINI SUNDAE CHOCOLATE','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MINI SUNDAE CHOCOLATE'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-071');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-072','VANILLA BALL','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('VANILLA BALL'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-072');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-073','ARABIAN DELIGHT','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('ARABIAN DELIGHT'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-073');

INSERT INTO "Ingredient" ("id","sku","name","category","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'BKY-074','MORE THAN AAM','Bakery','OTHER'::"IngredientSubStore",'pcs',0,0,0,0,0,0,true,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name")=lower('MORE THAN AAM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku"='BKY-074');

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ripple Tea Cups [100ml]','FNB-001','Cups','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ripple Tea Cups [100ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ripple Water Cups [200ml]','FNB-002','Cups','pcs',true,1575.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ripple Water Cups [200ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'White Water Cups [200ml]','FNB-003','Cups','pcs',true,500.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('White Water Cups [200ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Printed Tissue Paper','FNB-004','Paper Products','pkt',true,319.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Printed Tissue Paper'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'5 CP Meal Tray','FNB-005','Trays','pcs',true,325.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('5 CP Meal Tray'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'3 CP Meal Tray [10inch]','FNB-006','Trays','pcs',true,800.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('3 CP Meal Tray [10inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn Starch round plates [10 inch]','FNB-007','Plates','pcs',true,475.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn Starch round plates [10 inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Baggase Plates [7inch]','FNB-008','Plates','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Baggase Plates [7inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Butter Paper Roll','FNB-009','Paper Products','roll',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Butter Paper Roll'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Round Printed logo sticker','FNB-010','Stickers','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Round Printed logo sticker'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Printed Square sticker','FNB-011','Stickers','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Printed Square sticker'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Table Roll','FNB-012','Paper Products','pcs',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Table Roll'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminium Foil','FNB-013','Foils & Wraps','pcs',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminium Foil'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Cling Wrap','FNB-014','Foils & Wraps','pcs',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Cling Wrap'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Windsor 8 CP Meal Box','FNB-015','Boxes','pcs',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Windsor 8 CP Meal Box'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Windsor 5 CP Meal Box','FNB-016','Boxes','pcs',true,600.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Windsor 5 CP Meal Box'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn starch 8 CP Meal Box [(12 pck)]','FNB-017','Boxes','pcs',true,300.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn starch 8 CP Meal Box [(12 pck)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Spoon [16mm]','FNB-018','Cutlery','pcs',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Spoon [16mm]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Fork [16mm]','FNB-019','Cutlery','pcs',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Fork [16mm]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Wooden Stirrer [500 pic pct]','FNB-020','Cutlery','pcs',true,1000.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Wooden Stirrer [500 pic pct]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Cello Tape [1inch]','FNB-021','Tapes','pcs',true,84.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Cello Tape [1inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'White Packaging Tape [2.5inch]','FNB-022','Tapes','pcs',true,36.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('White Packaging Tape [2.5inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Tape [2.5inch]','FNB-023','Tapes','pcs',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Tape [2.5inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Tape [4.5inch]','FNB-024','Tapes','pcs',true,45.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Tape [4.5inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Double Tape [2inch]','FNB-025','Tapes','pcs',true,3.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Double Tape [2inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container [100ml]','FNB-026','Containers','pcs',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container [100ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container [500ml]','FNB-027','Containers','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container [500ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Plastic Container [750ml]','FNB-028','Containers','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Plastic Container [750ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Areca leaf Container [250ml]','FNB-029','Containers','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Areca leaf Container [250ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Areca leaf Container [500ml]','FNB-030','Containers','pcs',true,66.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Areca leaf Container [500ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Areca leaf Container [750ml]','FNB-031','Containers','pcs',true,75.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Areca leaf Container [750ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Baggase disposable Bowl [250ml (115ml)]','FNB-032','Bowls','pcs',true,250.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Baggase disposable Bowl [250ml (115ml)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Baggase Bowl [120ml]','FNB-033','Bowls','pcs',true,100.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Baggase Bowl [120ml]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'White Cake Box [9x8x4]','FNB-034','Boxes','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('White Cake Box [9x8x4]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brown Cake Box [9x8x4]','FNB-035','Boxes','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brown Cake Box [9x8x4]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Paper Bag [7x3]','FNB-036','Bags','pcs',true,660.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Paper Bag [7x3]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Round 3CP Areca Plates [9inch]','FNB-037','Plates','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Round 3CP Areca Plates [9inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Square 3CP Areca Plates [10inch]','FNB-038','Plates','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Square 3CP Areca Plates [10inch]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Hair Net','FNB-039','Hygiene','pouch',true,6.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Hair Net'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Hand Gloves','FNB-040','Hygiene','pouch',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Hand Gloves'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tooth Pick','FNB-041','Hygiene','pcs',true,30.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tooth Pick'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger clam shell [6x6]','FNB-042','Boxes','pcs',true,975.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger clam shell [6x6]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger clam shell [8x8]','FNB-043','Boxes','pcs',true,750.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger clam shell [8x8]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Burger clam shell [9x9]','FNB-044','Boxes','pcs',true,525.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Burger clam shell [9x9]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Sandwich clam shell','FNB-045','Boxes','pcs',true,1950.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Sandwich clam shell'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Fuel Wax','FNB-046','Miscellaneous','tin',true,22.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Fuel Wax'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Disposable Plastic Juice Cups with Lid [300ml (78x2)]','FNB-047','Cups','pcs',true,200.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Disposable Plastic Juice Cups with Lid [300ml (78x2)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Palstic Juice Cups Without Lid [300ml (78x2)]','FNB-048','Cups','pcs',true,50.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Palstic Juice Cups Without Lid [300ml (78x2)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Paper straws [8mm]','FNB-049','Straws','pcs',true,668.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Paper straws [8mm]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminium Paper Plates [7 INCH]','FNB-050','Plates','pcs',true,180.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminium Paper Plates [7 INCH]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Aluminium Paper Plates [small]','FNB-051','Plates','pcs',true,105.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Aluminium Paper Plates [small]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Ketchup Sachets','FNB-052',NULL,'pkt',true,7.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Ketchup Sachets'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Chocos Kelloggs [1 kg pcts]','FNB-053','Cereals','pkt',true,5.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Chocos Kelloggs [1 kg pcts]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Corn Flakes [1 kg pcts]','FNB-054','Cereals','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Corn Flakes [1 kg pcts]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'High Ball Glass [8 oz]','EVT-001','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('High Ball Glass [8 oz]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Juice Glass','EVT-002','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Juice Glass'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Wine Glass','EVT-003','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Wine Glass'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Champagne Saucer','EVT-004','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Champagne Saucer'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Spoon','EVT-005','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Spoon'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tables','EVT-006','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tables'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Frills','EVT-007','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Frills'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dust Bin','EVT-008','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dust Bin'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Canopy with side wall [10 x 15]','EVT-009','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Canopy with side wall [10 x 15]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Canopy [10 x 15]','EVT-010','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Canopy [10 x 15]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dinner Plates','EVT-011','Event Equipment','pcs',true,150.0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dinner Plates'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Full Plates [Melamine]','EVT-012','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Full Plates [Melamine]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Quarter Plates [Melamine]','EVT-013','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Quarter Plates [Melamine]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Half Plates [Melamine]','EVT-014','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Half Plates [Melamine]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Soup Bowl, Saucer, Spoon [Melamine]','EVT-015','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Soup Bowl, Saucer, Spoon [Melamine]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Dal Bowl [Melamine]','EVT-016','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Dal Bowl [Melamine]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Cup & Saucer [Bone China]','EVT-017','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Cup & Saucer [Bone China]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Spoon [Stainless Steel]','EVT-018','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Spoon [Stainless Steel]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'AP Fork [Stainless Steel]','EVT-019','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('AP Fork [Stainless Steel]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Service Ladles [Stainless Steel]','EVT-020','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Service Ladles [Stainless Steel]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Tea Kettle [Stainless Steel]','EVT-021','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Tea Kettle [Stainless Steel]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Brass Chafing Dish [Brass]','EVT-022','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Brass Chafing Dish [Brass]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Rectangular Chafing Dish [Stainless Steel (SS)]','EVT-023','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Rectangular Chafing Dish [Stainless Steel (SS)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Soup Tureen [Serveware]','EVT-024','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Soup Tureen [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Salad Platter - Large [Serveware]','EVT-025','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Salad Platter - Large [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Oval Platter [Serveware]','EVT-026','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Oval Platter [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Platter Bowl (Large) [Serveware]','EVT-027','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Platter Bowl (Large) [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Round Salver [Serveware]','EVT-028','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Round Salver [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Platter Tubs [Serveware]','EVT-029','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Platter Tubs [Serveware]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'SS Katori [Stainless Steel (SS)]','EVT-030','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('SS Katori [Stainless Steel (SS)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Half Food Pan [Stainless Steel (SS)]','EVT-031','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Half Food Pan [Stainless Steel (SS)]'));

INSERT INTO "BanquetItem" ("id","name","sku","category","unit","active","currentStock","createdAt","updatedAt")
SELECT gen_random_uuid()::text,'Full Food Pan [Stainless Steel (SS)]','EVT-032','Event Equipment','pcs',true,0,NOW(),NOW()
WHERE NOT EXISTS (SELECT 1 FROM "BanquetItem" WHERE lower("name")=lower('Full Food Pan [Stainless Steel (SS)]'));
