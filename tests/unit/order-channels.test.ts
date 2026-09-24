import { describe, expect, it } from "vitest";
import { OrderChannel } from "@prisma/client";
import {
  channelWantsFeedback,
  EVENT_DELIVERY_CHANNEL_LIST,
  isEventDeliveryChannel,
  isImmediateChannel,
  isLeftoverChannel,
  isPackagePricedChannel,
} from "@/lib/order-channels";

/**
 * The Ramaiah café counter is COUNTER_SALE under another name: every rule
 * that applies to one must apply to the other, or the new channel drifts
 * into a third way of working nobody asked for.
 */
describe("Ramaiah Cafe follows the counter-sale rules exactly", () => {
  const predicates = {
    isImmediateChannel,
    channelWantsFeedback,
    isEventDeliveryChannel,
    isPackagePricedChannel,
    isLeftoverChannel,
  };

  for (const [name, fn] of Object.entries(predicates)) {
    it(name, () => {
      expect(fn(OrderChannel.RAMAIAH_CAFE)).toBe(fn(OrderChannel.COUNTER_SALE));
    });
  }

  it("is a lump-sum, delivery-prep, leftover-return, feedback channel — not an in-house one", () => {
    expect(isPackagePricedChannel(OrderChannel.RAMAIAH_CAFE)).toBe(true);
    expect(isEventDeliveryChannel(OrderChannel.RAMAIAH_CAFE)).toBe(true);
    expect(isLeftoverChannel(OrderChannel.RAMAIAH_CAFE)).toBe(true);
    expect(channelWantsFeedback(OrderChannel.RAMAIAH_CAFE)).toBe(true);
    expect(isImmediateChannel(OrderChannel.RAMAIAH_CAFE)).toBe(false);
    expect(EVENT_DELIVERY_CHANNEL_LIST).toContain(OrderChannel.RAMAIAH_CAFE);
  });

  it("leftover returns stay with the counters and outdoor catering", () => {
    expect(isLeftoverChannel(OrderChannel.ODC)).toBe(true);
    expect(isLeftoverChannel(OrderChannel.BANQUET)).toBe(false);
    expect(isLeftoverChannel(OrderChannel.ROOM_SERVICE)).toBe(false);
  });
});
