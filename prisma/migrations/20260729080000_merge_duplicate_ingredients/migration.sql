-- Kitchen catalogue had visible duplicates ("Paneer"/"Paneer ", "Masoor Dal"
-- three times, "Fresh cream"/"Fresh Cream"). The app blocks duplicate names,
-- so these came from the master-list import migrations: they matched existing
-- rows with lower(name) but never trimmed, so a stored name carrying a stray
-- space didn't match the sheet and a twin was inserted instead of reused.
-- Split names split stock — goods received against one are invisible to a
-- requisition pointing at the other, which is what broke GRNs.

-- 1. Trim stored names so whitespace twins collapse to the same text.
UPDATE "Ingredient" SET "name" = btrim("name") WHERE "name" <> btrim("name");

-- 2. Merge each duplicate group into one survivor. Same rules as the
--    mergeIngredient action: history is REPOINTED (never deleted), stock is
--    summed, cost becomes the quantity-weighted average, losers are
--    deactivated rather than dropped so the audit trail stays intact.
--    Groups whose rows disagree on unit are skipped — folding 5 pkt into kg
--    would corrupt stock, so those need a human (Kitchen stock → merge).
DO $$
DECLARE
  grp   RECORD;
  keep  TEXT;
  losers TEXT[];
  new_qty  NUMERIC;
  new_cost NUMERIC;
BEGIN
  FOR grp IN
    SELECT lower(btrim(name)) AS key
    FROM "Ingredient"
    GROUP BY lower(btrim(name))
    HAVING count(*) > 1
       AND count(DISTINCT lower(btrim(unit))) = 1   -- same unit only
  LOOP
    -- Survivor: the row carrying real history, then the most stock, then the
    -- oldest — so the id that other records already point at usually wins.
    SELECT id INTO keep
    FROM "Ingredient" i
    WHERE lower(btrim(i.name)) = grp.key
    ORDER BY (
      (SELECT count(*) FROM "IngredientReceipt"    x WHERE x."ingredientId" = i.id) +
      (SELECT count(*) FROM "IngredientIssue"      x WHERE x."ingredientId" = i.id) +
      (SELECT count(*) FROM "ChefRequisitionLine"  x WHERE x."ingredientId" = i.id) +
      (SELECT count(*) FROM "VendorPOLine"         x WHERE x."ingredientId" = i.id)
    ) DESC, i."onHandQty" DESC, i."createdAt" ASC
    LIMIT 1;

    SELECT array_agg(id) INTO losers
    FROM "Ingredient"
    WHERE lower(btrim(name)) = grp.key AND id <> keep;

    -- Quantity-weighted average cost across the whole group.
    SELECT COALESCE(SUM("onHandQty"), 0),
           CASE WHEN COALESCE(SUM("onHandQty"), 0) > 0
                THEN SUM("onHandQty" * "avgUnitCost") / SUM("onHandQty")
                ELSE MAX("avgUnitCost") END
      INTO new_qty, new_cost
    FROM "Ingredient" WHERE lower(btrim(name)) = grp.key;

    -- Repoint every child record onto the survivor.
    UPDATE "IngredientReceipt"       SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "IngredientIssue"         SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "IngredientAdjustment"    SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "RecipeIngredient"        SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "PurchaseRequisitionLine" SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "OrderBudgetLine"         SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "VendorPOLine"            SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);
    UPDATE "ChefRequisitionLine"     SET "ingredientId" = keep WHERE "ingredientId" = ANY(losers);

    UPDATE "Ingredient"
       SET "onHandQty" = new_qty, "avgUnitCost" = new_cost, "active" = true, "updatedAt" = NOW()
     WHERE id = keep;

    -- Losers keep their row (audit) but hold no stock and leave the pickers.
    UPDATE "Ingredient"
       SET "active" = false, "onHandQty" = 0, "updatedAt" = NOW()
     WHERE id = ANY(losers);
  END LOOP;
END $$;

-- 3. Make it structurally impossible to add another one. A partial unique
--    index over the ACTIVE rows: deactivated historical twins are allowed to
--    keep their names, but two live items can never share one again — this
--    binds raw SQL imports too, which is how the duplicates got in.
--    Wrapped so that a leftover unit-mismatch group can't fail the deploy;
--    those stay visible in the catalogue for a human to merge.
DO $$
BEGIN
  CREATE UNIQUE INDEX "Ingredient_active_name_unique"
    ON "Ingredient" (lower(btrim(name))) WHERE "active";
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'Duplicate active ingredient names remain (differing units) — merge them from Kitchen stock, then create the index.';
END $$;
