-- The vendor import seeded V-0001..V-00NN directly without initialising
-- VendorCodeSequence, so nextVendorCode() minted V-0001, collided, and the
-- rollback undid the sequence bump — vendor creation failed forever.
-- Initialise (or fast-forward) the sequence past the highest existing code.
INSERT INTO "VendorCodeSequence" ("year", "next")
VALUES (
  0,
  COALESCE((
    SELECT MAX(CAST(SUBSTRING("code" FROM 'V-([0-9]+)') AS INTEGER))
    FROM "Vendor" WHERE "code" ~ '^V-[0-9]+$'
  ), 0) + 1
)
ON CONFLICT ("year") DO UPDATE
SET "next" = GREATEST("VendorCodeSequence"."next", EXCLUDED."next");
