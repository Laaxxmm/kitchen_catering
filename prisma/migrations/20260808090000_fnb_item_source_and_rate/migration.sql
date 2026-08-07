-- F&B catalogue splits in two: stock the client owns, and stock they hire in.
--
-- The client is replacing the whole F&B list with three sheets — in-house
-- disposables, in-house crockery, and a hire list priced per event. Same
-- store, same issue/return flow, so this is one column on "BanquetItem",
-- not a parallel table.
--
-- Three things this is deliberately shaped around:
--
-- 1. "source" is an enum, not a boolean. The client has already asked about
--    a third bucket (rented in from a sister branch). Widening an enum is an
--    ALTER TYPE; widening a boolean is a data migration.
--
-- 2. UNIQUENESS MOVES. "BanquetItem_name_key" is now wrong and would block
--    the import outright: "soup bowl" is a real hired-Melamine item AND a
--    hired-Bonechina one at a different rate, and "soup saucer" likewise.
--    A name means something only once you know the source and the grade, so
--    the key becomes (name, source, category). Verified against the incoming
--    data: 193 F&B rows, 193 distinct (name, source, category) triples.
--
--    Caveat kept in view: "category" stays nullable (the item form allows a
--    blank category and the F&B actions write NULL), and Postgres treats
--    NULLs as distinct in a unique index — so two same-named rows with NO
--    category are still possible. Every one of the 193 imported rows carries
--    a category, so the catalogue itself is fully covered. Tightening
--    "category" to NOT NULL would break the existing item form, which is
--    owned elsewhere.
--
-- 3. "rate" is nullable. Hired items are priced per unit per event and
--    in-house disposables carry a purchase rate, but the client never priced
--    part of the crockery list — a NOT NULL 0 would read as "free", which is
--    a different claim from "not priced".
--
-- BACKFILL — every "BanquetItem" that exists today is owned stock bought by
-- the client, so DEFAULT 'IN_HOUSE' on ADD COLUMN stamps the truth on every
-- existing row and the column lands NOT NULL with no NULL window. (The
-- clean-slate reset clears this table shortly after, but the migration has
-- to stand on its own against live data.)

CREATE TYPE "BanquetItemSource" AS ENUM ('IN_HOUSE', 'HIRED');

ALTER TABLE "BanquetItem"
    ADD COLUMN "source" "BanquetItemSource" NOT NULL DEFAULT 'IN_HOUSE',
    ADD COLUMN "rate" DECIMAL(12,2);

DROP INDEX "BanquetItem_name_key";

-- Safe on live data in this order: the old key was name alone, so anything
-- unique on name is already unique on the wider triple.
CREATE UNIQUE INDEX "BanquetItem_name_source_category_key" ON "BanquetItem"("name", "source", "category");

-- The catalogue screens list one source at a time.
CREATE INDEX "BanquetItem_source_idx" ON "BanquetItem"("source");

-- Two counters beside the kitchen's "GPItemCodeSequence", which stays the
-- kitchen one. The three catalogues carry different prefixes (GP-nnn /
-- GP-IN-nnn / GP-HR-nnn) and the client numbers each list from 1, so one
-- shared counter would leave visible gaps in all three. Seeded by the
-- catalogue import (scripts/import-catalogue.ts), not here — this migration
-- runs on every boot and must not renumber anything.
CREATE TABLE "GPInhouseItemCodeSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GPInhouseItemCodeSequence_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "GPHiredItemCodeSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "GPHiredItemCodeSequence_pkey" PRIMARY KEY ("year")
);
