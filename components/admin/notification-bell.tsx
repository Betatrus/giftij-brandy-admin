"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getNewOrderNotifications } from "@/lib/actions/notifications";

type OrderNotification = { id: string; orderNumber: string; createdAt: string; customer: { name: string } };

/**
 * "New order received" (§7) — a real, working notification, not the
 * previous do-nothing bell. Deliberately simple: fetches PENDING orders
 * on mount and whenever the bell is opened (no websocket/polling loop —
 * that would be more real-time infrastructure than this targeted
 * refinement calls for). Each item links straight to that order; opening
 * ANY of them naturally clears it from this list on the next fetch,
 * since viewing an order moves it out of PENDING (see
 * lib/actions/notifications.ts's top comment) — there's no separate
 * "mark as read" action to build or maintain.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [orders, setOrders] = useState<OrderNotification[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await getNewOrderNotifications();
      setCount(res.count);
      setOrders(res.orders as unknown as OrderNotification[]);
    } catch {
      // Fails quietly — a broken notification fetch should never block
      // the rest of the admin from working.
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // light periodic refresh, not real-time push
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative text-ink/60 hover:text-ink"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-body rounded-full w-4 h-4 flex items-center justify-center">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-soft border border-cream z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-cream">
            <p className="font-body text-sm font-medium text-ink">Notifications</p>
          </div>
          {orders.length === 0 ? (
            <p className="font-body text-sm text-ink/40 px-4 py-6 text-center">No new orders right now.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {orders.map((o) => (
                <Link
                  key={o.id}
                  href={`/admin/orders/${o.id}`}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 border-b border-cream last:border-0 hover:bg-cream/40"
                >
                  <p className="font-body text-sm text-ink">New order received</p>
                  <p className="font-body text-xs text-ink/50 mt-0.5">
                    {o.orderNumber} · {o.customer.name}
                  </p>
                </Link>
              ))}
            </div>
          )}
          <Link
            href="/admin/orders"
            onClick={() => setOpen(false)}
            className="block text-center font-body text-xs text-gold py-3 border-t border-cream hover:bg-cream/40"
          >
            View All Orders
          </Link>
        </div>
      )}
    </div>
  );
}
