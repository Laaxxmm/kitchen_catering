import { BanquetRequisitionLineStatus } from "@prisma/client";
import { Decimal } from "decimal.js";

// The whole decision behind "the order went 10 → 20 pax, raise this line":
// quantities in, the line's resulting status or a user-facing refusal out.
// DB-free so amendBanquetRequisitionLineQty and the inline editor give the
// same answer — the editor before the round trip, the action as the gate.

export type BanquetLineAmend =
  | { ok: true; status: BanquetRequisitionLineStatus; newQty: string }
  | { ok: false; error: string };

function toDecimal(value: string): Decimal | null {
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d : null;
  } catch {
    // decimal.js throws on "", "abc" — a typed-in box reaches here.
    return null;
  }
}

export function planBanquetLineAmend(input: {
  requestedQty: string;
  issuedQty: string;
  newQty: string;
  unit: string;
  lineStatus: BanquetRequisitionLineStatus;
}): BanquetLineAmend {
  if (input.lineStatus === BanquetRequisitionLineStatus.CANCELLED) {
    return { ok: false, error: "This item was cancelled — its quantity can't be changed." };
  }
  const requested = toDecimal(input.requestedQty);
  const issued = toDecimal(input.issuedQty);
  // Decimal(14,3) column — anything finer is silently truncated on write, so
  // decide on the value that will actually be stored.
  const next = toDecimal(input.newQty)?.toDecimalPlaces(3) ?? null;
  if (!requested || !issued || !next) return { ok: false, error: "Enter a valid quantity." };
  if (next.lte(0)) return { ok: false, error: "Quantity must be greater than 0." };
  if (next.eq(requested)) {
    return { ok: false, error: `Already requesting ${requested.toString()} ${input.unit}.` };
  }
  if (next.lt(issued)) {
    return {
      ok: false,
      error: `${issued.toString()} ${input.unit} already issued — the quantity can't go below that. Record a banquet return to take stock back first.`,
    };
  }
  return {
    ok: true,
    newQty: next.toString(),
    status: nextStatus(next, issued, input.lineStatus),
  };
}

/**
 * Deliberately identical to `decideAmend`'s rule on the kitchen side
 * (requisitions/[id]/_components/amend-rules.ts) — the two stores must behave
 * the same or the team learns two rules. Change one, change both.
 */
function nextStatus(
  requested: Decimal,
  issued: Decimal,
  current: BanquetRequisitionLineStatus,
): BanquetRequisitionLineStatus {
  // A vendor PO is already out for this line's shortfall. Raising the number
  // changes how much is short, not the fact that the store is waiting on a
  // vendor — and GRN acceptance owns the flip back (it matches on exactly this
  // status, procurement.ts:1155). Clearing the flag here would drop the line
  // out of that handshake and the goods would land with nothing re-opening it.
  // So the number moves, the flag doesn't, and the store is told the PO may no
  // longer cover the whole need.
  if (current === BanquetRequisitionLineStatus.AWAITING_PROCUREMENT) return current;

  // Raising past what's issued is the point: an ISSUED line drops back to
  // PARTIALLY_ISSUED, which puts the shortfall in the store's queue again.
  if (issued.gte(requested)) return BanquetRequisitionLineStatus.ISSUED;
  if (issued.gt(0)) return BanquetRequisitionLineStatus.PARTIALLY_ISSUED;
  return BanquetRequisitionLineStatus.PENDING;
}
