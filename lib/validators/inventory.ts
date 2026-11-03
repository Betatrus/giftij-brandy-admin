import { z } from "zod";

export const STOCK_CHANGE_TYPES = [
  "INCREASE",
  "DECREASE",
  "ADJUST",
  "DAMAGE",
  "RETURN",
] as const;

export const ADJUSTMENT_REASON_TYPES = [
  "RESTOCK",
  "OFFLINE_SALE",
  "CORRECTION",
  "DAMAGED",
  "CUSTOMER_RETURN",
] as const;

export type AdjustmentReasonType =
  (typeof ADJUSTMENT_REASON_TYPES)[number];

const businessDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "Please enter a valid date.",
  );

function reasonMatchesChangeType(data: {
  changeType: (typeof STOCK_CHANGE_TYPES)[number];
  adjustmentReason: AdjustmentReasonType;
}) {
  switch (data.changeType) {
    case "INCREASE":
      return data.adjustmentReason === "RESTOCK";

    case "DECREASE":
      return (
        data.adjustmentReason === "OFFLINE_SALE" ||
        data.adjustmentReason === "CORRECTION"
      );

    case "ADJUST":
      return data.adjustmentReason === "CORRECTION";

    case "DAMAGE":
      return data.adjustmentReason === "DAMAGED";

    case "RETURN":
      return data.adjustmentReason === "CUSTOMER_RETURN";

    default:
      return false;
  }
}

const commonAdjustmentFields = {
  changeType: z.enum(STOCK_CHANGE_TYPES),

  quantity: z.coerce
    .number()
    .int()
    .min(1, "Quantity must be at least 1"),

  adjustmentReason: z.enum(
    ADJUSTMENT_REASON_TYPES,
  ),

  businessDate: businessDateSchema,

  unitSellingPrice: z.coerce
    .number()
    .min(0)
    .optional(),

  reason: z
    .string()
    .max(500)
    .optional(),
};

export const adjustStockSchema = z
  .object({
    productId: z.string().min(1),
    ...commonAdjustmentFields,
  })
  .refine((data) => data.adjustmentReason !== "CUSTOMER_RETURN", { message: "Customer returns must be recorded against the original order item.", path: ["adjustmentReason"] })
  .refine(reasonMatchesChangeType, {
    message:
      "The selected reason does not match this stock action.",
    path: ["adjustmentReason"],
  })
  .refine(
    (data) =>
      data.adjustmentReason !==
        "OFFLINE_SALE" ||
      data.unitSellingPrice !== undefined,
    {
      message:
        "Enter the price this item actually sold for.",
      path: ["unitSellingPrice"],
    },
  )
  .refine(
    (data) =>
      data.adjustmentReason ===
        "OFFLINE_SALE" ||
      data.unitSellingPrice === undefined,
    {
      message:
        "Selling price is only allowed for an offline sale.",
      path: ["unitSellingPrice"],
    },
  );

export type AdjustStockInput =
  z.infer<typeof adjustStockSchema>;

export const adjustVariantStockSchema = z
  .object({
    variantId: z.string().min(1),
    ...commonAdjustmentFields,
  })
  .refine((data) => data.adjustmentReason !== "CUSTOMER_RETURN", { message: "Customer returns must be recorded against the original order item.", path: ["adjustmentReason"] })
  .refine(reasonMatchesChangeType, {
    message:
      "The selected reason does not match this stock action.",
    path: ["adjustmentReason"],
  })
  .refine(
    (data) =>
      data.adjustmentReason !==
        "OFFLINE_SALE" ||
      data.unitSellingPrice !== undefined,
    {
      message:
        "Enter the price this item actually sold for.",
      path: ["unitSellingPrice"],
    },
  )
  .refine(
    (data) =>
      data.adjustmentReason ===
        "OFFLINE_SALE" ||
      data.unitSellingPrice === undefined,
    {
      message:
        "Selling price is only allowed for an offline sale.",
      path: ["unitSellingPrice"],
    },
  );

export type AdjustVariantStockInput =
  z.infer<
    typeof adjustVariantStockSchema
  >;

const bulkAdjustmentLineSchema = z
  .object({
    productId: z.string().min(1),
    ...commonAdjustmentFields,
  })
  .refine((data) => data.adjustmentReason !== "CUSTOMER_RETURN", { message: "Customer returns must be recorded against the original order item.", path: ["adjustmentReason"] })
  .refine(reasonMatchesChangeType, {
    message:
      "The selected reason does not match this stock action.",
    path: ["adjustmentReason"],
  })
  .refine(
    (data) =>
      data.adjustmentReason !==
        "OFFLINE_SALE" ||
      data.unitSellingPrice !== undefined,
    {
      message:
        "Enter the price this item actually sold for.",
      path: ["unitSellingPrice"],
    },
  );

export const bulkAdjustStockSchema =
  z.object({
    adjustments: z
      .array(bulkAdjustmentLineSchema)
      .min(1),
  });

export type BulkAdjustStockInput =
  z.infer<typeof bulkAdjustStockSchema>;

export const recordCustomerReturnSchema = z.object({
  orderItemId: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  restockQuantity: z.coerce.number().int().min(0),
  refundHandled: z.literal(true, { errorMap: () => ({ message: "Confirm that the refund has already been handled." }) }),
  refundAmount: z.coerce.number().min(0).optional(),
  businessDate: businessDateSchema,
  note: z.string().max(1000).optional(),
}).refine((data) => data.restockQuantity <= data.quantity, {
  message: "Restock quantity cannot exceed the quantity returned.",
  path: ["restockQuantity"],
});

export type RecordCustomerReturnInput = z.infer<typeof recordCustomerReturnSchema>;
