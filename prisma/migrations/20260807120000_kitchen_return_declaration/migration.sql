-- Kitchen returns become a custody handover.
--
-- Until now a return was one step: the store keeper typed it and stock moved
-- in the same transaction. The client asked for the chef to declare what
-- they are sending back, and for the store to confirm what physically turned
-- up — because "chef said 2 kg, 1.5 kg arrived" is the discrepancy the old
-- one-step path silently absorbed.
--
-- Modelled on the existing table rather than a parallel one: a declaration
-- IS a return that has not been confirmed yet, so the order panel, the
-- returns list and the issue→credit link all keep reading one place.
--
-- Two things this is deliberately shaped around:
--
-- 1. "status" is the whole safety story. Only a CONFIRMED row has ever
--    touched Ingredient.onHandQty, so every "how much came back" read —
--    the returnable ceiling above all — filters on it. A DECLARED row is a
--    promise; a REJECTED row is a promise that was withdrawn or refused.
--
-- 2. "declaredQuantity" is never overwritten. Confirmation writes the
--    received figure into "quantity" and leaves the declared figure alone,
--    the same way ManpowerRequest keeps requestedPeople/Days/Rate beside
--    approvedPeople/Days/Rate. Overwriting it would destroy exactly the
--    number this change exists to produce.
--
-- BACKFILL — every "IngredientReturn" row that already exists is a completed,
-- already-moved return recorded by the store in one step. Those rows must
-- stay valid and visible, and must NOT read as pending work:
--   * "status" lands NOT NULL DEFAULT 'CONFIRMED', so ADD COLUMN stamps
--     CONFIRMED on every existing row — no NULL that a later "pending"
--     query would sweep up.
--   * "confirmedById"/"confirmedAt" are filled from the row's own
--     recordedById/createdAt, because on the one-step path the person who
--     recorded it IS the person who took delivery. That keeps "every
--     CONFIRMED row names who booked the stock in" true for history too.
--   * "declaredQuantity" stays NULL on those lines, which is the truth:
--     there was no declaration behind them.
--
-- Order.status is untouched by this flow, as it was before.

CREATE TYPE "IngredientReturnStatus" AS ENUM ('DECLARED', 'CONFIRMED', 'REJECTED');

ALTER TABLE "IngredientReturn"
    ADD COLUMN "status" "IngredientReturnStatus" NOT NULL DEFAULT 'CONFIRMED',
    ADD COLUMN "confirmedById" TEXT,
    ADD COLUMN "confirmedAt" TIMESTAMP(3),
    ADD COLUMN "confirmationNote" TEXT,
    ADD COLUMN "rejectedById" TEXT,
    ADD COLUMN "rejectedAt" TIMESTAMP(3),
    ADD COLUMN "rejectionReason" TEXT;

-- The explicit half of the backfill: history gets a confirmer, not a blank.
UPDATE "IngredientReturn"
   SET "confirmedById" = "recordedById",
       "confirmedAt"   = "createdAt"
 WHERE "status" = 'CONFIRMED'
   AND "confirmedById" IS NULL;

ALTER TABLE "IngredientReturnLine"
    ADD COLUMN "declaredQuantity" DECIMAL(14,3);

-- The store's queue: "which declarations are waiting on me".
CREATE INDEX "IngredientReturn_status_idx" ON "IngredientReturn"("status");

-- SET NULL on both decision stamps, matching "ManpowerRequest_approvedById_fkey"
-- — a leaver's user row must not take a stock document with it. (recordedById
-- stays RESTRICT, as it already is: the document must always name its author.)
ALTER TABLE "IngredientReturn" ADD CONSTRAINT "IngredientReturn_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IngredientReturn" ADD CONSTRAINT "IngredientReturn_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
