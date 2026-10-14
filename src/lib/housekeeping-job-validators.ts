import { z } from "zod";
import { HousekeepingJobType, JobPriority } from "@prisma/client";

/**
 * Input for the housekeeping job actions (src/server/actions/housekeeping-
 * jobs.ts). Shape only — that a room / staff member / item exists and is
 * active is checked inside the action's transaction.
 */

export const HK_JOB_TYPE_LABEL: Record<HousekeepingJobType, string> = {
  CHECKOUT_CLEAN: "Checkout clean",
  STAYOVER_CLEAN: "Stayover clean",
  TURNDOWN: "Turndown",
  DEEP_CLEAN: "Deep clean",
  GUEST_REQUEST: "Guest request",
  LAUNDRY: "Laundry",
  OTHER: "Other",
};

export const JOB_PRIORITY_LABEL: Record<JobPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const id = z.string().trim().min(1).max(60);
/** Optional link: blank / null = none. `undefined` (not sent) is kept
 *  distinct from `null` (cleared) so an edit can leave a field alone. */
const optionalId = z
  .string()
  .trim()
  .max(60)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

/** A positive quantity, at most 3 decimal places, that fits Decimal(14,3). */
const quantity = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((s) => /^\d{1,11}(\.\d{1,3})?$/.test(s), "Enter a quantity with up to 3 decimals")
  .refine((s) => Number(s) > 0, "Quantity must be more than 0");

export const HousekeepingJobCreateInput = z.object({
  type: z.nativeEnum(HousekeepingJobType),
  priority: z.nativeEnum(JobPriority).default(JobPriority.NORMAL),
  roomId: optionalId,
  staffId: optionalId,
  description: z.string().trim().min(3, "Say what needs doing").max(1000),
  notes: optionalText(1000),
  /** datetime-local, read as IST. Blank = now. */
  reportedAt: z.string().trim().max(40).optional(),
});

/** Edit / assign while the job is open. Omitted = leave alone, null = clear. */
export const HousekeepingJobUpdateInput = z.object({
  type: z.nativeEnum(HousekeepingJobType).optional(),
  priority: z.nativeEnum(JobPriority).optional(),
  roomId: optionalId,
  staffId: optionalId,
  description: z.string().trim().min(3, "Say what needs doing").max(1000).optional(),
  notes: optionalText(1000),
});

export const HousekeepingJobStartInput = z.object({
  staffId: optionalId,
});

export const HousekeepingJobCompleteInput = z.object({
  outcome: z.string().trim().min(3, "Say what was done").max(1000),
  roomId: optionalId,
  staffId: optionalId,
  items: z
    .array(z.object({ itemId: id, qty: quantity }))
    .max(50, "At most 50 item lines")
    .default([])
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((l, i) => {
        if (seen.has(l.itemId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "The same item is on two lines — put the total on one",
            path: [i, "itemId"],
          });
        }
        seen.add(l.itemId);
      });
    }),
});

export const HousekeepingJobCancelInput = z.object({
  reason: z.string().trim().min(3, "Say why the job is cancelled").max(500),
});
