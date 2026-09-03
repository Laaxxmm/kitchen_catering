import { Decimal } from "decimal.js";
import { toDecimal } from "@/lib/money";

/**
 * What state an item is actually in, judged by how the kitchen uses it.
 *
 * The old signal was one rule — on hand <= 0 means "out" — and after the
 * catalogue import that put ~285 of 405 items into a red "Out of stock"
 * number, because they had no opening count and had never been issued. The
 * store read it as noise, ignored it, and went back to walking the shelves
 * every morning. The second rule, on hand <= reorder level, almost never
 * fired: reorder level defaults to 0 and nobody was going to hand-set 405 of
 * them.
 *
 * So the classification here is derived from movement, not from setup: an
 * item that gets issued has a usage rate, a rate gives days of cover, and
 * days of cover is the only number that answers "do I order this today".
 * Items nobody has ever touched are set aside quietly rather than counted as
 * a shortage.
 */

export type StockBucket =
  /** Zero on hand, and the kitchen has been drawing it. Order today. */
  | "OUT_NEEDED"
  /** Less than RUNNING_OUT_DAYS of cover left at the current rate. */
  | "RUNNING_OUT"
  /** Between RUNNING_OUT_DAYS and WATCH_DAYS of cover. */
  | "WATCH"
  /** Comfortable. */
  | "HEALTHY"
  /** Never issued, ever. Not a shortage — kept out of the headline. */
  | "NEVER_USED"
  /** Stock sitting on the shelf that nothing has drawn in DORMANT_DAYS. */
  | "DORMANT";

/** Under this many days of cover, order now. */
export const RUNNING_OUT_DAYS = 7;
/** Under this many, keep an eye on it. */
export const WATCH_DAYS = 14;
/** No issue in this long, with stock on hand, is money standing still. */
export const DORMANT_DAYS = 60;
/** What "order enough" means: top back up to this many days of cover. */
export const TARGET_COVER_DAYS = 14;

export interface StockUsage {
  onHandQty: Decimal | string | number;
  /** Manual override. 0 (the default) means "not set". */
  reorderLevel: Decimal | string | number;
  /** Everything issued since the item first moved. */
  issuedQty: Decimal | string | number;
  /** First movement of any kind — receipt or issue. Null = never moved. */
  firstMovementAt: Date | null;
  /** Last time the kitchen drew it. Null = never issued. */
  lastIssuedAt: Date | null;
}

export interface StockHealth {
  bucket: StockBucket;
  /** Average quantity issued per day since the item first moved. */
  dailyRate: Decimal;
  /** Days of stock left at that rate; null when the rate is zero. */
  daysCover: number | null;
  /** How much to buy to reach TARGET_COVER_DAYS; zero when nothing is due. */
  suggestedQty: Decimal;
}

/**
 * Days between two instants, floored at 1.
 *
 * A catalogue that went live three weeks ago would otherwise divide a week's
 * usage by a 60-day window and report a rate near zero — every item would
 * look comfortable on the day the shelf ran dry. Measuring from the item's
 * own first movement is what makes the rate honest on a young catalogue.
 */
function daysSince(from: Date, now: Date): number {
  const ms = now.getTime() - from.getTime();
  return Math.max(1, ms / 86_400_000);
}

export function classifyStock(input: StockUsage, now: Date = new Date()): StockHealth {
  const onHand = toDecimal(input.onHandQty);
  const reorder = toDecimal(input.reorderLevel);
  const issued = toDecimal(input.issuedQty);

  const neverIssued = input.lastIssuedAt === null || issued.lte(0);

  // Rate is per day since the item first moved, not over a fixed window.
  const observedDays = input.firstMovementAt ? daysSince(input.firstMovementAt, now) : 0;
  const dailyRate =
    neverIssued || observedDays <= 0 ? new Decimal(0) : issued.div(observedDays);

  const daysCover = dailyRate.gt(0) ? Number(onHand.div(dailyRate).toFixed(2)) : null;

  const suggestedQty = (() => {
    if (dailyRate.lte(0)) return new Decimal(0);
    const target = dailyRate.times(TARGET_COVER_DAYS);
    const gap = target.minus(onHand);
    return gap.gt(0) ? gap.toDecimalPlaces(2) : new Decimal(0);
  })();

  const bucket = ((): StockBucket => {
    // Nothing has ever been drawn: it is a catalogue entry, not a shortage.
    // Said before the zero-stock check on purpose — this is precisely the
    // 285 that used to fill the red card.
    if (neverIssued) {
      return onHand.gt(0) && isStale(input.lastIssuedAt, now) ? "DORMANT" : "NEVER_USED";
    }
    if (onHand.lte(0)) return "OUT_NEEDED";

    // A hand-set reorder level is a deliberate instruction and outranks the
    // computed rate — someone who sets one knows something the data doesn't.
    if (reorder.gt(0) && onHand.lte(reorder)) return "RUNNING_OUT";

    if (isStale(input.lastIssuedAt, now)) return "DORMANT";
    if (daysCover === null) return "HEALTHY";
    if (daysCover < RUNNING_OUT_DAYS) return "RUNNING_OUT";
    if (daysCover < WATCH_DAYS) return "WATCH";
    return "HEALTHY";
  })();

  return { bucket, dailyRate, daysCover, suggestedQty };
}

function isStale(lastIssuedAt: Date | null, now: Date): boolean {
  if (!lastIssuedAt) return true;
  return daysSince(lastIssuedAt, now) > DORMANT_DAYS;
}

/** The buckets the store has to act on, in the order they should be read. */
export const ACTIONABLE_BUCKETS: StockBucket[] = ["OUT_NEEDED", "RUNNING_OUT", "WATCH"];

export const BUCKET_LABEL: Record<StockBucket, string> = {
  OUT_NEEDED: "Out — needed",
  RUNNING_OUT: "Running out",
  WATCH: "Watch",
  HEALTHY: "Healthy",
  NEVER_USED: "Never used",
  DORMANT: "Not moving",
};
