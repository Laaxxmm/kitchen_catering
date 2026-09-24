-- The kitchen store keeps frozen goods, meat and bought-in ready-made items
-- (bakery, sweets, snacks) on their own shelf. Until now the enum had no
-- name for it, so 137 such items sat under OTHER beside the dry groceries.
ALTER TYPE "IngredientSubStore" ADD VALUE IF NOT EXISTS 'FROZEN';
