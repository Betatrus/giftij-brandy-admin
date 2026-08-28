"use client";

import { useEffect, useState } from "react";
import {
  searchCustomersLite,
  listFailedPaymentCustomers,
  sendCustomerEmail,
  listSentCampaigns,
} from "@/lib/actions/communications";
import { X, Search } from "lucide-react";

type Recipient = { id: string; name: string; email: string };
type SentCampaign = { id: string; subject: string; sentAt: string | null; stats: unknown };

export function EmailComposer() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ successCount: number; failureCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentHistory, setSentHistory] = useState<SentCampaign[]>([]);

  useEffect(() => {
    listSentCampaigns().then((c) => setSentHistory(c as unknown as SentCampaign[]));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      const res = await searchCustomersLite(query);
      setResults(res as unknown as Recipient[]);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function addRecipient(r: Recipient) {
    if (!selected.some((s) => s.id === r.id)) setSelected([...selected, r]);
    setQuery("");
    setResults([]);
  }

  function removeRecipient(id: string) {
    setSelected(selected.filter((s) => s.id !== id));
  }

  async function handleAddFailedPayments() {
    const customers = await listFailedPaymentCustomers();
    const toAdd = (customers as unknown as Recipient[]).filter((c) => !selected.some((s) => s.id === c.id));
    setSelected([...selected, ...toAdd]);
  }

  async function handleSend() {
    setError(null);
    setSendResult(null);
    if (selected.length === 0) {
      setError("Select at least one customer.");
      return;
    }
    if (!subject.trim() || !message.trim()) {
      setError("Subject and message are both required.");
      return;
    }
    setSending(true);
    try {
      const result = await sendCustomerEmail({
        customerIds: selected.map((s) => s.id),
        subject: subject.trim(),
        message: message.trim(),
      });
      setSendResult({ successCount: result.successCount, failureCount: result.failureCount });
      setSelected([]);
      setSubject("");
      setMessage("");
      listSentCampaigns().then((c) => setSentHistory(c as unknown as SentCampaign[]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6">
          <h2 className="font-body text-sm font-medium text-ink mb-3">Recipients</h2>

          <div className="flex flex-wrap gap-2 mb-3">
            {selected.map((r) => (
              <span
                key={r.id}
                className="flex items-center gap-1.5 bg-champagne/30 border border-gold/30 text-ink text-sm font-body px-3 py-1.5 rounded-full"
              >
                {r.name}
                <button onClick={() => removeRecipient(r.id)} className="text-ink/40 hover:text-ink" aria-label={`Remove ${r.name}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {selected.length === 0 && <p className="font-body text-xs text-ink/40">No recipients selected yet.</p>}
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers by name or email..."
              className="w-full pl-9 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            />
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white rounded-xl shadow-soft border border-cream max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => addRecipient(r)}
                    className="w-full text-left px-3 py-2 hover:bg-cream/40 font-body text-sm"
                  >
                    <p className="text-ink">{r.name}</p>
                    <p className="text-xs text-ink/40">{r.email}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleAddFailedPayments}
            className="mt-3 text-xs text-gold underline"
          >
            + Add customers with failed payments (last 30 days)
          </button>
        </section>

        <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 space-y-3">
          <h2 className="font-body text-sm font-medium text-ink">Message</h2>

          <div>
            <label className="font-body text-sm text-ink/70">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            />
          </div>

          <div>
            <label className="font-body text-sm text-ink/70">
              Message <span className="text-ink/40">— use {"{{firstName}}"} to personalize</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              placeholder={"Hi {{firstName}},\n\n..."}
              className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body text-sm"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {sendResult && (
            <p className="text-xs text-green-700 bg-green-50 rounded-xl px-3 py-2">
              Sent to {sendResult.successCount} customer{sendResult.successCount === 1 ? "" : "s"}
              {sendResult.failureCount > 0 && ` — ${sendResult.failureCount} failed to send`}.
            </p>
          )}

          <button
            onClick={handleSend}
            disabled={sending}
            className="rounded-xl bg-gold text-white font-body text-sm px-5 py-2.5 disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send Now"}
          </button>
        </section>
      </div>

      <section className="bg-white rounded-2xl shadow-soft p-5 md:p-6 h-fit">
        <h2 className="font-body text-sm font-medium text-ink mb-3">Recent Sends</h2>
        {sentHistory.length === 0 ? (
          <p className="font-body text-xs text-ink/40">Nothing sent yet.</p>
        ) : (
          <div className="space-y-3">
            {sentHistory.map((c) => {
              const stats = c.stats as { recipientCount?: number; successCount?: number } | null;
              return (
                <div key={c.id} className="border-b border-cream last:border-0 pb-3 last:pb-0">
                  <p className="font-body text-sm text-ink">{c.subject}</p>
                  <p className="font-body text-xs text-ink/40 mt-0.5">
                    {c.sentAt ? new Date(c.sentAt).toLocaleString() : "—"}
                    {stats?.recipientCount ? ` · ${stats.successCount ?? 0}/${stats.recipientCount} sent` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
