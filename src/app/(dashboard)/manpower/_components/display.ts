import { ManpowerRequestStatus } from "@prisma/client";
import type { PillTone } from "@/components/ik/StatusPill";
import { manpowerCost } from "@/lib/manpower";
import { formatINR } from "@/lib/money";

/** Amber = somebody still has to act; green = settled/done; red/grey = closed. */
export const STATUS_META: Record<ManpowerRequestStatus, { label: string; tone: PillTone }> = {
  [ManpowerRequestStatus.REQUESTED]: { label: "Awaiting approval", tone: "amber" },
  [ManpowerRequestStatus.APPROVED]: { label: "Approved", tone: "green" },
  [ManpowerRequestStatus.COMPLETED]: { label: "Job done", tone: "amber" },
  [ManpowerRequestStatus.PAID]: { label: "Paid", tone: "green" },
  [ManpowerRequestStatus.REJECTED]: { label: "Turned down", tone: "red" },
  [ManpowerRequestStatus.CANCELLED]: { label: "Called off", tone: "grey" },
};

/** "4 × 2 days @ ₹450.00 = ₹3,600.00" — one shape for every screen, so the
 *  requested and approved lines can be read against each other at a glance. */
export function figureLine(people: number, days: number, rate: string): string {
  const cost = manpowerCost(people, days, rate);
  return `${people} × ${days} day${days === 1 ? "" : "s"} @ ${formatINR(rate)} = ${formatINR(cost)}`;
}
