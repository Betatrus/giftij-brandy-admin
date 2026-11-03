"use client";

import { useEffect, useMemo, useState } from "react";
import { listReturnableOrderItems, recordCustomerReturn } from "@/lib/actions/inventory";

type ReturnableItem = Awaited<ReturnType<typeof listReturnableOrderItems>>[number];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function CustomerReturnPanel() {
  const [items, setItems] = useState<ReturnableItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [restockQuantity, setRestockQuantity] = useState(1);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundStatus, setRefundStatus] = useState<"NOT_REQUIRED" | "PENDING" | "COMPLETED">("NOT_REQUIRED");
  const [businessDate, setBusinessDate] = useState(today());
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await listReturnableOrderItems();
      setItems(result);
      setSelectedId((current) => result.some((item) => item.orderItemId === current) ? current : result[0]?.orderItemId ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load delivered order items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(() => items.find((item) => item.orderItemId === selectedId), [items, selectedId]);

  async function submit() {
    setError("");
    setMessage("");
    if (!selected) return setError("Choose an order item.");
    if (quantity < 1 || quantity > selected.remainingQuantity) return setError(`Quantity must be between 1 and ${selected.remainingQuantity}.`);
    if (restockQuantity < 0 || restockQuantity > quantity) return setError("Restock quantity cannot exceed the quantity returned.");
    if (!businessDate || businessDate > today()) return setError("Choose a valid return date that is not in the future.");

    setPending(true);
    try {
      await recordCustomerReturn({
        orderItemId: selected.orderItemId,
        quantity,
        restockQuantity,
        refundStatus,
        ...(selected.canRecordRefundAmount ? { refundAmount: refundAmount === "" ? undefined : Number(refundAmount) } : {}),
        businessDate,
        note: note.trim() || undefined,
      });
      setMessage("Return recorded. Eligible stock has been updated.");
      setQuantity(1);
      setRestockQuantity(1);
      setRefundAmount("");
      setRefundStatus("NOT_REQUIRED");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record this return.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-cream bg-white p-5 shadow-soft">
      <div className="mb-4">
        <h2 className="font-display text-lg text-ink">Customer Return / Refund</h2>
        <p className="mt-1 font-body text-sm text-ink/50">Record a return after the customer has received and returned the item. Select the refund status based on the manual refund process; only resale-eligible units are added back to available stock.</p>
      </div>
      {loading ? <p className="text-sm text-ink/50">Loading delivered orders...</p> : items.length === 0 ? (
        <p className="rounded-xl bg-cream/40 p-3 text-sm text-ink/60">No delivered order items currently have quantities eligible for return.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="font-body text-sm text-ink/70 md:col-span-2">
            Original order item
            <select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setQuantity(1); setRestockQuantity(1); }} className="mt-1 w-full rounded-xl border border-cream px-3 py-2">
              {items.map((item) => <option key={item.orderItemId} value={item.orderItemId}>{item.orderNumber} · {item.customerName} · {item.productName}{item.variant ? ` — ${item.variant}` : ""} · {item.remainingQuantity} eligible</option>)}
            </select>
          </label>
          {selected && <p className="md:col-span-2 text-xs text-ink/50">Customer: {selected.customerName} ({selected.customerEmail}) · SKU: {selected.sku} · Ordered: {selected.orderedQuantity} · Previously returned: {selected.returnedQuantity}</p>}
          <label className="font-body text-sm text-ink/70">Quantity returned
            <input type="number" min={1} max={selected?.remainingQuantity ?? 1} value={quantity} onChange={(e) => { const n = Number(e.target.value); setQuantity(n); setRestockQuantity((v) => Math.min(v, n)); }} className="mt-1 w-full rounded-xl border border-cream px-3 py-2" />
          </label>
          <label className="font-body text-sm text-ink/70">Quantity fit for resale (restock)
            <input type="number" min={0} max={quantity} value={restockQuantity} onChange={(e) => setRestockQuantity(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-cream px-3 py-2" />
          </label>
          <label className="font-body text-sm text-ink/70">Refund status
            <select value={refundStatus} onChange={(e) => setRefundStatus(e.target.value as typeof refundStatus)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2">
              <option value="NOT_REQUIRED">No refund required</option>
              <option value="PENDING">Refund pending</option>
              <option value="COMPLETED">Refund completed</option>
            </select>
          </label>
          {selected?.canRecordRefundAmount && <label className="font-body text-sm text-ink/70">Refund amount (₦, optional)
            <input type="number" min={0} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2" placeholder="Amount actually refunded" />
          </label>}
          <label className="font-body text-sm text-ink/70">Return / refund date
            <input type="date" max={today()} value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2" />
          </label>
          <p className="md:col-span-2 text-xs text-ink/50">Mark a refund completed only after it has been confirmed outside this system. This status does not initiate a payment-provider refund.</p>
          <label className="font-body text-sm text-ink/70 md:col-span-2">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-cream px-3 py-2" placeholder="Condition, refund reference, or handling note" />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink/50">Returned but not restocked: {quantity - restockQuantity} unit(s). These do not increase available stock.</p>
            <button type="button" onClick={submit} disabled={pending || loading} className="rounded-xl bg-gold px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{pending ? "Recording..." : "Record return"}</button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 text-sm text-green-700">{message}</p>}
    </section>
  );
}
