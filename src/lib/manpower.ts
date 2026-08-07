import { ManpowerRequestStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { humanizeStatus } from "@/lib/order-status";
import { round2, toDecimal, zero } from "@/lib/money";

/**
 * Manpower request rules: which move is legal from where, when money may
 * move, and the rupee arithmetic. Pure decisions, no DB — shared by the
 * server actions, the request board and the monthly report, so what the
 * server refuses and what the UI offers cannot drift apart.
 *
 * The money discipline is the one we shipped for supplier bills: approved
 * AND the job actually done before a rupee leaves. Both are enforced here
 * and re-enforced in the action, never only in the UI.
 */

/**
 * The whole lifecycle, as an adjacency list. Statuses absent from a list are
 * refused.
 *
 * REQUESTED  → APPROVED / REJECTED / CANCELLED
 * APPROVED   → COMPLETED (the job was done) / CANCELLED (called off first)
 * COMPLETED  → PAID only. Once the labour has worked, the debt is real —
 *              cancelling it away would silently strand a person's wages.
 *              Correcting the figure is `settle`, not a cancel.
 * PAID / REJECTED / CANCELLED are terminal.
 */
export const MANPOWER_TRANSITIONS: Record<ManpowerRequestStatus, ManpowerRequestStatus[]> = {
  [ManpowerRequestStatus.REQUESTED]: [
    ManpowerRequestStatus.APPROVED,
    ManpowerRequestStatus.REJECTED,
    ManpowerRequestStatus.CANCELLED,
  ],
  [ManpowerRequestStatus.APPROVED]: [
    ManpowerRequestStatus.COMPLETED,
    ManpowerRequestStatus.CANCELLED,
  ],
  [ManpowerRequestStatus.COMPLETED]: [ManpowerRequestStatus.PAID],
  [ManpowerRequestStatus.PAID]: [],
  [ManpowerRequestStatus.REJECTED]: [],
  [ManpowerRequestStatus.CANCELLED]: [],
};

export function canTransition(
  from: ManpowerRequestStatus,
  to: ManpowerRequestStatus,
): boolean {
  return MANPOWER_TRANSITIONS[from].includes(to);
}

/** Why this move is refused, in words the requester can act on. */
export function transitionRefusal(
  from: ManpowerRequestStatus,
  to: ManpowerRequestStatus,
): string | null {
  if (canTransition(from, to)) return null;
  if (from === to) return `This request is already ${humanizeStatus(from)}.`;
  if (MANPOWER_TRANSITIONS[from].length === 0) {
    return `This request is ${humanizeStatus(from)} — nothing more can be done to it.`;
  }
  return `A ${humanizeStatus(from)} request can't be marked ${humanizeStatus(to)}.`;
}

/**
 * The only status money may leave on. COMPLETED means approved (you cannot
 * reach it any other way) AND the job done — both halves of the gate in one
 * check.
 */
export function isPayable(status: ManpowerRequestStatus): boolean {
  return status === ManpowerRequestStatus.COMPLETED;
}

/**
 * Why this request can't be paid. `actualCost` is what accounts settled on;
 * paying before anyone has said what the labour actually invoiced is how you
 * pay the estimate by accident.
 */
export function payRefusal(
  status: ManpowerRequestStatus,
  actualCost: Rupees | null | undefined,
): string | null {
  if (status === ManpowerRequestStatus.PAID) return "This request is already paid.";
  if (status === ManpowerRequestStatus.REQUESTED) {
    return "Nobody has approved this manpower request yet — it can't be paid.";
  }
  if (status === ManpowerRequestStatus.APPROVED) {
    return "The job isn't marked done yet — a manpower request is paid after the work, not before.";
  }
  if (!isPayable(status)) {
    return `This request is ${humanizeStatus(status)} — only an approved, completed request can be paid.`;
  }
  if (isBlank(actualCost)) {
    return "Record the actual cost accounts settled on before paying.";
  }
  return null;
}

/** Why the actual cost can't be recorded. Settling is what accounts do once
 *  the labour has invoiced, so the job has to be done first — and the number
 *  is frozen once it has been paid out. */
export function settleRefusal(status: ManpowerRequestStatus): string | null {
  if (status === ManpowerRequestStatus.PAID) {
    return "This request is already paid — the settled cost can't be changed.";
  }
  if (status !== ManpowerRequestStatus.COMPLETED) {
    return `This request is ${humanizeStatus(status)} — mark the job done before settling what it actually cost.`;
  }
  return null;
}

// ─── Cost arithmetic ─────────────────────────────────────────────────────

/**
 * Anything `toDecimal` can swallow. Deliberately structural rather than
 * `Prisma.Decimal`, so a Prisma row, a decimal.js Decimal and a raw form
 * string all fit and this module stays importable from a client component.
 */
export type Rupees = string | number | { toString(): string };

/**
 * A blank string is not a zero — it's an empty box on a form. `decimalString`
 * lets "" through and `new Decimal("")` throws, which has crashed this app
 * twice. Treat blank/absent as "not provided".
 */
function isBlank(value: Rupees | null | undefined): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

/** Blank-safe `toDecimal`. Every Decimal in this module goes through here. */
function rupees(value: Rupees | null | undefined): Decimal {
  return isBlank(value) ? zero() : toDecimal(value!);
}

/** people × days × rate-per-person-per-day, in paise-exact Decimal.
 *  Blank/absent rate reads as nothing costed yet, i.e. ₹0 — never a throw. */
export function manpowerCost(
  people: number | null | undefined,
  days: number | null | undefined,
  rate: Rupees | null | undefined,
): Decimal {
  if (people == null || days == null || isBlank(rate)) return zero();
  if (!Number.isFinite(people) || !Number.isFinite(days)) return zero();
  return round2(toDecimal(people).times(days).times(rupees(rate)));
}

/** The three figures a request is costed on. */
export interface ManpowerFigures {
  people: number;
  days: number;
  rate: string;
}

/** The shape every helper below reads. Prisma rows satisfy it (Decimal has
 *  toString), and so do plain form values — no Prisma import needed. */
export interface ManpowerCostable {
  requestedPeople: number;
  requestedDays: number;
  requestedRate: Rupees;
  approvedPeople?: number | null;
  approvedDays?: number | null;
  approvedRate?: Rupees | null;
  actualCost?: Rupees | null;
}

/** What was originally asked for. Survives the manager's edit untouched. */
export function requestedFigures(r: ManpowerCostable): ManpowerFigures {
  return {
    people: r.requestedPeople,
    days: r.requestedDays,
    rate: String(r.requestedRate),
  };
}

/**
 * The figures the money is actually based on: the manager's approved numbers
 * when they exist, otherwise what was asked for (still pending approval).
 */
export function effectiveFigures(r: ManpowerCostable): ManpowerFigures {
  if (r.approvedPeople == null || r.approvedDays == null || isBlank(r.approvedRate)) {
    return requestedFigures(r);
  }
  return {
    people: r.approvedPeople,
    days: r.approvedDays,
    rate: String(r.approvedRate),
  };
}

/** True when the manager changed any of the three figures at approval — the
 *  "asked for 6 at ₹500, approved 4 at ₹450" case the report calls out. */
export function wasEditedAtApproval(r: ManpowerCostable): boolean {
  const asked = requestedFigures(r);
  const approved = effectiveFigures(r);
  return (
    asked.people !== approved.people ||
    asked.days !== approved.days ||
    !rupees(asked.rate).eq(rupees(approved.rate))
  );
}

/** What this request is expected to cost — approved figures if approved. */
export function estimatedCost(r: ManpowerCostable): Decimal {
  const f = effectiveFigures(r);
  return manpowerCost(f.people, f.days, f.rate);
}

/** What it would have cost as originally asked for. */
export function requestedCost(r: ManpowerCostable): Decimal {
  const f = requestedFigures(r);
  return manpowerCost(f.people, f.days, f.rate);
}

/**
 * Estimate vs what accounts actually settled. `actual` and `variance` are
 * null until someone settles — the report must show "not settled yet"
 * rather than a fake zero overrun.
 *
 * variance = actual − estimate, so positive is an overrun.
 */
export interface ManpowerVariance {
  estimate: Decimal;
  actual: Decimal | null;
  variance: Decimal | null;
  /** actual > estimate — the row the manager wants to see in the report. */
  overrun: boolean;
}

export function costVariance(r: ManpowerCostable): ManpowerVariance {
  const estimate = estimatedCost(r);
  if (isBlank(r.actualCost)) {
    return { estimate, actual: null, variance: null, overrun: false };
  }
  const actual = round2(rupees(r.actualCost));
  const variance = actual.minus(estimate);
  return { estimate, actual, variance, overrun: variance.gt(0) };
}
