import { z } from "zod";
import {
  ApprovalDecision,
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  CustomerInvoiceKind,
  CustomerInvoiceStatus,
  DeliveryStatus,
  MealType,
  OrderStatus,
  PaymentMethod,
  ProductionJobStatus,
  QuoteStatus,
  Role,
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
  phone: z.string().max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  groupId: z.string().nullable().optional(),
  defaultTdsRatePct: decimalString.nullable().optional(),
  defaultTdsSection: z.string().max(20).nullable().optional(),
  creditLimit: decimalString.optional(),
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
  portions: decimalString,
  unitPrice: decimalString,
  discountPct: decimalString.optional(),
  gstRatePct: decimalString.optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type QuoteLineInputT = z.infer<typeof QuoteLineInput>;

export const QuoteHeaderInput = z.object({
  customerId: z.string(),
  eventDate: isoDate,
  headcount: z.number().int().positive(),
  mealType: z.nativeEnum(MealType),
  deliveryAddress: z.string().min(1).max(500),
  deliveryWindowStart: isoDate,
  deliveryWindowEnd: isoDate,
  placeOfSupplyStateCode: stateCode,
  notes: z.string().max(2000).nullable().optional(),
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

export const OrderCreateInput = z.object({
  customerId: z.string(),
  eventDate: isoDate,
  headcount: z.number().int().positive(),
  mealType: z.nativeEnum(MealType),
  deliveryAddress: z.string().min(1).max(500),
  deliveryWindowStart: isoDate,
  deliveryWindowEnd: isoDate,
  placeOfSupplyStateCode: stateCode,
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(OrderItemInput).min(1, "At least one item is required"),
});
export type OrderCreateInputT = z.infer<typeof OrderCreateInput>;

export const OrderUpdateInput = OrderCreateInput.partial().extend({
  items: z.array(OrderItemInput).optional(),
});

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
  otp: z.string().regex(/^[0-9]{4}$/, "OTP must be 4 digits"),
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
};
