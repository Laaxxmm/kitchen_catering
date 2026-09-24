import { OrderChannel } from "@prisma/client";

// Single source of truth for channel-policy predicates. These rules gate
// real workflow decisions (admin sign-off, required event date, feedback
// links), so they must agree everywhere — keep them here rather than
// re-deriving the channel lists inline at each call site.

/**
 * The two walk-up counters. RAMAIAH_CAFE (the Ramaiah campus café) is worked
 * exactly like COUNTER_SALE — lump-sum package price, delivery prep,
 * leftover returns, feedback link — and only exists as its own value so
 * sales and reports can tell the counters apart. Every rule below lists
 * them together on purpose; do not add one without the other.
 */
const COUNTER_CHANNELS: readonly OrderChannel[] = [OrderChannel.COUNTER_SALE, OrderChannel.RAMAIAH_CAFE];

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
  ...COUNTER_CHANNELS,
]);

export function channelWantsFeedback(channel: OrderChannel): boolean {
  return FEEDBACK_CHANNELS.has(channel);
}

/**
 * Off-site catering channels where the delivery team has to prepare cutlery,
 * crockery and event arrangements ahead of the event — banquet, outdoor
 * catering (ODC) and packed/take-away batches. In-house channels (room
 * service / à la carte / management) are served on the premises and need no
 * such delivery prep, so they're excluded.
 */
const EVENT_DELIVERY_CHANNELS: ReadonlySet<OrderChannel> = new Set([
  OrderChannel.BANQUET,
  OrderChannel.BUFFET,
  OrderChannel.ODC,
  OrderChannel.PACKET,
  ...COUNTER_CHANNELS,
]);

/** Array form for Prisma `{ channel: { in: … } }` filters — same set. */
export const EVENT_DELIVERY_CHANNEL_LIST: OrderChannel[] = [...EVENT_DELIVERY_CHANNELS];

export function isEventDeliveryChannel(channel: OrderChannel): boolean {
  return EVENT_DELIVERY_CHANNELS.has(channel);
}

/**
 * Channels priced as ONE lump-sum package (the dishes are sub-heads, not
 * per-plate line items): banquet, buffet, outdoor catering, packed batches
 * and the two counters. In-house channels stay per-dish priced.
 */
const PACKAGE_PRICED_CHANNELS: ReadonlySet<OrderChannel> = new Set([
  OrderChannel.BANQUET,
  OrderChannel.BUFFET,
  OrderChannel.ODC,
  OrderChannel.PACKET,
  ...COUNTER_CHANNELS,
]);

export function isPackagePricedChannel(channel: OrderChannel): boolean {
  return PACKAGE_PRICED_CHANNELS.has(channel);
}

/**
 * Channels where surplus food comes back after the event and is returned to
 * the kitchen as leftovers: the counters and outdoor catering.
 */
const LEFTOVER_CHANNELS: ReadonlySet<OrderChannel> = new Set([...COUNTER_CHANNELS, OrderChannel.ODC]);

export function isLeftoverChannel(channel: OrderChannel): boolean {
  return LEFTOVER_CHANNELS.has(channel);
}
