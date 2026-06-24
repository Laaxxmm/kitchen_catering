import { OrderChannel } from "@prisma/client";

// Single source of truth for channel-policy predicates. These rules gate
// real workflow decisions (admin sign-off, required event date, feedback
// links), so they must agree everywhere — keep them here rather than
// re-deriving the channel lists inline at each call site.

/**
 * In-house "immediate" channels: served now to a room/table/team rather than
 * pre-booked catering. They skip the admin commercial gate (straight to the
 * chef) and don't require a future event date or delivery window.
 */
const IMMEDIATE_CHANNELS: ReadonlySet<OrderChannel> = new Set([
  OrderChannel.ROOM_SERVICE,
  OrderChannel.ALACARTE,
  OrderChannel.MANAGEMENT,
]);

export function isImmediateChannel(channel: OrderChannel): boolean {
  return IMMEDIATE_CHANNELS.has(channel);
}

/**
 * Channels that get a post-delivery WhatsApp feedback link minted on
 * completion. MANAGEMENT (internal) orders are intentionally excluded.
 */
const FEEDBACK_CHANNELS: ReadonlySet<OrderChannel> = new Set([
  OrderChannel.ROOM_SERVICE,
  OrderChannel.ALACARTE,
  OrderChannel.ODC,
  OrderChannel.PACKET,
]);

export function channelWantsFeedback(channel: OrderChannel): boolean {
  return FEEDBACK_CHANNELS.has(channel);
}
