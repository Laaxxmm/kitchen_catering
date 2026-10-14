import { z } from "zod";
import { decimalString, MaintenanceActivityStatusInput } from "@/lib/validators";

// Maintenance jobs closed with the spares actually used. Kept out of
// validators.ts so the schema there only changes in place.

/** One spare used on the job. The action rounds to 3 dp and refuses ≤ 0. */
const MaintenancePartLine = z.object({
  itemId: z.string().trim().min(1, "Pick an item").max(60),
  qty: decimalString
    .refine((s) => s !== "", "Enter a quantity")
    .refine((s) => !s.startsWith("-"), "Can't be negative"),
});

export const MaintenancePartsInput = z
  .array(MaintenancePartLine)
  .max(50, "At most 50 spares on one job")
  .refine(
    (lines) => new Set(lines.map((l) => l.itemId)).size === lines.length,
    "Each spare once — put its total on one line",
  );

/** The status change, plus the parts recorded when it is COMPLETED. */
export const MaintenanceJobStatusInput = MaintenanceActivityStatusInput.extend({
  parts: MaintenancePartsInput.optional().default([]),
});

export const MaintenanceAssignInput = z.object({
  staffId: z.string().trim().min(1, "Pick a staff member").max(60),
});
