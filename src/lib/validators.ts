import { z } from "zod";
import {
  ApprovalDecision,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  DeliveryStatus,
  MealType,
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  ProductionJobStatus,
  QuoteStatus,
  MaintenanceActivityStatus,
  MaintenanceCategory,
  Role,
  RoomType,
  TaskPriority,
  TaskStatus,
  VendorPaymentTerms,
} from "@prisma/client";

// =====================================================================
// COMMON
// =====================================================================

/**
 * Accept either a string or number; normalise to string so it can be fed
 * into `new Decimal(...)` without precision loss. All money / quantity
 * fields in the schema use this transform.
 */
export const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v));

/** 2-digit Indian GST state code, e.g. "29" for Karnataka. */
export const stateCode = z.string().regex(/^[0-9]{2}$/, "stateCode must be 2 digits");

/** Standard 15-character GSTIN with checksum digit (regex match only — full
 *  checksum validation deferred to Phase 3 e-invoicing). */
export const gstin = z
  .string()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/, "Invalid GSTIN format");

/** ISO date or datetime string. Parsed downstream via `istToUtc`. */
const isoDate = z.string().min(1);

// =====================================================================
// IDENTITY
// =====================================================================

export const UserInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200).optional(),
  role: z.nativeEnum(Role),
  phone: z.string().max(20).nullable().optional(),
});
export type UserInputT = z.infer<typeof UserInput>;

export const UserUpdateInput = UserInput.partial().extend({
  active: z.boolean().optional(),
});

// =====================================================================
// CUSTOMER + CUSTOMER GROUP
// =====================================================================

export const CustomerInput = z.object({
  name: z.string().min(1).max(200),
  gstin: gstin.nullable().optional(),
  pan: z.string().max(20).nullable().optional(),
  billingAddress: z.string().min(1).max(500),
  shippingAddress: z.string().max(500).nullable().optional(),
  stateCode,
  contactName: z.string().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  // Phone is now mandatory per the Workflow doc — needed for
  // WhatsApp feedback and OTP delivery flows.
  phone: z
    .string()
    .min(7, "Phone number is required (min 7 digits)")
    .max(20),
  notes: z.string().max(2000).nullable().optional(),
  groupId: z.string().nullable().optional(),
  defaultTdsRatePct: decimalString.nullable().optional(),
  defaultTdsSection: z.string().max(20).nullable().optional(),
  // Optional "bill to" entity when the legal name on the invoice
  // differs from the customer's display name. Defaults to `name`.
  billingCompanyName: z.string().max(200).nullable().optional(),
  creditLimit: decimalString.optional(),
  // Duration in days (0 = cash). Drives approval routing on orders:
  // ≤15 → Manager; >15 → Admin (enforced server-side).
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentTerms: z.nativeEnum(VendorPaymentTerms).optional(),
});
export type CustomerInputT = z.infer<typeof CustomerInput>;

export const CustomerGroupInput = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().max(60).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});
export type CustomerGroupInputT = z.infer<typeof CustomerGroupInput>;

// =====================================================================
// INGREDIENT
// =====================================================================

export const IngredientInput = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  category: z.string().max(60).nullable().optional(),
  // Sub-store discriminator — drives the per-category requisition
  // approval rules from the Workflow doc matrix. See
  // IngredientSubStore enum in schema.prisma.
  subStore: z
    .enum(["VEGETABLE", "GROCERY", "MILK", "WATER", "OTHER"])
    .optional(),
  unit: z.string().min(1).max(20),
  openingQty: decimalString.optional(),
  openingAvgCost: decimalString.optional(),
  reorderLevel: decimalString.optional(),
  preferredVendorId: z.string().nullable().optional(),
  hsnSac: z.string().max(20).nullable().optional(),
  gstRatePct: decimalString.optional(),
});
export type IngredientInputT = z.infer<typeof IngredientInput>;

export const IngredientReceiptInput = z.object({
  ingredientId: z.string(),
  qty: decimalString,
  unitCost: decimalString,
  receivedAt: isoDate.optional(),
  supplier: z.string().max(200).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type IngredientReceiptInputT = z.infer<typeof IngredientReceiptInput>;

export const IngredientIssueInput = z.object({
  ingredientId: z.string(),
  // orderId is required on the schema — every issue ties to an Order.
  orderId: z.string(),
  qty: decimalString,
  note: z.string().max(500).nullable().optional(),
});
export type IngredientIssueInputT = z.infer<typeof IngredientIssueInput>;

// Admin/manager manual stock adjustment. Either set `newQty` (target the
// new on-hand absolute) or `delta` (signed change). One is required.
export const IngredientAdjustmentInput = z
  .object({
    ingredientId: z.string(),
    newQty: decimalString.optional(),
    delta: decimalString.optional(),
    reason: z.string().min(2).max(200),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.newQty !== undefined || v.delta !== undefined, {
    message: "Either newQty or delta is required",
    path: ["newQty"],
  });
export type IngredientAdjustmentInputT = z.infer<typeof IngredientAdjustmentInput>;

// =====================================================================
// DISH + RECIPE
// =====================================================================

export const DishInput = z.object({
  code: z.string().max(40).nullable().optional(),
  name: z.string().min(1).max(200),
  category: z.string().max(60).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  unitPrice: decimalString,
  unit: z.string().min(1).max(20).optional(),
  hsnSac: z.string().max(20).nullable().optional(),
  gstRatePct: decimalString.optional(),
});
export type DishInputT = z.infer<typeof DishInput>;

export const RecipeIngredientInput = z.object({
  id: z.string().optional(),
  ingredientId: z.string(),
  qty: decimalString,
  unit: z.string().min(1).max(20),
  wastagePercent: decimalString.optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type RecipeIngredientInputT = z.infer<typeof RecipeIngredientInput>;

export const RecipeInput = z.object({
  name: z.string().min(1).max(200).optional(),
  dishId: z.string().nullable().optional(),
  isSubRecipe: z.boolean().optional(),
  yieldQty: decimalString.optional(),
  yieldUnit: z.string().max(20).optional(),
  standardYieldPercent: decimalString.optional(),
  notes: z.string().max(1000).nullable().optional(),
  ingredients: z.array(RecipeIngredientInput).optional(),
});
export type RecipeInputT = z.infer<typeof RecipeInput>;

export const RecipeSubRecipeInput = z.object({
  parentId: z.string(),
  childId: z.string(),
  quantity: decimalString,
});

// =====================================================================
// QUOTE
// =====================================================================

export const QuoteLineInput = z.object({
  id: z.string().optional(),
  dishId: z.string().nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: decimalString,
  unit: z.string().min(1).max(20),
  unitPrice: decimalString,
  discountPct: decimalString.optional(),
  gstRatePct: decimalString.optional(),
  hsnSac: z.string().max(20).nullable().optional(),
});
export type QuoteLineInputT = z.infer<typeof QuoteLineInput>;

export const QuoteHeaderInput = z.object({
  customerId: z.string(),
  title: z.string().min(1).max(200),
  eventDate: isoDate.optional(),
  headcount: z.number().int().positive().optional(),
  mealType: z.nativeEnum(MealType).optional(),
  deliveryAddress: z.string().max(500).optional(),
  placeOfSupplyStateCode: stateCode,
  notes: z.string().max(2000).nullable().optional(),
  termsMd: z.string().max(10000).nullable().optional(),
  validUntil: isoDate.optional(),
});
export type QuoteHeaderInputT = z.infer<typeof QuoteHeaderInput>;

export const QuoteCreateInput = z.object({
  header: QuoteHeaderInput,
  lines: z.array(QuoteLineInput).min(1, "At least one line is required"),
});
export type QuoteCreateInputT = z.infer<typeof QuoteCreateInput>;

// =====================================================================
// ORDER
// =====================================================================

export const OrderItemInput = z.object({
  id: z.string().optional(),
  dishId: z.string(),
  portions: decimalString,
  unitPrice: decimalString,
  discountPct: decimalString.optional(),
  gstRatePct: decimalString.optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type OrderItemInputT = z.infer<typeof OrderItemInput>;

// Raw shape kept un-refined so OrderUpdateInput can call .partial() on
// it. The channel-conditional check applies only on create (where all
// fields are present); updates re-check via the same logic inside the
// server action when channel changes.
const orderCreateBase = z.object({
  // Optional — the immediate in-house channels (room service / à la carte /
  // management) are tracked by room/table, so a named customer isn't needed;
  // the server attaches the built-in "House / Walk-in" customer. Required for
  // pre-booked catering, enforced in the superRefine below.
  customerId: z.string().optional().nullable(),
  // Channel defaults to BANQUET to preserve old semantics for legacy
  // clients that don't send the field yet.
  channel: z.nativeEnum(OrderChannel).default(OrderChannel.BANQUET),
  // The next four are required for pre-booked catering (BANQUET / ODC /
  // PACKET) but NOT for the immediate in-house channels (room service /
  // à la carte / management) — those are served "now" to a room/table, so
  // event date, delivery address/window and place of supply don't apply.
  // Conditionally enforced in the superRefine below; the server fills
  // sensible defaults for immediate channels.
  eventDate: isoDate.optional(),
  headcount: z.number().int().positive(),
  mealType: z.nativeEnum(MealType),
  deliveryAddress: z.string().max(500).optional(),
  deliveryWindowStart: isoDate.optional(),
  deliveryWindowEnd: isoDate.optional(),
  placeOfSupplyStateCode: stateCode.optional(),
  // Required-IF-channel — enforced by the refinement on OrderCreateInput.
  roomNumber: z.string().max(40).nullable().optional(),
  tableNumber: z.string().max(40).nullable().optional(),
  // Lump-sum package price. Only honoured for ODC / PACKET channels —
  // those are bulk orders quoted as one package, so the operator types
  // the agreed total instead of the system summing per-dish rates.
  // Ignored (recomputed from line items) for all other channels.
  packageTotal: decimalString.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(OrderItemInput).min(1, "At least one item is required"),
});

// Immediate in-house channels — served now to a room/table, not pre-booked.
const IMMEDIATE_CHANNELS: OrderChannel[] = [
  OrderChannel.ROOM_SERVICE,
  OrderChannel.ALACARTE,
  OrderChannel.MANAGEMENT,
];

export const OrderCreateInput = orderCreateBase.superRefine((v, ctx) => {
  // Room service AND à la carte both require a room number — the guest is in
  // a room either way (dine-in is charged to the room folio).
  if (
    (v.channel === OrderChannel.ROOM_SERVICE || v.channel === OrderChannel.ALACARTE) &&
    !(v.roomNumber && v.roomNumber.trim().length > 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["roomNumber"],
      message: "Room service and à la carte orders require a room number",
    });
  }

  // Pre-booked catering needs an event date, delivery address and place of
  // supply. The immediate channels don't — the server defaults those.
  if (!IMMEDIATE_CHANNELS.includes(v.channel)) {
    if (!v.customerId || v.customerId.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerId"], message: "Customer is required" });
    }
    if (!v.eventDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eventDate"], message: "Event date is required" });
    }
    if (!v.deliveryAddress || v.deliveryAddress.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deliveryAddress"], message: "Delivery address is required" });
    }
    if (!v.placeOfSupplyStateCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["placeOfSupplyStateCode"], message: "Place of supply is required" });
    }
  }
});
export type OrderCreateInputT = z.infer<typeof OrderCreateInput>;

export const OrderUpdateInput = orderCreateBase.partial().extend({
  items: z.array(OrderItemInput).optional(),
});

/**
 * Mid-flight revision of a confirmed order (client changed pax). Only the
 * quantities move: headcount, per-existing-line portions (0 removes the
 * line), and — for package-priced channels — the renegotiated package
 * total. A note is mandatory so the kitchen knows why quantities changed.
 * Dishes/prices are NOT editable here (that's the chef's swap flow).
 */
export const OrderReviseInput = z.object({
  headcount: z.coerce.number().int().min(1, "Headcount must be at least 1"),
  items: z
    .array(
      z.object({
        // Existing OrderItem id — the action verifies it belongs to the order.
        id: z.string().min(1),
        portions: z.coerce
          .number()
          .int("Portions must be a whole number")
          .min(0, "Portions can't be negative"),
      }),
    )
    .min(1, "At least one line is required"),
  // Honoured only for package-priced channels (banquet / buffet / ODC /
  // packet) — ignored otherwise, same as OrderCreateInput.
  packageTotal: decimalString.nullable().optional(),
  revisionNote: z.string().trim().min(1, "A revision note is required").max(2000),
});
export type OrderReviseInputT = z.infer<typeof OrderReviseInput>;

export const OrderStoreApprovalInput = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().min(1, "Store approval note is required").max(2000),
});
export type OrderStoreApprovalInputT = z.infer<typeof OrderStoreApprovalInput>;

export const OrderManagerApprovalInput = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().max(2000).optional(),
});
export type OrderManagerApprovalInputT = z.infer<typeof OrderManagerApprovalInput>;

export const OrderManagerOverrideInput = z.object({
  reason: z.string().min(1, "Override reason is required").max(2000),
});
export type OrderManagerOverrideInputT = z.infer<typeof OrderManagerOverrideInput>;

// =====================================================================
// CHEF REQUISITION
// =====================================================================

export const ChefRequisitionLineInput = z.object({
  id: z.string().optional(),
  ingredientId: z.string(),
  orderItemId: z.string().nullable().optional(),
  requestedQty: decimalString,
  unit: z.string().max(20).optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type ChefRequisitionLineInputT = z.infer<typeof ChefRequisitionLineInput>;

export const ChefRequisitionCreateInput = z.object({
  orderId: z.string(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(ChefRequisitionLineInput).optional(),
});

// Standalone (order-less) stock request the chef raises for the kitchen —
// not tied to any order. At least one line required.
export const ChefRequisitionStandaloneInput = z.object({
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(ChefRequisitionLineInput).min(1),
});
export type ChefRequisitionStandaloneInputT = z.infer<typeof ChefRequisitionStandaloneInput>;

export const ChefRequisitionIssueInput = z.object({
  lineId: z.string(),
  qtyToIssue: decimalString,
});

export const ChefRequisitionSendToProcurementInput = z.object({
  lineId: z.string(),
  reason: z.string().min(1, "Reason is required").max(500),
});

// =====================================================================
// PRODUCTION
// =====================================================================

export const ProductionJobItemAssignInput = z.object({
  itemId: z.string(),
  chefUserId: z.string(),
});

// =====================================================================
// DELIVERY
// =====================================================================

export const DeliveryAssignInput = z.object({
  orderId: z.string(),
  driverUserId: z.string(),
  vehicleNo: z.string().max(40).nullable().optional(),
  scheduledAt: isoDate,
});

export const DeliveryOTPInput = z.object({
  // OTP is now optional. We dropped the customer-readback step — the
  // driver just confirms delivery directly. The schema still accepts an
  // OTP for backwards-compatible payloads, but it is no longer required.
  otp: z.string().regex(/^[0-9]{4}$/, "OTP must be 4 digits").optional(),
  // Payment-on-delivery: driver records whether they collected payment
  // at the door. When `paymentCollected` is true, the other fields are
  // required and a CustomerInvoicePayment row is auto-recorded against
  // the auto-created tax invoice for the order.
  paymentCollected: z.boolean().optional(),
  paymentAmount: decimalString.optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  paymentReference: z.string().max(120).optional(),
});

export const DeliveryFailureInput = z.object({
  reason: z.string().min(1).max(500),
});

// =====================================================================
// CUSTOMER INVOICE
// =====================================================================

export const CustomerInvoiceLineInput = z.object({
  id: z.string().optional(),
  description: z.string().min(1).max(500),
  hsnSac: z.string().max(20).nullable().optional(),
  qty: decimalString,
  unitPrice: decimalString,
  discountPct: decimalString.optional(),
  gstRatePct: decimalString.optional(),
});

export const CustomerInvoiceInput = z.object({
  customerId: z.string(),
  orderId: z.string().nullable().optional(),
  kind: z.nativeEnum(CustomerInvoiceKind).optional(),
  invoiceDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  placeOfSupplyStateCode: stateCode,
  notes: z.string().max(2000).nullable().optional(),
  terms: z.string().max(2000).nullable().optional(),
  lines: z.array(CustomerInvoiceLineInput).min(1),
});

// =====================================================================
// PAYMENT
// =====================================================================

export const CustomerInvoicePaymentInput = z.object({
  invoiceId: z.string(),
  amount: decimalString,
  method: z.nativeEnum(PaymentMethod),
  paidAt: isoDate.optional(),
  reference: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const VendorBillPaymentInput = z.object({
  billId: z.string(),
  amount: decimalString,
  method: z.nativeEnum(PaymentMethod),
  paidAt: isoDate.optional(),
  reference: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const PaymentReversalInput = z.object({
  paymentId: z.string(),
  reason: z.string().min(1).max(500),
});

// =====================================================================
// PROCUREMENT (Phase 2)
// =====================================================================

export const VendorInput = z.object({
  name: z.string().min(1).max(200),
  gstin: gstin.nullable().optional(),
  pan: z.string().max(20).nullable().optional(),
  stateCode,
  category: z.string().max(40).optional(),
  msme: z.boolean().optional(),
  contactName: z.string().max(120).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  paymentTerms: z.string().max(40).optional(),
  creditLimit: decimalString.optional(),
  notes: z.string().max(2000).nullable().optional(),
  defaultTdsRatePct: decimalString.nullable().optional(),
  defaultTdsSection: z.string().max(20).nullable().optional(),
});
export type VendorInputT = z.infer<typeof VendorInput>;

export const VendorPOLineInput = z.object({
  id: z.string().optional(),
  ingredientId: z.string().nullable().optional(),
  sku: z.string().min(1, "Each line needs an SKU / item name").max(40),
  description: z.string().min(1).max(500),
  unit: z.string().min(1).max(20),
  quantity: decimalString,
  unitPrice: decimalString,
  gstRatePct: decimalString.optional(),
});
export type VendorPOLineInputT = z.infer<typeof VendorPOLineInput>;

export const VendorPOCreateInput = z.object({
  vendorId: z.string(),
  orderId: z.string().nullable().optional(),
  procurementType: z.enum(["STANDARD", "LOCAL", "ONLINE"]).optional(),
  placeOfSupplyStateCode: stateCode,
  expectedDate: isoDate.optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(VendorPOLineInput).min(1),
});
export type VendorPOCreateInputT = z.infer<typeof VendorPOCreateInput>;

export const GRNLineInput = z.object({
  poLineId: z.string(),
  acceptedQty: decimalString,
  rejectedQty: decimalString.optional(),
  reason: z.string().max(500).nullable().optional(),
});
export type GRNLineInputT = z.infer<typeof GRNLineInput>;

export const GRNCreateInput = z.object({
  poId: z.string(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(GRNLineInput).min(1),
});
export type GRNCreateInputT = z.infer<typeof GRNCreateInput>;

export const VendorBillLineInput = z.object({
  id: z.string().optional(),
  description: z.string().min(1).max(500),
  quantity: decimalString,
  unit: z.string().min(1).max(20),
  unitPrice: decimalString,
  gstRatePct: decimalString.optional(),
});
export type VendorBillLineInputT = z.infer<typeof VendorBillLineInput>;

export const VendorBillCreateInput = z.object({
  vendorId: z.string(),
  poId: z.string().nullable().optional(),
  vendorBillNo: z.string().max(60).nullable().optional(),
  issueDate: isoDate.optional(),
  dueDate: isoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(VendorBillLineInput).min(1),
});
export type VendorBillCreateInputT = z.infer<typeof VendorBillCreateInput>;

// Editing an existing bill: vendor + PO linkage are fixed at creation
// (changing them would orphan the 3-way-match context); everything else
// is a full replace.
export const VendorBillUpdateInput = VendorBillCreateInput.omit({
  vendorId: true,
  poId: true,
});
export type VendorBillUpdateInputT = z.infer<typeof VendorBillUpdateInput>;

export const InventoryAuditLineInput = z.object({
  ingredientId: z.string(),
  physicalCount: decimalString,
});
export type InventoryAuditLineInputT = z.infer<typeof InventoryAuditLineInput>;

export const InventoryAuditPostInput = z.object({
  lines: z.array(InventoryAuditLineInput).min(1),
  notes: z.string().max(500).nullable().optional(),
});

// =====================================================================
// FINANCE (Phase 3): petty cash + salary
// =====================================================================

export const PettyCashFloatInput = z.object({
  custodianId: z.string(),
  name: z.string().min(1).max(120),
  openingBalance: decimalString,
});

export const PettyCashVoucherInput = z.object({
  floatId: z.string(),
  amount: decimalString,
  category: z.string().min(1).max(40),
  paidTo: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  paidAt: isoDate.optional(),
});

/** Edit of an existing voucher — floatId is immutable, everything the
 *  operator typed is editable. Same field rules as PettyCashVoucherInput;
 *  paidAt is required because the edit form always sends it prefilled. */
export const PettyCashVoucherUpdateInput = z.object({
  amount: decimalString,
  category: z.string().min(1).max(40),
  paidTo: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  paidAt: isoDate,
});

export const PettyCashTopUpInput = z.object({
  floatId: z.string(),
  amount: decimalString,
  source: z.string().min(1).max(40),
  reference: z.string().max(120).nullable().optional(),
});

export const SalaryStructureInput = z.object({
  employeeId: z.string(),
  type: z.enum(["HOURLY", "SALARIED"]),
  hourlyRate: decimalString.nullable().optional(),
  monthlySalary: decimalString.nullable().optional(),
  effectiveFrom: isoDate,
  notes: z.string().max(500).nullable().optional(),
});

export const SalaryRunCreateInput = z.object({
  periodMonth: isoDate,
});

// =====================================================================
// TASK ASSIGNMENT
// =====================================================================

export const TaskTemplateInput = z.object({
  id: z.string().optional(),
  title: z.string().min(2).max(160),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export const TaskAssignInput = z.object({
  assignedToId: z.string().min(1, "Pick an assignee"),
  title: z.string().min(2, "Title is required").max(160),
  description: z.string().max(4000).nullable().optional(),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.NORMAL),
  targetDate: isoDate,
  templateId: z.string().nullable().optional(),
});

export const TaskUpdateInput = z.object({
  id: z.string().min(1),
  title: z.string().min(2).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  targetDate: isoDate.optional(),
  assignedToId: z.string().min(1).optional(),
});

export const TaskSubmitInput = z.object({
  id: z.string().min(1),
  // Mandatory — short enough to enforce a real note, long enough for context.
  completionRemarks: z.string().trim().min(3, "Remarks are required").max(4000),
  completedAt: isoDate.optional(),
});

export const TaskReviewInput = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  // Required when rejecting.
  rejectionReason: z.string().max(1000).optional(),
});

export const TaskCancelInput = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

// =====================================================================
// HOUSEKEEPING
// =====================================================================

export const RoomInput = z.object({
  number: z.string().min(1).max(40),
  name: z.string().max(120).nullable().optional(),
  type: z.nativeEnum(RoomType).default(RoomType.STANDARD),
  floor: z.string().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

export const HousekeepingStaffInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export const HousekeepingItemInput = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().max(60).nullable().optional(),
  unit: z.string().min(1).max(20).default("piece"),
  // Reusable (towels / linens) vs consumable (soap / tissue). Reusable items
  // are issued, washed, and returned to stock rather than used up.
  reusable: z.boolean().optional(),
  minStock: decimalString.nullable().optional(),
  // Opening balance — applied only on CREATE. Server records an internal
  // "Opening balance" receipt for the audit trail and bumps currentStock.
  // Ignored on UPDATE (use the regular receipt flow to correct stock).
  openingStock: decimalString.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const ReceiptLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
  costPerUnit: decimalString.nullable().optional(),
});

export const HousekeepingReceiptInput = z.object({
  receivedAt: isoDate,
  sourceNote: z.string().max(500).nullable().optional(),
  sourceContact: z.string().max(160).nullable().optional(),
  lines: z.array(ReceiptLineInput).min(1, "Add at least one line"),
});

const IssueLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
});

export const HousekeepingIssueInput = z.object({
  issuedAt: isoDate,
  staffId: z.string().min(1, "Pick a staff member"),
  roomId: z.string().min(1, "Pick a room"),
  purpose: z.string().max(200).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  lines: z.array(IssueLineInput).min(1, "Add at least one item"),
});

// =====================================================================
// MAINTENANCE
// =====================================================================

export const MaintenanceStaffInput = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().max(20).nullable().optional(),
  category: z.nativeEnum(MaintenanceCategory).default(MaintenanceCategory.GENERAL),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export const MaintenanceItemInput = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().max(60).nullable().optional(),
  unit: z.string().min(1).max(20).default("piece"),
  category: z.nativeEnum(MaintenanceCategory).default(MaintenanceCategory.GENERAL),
  minStock: decimalString.nullable().optional(),
  openingStock: decimalString.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const MaintReceiptLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
  costPerUnit: decimalString.nullable().optional(),
});

export const MaintenanceReceiptInput = z.object({
  receivedAt: isoDate,
  sourceNote: z.string().max(500).nullable().optional(),
  sourceContact: z.string().max(160).nullable().optional(),
  lines: z.array(MaintReceiptLineInput).min(1, "Add at least one line"),
});

const MaintActivityLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
});

export const MaintenanceActivityInput = z.object({
  performedAt: isoDate,
  staffId: z.string().min(1, "Pick a staff member"),
  roomId: z.string().min(1, "Pick a room"),
  category: z.nativeEnum(MaintenanceCategory),
  status: z.nativeEnum(MaintenanceActivityStatus).default(MaintenanceActivityStatus.COMPLETED),
  issueReported: z.string().min(2, "Describe the issue").max(500),
  workDone: z.string().max(1000).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Items consumed are optional — many activities are pure labour.
  lines: z.array(MaintActivityLineInput).optional().default([]),
});

// =====================================================================
// BANQUET STORE (F&B service-side packaging)
// =====================================================================

export const BanquetItemInput = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().max(60).nullable().optional(),
  category: z.string().max(60).nullable().optional(),
  unit: z.string().min(1).max(20).default("piece"),
  minStock: decimalString.nullable().optional(),
  openingStock: decimalString.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const BanquetReceiptLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
  costPerUnit: decimalString.nullable().optional(),
});

export const BanquetReceiptInput = z.object({
  receivedAt: isoDate,
  sourceNote: z.string().max(500).nullable().optional(),
  sourceContact: z.string().max(160).nullable().optional(),
  lines: z.array(BanquetReceiptLineInput).min(1, "Add at least one line"),
});

const BanquetIssueLineInput = z.object({
  itemId: z.string().min(1),
  quantity: decimalString,
});

export const BanquetIssueInput = z.object({
  issuedAt: isoDate,
  purpose: z.string().min(2, "Describe the purpose").max(200),
  orderId: z.string().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  lines: z.array(BanquetIssueLineInput).min(1, "Add at least one item"),
});

export const BanquetReturnInput = z.object({
  returnedAt: isoDate,
  orderId: z.string().min(1),
  notes: z.string().max(500).nullable().optional(),
  lines: z.array(BanquetIssueLineInput).min(1, "Add at least one item"),
});

// F&B service raises a Banquet Requisition against banquet-store stock;
// the store keeper fulfils it line by line. Mirrors ChefRequisition* but
// against BanquetItem instead of Ingredient. At least one line required.
const BanquetRequisitionLineInput = z.object({
  itemId: z.string().min(1),
  requestedQty: decimalString,
});

export const BanquetRequisitionInput = z.object({
  orderId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(BanquetRequisitionLineInput).min(1, "Add at least one item"),
});
export type BanquetRequisitionInputT = z.infer<typeof BanquetRequisitionInput>;

// Store keeper issues one requisition line (full or partial).
export const BanquetRequisitionIssueInput = z.object({
  requisitionLineId: z.string().min(1),
  issueQty: decimalString,
});

// Store keeper flags a short line for a purchase order.
export const BanquetRequisitionAwaitingInput = z.object({
  requisitionLineId: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

// Bulk stock count — same shape as the kitchen's InventoryAuditPostInput:
// each line sets an item's on-hand to the physically counted quantity.
export const BanquetStockCountLineInput = z.object({
  itemId: z.string().min(1),
  countedQty: decimalString,
});
export type BanquetStockCountLineInputT = z.infer<typeof BanquetStockCountLineInput>;

export const BanquetStockCountInput = z.object({
  lines: z.array(BanquetStockCountLineInput).min(1, "Count at least one item"),
  notes: z.string().max(500).nullable().optional(),
});

// =====================================================================
// SETTINGS
// =====================================================================

export const SettingUpdateInput = z.object({
  key: z.string().min(1).max(80),
  value: z.unknown(),
});

// Re-export enums for callers that want to discriminate without importing
// twice. Keeps consumer imports clean.
export {
  ApprovalDecision,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  CustomerInvoiceStatus,
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  ProductionJobStatus,
  QuoteStatus,
  Role,
  TaskPriority,
  TaskStatus,
};
