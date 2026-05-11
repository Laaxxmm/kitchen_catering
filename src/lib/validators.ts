import { z } from "zod";

// Common reusable validator: accept either a string or number, normalise to
// a string so it can be fed into `new Decimal(...)` without precision loss.
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v));

// Module-specific validators arrive in Phase 1. See docs/PHASE-1-CORE-FLOW.md.
