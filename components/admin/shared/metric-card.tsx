import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";

type MetricCardProps = {
  label: string;
  value: string | number;
  href?: string;
  helper?: string;
  changePercent?: number | null;
  warning?: boolean;
  prominent?: boolean;
};

function MetricContent({
  label,
  value,
  helper,
  changePercent,
  warning = false,
}: Pick<
  MetricCardProps,
  | "label"
  | "value"
  | "helper"
  | "changePercent"
  | "warning"
>) {
  const hasComparison = changePercent !== undefined;

  const isPositive =
    typeof changePercent === "number" &&
    changePercent >= 0;

  return (
    <>
      <p className="font-body text-[11px] font-medium uppercase tracking-[0.12em] text-ink/45">
        {label}
      </p>

      <p
        className={`mt-3 font-body text-[28px] font-medium leading-none tracking-tight tabular-nums sm:text-[30px] ${
          warning
            ? "text-amber-700"
            : "text-ink"
        }`}
      >
        {value}
      </p>

      {helper && (
        <p className="mt-2 font-body text-xs leading-5 text-ink/45">
          {helper}
        </p>
      )}

      {hasComparison &&
        (changePercent === null ? (
          <p className="mt-3 font-body text-[11px] text-ink/35">
            No comparison available
          </p>
        ) : (
          <div
            className={`mt-3 flex items-center gap-1 font-body text-[11px] font-medium ${
              isPositive
                ? "text-emerald-700"
                : "text-red-600"
            }`}
          >
            {isPositive ? (
              <ArrowUpRight
                size={13}
                strokeWidth={1.8}
              />
            ) : (
              <ArrowDownRight
                size={13}
                strokeWidth={1.8}
              />
            )}

            <span className="tabular-nums">
              {Math.abs(
                changePercent,
              ).toLocaleString("en-NG", {
                maximumFractionDigits: 1,
              })}
              %
            </span>

            <span className="font-normal text-ink/35">
              vs yesterday
            </span>
          </div>
        ))}
    </>
  );
}

export function MetricCard({
  label,
  value,
  href,
  helper,
  changePercent,
  warning = false,
  prominent = false,
}: MetricCardProps) {
  const className = [
    "group relative min-w-0 overflow-hidden bg-white",
    "border border-cream/90",
    "rounded-2xl",
    prominent ? "p-5 sm:p-6" : "p-5",
    "transition duration-200",
    href
      ? "hover:border-champagne hover:shadow-soft"
      : "",
    warning
      ? "border-amber-200 bg-amber-50/30"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <MetricContent
      label={label}
      value={value}
      helper={helper}
      changePercent={changePercent}
      warning={warning}
    />
  );

  if (href) {
    return (
      <Link
        href={href}
        className={className}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}