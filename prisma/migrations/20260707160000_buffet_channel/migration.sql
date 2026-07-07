-- New order channel: BUFFET (breakfast / lunch / dinner buffets),
-- package-priced like banquet / ODC / packed.
ALTER TYPE "OrderChannel" ADD VALUE IF NOT EXISTS 'BUFFET';
