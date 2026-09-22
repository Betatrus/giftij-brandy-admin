"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getAnalyticsOverview } from "@/lib/actions/analytics";

import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type DatePreset,
} from "@/lib/utils/date-presets";

import { CategoryFilterTabs } from "@/components/admin/shared/category-filter-tabs";
import { MetricCard } from "@/components/admin/shared/metric-card";
import { formatNaira } from "@/lib/utils/format-money";

type CategoryOption = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
};

type Overview = Awaited<
  ReturnType<
    typeof getAnalyticsOverview
  >
>;

export function AnalyticsDashboard({
  categories,
}: {
  categories: CategoryOption[];
}) {
  const [
    preset,
    setPreset,
  ] =
    useState<DatePreset>(
      "30D",
    );

  const [
    customFrom,
    setCustomFrom,
  ] = useState("");

  const [
    customTo,
    setCustomTo,
  ] = useState("");

  const [
    categoryId,
    setCategoryId,
  ] = useState("");

  const [
    saleSource,
    setSaleSource,
  ] = useState("");

  const [
    data,
    setData,
  ] =
    useState<Overview | null>(
      null,
    );

  const [
    loading,
    setLoading,
  ] = useState(true);

  async function load() {
    setLoading(true);

    try {
      const result =
        await getAnalyticsOverview(
          {
            preset,

            dateFrom:
              preset ===
              "CUSTOM"
                ? customFrom ||
                  undefined
                : undefined,

            dateTo:
              preset ===
              "CUSTOM"
                ? customTo ||
                  undefined
                : undefined,

            categoryId:
              categoryId ||
              undefined,

            saleSource:
              (saleSource ||
                undefined) as
                | "ONLINE"
                | "OFFLINE"
                | undefined,
          },
        );

      setData(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preset,
    customFrom,
    customTo,
    categoryId,
    saleSource,
  ]);

  return (
    <div>
      <div className="mb-7 space-y-4">
        <CategoryFilterTabs
          categories={
            categories
          }
          value={categoryId}
          onChange={
            setCategoryId
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() =>
                    setPreset(
                      item,
                    )
                  }
                  className={`rounded-lg border px-3 py-2 font-body text-xs font-medium transition-colors ${
                    preset ===
                    item
                      ? "border-gold bg-gold text-white"
                      : "border-cream bg-white text-ink/55 hover:border-champagne hover:text-ink"
                  }`}
                >
                  {
                    DATE_PRESET_LABELS[
                      item
                    ]
                  }
                </button>
              ),
            )}
          </div>

          {preset ===
            "CUSTOM" && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={
                  customFrom
                }
                onChange={(
                  event,
                ) =>
                  setCustomFrom(
                    event
                      .target
                      .value,
                  )
                }
                className="rounded-lg border border-cream bg-white px-3 py-2 font-body text-xs text-ink outline-none focus:border-gold"
              />

              <span className="font-body text-xs text-ink/40">
                to
              </span>

              <input
                type="date"
                value={
                  customTo
                }
                onChange={(
                  event,
                ) =>
                  setCustomTo(
                    event
                      .target
                      .value,
                  )
                }
                className="rounded-lg border border-cream bg-white px-3 py-2 font-body text-xs text-ink outline-none focus:border-gold"
              />
            </div>
          )}

          <select
            value={
              saleSource
            }
            onChange={(
              event,
            ) =>
              setSaleSource(
                event.target
                  .value,
              )
            }
            className="rounded-lg border border-cream bg-white px-3 py-2 font-body text-xs text-ink outline-none focus:border-gold"
          >
            <option value="">
              All sales
            </option>

            <option value="ONLINE">
              Online only
            </option>

            <option value="OFFLINE">
              Offline only
            </option>
          </select>
        </div>
      </div>

      {loading ||
      !data ? (
        <div className="flex min-h-40 items-center justify-center">
          <p className="font-body text-sm text-ink/40">
            Loading
            analytics...
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {data
            .unknownRevenueCount >
            0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="font-body text-xs leading-5 text-amber-800">
                {
                  data.unknownRevenueCount
                }{" "}
                offline sale
                {data.unknownRevenueCount ===
                1
                  ? ""
                  : "s"}{" "}
                in this range{" "}
                {data.unknownRevenueCount ===
                1
                  ? "has"
                  : "have"}{" "}
                no recorded
                selling price
                and{" "}
                {data.unknownRevenueCount ===
                1
                  ? "is"
                  : "are"}{" "}
                excluded from
                revenue and
                profit figures.
                Units sold and
                Best Sellers
                still include
                them.
              </p>
            </div>
          )}

          <section>
            <div className="mb-3">
              <h2 className="font-body text-sm font-medium text-ink">
                Performance
              </h2>

              <p className="mt-0.5 font-body text-xs text-ink/40">
                Sales and
                financial
                performance for
                the selected
                period.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.financials && (
                <MetricCard
                  label="Revenue"
                  value={formatNaira(
                    data
                      .financials
                      .revenue,
                  )}
                />
              )}

              {data.financials && (
                <MetricCard
                  label="Profit"
                  value={formatNaira(
                    data
                      .financials
                      .profit,
                  )}
                />
              )}

              {data.financials && (
                <MetricCard
                  label="Profit Margin"
                  value={`${data.financials.profitMargin.toLocaleString(
                    "en-NG",
                    {
                      maximumFractionDigits: 1,
                    },
                  )}%`}
                />
              )}

              <MetricCard
                label="Orders"
                value={data.orderCount.toLocaleString(
                  "en-NG",
                )}
              />

              <MetricCard
                label="Units Sold"
                value={data.unitsSold.toLocaleString(
                  "en-NG",
                )}
              />

              <MetricCard
                label="Average Order Value"
                value={formatNaira(
                  Math.round(
                    data.averageOrderValue,
                  ),
                )}
              />
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="font-body text-sm font-medium text-ink">
                Order status
              </h2>

              <p className="mt-0.5 font-body text-xs text-ink/40">
                Current
                fulfilment
                status of online
                orders in the
                selected period.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard
                label="Completed Orders"
                value={data.completedOrderCount.toLocaleString(
                  "en-NG",
                )}
                helper="Fulfilled orders"
              />

              <MetricCard
                label="Pending Orders"
                value={data.pendingOrderCount.toLocaleString(
                  "en-NG",
                )}
                helper="Awaiting acknowledgement"
              />

              <MetricCard
                label="Processing Orders"
                value={data.processingOrderCount.toLocaleString(
                  "en-NG",
                )}
                helper="Currently being fulfilled"
              />
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="font-body text-sm font-medium text-ink">
                Customers &
                channels
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="New Customers"
                value={data.newCustomers.toLocaleString(
                  "en-NG",
                )}
              />

              <MetricCard
                label="Returning Customers"
                value={data.returningCustomers.toLocaleString(
                  "en-NG",
                )}
              />

              <MetricCard
                label="Online Sales"
                value={data.onlineSales.count.toLocaleString(
                  "en-NG",
                )}
                helper={formatNaira(
                  data
                    .onlineSales
                    .revenue,
                )}
              />

              <MetricCard
                label="Offline Sales"
                value={data.offlineSales.count.toLocaleString(
                  "en-NG",
                )}
                helper={formatNaira(
                  data
                    .offlineSales
                    .revenue,
                )}
              />

              <MetricCard
                label="Low Stock"
                value={data.lowStockCount.toLocaleString(
                  "en-NG",
                )}
                warning={
                  data.lowStockCount >
                  0
                }
                helper={
                  data.lowStockCount >
                  0
                    ? "Inventory needs attention"
                    : "Inventory levels are healthy"
                }
              />
            </div>
          </section>

          <section className="rounded-2xl border border-cream/90 bg-white p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="font-body text-sm font-medium text-ink">
                Revenue trend
              </h2>

              <p className="mt-0.5 font-body text-xs text-ink/40">
                Revenue movement
                across the
                selected period.
              </p>
            </div>

            {data.trend
              .length === 0 ? (
              <p className="font-body text-xs text-ink/40">
                No sales in this
                range.
              </p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >
                  <LineChart
                    data={
                      data.trend
                    }
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#F0EAE0"
                      vertical={
                        false
                      }
                    />

                    <XAxis
                      dataKey="date"
                      tick={{
                        fontSize: 11,
                        fill: "#777",
                      }}
                      tickLine={
                        false
                      }
                      axisLine={
                        false
                      }
                    />

                    <YAxis
                      tick={{
                        fontSize: 11,
                        fill: "#777",
                      }}
                      tickLine={
                        false
                      }
                      axisLine={
                        false
                      }
                      tickFormatter={(
                        value,
                      ) => {
                        if (
                          value >=
                          1_000_000
                        ) {
                          return `₦${(
                            value /
                            1_000_000
                          ).toFixed(
                            1,
                          )}m`;
                        }

                        if (
                          value >=
                          1000
                        ) {
                          return `₦${Math.round(
                            value /
                              1000,
                          )}k`;
                        }

                        return `₦${value}`;
                      }}
                    />

                    <Tooltip
                      formatter={(
                        value:
                          number,
                      ) => [
                        formatNaira(
                          value,
                        ),
                        "Revenue",
                      ]}
                    />

                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#C9A84C"
                      strokeWidth={
                        2
                      }
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-cream/90 bg-white p-5 sm:p-6">
              <h2 className="font-body text-sm font-medium text-ink">
                Best sellers
              </h2>

              <div className="mt-5">
                {data
                  .bestSellers
                  .length ===
                0 ? (
                  <p className="font-body text-xs text-ink/40">
                    No sales in
                    this range.
                  </p>
                ) : (
                  <div className="divide-y divide-cream/70">
                    {data.bestSellers.map(
                      (
                        product,
                        index,
                      ) => (
                        <div
                          key={`${product.productName}-${index}`}
                          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-body text-sm font-medium text-ink">
                              {
                                product.productName
                              }
                            </p>

                            <p className="mt-0.5 font-body text-xs text-ink/40">
                              Rank{" "}
                              {index +
                                1}
                            </p>
                          </div>

                          <p className="shrink-0 font-body text-sm font-medium tabular-nums text-ink">
                            {product.unitsSold.toLocaleString(
                              "en-NG",
                            )}{" "}
                            sold
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-cream/90 bg-white p-5 sm:p-6">
              <h2 className="font-body text-sm font-medium text-ink">
                Category
                performance
              </h2>

              <div className="mt-5">
                {data
                  .categoryPerformance
                  .length ===
                0 ? (
                  <p className="font-body text-xs text-ink/40">
                    No sales in
                    this range.
                  </p>
                ) : (
                  <div className="divide-y divide-cream/70">
                    {[
                      ...data.categoryPerformance,
                    ]
                      .sort(
                        (
                          a,
                          b,
                        ) =>
                          b.revenue -
                          a.revenue,
                      )
                      .map(
                        (
                          category,
                        ) => (
                          <div
                            key={
                              category.category
                            }
                            className="flex items-center justify-between gap-5 py-3 first:pt-0 last:pb-0"
                          >
                            <p className="min-w-0 truncate font-body text-sm font-medium text-ink">
                              {
                                category.category
                              }
                            </p>

                            <div className="shrink-0 text-right">
                              <p className="font-body text-sm font-medium tabular-nums text-ink">
                                {formatNaira(
                                  category.revenue,
                                )}
                              </p>

                              <p className="mt-0.5 font-body text-[11px] tabular-nums text-ink/40">
                                {category.unitsSold.toLocaleString(
                                  "en-NG",
                                )}{" "}
                                units
                              </p>
                            </div>
                          </div>
                        ),
                      )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}