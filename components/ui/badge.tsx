const STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  DRAFT: "bg-cream text-ink/60",
  ARCHIVED: "bg-ink/10 text-ink/50",
  LOW_STOCK: "bg-amber-100 text-amber-700",
  OUT_OF_STOCK: "bg-red-100 text-red-700",
};

export function Badge({ label, tone = "DRAFT" }: { label: string; tone?: keyof typeof STYLES }) {
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-full text-xs font-body font-medium ${
        STYLES[tone] ?? STYLES.DRAFT
      }`}
    >
      {label}
    </span>
  );
}
