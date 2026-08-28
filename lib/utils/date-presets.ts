export const DATE_PRESETS = ["TODAY", "7D", "30D", "3M", "12M", "CUSTOM"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  TODAY: "Today",
  "7D": "Last 7 days",
  "30D": "Last 30 days",
  "3M": "Last 3 months",
  "12M": "Last 12 months",
  CUSTOM: "Custom",
};

/** Resolves a preset into a concrete [from, to] range, `to` always being "now." CUSTOM defers entirely to the explicit dates the caller supplies. */
export function resolveDatePreset(preset: DatePreset, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const to = customTo ? new Date(customTo) : new Date();

  if (preset === "CUSTOM") {
    return { from: customFrom ? new Date(customFrom) : new Date(0), to };
  }

  const from = new Date(to);
  switch (preset) {
    case "TODAY":
      from.setHours(0, 0, 0, 0);
      break;
    case "7D":
      from.setDate(from.getDate() - 7);
      break;
    case "30D":
      from.setDate(from.getDate() - 30);
      break;
    case "3M":
      from.setMonth(from.getMonth() - 3);
      break;
    case "12M":
      from.setMonth(from.getMonth() - 12);
      break;
  }
  return { from, to };
}
