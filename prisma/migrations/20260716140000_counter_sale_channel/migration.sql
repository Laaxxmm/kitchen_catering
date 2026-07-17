-- New order channel: COUNTER_SALE — package-priced + event-delivery like ODC.
ALTER TYPE "OrderChannel" ADD VALUE IF NOT EXISTS 'COUNTER_SALE';
