-- New sales channel: the Ramaiah campus café counter. Priced and worked
-- exactly like COUNTER_SALE (lump-sum package, leftover returns, delivery
-- prep, feedback link); its own value so sales and reports can tell the
-- two counters apart.
ALTER TYPE "OrderChannel" ADD VALUE IF NOT EXISTS 'RAMAIAH_CAFE';
