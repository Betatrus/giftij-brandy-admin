"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateCustomerNotes } from "@/lib/actions/customers";
import {
  ADMIN_ORDER_STATUS_LABELS,
  fromSchemaOrderStatus,
  type AdminOrderStatus,
} from "@/lib/utils/order-status";
import { Badge } from "@/components/ui/badge";
import type { CustomerLifecycle } from "@/lib/validators/customer";

type CustomerDetailData = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  location: string;
  subscribed: boolean;
  internalNotes: string | null;
  lifecycle: CustomerLifecycle;

  orders: {
    id: string;
    orderNumber: string;
    status: string;
    subtotal: number;
    createdAt: string;
  }[];

  totalSpent: number;
  firstOrder: string | null;
  lastOrder: string | null;

  failedPayments: {
    id: string;
    createdAt: string;
    metadata: unknown;
  }[];

  enquiries: {
    id: string;
    ticketNumber: string;
    subject: string;
    status: string;
    createdAt: string;
  }[];

  complaints: {
    id: string;
    ticketNumber: string;
    subject: string;
    status: string;
    createdAt: string;
  }[];
};

const LIFECYCLE_LABELS: Record<
  CustomerLifecycle,
  string
> = {
  NEW: "New Customer",
  RETURNING: "Returning Customer",
};

export function CustomerDetail({
  customer,
  canWrite,
}: {
  customer: CustomerDetailData;
  canWrite: boolean;
}) {
  const router = useRouter();

  const [notes, setNotes] =
    useState(
      customer.internalNotes ??
        ""
    );

  const [saving, setSaving] =
    useState(false);

  async function handleSaveNotes() {
    setSaving(true);

    try {
      await updateCustomerNotes({
        customerId:
          customer.id,
        internalNotes: notes,
      });

      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Customer profile */}
      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-ink break-words">
              {customer.name}
            </h2>

            <p className="font-body text-sm text-ink/50 break-all mt-1">
              {customer.email}
            </p>
          </div>

          <Badge
            label={
              LIFECYCLE_LABELS[
                customer.lifecycle
              ]
            }
            tone={
              customer.lifecycle
            }
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <p className="font-body text-xs uppercase tracking-wide text-ink/35 mb-1">
              Phone Number
            </p>

            <p className="font-body text-sm text-ink">
              {customer.phone ||
                "Not available"}
            </p>
          </div>

          <div>
            <p className="font-body text-xs uppercase tracking-wide text-ink/35 mb-1">
              Location
            </p>

            <p className="font-body text-sm text-ink">
              {customer.location ||
                "Not available"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 pt-5 border-t border-cream text-center">
          <div>
            <p className="font-display text-lg text-ink">
              {
                customer.orders
                  .length
              }
            </p>

            <p className="font-body text-xs text-ink/50">
              Orders
            </p>
          </div>

          <div>
            <p className="font-display text-lg text-ink">
              ₦
              {customer.totalSpent.toLocaleString()}
            </p>

            <p className="font-body text-xs text-ink/50">
              Total Spent
            </p>
          </div>

          <div>
            <p className="font-display text-lg text-ink">
              {customer.lastOrder
                ? new Date(
                    customer.lastOrder
                  ).toLocaleDateString()
                : "—"}
            </p>

            <p className="font-body text-xs text-ink/50">
              Last Order
            </p>
          </div>
        </div>
      </section>

      {/* Order history */}
      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">
          Order History
        </h3>

        {customer.orders.length ===
        0 ? (
          <p className="font-body text-xs text-ink/40">
            No orders yet.
          </p>
        ) : (
          <div className="space-y-2">
            {customer.orders.map(
              (order) => {
                const adminStatus =
                  fromSchemaOrderStatus(
                    order.status as Parameters<
                      typeof fromSchemaOrderStatus
                    >[0]
                  ) as AdminOrderStatus;

                return (
                  <Link
                    key={
                      order.id
                    }
                    href={`/admin/orders/${order.id}`}
                    className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-2 sm:gap-4 items-center rounded-xl hover:bg-cream/40 px-3 py-3 -mx-3"
                  >
                    <span className="font-body text-sm text-ink">
                      {
                        order.orderNumber
                      }
                    </span>

                    <span className="font-body text-sm text-ink text-right sm:order-last">
                      ₦
                      {order.subtotal.toLocaleString()}
                    </span>

                    <span className="font-body text-xs text-ink/40">
                      {new Date(
                        order.createdAt
                      ).toLocaleDateString()}
                    </span>

                    <div>
                      <Badge
                        label={
                          ADMIN_ORDER_STATUS_LABELS[
                            adminStatus
                          ]
                        }
                        tone={
                          adminStatus
                        }
                      />
                    </div>
                  </Link>
                );
              }
            )}
          </div>
        )}
      </section>

      {/* Failed payments */}
      {customer.failedPayments
        .length > 0 && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">
            Failed Payment
            Attempts
          </h3>

          <p className="font-body text-xs text-ink/40 mb-3">
            Useful for recovery
            outreach. Consider
            reaching out through
            Communication.
          </p>

          <div className="space-y-2">
            {customer.failedPayments.map(
              (payment) => (
                <div
                  key={
                    payment.id
                  }
                  className="flex items-center justify-between gap-4 font-body text-sm"
                >
                  <span className="text-ink/60">
                    Payment
                    attempt failed
                  </span>

                  <span className="text-ink/40 text-xs text-right">
                    {new Date(
                      payment.createdAt
                    ).toLocaleString()}
                  </span>
                </div>
              )
            )}
          </div>
        </section>
      )}

      {/* Communications */}
      {(customer.enquiries
        .length > 0 ||
        customer.complaints
          .length > 0) && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">
            Communication
            History
          </h3>

          <div className="space-y-2">
            {[
              ...customer.enquiries,
              ...customer.complaints,
            ]
              .sort(
                (a, b) =>
                  new Date(
                    b.createdAt
                  ).getTime() -
                  new Date(
                    a.createdAt
                  ).getTime()
              )
              .map(
                (item) => (
                  <div
                    key={
                      item.id
                    }
                    className="flex items-center justify-between gap-4 font-body text-sm"
                  >
                    <span className="text-ink/70">
                      {
                        item.subject
                      }
                    </span>

                    <Badge
                      label={
                        item.status
                      }
                      tone="DRAFT"
                    />
                  </div>
                )
              )}
          </div>
        </section>
      )}

      {/* Internal notes */}
      {canWrite && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">
            Internal Notes
          </h3>

          <p className="font-body text-xs text-ink/40 mb-2">
            Only visible to
            admins. Never shown
            to the customer.
          </p>

          <textarea
            value={notes}
            onChange={(event) =>
              setNotes(
                event.target.value
              )
            }
            rows={4}
            className="w-full rounded-xl border border-cream px-3 py-2 text-sm font-body"
          />

          <button
            onClick={
              handleSaveNotes
            }
            disabled={saving}
            className="mt-3 rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
          >
            {saving
              ? "Saving..."
              : "Save Notes"}
          </button>
        </section>
      )}
    </div>
  );
}