"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import Link from "next/link";
import { Bell } from "lucide-react";

import { getAdminNotifications } from "@/lib/actions/notifications";

type OrderNotification = {
  id: string;
  orderNumber: string;
  createdAt: string | Date;

  customer: {
    name: string;
  };
};

type OrderReminder = {
  id: string;
  orderNumber: string;

  customer: {
    name: string;
  };

  status:
    | "PENDING"
    | "PROCESSING";

  reminderSince:
    | string
    | Date;

  daysOpen: number;
};

type InventoryNotification = {
  id: string;
  action: string;
  createdAt: string | Date;
  productId: string | null;
  productName: string;
  variantLabel: string | null;
  adjustmentReason: string | null;
  businessDate: string | null;
  quantityChanged: number | null;
  beforeStock: number | null;
  afterStock: number | null;
  actorName: string;
};

function activityTitle(
  action: string,
) {
  switch (action) {
    case "INVENTORY_RESTOCK":
      return "Stock restocked";

    case "INVENTORY_OFFLINE_SALE":
      return "Offline sale recorded";

    case "INVENTORY_CORRECTION":
      return "Stock corrected";

    case "INVENTORY_DAMAGED":
      return "Damaged stock recorded";

    case "INVENTORY_CUSTOMER_RETURN":
      return "Customer return recorded";

    default:
      return "Inventory updated";
  }
}

function stockMovement(
  item: InventoryNotification,
) {
  if (
    item.beforeStock === null ||
    item.afterStock === null
  ) {
    return null;
  }

  return `${item.beforeStock} → ${item.afterStock}`;
}

function reminderTitle(
  reminder: OrderReminder,
) {
  if (
    reminder.status ===
    "PENDING"
  ) {
    return "Pending order needs attention";
  }

  return "Processing order needs follow-up";
}

export function NotificationBell() {
  const [open, setOpen] =
    useState(false);

  const [count, setCount] =
    useState(0);

  const [orders, setOrders] =
    useState<
      OrderNotification[]
    >([]);

  const [
    orderReminders,
    setOrderReminders,
  ] = useState<
    OrderReminder[]
  >([]);

  const [
    inventory,
    setInventory,
  ] = useState<
    InventoryNotification[]
  >([]);

  const containerRef =
    useRef<HTMLDivElement>(
      null,
    );

  async function load() {
    try {
      const res =
        await getAdminNotifications();

      setCount(res.count);

      setOrders(
        res.orders as unknown as OrderNotification[],
      );

      setOrderReminders(
        res.orderReminders as unknown as OrderReminder[],
      );

      setInventory(
        res.inventory as unknown as InventoryNotification[],
      );
    } catch {
      // Notifications must never
      // block normal admin usage.
    }
  }

  useEffect(() => {
    load();

    const interval =
      setInterval(
        load,
        60_000,
      );

    return () =>
      clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent,
    ) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside,
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleClickOutside,
      );
  }, []);

  const isEmpty =
    orders.length === 0 &&
    orderReminders.length === 0 &&
    inventory.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() => {
          setOpen(
            (current) =>
              !current,
          );

          if (!open) {
            load();
          }
        }}
        className="relative text-ink/60 hover:text-ink"
        aria-label="Notifications"
      >
        <Bell size={20} />

        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-body rounded-full min-w-4 h-4 px-1 flex items-center justify-center">
            {count > 9
              ? "9+"
              : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-soft border border-cream z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-cream">
            <p className="font-body text-sm font-medium text-ink">
              Notifications
            </p>

            <p className="font-body text-[11px] text-ink/40 mt-0.5">
              Orders, reminders and recent inventory activity
            </p>
          </div>

          {isEmpty ? (
            <p className="font-body text-sm text-ink/40 px-4 py-6 text-center">
              No notifications right now.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {orderReminders.length >
                0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 font-body text-[10px] uppercase tracking-wider text-red-600">
                    Needs Attention
                  </p>

                  {orderReminders.map(
                    (reminder) => (
                      <Link
                        key={
                          reminder.id
                        }
                        href={`/admin/orders/${reminder.id}`}
                        onClick={() =>
                          setOpen(
                            false,
                          )
                        }
                        className="block px-4 py-3 border-b border-cream bg-red-50/40 hover:bg-red-50"
                      >
                        <p className="font-body text-sm font-medium text-ink">
                          {reminderTitle(
                            reminder,
                          )}
                        </p>

                        <p className="font-body text-xs text-ink/60 mt-0.5">
                          {
                            reminder.orderNumber
                          }{" "}
                          ·{" "}
                          {
                            reminder
                              .customer
                              .name
                          }
                        </p>

                        <p className="font-body text-[11px] text-red-600 mt-1">
                          {reminder.status ===
                          "PENDING"
                            ? "Pending"
                            : "Processing"}{" "}
                          for{" "}
                          {
                            reminder.daysOpen
                          }{" "}
                          day
                          {reminder.daysOpen ===
                          1
                            ? ""
                            : "s"}
                        </p>
                      </Link>
                    ),
                  )}
                </div>
              )}

              {orders.length >
                0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 font-body text-[10px] uppercase tracking-wider text-ink/40">
                    New Orders
                  </p>

                  {orders.map(
                    (order) => (
                      <Link
                        key={
                          order.id
                        }
                        href={`/admin/orders/${order.id}`}
                        onClick={() =>
                          setOpen(
                            false,
                          )
                        }
                        className="block px-4 py-3 border-b border-cream hover:bg-cream/40"
                      >
                        <p className="font-body text-sm text-ink">
                          New order received
                        </p>

                        <p className="font-body text-xs text-ink/50 mt-0.5">
                          {
                            order.orderNumber
                          }{" "}
                          ·{" "}
                          {
                            order
                              .customer
                              .name
                          }
                        </p>
                      </Link>
                    ),
                  )}
                </div>
              )}

              {inventory.length >
                0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 font-body text-[10px] uppercase tracking-wider text-ink/40">
                    Inventory
                  </p>

                  {inventory.map(
                    (item) => {
                      const movement =
                        stockMovement(
                          item,
                        );

                      const content = (
                        <>
                          <p className="font-body text-sm text-ink">
                            {activityTitle(
                              item.action,
                            )}
                          </p>

                          <p className="font-body text-xs text-ink/60 mt-0.5">
                            {
                              item.productName
                            }

                            {item.variantLabel
                              ? ` · ${item.variantLabel}`
                              : ""}
                          </p>

                          {movement && (
                            <p className="font-body text-xs text-ink/50 mt-0.5">
                              Stock:{" "}
                              {
                                movement
                              }
                            </p>
                          )}

                          <p className="font-body text-[11px] text-ink/40 mt-1">
                            By{" "}
                            {
                              item.actorName
                            }

                            {item.businessDate
                              ? ` · ${item.businessDate}`
                              : ""}
                          </p>
                        </>
                      );

                      if (
                        item.productId
                      ) {
                        return (
                          <Link
                            key={
                              item.id
                            }
                            href={`/admin/inventory#product-${item.productId}`}
                            onClick={() =>
                              setOpen(
                                false,
                              )
                            }
                            className="block px-4 py-3 border-b border-cream hover:bg-cream/40"
                          >
                            {
                              content
                            }
                          </Link>
                        );
                      }

                      return (
                        <div
                          key={
                            item.id
                          }
                          className="px-4 py-3 border-b border-cream"
                        >
                          {content}
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 border-t border-cream">
            <Link
              href="/admin/orders"
              onClick={() =>
                setOpen(false)
              }
              className="text-center font-body text-xs text-gold py-3 hover:bg-cream/40 border-r border-cream"
            >
              View Orders
            </Link>

            <Link
              href="/admin/inventory"
              onClick={() =>
                setOpen(false)
              }
              className="text-center font-body text-xs text-gold py-3 hover:bg-cream/40"
            >
              View Inventory
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}