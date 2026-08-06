-- One shared "GP-nnn" code across BOTH item catalogues (kitchen Ingredient +
-- F&B BanquetItem). Staff kept adding near-identical items ("Paneer" vs
-- "Paneer "), splitting stock across twin rows; a single printed code per item
-- is how the team ends that. The code reuses the existing "sku" column — a
-- second parallel code column would put two codes on screen, which is the
-- confusion we're removing. The old value is preserved in "legacySku" so no
-- supplier part number is lost and the change is reversible.

ALTER TABLE "Ingredient" ADD COLUMN "legacySku" TEXT;
ALTER TABLE "BanquetItem" ADD COLUMN "legacySku" TEXT;

CREATE TABLE "GPItemCodeSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GPItemCodeSequence_pkey" PRIMARY KEY ("year")
);

-- Kitchen park-and-assign. "Ingredient"."sku" is UNIQUE and NOT NULL, and a
-- non-deferrable unique index is enforced row by row inside one UPDATE — so a
-- direct assignment would fail if any existing sku already looked like a code
-- we're about to hand out. Park every sku in a namespace nothing can collide
-- with first, then assign.
UPDATE "Ingredient" SET "legacySku" = "sku", "sku" = '__gp_pending__' || "id";

-- Deterministic order: oldest first, name as tiebreak — the bulk imports
-- inserted whole sheets in one statement, so createdAt alone is not a total
-- order and a re-run could otherwise renumber.
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt" ASC, "name" ASC) AS n
  FROM "Ingredient"
)
-- lpad() TRUNCATES when the value is already longer than the pad length
-- (lpad('1000',3,'0') = '100'), which would mint a duplicate of GP-100. Pad
-- to 3 only while it fits; past 999 the number stands on its own, matching
-- formatGPItemCode() in src/lib/sequences.ts.
UPDATE "Ingredient" i
SET "sku" = 'GP-' || CASE WHEN o.n < 1000 THEN lpad(o.n::text, 3, '0') ELSE o.n::text END
FROM ordered o
WHERE i."id" = o."id";

-- F&B continues the same run, so kitchen GP-001..GP-N is followed by F&B
-- GP-(N+1)... "BanquetItem"."sku" carries no unique index (only "name" does),
-- so one statement is safe here.
WITH ordered AS (
  SELECT
    "id",
    (SELECT count(*) FROM "Ingredient")
      + row_number() OVER (ORDER BY "createdAt" ASC, "name" ASC) AS n
  FROM "BanquetItem"
)
UPDATE "BanquetItem" b
SET "legacySku" = b."sku", "sku" = 'GP-' || CASE WHEN o.n < 1000 THEN lpad(o.n::text, 3, '0') ELSE o.n::text END
FROM ordered o
WHERE b."id" = o."id";

-- Seed the counter. nextSequenceValue() claims a code with
--   UPDATE SET next = next + 1 RETURNING next   →  claimed = next - 1
-- so the stored "next" is literally "the code to hand out next", not "the last
-- code used": store MAX+1 and the first new item gets MAX+1, not MAX. (Same
-- reasoning as 20260707190000_heal_vendor_code_sequence, which fixed exactly
-- this collision for vendor codes.) Read back from the rows just written
-- rather than from a count, so the seed can't drift from what was assigned.
INSERT INTO "GPItemCodeSequence" ("year", "next")
VALUES (
  0,
  COALESCE((
    SELECT MAX(CAST(SUBSTRING("sku" FROM '^GP-([0-9]+)$') AS INTEGER))
    FROM (
      SELECT "sku" FROM "Ingredient"
      UNION ALL
      SELECT "sku" FROM "BanquetItem"
    ) AS all_codes
  ), 0) + 1
);
