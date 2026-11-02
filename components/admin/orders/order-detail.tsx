"use client";

import {
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  markOrderProcessingOnView,
  completeOrder,
  cancelOrder,
  addOrderNote,
} from "@/lib/actions/orders";
import {
  ADMIN_ORDER_STATUS_LABELS,
  type AdminOrderStatus,
} from "@/lib/utils/order-status";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type OrderDetailData = {
  id: string;
  orderNumber: string;
  adminStatus: AdminOrderStatus;
  subtotal: number;
  profit?: number | null;

  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };

  shippingAddress: unknown;
  paymentReference: string | null;

  items: {
    id: string;
    quantity: number;
    unitPrice: number;

    product: {
      id: string;
      name: string;
      images: {
        url: string;
      }[];
    };

    variant: {
      id: string;
      value: string;
    } | null;
  }[];

  notes: {
    id: string;
    note: string;
    createdBy: string;
    createdAt: string;
  }[];

  timeline: {
    id: string;
    label: string;
    createdAt: string;
  }[];

  canSeeFinancials: boolean;
};

export function OrderDetail({
  order,
}: {
  order: OrderDetailData;
}) {
  const router = useRouter();

  const [isPending, setIsPending] =
    useState(false);

  const [
    markingViewed,
    setMarkingViewed,
  ] = useState(
    order.adminStatus ===
      "PENDING"
  );

  const [
    confirmCancel,
    setConfirmCancel,
  ] = useState(false);

  const [note, setNote] =
    useState("");

  const [error, setError] =
    useState<string | null>(
      null
    );

  /**
   * Viewing the order is the operational trigger for:
   *
   * PENDING -> PROCESSING
   *
   * This happens after the page has rendered so the Server Component
   * itself remains read-only and cannot crash because of cache
   * revalidation/state mutation during rendering.
   */
  useEffect(() => {
    if (
      order.adminStatus !==
      "PENDING"
    ) {
      setMarkingViewed(false);
      return;
    }

    let active = true;

    async function markViewed() {
      try {
        await markOrderProcessingOnView(
          order.id
        );

        if (active) {
          router.refresh();
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to start processing this order."
          );
        }
      } finally {
        if (active) {
          setMarkingViewed(false);
        }
      }
    }

    markViewed();

    return () => {
      active = false;
    };
  }, [
    order.id,
    order.adminStatus,
    router,
  ]);

  async function handleComplete() {
    setError(null);
    setIsPending(true);

    try {
      await completeOrder(
        order.id
      );

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to complete order."
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setIsPending(true);

    try {
      await cancelOrder(
        order.id
      );

      setConfirmCancel(false);

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to request cancellation review."
      );
    } finally {
      setIsPending(false);
    }
  }

  async function handleAddNote() {
    if (!note.trim()) {
      return;
    }

    setError(null);
    setIsPending(true);

    try {
      await addOrderNote({
        orderId: order.id,
        note: note.trim(),
      });

      setNote("");

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to add note."
      );
    } finally {
      setIsPending(false);
    }
  }

  const address =
    order.shippingAddress &&
    typeof order.shippingAddress ===
      "object"
      ? (order.shippingAddress as Record<
          string,
          unknown
        >)
      : null;

  const streetAddress =
    address &&
    typeof address.address ===
      "string"
      ? address.address
      : address &&
          typeof address.line1 ===
            "string"
        ? address.line1
        : null;

  const locationParts = address
    ? [
        streetAddress,
        address.city,
        address.state,
        address.country,
      ].filter(
        (value): value is string =>
          typeof value ===
            "string" &&
          value.trim().length > 0
      )
    : [];

  return (
    <div className="space-y-6 max-w-3xl">
      {error && (
        <div className="bg-red-50 text-red-700 text-sm font-body rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-lg text-ink">
              {order.orderNumber}
            </h2>

            <p className="font-body text-xs text-ink/40 mt-0.5">
              {order.paymentReference
                ? `Ref: ${order.paymentReference}`
                : "No payment reference"}
            </p>
          </div>

          <Badge
            label={
              markingViewed
                ? "Processing"
                : ADMIN_ORDER_STATUS_LABELS[
                    order
                      .adminStatus
                  ]
            }
            tone={
              markingViewed
                ? "PROCESSING"
                : order.adminStatus
            }
          />
        </div>

        {markingViewed && (
          <p className="font-body text-xs text-ink/45 mb-4">
            Opening this order
            for processing...
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {order.adminStatus ===
            "PROCESSING" && (
            <button
              onClick={
                handleComplete
              }
              disabled={
                isPending ||
                markingViewed
              }
              className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
            >
              Complete Order
            </button>
          )}

          {(order.adminStatus ===
            "PENDING" ||
            order.adminStatus ===
              "PROCESSING") && (
            <button
              onClick={() =>
                setConfirmCancel(
                  true
                )
              }
              disabled={
                isPending ||
                markingViewed
              }
              className="rounded-xl border border-red-200 text-red-600 font-body text-sm px-4 py-2 disabled:opacity-60"
            >
              Request Cancellation Review
            </button>
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">
          Items
        </h3>

        <div className="space-y-3">
          {order.items.map(
            (item) => (
              <div
                key={item.id}
                className="flex items-center gap-3"
              >
                {item.product
                  .images?.[0]
                  ?.url ? (
                  <Image
                    src={
                      item.product
                        .images[0]
                        .url
                    }
                    alt={
                      item.product
                        .name
                    }
                    width={44}
                    height={44}
                    className="rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-cream" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm text-ink break-words">
                    {
                      item.product
                        .name
                    }
                  </p>

                  {item.variant && (
                    <p className="font-body text-xs text-ink/50">
                      {
                        item.variant
                          .value
                      }
                    </p>
                  )}
                </div>

                <p className="font-body text-sm text-ink/60">
                  × {item.quantity}
                </p>

                <p className="font-body text-sm text-ink">
                  ₦
                  {(
                    item.unitPrice *
                    item.quantity
                  ).toLocaleString()}
                </p>
              </div>
            )
          )}
        </div>

        <div className="border-t border-cream mt-4 pt-4 space-y-1 text-right">
          <p className="font-body text-sm text-ink">
            Subtotal:{" "}
            <span className="font-medium">
              ₦
              {order.subtotal.toLocaleString()}
            </span>
          </p>

          {order.canSeeFinancials &&
            order.profit !==
              null &&
            order.profit !==
              undefined && (
              <p className="font-body text-xs text-ink/50">
                Profit: ₦
                {order.profit.toLocaleString()}
              </p>
            )}
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">
          Customer
        </h3>

        <p className="font-body text-sm text-ink">
          {order.customer.name}
        </p>

        <p className="font-body text-xs text-ink/50">
          {order.customer.email}
        </p>

        {order.customer.phone && (
          <p className="font-body text-xs text-ink/50">
            {order.customer.phone}
          </p>
        )}

        <p className="font-body text-xs text-ink/50 mt-2">
          {locationParts.length >
          0
            ? locationParts.join(
                ", "
              )
            : "No shipping address on file"}
        </p>
      </section>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">
          Timeline
        </h3>

        <div className="space-y-2">
          {order.timeline.map(
            (event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-4 font-body text-sm"
              >
                <span className="text-ink/70">
                  {event.label}
                </span>

                <span className="text-ink/40 text-xs text-right">
                  {new Date(
                    event.createdAt
                  ).toLocaleString()}
                </span>
              </div>
            )
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">
          Notes
        </h3>

        <div className="space-y-2 mb-4">
          {order.notes.length ===
            0 && (
            <p className="font-body text-xs text-ink/40">
              No notes yet.
            </p>
          )}

          {order.notes.map(
            (noteItem) => (
              <div
                key={noteItem.id}
                className="rounded-xl bg-cream/40 px-3 py-2"
              >
                <p className="font-body text-sm text-ink">
                  {
                    noteItem.note
                  }
                </p>

                <p className="font-body text-[11px] text-ink/40 mt-1">
                  {new Date(
                    noteItem.createdAt
                  ).toLocaleString()}
                </p>
              </div>
            )
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={note}
            onChange={(event) =>
              setNote(
                event.target.value
              )
            }
            placeholder="Add a note..."
            className="flex-1 rounded-xl border border-cream px-3 py-2 text-sm font-body"
          />

          <button
            onClick={
              handleAddNote
            }
            disabled={
              isPending ||
              !note.trim()
            }
            className="rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
          >
            Add
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmCancel}
        title="Request cancellation review?"
        description="This sends the order for admin review. The order will not be cancelled, refunded, or restocked until those actions are separately approved."
        confirmLabel="Request Review"
        danger
        onConfirm={
          handleCancel
        }
        onCancel={() =>
          setConfirmCancel(
            false
          )
        }
      />
    </div>
  );
}