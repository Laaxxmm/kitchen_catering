-- Ninjacart vegetable price list import (36 items, source:
-- "Ninjacart - Vegetables Names With Rates.xlsx", July 2026 rates).
-- Guarded like the kitchen-store import: insert only when no ingredient
-- with the same name exists; rates become the cost baseline. For
-- vegetables that already exist with NO cost recorded (avgUnitCost = 0),
-- the rate is filled in — GRN-derived costs are never overwritten.

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-001', 'Pumpkin', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 25.0, 0, 25.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pumpkin'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-001');

UPDATE "Ingredient" SET "avgUnitCost" = 25.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Pumpkin') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-002', 'Mango', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 25.0, 0, 25.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Mango'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-002');

UPDATE "Ingredient" SET "avgUnitCost" = 25.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Mango') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-003', 'Musk melon', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 40.0, 0, 40.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Musk melon'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-003');

UPDATE "Ingredient" SET "avgUnitCost" = 40.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Musk melon') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-004', 'Papaya', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 35.0, 0, 35.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Papaya'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-004');

UPDATE "Ingredient" SET "avgUnitCost" = 35.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Papaya') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-005', 'Coconut', 'VEGETABLE'::"IngredientSubStore", 'piece', 0, 28.0, 0, 28.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coconut'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-005');

UPDATE "Ingredient" SET "avgUnitCost" = 28.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Coconut') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-006', 'Water melon', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 20.0, 0, 20.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Water melon'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-006');

UPDATE "Ingredient" SET "avgUnitCost" = 20.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Water melon') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-007', 'Pineapple', 'VEGETABLE'::"IngredientSubStore", 'piece', 0, 50.0, 0, 50.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pineapple'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-007');

UPDATE "Ingredient" SET "avgUnitCost" = 50.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Pineapple') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-008', 'Banana', 'VEGETABLE'::"IngredientSubStore", 'piece', 0, 4.5, 0, 4.5, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Banana'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-008');

UPDATE "Ingredient" SET "avgUnitCost" = 4.5, "updatedAt" = NOW()
WHERE lower("name") = lower('Banana') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-009', 'Onion (Big)', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 33.0, 0, 33.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Onion (Big)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-009');

UPDATE "Ingredient" SET "avgUnitCost" = 33.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Onion (Big)') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-010', 'Potato', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 35.0, 0, 35.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Potato'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-010');

UPDATE "Ingredient" SET "avgUnitCost" = 35.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Potato') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-011', 'Brinjal', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 41.0, 0, 41.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Brinjal'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-011');

UPDATE "Ingredient" SET "avgUnitCost" = 41.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Brinjal') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-012', 'Beans (French)', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 92.0, 0, 92.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Beans (French)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-012');

UPDATE "Ingredient" SET "avgUnitCost" = 92.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Beans (French)') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-013', 'Carrot', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 59.0, 0, 59.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Carrot'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-013');

UPDATE "Ingredient" SET "avgUnitCost" = 59.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Carrot') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-014', 'Tomato', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 36.0, 0, 36.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Tomato'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-014');

UPDATE "Ingredient" SET "avgUnitCost" = 36.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Tomato') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-015', 'Green Chilly', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 70.0, 0, 70.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Green Chilly'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-015');

UPDATE "Ingredient" SET "avgUnitCost" = 70.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Green Chilly') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-016', 'Lady Finger (Bhindi)', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 45.0, 0, 45.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Lady Finger (Bhindi)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-016');

UPDATE "Ingredient" SET "avgUnitCost" = 45.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Lady Finger (Bhindi)') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-017', 'Capsicum', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 61.0, 0, 61.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Capsicum'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-017');

UPDATE "Ingredient" SET "avgUnitCost" = 61.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Capsicum') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-018', 'Red Capsicum', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 65.0, 0, 65.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Red Capsicum'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-018');

UPDATE "Ingredient" SET "avgUnitCost" = 65.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Red Capsicum') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-019', 'Yellow Capsicum', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 65.0, 0, 65.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Yellow Capsicum'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-019');

UPDATE "Ingredient" SET "avgUnitCost" = 65.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Yellow Capsicum') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-020', 'Radish', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 30.0, 0, 30.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Radish'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-020');

UPDATE "Ingredient" SET "avgUnitCost" = 30.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Radish') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-021', 'Beetroot', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 48.0, 0, 48.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Beetroot'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-021');

UPDATE "Ingredient" SET "avgUnitCost" = 48.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Beetroot') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-022', 'Sweet Potato', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 40.0, 0, 40.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sweet Potato'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-022');

UPDATE "Ingredient" SET "avgUnitCost" = 40.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Sweet Potato') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-023', 'Cucumber', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 36.0, 0, 36.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Cucumber'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-023');

UPDATE "Ingredient" SET "avgUnitCost" = 36.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Cucumber') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-024', 'Garlic', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 190.0, 0, 190.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Garlic'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-024');

UPDATE "Ingredient" SET "avgUnitCost" = 190.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Garlic') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-025', 'Spring Onion', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 50.0, 0, 50.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Spring Onion'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-025');

UPDATE "Ingredient" SET "avgUnitCost" = 50.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Spring Onion') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-026', 'Ridge Gourd', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 45.0, 0, 45.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ridge Gourd'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-026');

UPDATE "Ingredient" SET "avgUnitCost" = 45.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Ridge Gourd') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-027', 'Ginger', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 120.0, 0, 120.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ginger'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-027');

UPDATE "Ingredient" SET "avgUnitCost" = 120.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Ginger') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-028', 'Drum stick', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 50.0, 0, 50.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Drum stick'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-028');

UPDATE "Ingredient" SET "avgUnitCost" = 50.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Drum stick') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-029', 'Cauliflower', 'VEGETABLE'::"IngredientSubStore", 'piece', 0, 41.0, 0, 41.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Cauliflower'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-029');

UPDATE "Ingredient" SET "avgUnitCost" = 41.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Cauliflower') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-030', 'Cabbage', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 44.0, 0, 44.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Cabbage'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-030');

UPDATE "Ingredient" SET "avgUnitCost" = 44.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Cabbage') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-031', 'Sponge Gourd', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 40.0, 0, 40.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Sponge Gourd'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-031');

UPDATE "Ingredient" SET "avgUnitCost" = 40.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Sponge Gourd') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-032', 'Ivy Gourd', 'VEGETABLE'::"IngredientSubStore", 'kg', 0, 40.0, 0, 40.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Ivy Gourd'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-032');

UPDATE "Ingredient" SET "avgUnitCost" = 40.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Ivy Gourd') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-033', 'Pudina (Mint)', 'VEGETABLE'::"IngredientSubStore", 'bunch', 0, 10.0, 0, 10.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Pudina (Mint)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-033');

UPDATE "Ingredient" SET "avgUnitCost" = 10.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Pudina (Mint)') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-034', 'Coriander', 'VEGETABLE'::"IngredientSubStore", 'bunch', 0, 13.0, 0, 13.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Coriander'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-034');

UPDATE "Ingredient" SET "avgUnitCost" = 13.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Coriander') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-035', 'Menthe (Fenugreek)', 'VEGETABLE'::"IngredientSubStore", 'bunch', 0, 15.0, 0, 15.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Menthe (Fenugreek)'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-035');

UPDATE "Ingredient" SET "avgUnitCost" = 15.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Menthe (Fenugreek)') AND "avgUnitCost" = 0;

INSERT INTO "Ingredient" ("id","sku","name","subStore","unit","openingQty","openingAvgCost","onHandQty","avgUnitCost","reorderLevel","gstRatePct","active","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'NJV-036', 'Palak', 'VEGETABLE'::"IngredientSubStore", 'bunch', 0, 12.0, 0, 12.0, 0, 0, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE lower("name") = lower('Palak'))
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" WHERE "sku" = 'NJV-036');

UPDATE "Ingredient" SET "avgUnitCost" = 12.0, "updatedAt" = NOW()
WHERE lower("name") = lower('Palak') AND "avgUnitCost" = 0;
