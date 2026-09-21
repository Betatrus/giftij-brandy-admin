import type { AdjustmentReasonType } from "@/lib/validators/inventory";

export type ParsedAdjustmentReason = {
  type:
    | AdjustmentReasonType
    | "ONLINE_SALE"
    | null;

  note: string | null;

  unitSellingPrice: number | null;

  originalPrice: number | null;

  discountAmount: number | null;

  businessDate: string | null;
};

export function formatAdjustmentReason(
  adjustmentReason:
    | AdjustmentReasonType
    | undefined,
  note: string | undefined,
  unitSellingPrice?: number,
  originalPrice?: number,
  businessDate?: string,
) {
  const trimmedNote =
    note?.trim();

  if (!adjustmentReason) {
    return trimmedNote || undefined;
  }

  let priceTag = "";

  if (
    adjustmentReason ===
      "OFFLINE_SALE" &&
    unitSellingPrice !== undefined
  ) {
    priceTag =
      originalPrice !== undefined
        ? `:${unitSellingPrice.toFixed(
            2,
          )}:${originalPrice.toFixed(2)}`
        : `:${unitSellingPrice.toFixed(
            2,
          )}`;
  }

  const classification =
    `[${adjustmentReason}${priceTag}]`;

  const dateTag =
    businessDate
      ? `[DATE:${businessDate}]`
      : "";

  return [
    classification,
    dateTag,
    trimmedNote,
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseAdjustmentReason(
  reason: string | null,
): ParsedAdjustmentReason {
  if (!reason) {
    return {
      type: null,
      note: null,
      unitSellingPrice: null,
      originalPrice: null,
      discountAmount: null,
      businessDate: null,
    };
  }

  const classificationMatch =
    reason.match(
      /^\[(RESTOCK|OFFLINE_SALE|ONLINE_SALE|CORRECTION|DAMAGED|CUSTOMER_RETURN)(?::([\d.]+)(?::([\d.]+))?)?\]\s*(.*)$/,
    );

  if (!classificationMatch) {
    return {
      type: null,
      note: reason,
      unitSellingPrice: null,
      originalPrice: null,
      discountAmount: null,
      businessDate: null,
    };
  }

  const unitSellingPrice =
    classificationMatch[2] !==
    undefined
      ? Number(
          classificationMatch[2],
        )
      : null;

  const originalPrice =
    classificationMatch[3] !==
    undefined
      ? Number(
          classificationMatch[3],
        )
      : null;

  let remainder =
    classificationMatch[4] ?? "";

  let businessDate:
    | string
    | null = null;

  const dateMatch =
    remainder.match(
      /^\[DATE:(\d{4}-\d{2}-\d{2})\]\s*(.*)$/,
    );

  if (dateMatch) {
    businessDate =
      dateMatch[1];

    remainder =
      dateMatch[2] ?? "";
  }

  return {
    type:
      classificationMatch[1] as
        | AdjustmentReasonType
        | "ONLINE_SALE",

    note:
      remainder.trim() || null,

    unitSellingPrice,

    originalPrice,

    discountAmount:
      unitSellingPrice !== null &&
      originalPrice !== null
        ? Math.round(
            (originalPrice -
              unitSellingPrice) *
              100,
          ) / 100
        : null,

    businessDate,
  };
}