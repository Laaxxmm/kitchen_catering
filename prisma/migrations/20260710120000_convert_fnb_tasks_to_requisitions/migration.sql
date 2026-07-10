-- One-time conversion: the two "Procure for F&B: …" tasks raised through the
-- old free-text request flow (deleted 2026-07-09) become real Banquet
-- Requisitions so the store keeper can issue against them line by line.
--
-- Title format produced by the old flow:
--   Procure for F&B: 1100 Pcs × Burger Clam Shell [9*9]; 1100 Pcs × Wooden Spoon [16 MM]; 3 Roll × Bu
-- (the old code sliced the summary to 80 chars, so the last segment can be
-- truncated — segments that don't exactly match a BanquetItem name go into
-- the requisition notes for F&B to add manually instead of guessing).
--
-- Idempotent: only open (ASSIGNED/REJECTED) tasks with this title prefix are
-- touched, and each is closed once converted. Re-running finds nothing.

DO $$
DECLARE
  t RECORD;
  seg TEXT;
  qty NUMERIC;
  iname TEXT;
  item_id TEXT;
  req_id TEXT;
  req_no TEXT;
  n INT;
  matched INT;
  unmatched TEXT;
BEGIN
  FOR t IN
    SELECT * FROM "Task"
    WHERE "title" LIKE 'Procure for F&B:%'
      AND "status" IN ('ASSIGNED', 'SUBMITTED', 'REJECTED')
    ORDER BY "createdAt"
  LOOP
    matched := 0;
    unmatched := NULL;
    req_id := gen_random_uuid()::text;

    -- Claim a BRQ number atomically (FY 26-27; this migration runs July 2026).
    INSERT INTO "BanquetRequisitionNumberSequence" ("year", "next") VALUES (2026, 2)
      ON CONFLICT ("year") DO UPDATE SET "next" = "BanquetRequisitionNumberSequence"."next" + 1
      RETURNING "next" - 1 INTO n;
    req_no := 'BRQ-26-27-' || lpad(n::text, 4, '0');

    INSERT INTO "BanquetRequisition"
      ("id", "requisitionNo", "status", "notes", "createdById", "submittedAt", "createdAt", "updatedAt")
    VALUES
      (req_id, req_no, 'SUBMITTED',
       'Converted from the pre-requisition task: "' || t."title" || '"',
       t."assignedById", t."createdAt", NOW(), NOW());

    -- Each segment: "<qty> <unit> × <item name>", separated by ";".
    FOR seg IN
      SELECT trim(s) FROM unnest(string_to_array(
        substring(t."title" FROM 'Procure for F&B: (.*)$'), ';')) AS s
      WHERE trim(s) <> ''
    LOOP
      qty := (regexp_match(seg, '^([0-9]+(?:\.[0-9]+)?)'))[1]::numeric;
      iname := trim((regexp_match(seg, '×\s*(.+)$'))[1]);
      item_id := NULL;
      IF qty IS NOT NULL AND iname IS NOT NULL THEN
        SELECT "id" INTO item_id FROM "BanquetItem"
        WHERE lower("name") = lower(iname)
        ORDER BY "active" DESC LIMIT 1;
      END IF;
      IF item_id IS NULL THEN
        unmatched := coalesce(unmatched || '; ', '') || seg;
        CONTINUE;
      END IF;
      INSERT INTO "BanquetRequisitionLine"
        ("id", "requisitionId", "itemId", "requestedQty", "issuedQty", "status")
      VALUES (gen_random_uuid()::text, req_id, item_id, qty, 0, 'PENDING');
      matched := matched + 1;
    END LOOP;

    IF matched = 0 THEN
      -- Nothing recognisable — leave the task as it was, drop the shell.
      DELETE FROM "BanquetRequisition" WHERE "id" = req_id;
      CONTINUE;
    END IF;

    IF unmatched IS NOT NULL THEN
      UPDATE "BanquetRequisition"
      SET "notes" = "notes" || E'\nCould not match (add manually): ' || unmatched
      WHERE "id" = req_id;
    END IF;

    -- Close the task, pointing at its replacement.
    UPDATE "Task"
    SET "status" = 'COMPLETED',
        "submittedAt" = NOW(),
        "completedAt" = NOW(),
        "reviewedAt" = NOW(),
        "completionRemarks" = 'Re-raised as banquet requisition ' || req_no ||
          ' — issue it from Banquet → Requisitions.',
        "updatedAt" = NOW()
    WHERE "id" = t."id";

    INSERT INTO "AuditLog" ("id", "userId", "action", "entity", "entityId", "at")
    VALUES (gen_random_uuid()::text, t."assignedById",
            'BANQUET_REQUISITION_CREATED', 'BanquetRequisition', req_id, NOW());
  END LOOP;
END $$;
