-- Admin toggle: when true, the store keeper can set kitchen ingredient
-- stock and F&B (banquet) stock directly via adjustments. Meant for the
-- initial stock-loading phase; turn off afterwards from Admin → Settings.
INSERT INTO "Settings" ("key", "value", "notes", "updatedAt")
VALUES (
  'stock.storeDirectEdit',
  'false'::jsonb,
  'ON: store keeper can directly set kitchen + F&B (banquet) stock via adjustments. Turn off after the stock-loading phase.',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;
