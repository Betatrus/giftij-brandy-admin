import { z } from "zod";
import { DATE_PRESETS } from "@/lib/utils/date-presets";

export const analyticsFiltersSchema = z.object({
  preset: z.enum(DATE_PRESETS).default("30D"),
  dateFrom: z.string().optional(), // only meaningful when preset === "CUSTOM"
  dateTo: z.string().optional(),
  categoryId: z.string().optional(),
  saleSource: z.enum(["ONLINE", "OFFLINE"]).optional(), // undefined = both, per §34 "ALL or filtered"
});

export type AnalyticsFiltersInput = z.infer<typeof analyticsFiltersSchema>;
