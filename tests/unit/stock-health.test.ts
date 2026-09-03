import { describe, expect, it } from "vitest";
import {
  classifyStock,
  RUNNING_OUT_DAYS,
  TARGET_COVER_DAYS,
  WATCH_DAYS,
} from "@/lib/stock-health";

/**
 * The rule this replaces was "on hand <= 0 means out", which after the
 * catalogue import painted ~285 of 405 items red — none of them a shortage,
 * all of them items nobody had ever drawn. The store stopped reading the
 * number and went back to walking the shelves.
 *
 * So the tests that matter are the ones that keep those 285 out of the
 * headline while a genuinely empty, genuinely used item stays in it.
 */

const NOW = new Date("2026-09-02T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** Never counted, never issued — the shape of most of the catalogue. */
const untouched = {
  onHandQty: "0",
  reorderLevel: "0",
  issuedQty: "0",
  firstMovementAt: null,
  lastIssuedAt: null,
};

describe("items nobody has ever used", () => {
  it("is not a shortage, whatever the stock says", () => {
    expect(classifyStock(untouched, NOW).bucket).toBe("NEVER_USED");
  });

  it("stays out of the headline even with stock on the shelf", () => {
    const received = {
      ...untouched,
      onHandQty: "40",
      firstMovementAt: daysAgo(10),
    };
    // Received but never drawn — worth a manager's attention, not the
    // store's morning order.
    expect(classifyStock(received, NOW).bucket).toBe("DORMANT");
  });

  it("suggests ordering nothing — there is no rate to project", () => {
    const health = classifyStock(untouched, NOW);
    expect(health.suggestedQty.toString()).toBe("0");
    expect(health.daysCover).toBeNull();
  });
});

describe("an item the kitchen actually draws", () => {
  /** 2/day for 30 days. */
  const steady = {
    reorderLevel: "0",
    issuedQty: "60",
    firstMovementAt: daysAgo(30),
    lastIssuedAt: daysAgo(1),
  };

  it("is out and needed when the shelf is empty", () => {
    expect(classifyStock({ ...steady, onHandQty: "0" }, NOW).bucket).toBe("OUT_NEEDED");
  });

  it("reads days of cover off the real rate", () => {
    const health = classifyStock({ ...steady, onHandQty: "20" }, NOW);
    expect(health.dailyRate.toString()).toBe("2");
    expect(health.daysCover).toBe(10);
  });

  it("is running out under a week of cover", () => {
    // 12 on hand at 2/day = 6 days.
    expect(classifyStock({ ...steady, onHandQty: "12" }, NOW).bucket).toBe("RUNNING_OUT");
  });

  it("is on watch between a week and a fortnight", () => {
    // 20 on hand at 2/day = 10 days.
    expect(classifyStock({ ...steady, onHandQty: "20" }, NOW).bucket).toBe("WATCH");
  });

  it("is healthy beyond a fortnight", () => {
    // 60 on hand at 2/day = 30 days.
    expect(classifyStock({ ...steady, onHandQty: "60" }, NOW).bucket).toBe("HEALTHY");
  });

  it("tops up to the target cover, not to some round number", () => {
    // 2/day × 14 days = 28 wanted, 12 on hand → 16 to buy.
    const health = classifyStock({ ...steady, onHandQty: "12" }, NOW);
    expect(health.suggestedQty.toString()).toBe("16");
    expect(TARGET_COVER_DAYS).toBe(14);
  });

  it("suggests nothing once there is already enough", () => {
    expect(classifyStock({ ...steady, onHandQty: "60" }, NOW).suggestedQty.toString()).toBe("0");
  });

  it("goes quiet once nothing has drawn it for two months", () => {
    const stale = { ...steady, onHandQty: "50", lastIssuedAt: daysAgo(90) };
    expect(classifyStock(stale, NOW).bucket).toBe("DORMANT");
  });
});

describe("a hand-set reorder level", () => {
  it("outranks the computed rate — somebody set it deliberately", () => {
    // 60 days of cover by the rate, but the level says this is low.
    const health = classifyStock(
      {
        onHandQty: "10",
        reorderLevel: "15",
        issuedQty: "6",
        firstMovementAt: daysAgo(36),
        lastIssuedAt: daysAgo(2),
      },
      NOW,
    );
    expect(health.bucket).toBe("RUNNING_OUT");
  });
});

describe("a young catalogue", () => {
  /**
   * The reason the rate is measured from the item's own first movement. Over
   * a fixed 60-day window, a week of real usage divides down to near zero
   * and every item reads comfortable on the morning the shelf runs dry.
   */
  it("reads a week of usage as a week, not as a sixtieth of one", () => {
    const week = {
      onHandQty: "10",
      reorderLevel: "0",
      issuedQty: "70", // 10/day for 7 days
      firstMovementAt: daysAgo(7),
      lastIssuedAt: daysAgo(1),
    };
    const health = classifyStock(week, NOW);
    expect(health.dailyRate.toString()).toBe("10");
    expect(health.daysCover).toBe(1);
    expect(health.bucket).toBe("RUNNING_OUT");
  });
});

describe("the thresholds are the ones agreed", () => {
  it("orders under 7 days and watches under 14", () => {
    expect(RUNNING_OUT_DAYS).toBe(7);
    expect(WATCH_DAYS).toBe(14);
  });
});
