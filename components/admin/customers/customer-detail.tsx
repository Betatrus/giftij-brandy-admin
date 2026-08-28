"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateCustomerNotes } from "@/lib/actions/customers";
import { ADMIN_ORDER_STATUS_LABELS, fromSchemaOrderStatus, type AdminOrderStatus } from "@/lib/utils/order-status";
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
  orders: { id: string; orderNumber: string; status: string; subtotal: number; createdAt: string }[];
  totalSpent: number;
  firstOrder: string | null;
  lastOrder: string | null;
  failedPayments: { id: string; createdAt: string; metadata: unknown }[];
  enquiries: { id: string; ticketNumber: string; subject: string; status: string; createdAt: string }[];
  complaints: { id: string; ticketNumber: string; subject: string; status: string; createdAt: string }[];
};

const LIFECYCLE_LABELS: Record<CustomerLifecycle, string> = {
  NEW: "New Customer",
  RETURNING: "Returning Customer",
};

export function CustomerDetail({ customer, canWrite }: { customer: CustomerDetailData; canWrite: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState(customer.internalNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSaveNotes() {
    setSaving(true);
    try {
      await updateCustomerNotes({ customerId: customer.id, internalNotes: notes });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-display text-lg text-ink">{customer.name}</h2>
            <p className="font-body text-sm text-ink/50">{customer.email}</p>
            {customer.phone && <p className="font-body text-sm text-ink/50">{customer.phone}</p>}
            {customer.location && <p className="font-body text-sm text-ink/50">{customer.location}</p>}
          </div>
          <Badge label={LIFECYCLE_LABELS[customer.lifecycle]} tone={customer.lifecycle} />
        </div>

        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-cream text-center">
          <div>
            <p className="font-display text-lg text-ink">{customer.orders.length}</p>
            <p className="font-body text-xs text-ink/50">Orders</p>
          </div>
          <div>
            <p className="font-display text-lg text-ink">₦{customer.totalSpent.toLocaleString()}</p>
            <p className="font-body text-xs text-ink/50">Total Spent</p>
          </div>
          <div>
            <p className="font-display text-lg text-ink">
              {customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString() : "—"}
            </p>
            <p className="font-body text-xs text-ink/50">Last Order</p>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
        <h3 className="font-body text-sm font-medium text-ink mb-3">Order History</h3>
        {customer.orders.length === 0 ? (
          <p className="font-body text-xs text-ink/40">No orders yet.</p>
        ) : (
          <div className="space-y-2">
            {customer.orders.map((o) => {
              const adminStatus = fromSchemaOrderStatus(o.status as Parameters<typeof fromSchemaOrderStatus>[0]) as AdminOrderStatus;
              return (
                <Link
                  key={o.id}
                  href={`/admin/orders/${o.id}`}
                  className="flex items-center justify-between rounded-xl hover:bg-cream/40 px-3 py-2 -mx-3"
                >
                  <span className="font-body text-sm text-ink">{o.orderNumber}</span>
                  <span className="font-body text-xs text-ink/40">{new Date(o.createdAt).toLocaleDateString()}</span>
                  <Badge label={ADMIN_ORDER_STATUS_LABELS[adminStatus]} tone={adminStatus} />
                  <span className="font-body text-sm text-ink">₦{o.subtotal.toLocaleString()}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {customer.failedPayments.length > 0 && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">Failed Payment Attempts</h3>
          <p className="font-body text-xs text-ink/40 mb-3">
            Useful for recovery outreach — consider reaching out via Communication.
          </p>
          <div className="space-y-2">
            {customer.failedPayments.map((f) => (
              <div key={f.id} className="flex items-center justify-between font-body text-sm">
                <span className="text-ink/60">Payment attempt failed</span>
                <span className="text-ink/40 text-xs">{new Date(f.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(customer.enquiries.length > 0 || customer.complaints.length > 0) && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">Communication History</h3>
          <div className="space-y-2">
            {[...customer.enquiries, ...customer.complaints]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between font-body text-sm">
                  <span className="text-ink/70">{t.subject}</span>
                  <Badge label={t.status} tone="DRAFT" />
                </div>
              ))}
          </div>
        </section>
      )}

      {canWrite && (
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h3 className="font-body text-sm font-medium text-ink mb-3">Internal Notes</h3>
          <p className="font-body text-xs text-ink/40 mb-2">Only visible to admins — never shown to the customer.</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-cream px-3 py-2 text-sm font-body"
          />
          <button
            onClick={handleSaveNotes}
            disabled={saving}
            className="mt-3 rounded-xl bg-gold text-white font-body text-sm px-4 py-2 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Notes"}
          </button>
        </section>
      )}
    </div>
  );
}
