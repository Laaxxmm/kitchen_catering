-- Kitchen store import from "List Of Items - Kitchen Store & F N B Service
-- Store.xlsx" (Kitchen Stock sheet only, per ops instruction — F&B sheet
-- deliberately excluded; that store is loaded via its bulk stock count).
-- Idempotent: each item inserts only when no ingredient with the same name
-- (case-insensitive) exists — live counts on existing items are never
-- overwritten. New items carry the sheet's July-3rd quantity as opening +
-- on-hand stock and the vendor rate (Eshwar, else Dheer) as average cost.
-- SKUs XLK-### mark this import. Sub-store defaults to GROCERY — reclassify
-- from the ingredient page where approval routing needs it.

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-001', 'Egg [6.2 per egg]', 'GROCERY'::"IngredientSubStore", 'tray', 10.0, 0.0, 10.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Egg [6.2 per egg]'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-001');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-002', 'Star Annise', 'GROCERY'::"IngredientSubStore", 'kg', 0.8, 729.0, 0.8, 729.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Star Annise'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-002');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-003', 'Masoor Dal', 'GROCERY'::"IngredientSubStore", 'kg', 25.0, 94.0, 25.0, 94.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Masoor Dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-003');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-004', 'Jeera seeds', 'GROCERY'::"IngredientSubStore", 'kg', 3.0, 267.61, 3.0, 267.61, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jeera seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-004');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-005', 'Toor dal', 'GROCERY'::"IngredientSubStore", 'kg', 23.0, 131.0, 23.0, 131.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Toor dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-005');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-006', 'Jeera powder 100gm', 'GROCERY'::"IngredientSubStore", 'pkt', 18.0, 37.14, 18.0, 37.14, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jeera powder 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-006');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-007', 'Urad Dal/Uddin Bele R', 'GROCERY'::"IngredientSubStore", 'kg', 7.0, 148.0, 7.0, 148.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Urad Dal/Uddin Bele R'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-007');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-008', 'Black pepper powder', 'GROCERY'::"IngredientSubStore", 'pkt', 12.0, 52.38, 12.0, 52.38, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Black pepper powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-008');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-009', 'Urad Dal whole', 'GROCERY'::"IngredientSubStore", 'kg', 5.0, 156.0, 5.0, 156.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Urad Dal whole'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-009');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-010', 'White pepper powder 100Gm', 'GROCERY'::"IngredientSubStore", 'pkt', 12.0, 27.61, 12.0, 27.61, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('White pepper powder 100Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-010');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-011', 'Yellow moong dal / Hesaru Bele Spl', 'GROCERY'::"IngredientSubStore", 'kg', 13.0, 117.0, 13.0, 117.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Yellow moong dal / Hesaru Bele Spl'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-011');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-012', 'Methi seeds', 'GROCERY'::"IngredientSubStore", 'kg', 0.91, 103.81, 0.91, 103.81, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Methi seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-012');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-013', 'Chana dal / Kadle Bele Reg', 'GROCERY'::"IngredientSubStore", 'kg', 6.0, 95.0, 6.0, 95.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chana dal / Kadle Bele Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-013');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-014', 'Ghus Ghus', 'GROCERY'::"IngredientSubStore", 'kg', 0.0, 1494.0, 0.0, 1494.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ghus Ghus'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-014');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-015', 'Fried grams / Dried Chenna Reg', 'GROCERY'::"IngredientSubStore", 'kg', 17.0, 108.0, 17.0, 108.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Fried grams / Dried Chenna Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-015');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-016', 'Kitchen King Masala 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 349.0, 5.0, 349.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kitchen King Masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-016');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-017', 'Steam Rice/Staff Rice', 'GROCERY'::"IngredientSubStore", 'bag', 2.0, 1534.0, 2.0, 1534.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Steam Rice/Staff Rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-017');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-018', 'Kitchen King masala 100gm', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 82.0, 5.0, 82.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kitchen King masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-018');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-019', 'Golden Fish Kollam Rice 26kg / Rice Sona', 'GROCERY'::"IngredientSubStore", 'bag', 0.0, 2132.0, 0.0, 2132.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Golden Fish Kollam Rice 26kg / Rice Sona'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-019');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-020', 'Chunky chat masala 100gm', 'GROCERY'::"IngredientSubStore", 'pkt', 20.0, 0.0, 20.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chunky chat masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-020');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-021', 'Dawat Basmati rice', 'GROCERY'::"IngredientSubStore", 'bag', 3.0, 4140.0, 3.0, 4140.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dawat Basmati rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-021');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-022', 'Kallu hoo/ lichen', 'GROCERY'::"IngredientSubStore", 'kg', 0.3, 680.0, 0.3, 680.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kallu hoo/ lichen'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-022');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-023', 'Poha / Avalakki Reg', 'GROCERY'::"IngredientSubStore", 'kg', 12.0, 54.0, 12.0, 54.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Poha / Avalakki Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-023');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-024', 'Sugar', 'GROCERY'::"IngredientSubStore", 'kg', 65.0, 45.23, 65.0, 45.23, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sugar'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-024');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-025', 'Orange Idli rice', 'GROCERY'::"IngredientSubStore", 'bag', 2.0, 40.5, 2.0, 40.5, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Orange Idli rice'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-025');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-026', 'Jaggery Powder 500g', 'GROCERY'::"IngredientSubStore", 'pkt', 15.0, 81.0, 15.0, 81.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jaggery Powder 500g'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-026');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-027', 'Dosa Rice / Rice IR8', 'GROCERY'::"IngredientSubStore", 'bag', 3.0, 33.5, 3.0, 33.5, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dosa Rice / Rice IR8'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-027');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-028', 'Jaggery ball', 'GROCERY'::"IngredientSubStore", 'kg', 10.0, 63.0, 10.0, 63.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jaggery ball'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-028');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-029', 'Orange Atta 50kg Bag / Atta Chakke', 'GROCERY'::"IngredientSubStore", 'kg', 35.5, 41.0, 35.5, 41.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Orange Atta 50kg Bag / Atta Chakke'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-029');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-030', 'Aromatic mix', 'GROCERY'::"IngredientSubStore", 'box', 9.0, 153.0, 9.0, 153.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Aromatic mix'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-030');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-031', 'Maida', 'GROCERY'::"IngredientSubStore", 'kg', 38.0, 44.0, 38.0, 44.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Maida'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-031');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-032', 'Soya bean', 'GROCERY'::"IngredientSubStore", 'kg', 2.0, 112.38, 2.0, 112.38, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Soya bean'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-032');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-033', 'Rice Flour', 'GROCERY'::"IngredientSubStore", 'kg', 16.0, 46.0, 16.0, 46.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Rice Flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-033');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-034', 'Kismiss / Dry Grapes', 'GROCERY'::"IngredientSubStore", 'kg', 3.0, 439.0, 3.0, 439.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kismiss / Dry Grapes'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-034');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-035', 'Besan / Kadle Hittu', 'GROCERY'::"IngredientSubStore", 'kg', 37.0, 96.0, 37.0, 96.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Besan / Kadle Hittu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-035');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-036', 'Baby cashewnut', 'GROCERY'::"IngredientSubStore", 'kg', 8.0, 569.0, 8.0, 569.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Baby cashewnut'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-036');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-037', 'Ragi flour', 'GROCERY'::"IngredientSubStore", 'kg', 10.0, 57.0, 10.0, 57.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ragi flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-037');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-038', 'Cashewnut 4p', 'GROCERY'::"IngredientSubStore", 'kg', 5.1, 834.29, 5.1, 834.29, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Cashewnut 4p'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-038');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-039', 'Corn flour', 'GROCERY'::"IngredientSubStore", 'kg', 15.0, 46.0, 15.0, 46.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Corn flour'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-039');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-040', 'Rasam powder 200gm', 'GROCERY'::"IngredientSubStore", 'pkt', 9.0, 153.33, 9.0, 153.33, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Rasam powder 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-040');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-041', 'Chiroti rava', 'GROCERY'::"IngredientSubStore", 'kg', 14.0, 48.0, 14.0, 48.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chiroti rava'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-041');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-042', 'Bisibelebath powder 200Gm', 'GROCERY'::"IngredientSubStore", 'pkt', 13.0, 152.38, 13.0, 152.38, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Bisibelebath powder 200Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-042');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-043', 'Orange sooji(local rava) / Rave Uppitu Reg', 'GROCERY'::"IngredientSubStore", 'kg', 13.0, 47.0, 13.0, 47.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Orange sooji(local rava) / Rave Uppitu Reg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-043');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-044', 'Puliyogare powder 200gm', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 135.24, 5.0, 135.24, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Puliyogare powder 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-044');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-045', 'Rajma chitra', 'GROCERY'::"IngredientSubStore", 'kg', 0.0, 138.0, 0.0, 138.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Rajma chitra'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-045');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-046', 'Puliyogare powder 1kg', 'GROCERY'::"IngredientSubStore", 'pkt', 0.0, 390.0, 0.0, 390.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Puliyogare powder 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-046');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-047', 'Red rajma', 'GROCERY'::"IngredientSubStore", 'kg', 17.0, 147.0, 17.0, 147.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Red rajma'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-047');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-048', 'Splitz Tomato Ketchup', 'GROCERY'::"IngredientSubStore", 'pkt', 11.0, 107.0, 11.0, 107.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Splitz Tomato Ketchup'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-048');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-049', 'Black Urad Dal', 'GROCERY'::"IngredientSubStore", 'kg', 14.0, 129.0, 14.0, 129.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Black Urad Dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-049');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-050', 'Vinegar', 'GROCERY'::"IngredientSubStore", 'btl', 5.0, 24.0, 5.0, 24.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Vinegar'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-050');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-051', 'Green moong dal', 'GROCERY'::"IngredientSubStore", 'kg', 10.0, 148.0, 10.0, 148.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Green moong dal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-051');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-052', 'Red chilli sauce', 'GROCERY'::"IngredientSubStore", 'btl', 6.0, 41.9, 6.0, 41.9, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Red chilli sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-052');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-053', 'Black chana / Kadle Kalu', 'GROCERY'::"IngredientSubStore", 'kg', 13.0, 90.0, 13.0, 90.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Black chana / Kadle Kalu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-053');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-054', 'Green chilli sauce', 'GROCERY'::"IngredientSubStore", 'btl', 5.0, 41.9, 5.0, 41.9, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Green chilli sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-054');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-055', 'White chana / Kabuli', 'GROCERY'::"IngredientSubStore", 'kg', 12.5, 119.0, 12.5, 119.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('White chana / Kabuli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-055');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-056', 'Dark soya sauce', 'GROCERY'::"IngredientSubStore", 'btl', 6.0, 41.9, 6.0, 41.9, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dark soya sauce'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-056');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-057', 'Green peas dry', 'GROCERY'::"IngredientSubStore", 'kg', 4.0, 65.0, 4.0, 65.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Green peas dry'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-057');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-058', 'Dry mango powder/Amchur powder', 'GROCERY'::"IngredientSubStore", 'pkt', 3.0, 71.2, 3.0, 71.2, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dry mango powder/Amchur powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-058');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-059', 'Halasande', 'GROCERY'::"IngredientSubStore", 'kg', 2.0, 102.0, 2.0, 102.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Halasande'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-059');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-060', 'orange red bush', 'GROCERY'::"IngredientSubStore", 'tin', 0.0, 55.0, 0.0, 55.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('orange red bush'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-060');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-061', 'Millet/Navane', 'GROCERY'::"IngredientSubStore", 'kg', 12.0, 89.0, 12.0, 89.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Millet/Navane'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-061');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-062', 'Kesari bush', 'GROCERY'::"IngredientSubStore", 'tin', 0.0, 85.0, 0.0, 85.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kesari bush'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-062');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-063', 'White till', 'GROCERY'::"IngredientSubStore", 'kg', 0.2, 210.0, 0.2, 210.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('White till'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-063');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-064', 'Ingu(LG powder)', 'GROCERY'::"IngredientSubStore", 'btl', 7.0, 52.5, 7.0, 52.5, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ingu(LG powder)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-064');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-065', 'Black till', 'GROCERY'::"IngredientSubStore", 'kg', 0.1, 0.0, 0.1, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Black till'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-065');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-066', 'Keora water', 'GROCERY'::"IngredientSubStore", 'btl', 8.0, 56.78, 8.0, 56.78, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Keora water'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-066');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-067', 'Badam seeds', 'GROCERY'::"IngredientSubStore", 'kg', 0.3, 960.0, 0.3, 960.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Badam seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-067');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-068', 'Zaika gulabari / Rose Water', 'GROCERY'::"IngredientSubStore", 'btl', 6.0, 64.76, 6.0, 64.76, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Zaika gulabari / Rose Water'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-068');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-069', 'Pista', 'GROCERY'::"IngredientSubStore", 'kg', 0.95, 2450.0, 0.95, 2450.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pista'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-069');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-070', 'Tata salt(powder)', 'GROCERY'::"IngredientSubStore", 'pkt', 7.0, 29.0, 7.0, 29.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Tata salt(powder)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-070');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-071', 'Magaj', 'GROCERY'::"IngredientSubStore", 'kg', 7.0, 607.0, 7.0, 607.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Magaj'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-071');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-072', 'Stone salt', 'GROCERY'::"IngredientSubStore", 'pkt', 15.0, 20.0, 15.0, 20.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Stone salt'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-072');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-073', 'Ground nuts/peanuts', 'GROCERY'::"IngredientSubStore", 'kg', 9.0, 169.0, 9.0, 169.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ground nuts/peanuts'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-073');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-074', 'Ajwin', 'GROCERY'::"IngredientSubStore", 'kg', 0.2, 275.0, 0.2, 275.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ajwin'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-074');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-075', 'Super Garam Masala 200gm', 'GROCERY'::"IngredientSubStore", 'pkt', 22.0, 102.86, 22.0, 102.86, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Super Garam Masala 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-075');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-076', 'Mayonnaise', 'GROCERY'::"IngredientSubStore", 'pkt', 10.0, 108.0, 10.0, 108.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Mayonnaise'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-076');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-077', 'Everest Garam Masala 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 0.0, 0.0, 0.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Everest Garam Masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-077');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-078', 'Saffron', 'GROCERY'::"IngredientSubStore", 'kg', 0.02, 0.0, 0.02, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Saffron'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-078');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-079', 'MDH Garam masala 100gm', 'GROCERY'::"IngredientSubStore", 'pkt', 4.0, 90.0, 4.0, 90.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('MDH Garam masala 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-079');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-080', 'Kasuri methi 100gm', 'GROCERY'::"IngredientSubStore", 'pkt', 4.0, 48.0, 4.0, 48.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kasuri methi 100gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-080');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-081', 'MDH Kashmiri CHILLI 100GM', 'GROCERY'::"IngredientSubStore", 'pkt', 10.0, 107.62, 10.0, 107.62, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('MDH Kashmiri CHILLI 100GM'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-081');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-082', 'Anil shavige Vermicelli', 'GROCERY'::"IngredientSubStore", 'pkt', 7.0, 53.33, 7.0, 53.33, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Anil shavige Vermicelli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-082');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-083', 'Kashmiri chilli powder 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 3.0, 944.76, 3.0, 944.76, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kashmiri chilli powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-083');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-084', 'Roasted vermicelli', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 122.85, 5.0, 122.85, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Roasted vermicelli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-084');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-085', 'Kibs Badam Feast Powder', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 130.0, 5.0, 130.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Kibs Badam Feast Powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-085');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-086', 'Noodles', 'GROCERY'::"IngredientSubStore", 'pkt', 19.0, 0.0, 19.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Noodles'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-086');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-087', 'Yellow Chilly Powder 100gms', 'GROCERY'::"IngredientSubStore", 'pkt', 12.0, 619.05, 12.0, 619.05, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Yellow Chilly Powder 100gms'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-087');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-088', 'Macroni Pasta 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 2.0, 61.9, 2.0, 61.9, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Macroni Pasta 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-088');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-089', 'Shakti Chilly Powder 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 6.0, 160.95, 6.0, 160.95, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Shakti Chilly Powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-089');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-090', 'Roasted North papad(masala papad)', 'GROCERY'::"IngredientSubStore", 'pkt', 1.0, 385.0, 1.0, 385.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Roasted North papad(masala papad)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-090');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-091', 'MTR Chilly Powder 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 4.0, 302.84, 4.0, 302.84, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('MTR Chilly Powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-091');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-092', 'Flavour papad(sago chilly)', 'GROCERY'::"IngredientSubStore", 'pkt', 6.0, 58.57, 6.0, 58.57, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Flavour papad(sago chilly)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-092');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-093', 'Meat masala 200Gm', 'GROCERY'::"IngredientSubStore", 'pkt', 10.0, 143.81, 10.0, 143.81, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Meat masala 200Gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-093');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-094', 'Urad dal papad(lotus)', 'GROCERY'::"IngredientSubStore", 'pkt', 12.0, 40.0, 12.0, 40.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Urad dal papad(lotus)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-094');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-095', 'Turmeric 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 140.0, 5.0, 140.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Turmeric 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-095');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-096', 'Rice papad 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 0.0, 174.0, 0.0, 174.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Rice papad 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-096');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-097', 'Chat masala 200gm', 'GROCERY'::"IngredientSubStore", 'pkt', 2.0, 75.0, 2.0, 75.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chat masala 200gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-097');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-098', 'Fryums', 'GROCERY'::"IngredientSubStore", 'kg', 6.0, 78.0, 6.0, 78.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Fryums'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-098');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-099', 'Chat Masala 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 10.0, 0.0, 10.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chat Masala 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-099');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-100', 'Tea powder-red label 950g', 'GROCERY'::"IngredientSubStore", 'pkt', 14.0, 503.81, 14.0, 503.81, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Tea powder-red label 950g'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-100');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-101', 'MDH Chunky Chat Masala 100gms', 'GROCERY'::"IngredientSubStore", 'pkt', 0.0, 311.43, 0.0, 311.43, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('MDH Chunky Chat Masala 100gms'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-101');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-102', 'Coffee powder-Bru Ins 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 11.0, 660.0, 11.0, 660.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coffee powder-Bru Ins 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-102');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-103', 'Tamarind Chap Spl', 'GROCERY'::"IngredientSubStore", 'kg', 2.9, 148.0, 2.9, 148.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Tamarind Chap Spl'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-103');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-104', 'Coffee Cothas 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 6.0, 360.0, 6.0, 360.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coffee Cothas 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-104');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-105', 'MTR Samabar Powder 200 gm', 'GROCERY'::"IngredientSubStore", 'pkt', 0.0, 0.0, 0.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('MTR Samabar Powder 200 gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-105');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-106', 'Sunpure oil', 'GROCERY'::"IngredientSubStore", 'box', 2.5, 0.0, 2.5, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sunpure oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-106');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-107', 'Sambar powder500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 2.0, 196.19, 2.0, 196.19, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sambar powder500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-107');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-108', 'Coconut oil', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 319.0, 5.0, 319.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coconut oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-108');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-109', 'Sambar powder 1KG', 'GROCERY'::"IngredientSubStore", 'pkt', 1.0, 395.0, 1.0, 395.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sambar powder 1KG'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-109');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-110', 'Coconut milk', 'GROCERY'::"IngredientSubStore", 'tin', 4.0, 110.0, 4.0, 110.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coconut milk'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-110');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-111', 'Dhaniya powder 500gm', 'GROCERY'::"IngredientSubStore", 'pkt', 6.0, 134.29, 6.0, 134.29, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dhaniya powder 500gm'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-111');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-112', 'Mustard oil', 'GROCERY'::"IngredientSubStore", 'btl', 4.0, 198.09, 4.0, 198.09, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Mustard oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-112');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-113', 'Dhaniya seeds', 'GROCERY'::"IngredientSubStore", 'kg', 8.0, 179.0, 8.0, 179.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dhaniya seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-113');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-114', 'Olive oil', 'GROCERY'::"IngredientSubStore", 'btl', 2.0, 370.47, 2.0, 370.47, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Olive oil'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-114');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-115', 'Byadgi chilli', 'GROCERY'::"IngredientSubStore", 'kg', 1.9, 739.0, 1.9, 739.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Byadgi chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-115');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-116', 'Dry Coconut', 'GROCERY'::"IngredientSubStore", 'kg', 0.0, 429.0, 0.0, 429.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Dry Coconut'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-116');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-117', 'Round chilli', 'GROCERY'::"IngredientSubStore", 'kg', 1.0, 459.0, 1.0, 459.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Round chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-117');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-118', 'Ghee', 'GROCERY'::"IngredientSubStore", 'kg', 5.0, 661.9, 5.0, 661.9, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ghee'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-118');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-119', 'Salem chilli', 'GROCERY'::"IngredientSubStore", 'kg', 4.0, 360.95, 4.0, 360.95, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Salem chilli'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-119');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-120', 'Fruit jam', 'GROCERY'::"IngredientSubStore", 'btl', 3.0, 167.61, 3.0, 167.61, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Fruit jam'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-120');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-121', 'Chakke/Cinnamon stick', 'GROCERY'::"IngredientSubStore", 'kg', 1.65, 68.0, 1.65, 68.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Chakke/Cinnamon stick'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-121');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-122', 'Pickle 5kg', 'GROCERY'::"IngredientSubStore", 'btl', 4.0, 270.0, 4.0, 270.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pickle 5kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-122');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-123', 'Pulav leaves', 'GROCERY'::"IngredientSubStore", 'kg', 0.5, 180.0, 0.5, 180.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pulav leaves'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-123');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-124', 'Honey Dabur 1kg', 'GROCERY'::"IngredientSubStore", 'btl', 1.0, 200.0, 1.0, 200.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Honey Dabur 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-124');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-125', 'Marati Moggu', 'GROCERY'::"IngredientSubStore", 'kg', 0.6, 850.0, 0.6, 850.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Marati Moggu'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-125');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-126', 'Tomato Puree', 'GROCERY'::"IngredientSubStore", 'tin', 4.0, 69.52, 4.0, 69.52, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Tomato Puree'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-126');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-127', 'Lavanga', 'GROCERY'::"IngredientSubStore", 'kg', 0.8, 929.0, 0.8, 929.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Lavanga'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-127');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-128', 'Sabudana', 'GROCERY'::"IngredientSubStore", 'pkt', 1.0, 65.0, 1.0, 65.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sabudana'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-128');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-129', 'Big elachi', 'GROCERY'::"IngredientSubStore", 'kg', 0.25, 2150.0, 0.25, 2150.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Big elachi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-129');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-130', 'Nylon sabudana / Sago 500', 'GROCERY'::"IngredientSubStore", 'pkt', 5.0, 44.76, 5.0, 44.76, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Nylon sabudana / Sago 500'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-130');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-131', 'Elachi', 'GROCERY'::"IngredientSubStore", 'kg', 0.15, 3595.0, 0.15, 3595.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Elachi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-131');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-132', 'Oregano Leaves 1kg', 'GROCERY'::"IngredientSubStore", 'pkt', 1.0, 0.0, 1.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Oregano Leaves 1kg'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-132');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-133', 'Jaypathra (Javitri)', 'GROCERY'::"IngredientSubStore", 'kg', 0.3, 3246.0, 0.3, 3246.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jaypathra (Javitri)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-133');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-134', 'Whole Ragi', 'GROCERY'::"IngredientSubStore", 'pkt', 2.0, 56.0, 2.0, 56.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Whole Ragi'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-134');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-135', 'Jaypal / Jakai Pc', 'GROCERY'::"IngredientSubStore", 'kg', 0.07, 1050.0, 0.07, 1050.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Jaypal / Jakai Pc'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-135');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-136', 'Coconut Milk Powder', 'GROCERY'::"IngredientSubStore", 'kg', 1.0, 0.0, 1.0, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coconut Milk Powder'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-136');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-137', 'Sompu seeds', 'GROCERY'::"IngredientSubStore", 'kg', 1.8, 205.0, 1.8, 205.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sompu seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-137');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-138', 'Poppy Seeds', 'GROCERY'::"IngredientSubStore", 'pkt', 0.2, 0.0, 0.2, 0.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Poppy Seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-138');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-139', 'Mustard seeds', 'GROCERY'::"IngredientSubStore", 'kg', 1.5, 123.0, 1.5, 123.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Mustard seeds'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-139');

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'XLK-140', 'Black whole pepper', 'GROCERY'::"IngredientSubStore", 'kg', 1.7, 818.0, 1.7, 818.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Black whole pepper'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'XLK-140');
