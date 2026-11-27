"use client";
import { useState, useTransition } from "react";
import { updateStorefrontLock } from "@/lib/actions/settings";

export function StorefrontLockForm({ locked, message, unlocksAt }: { locked: boolean; message: string; unlocksAt: string }) {
  const [enabled,setEnabled]=useState(locked);
  const [notice,setNotice]=useState(message);
  const [reopens,setReopens]=useState(unlocksAt ? new Date(unlocksAt).toISOString().slice(0,16) : "");
  const [pending,startTransition]=useTransition();
  const [feedback,setFeedback]=useState("");
  function save(){setFeedback("");startTransition(async()=>{try{await updateStorefrontLock({locked:enabled,message:notice,unlocksAt:reopens?new Date(reopens).toISOString():null});setFeedback("Storefront access settings saved.");}catch(e){setFeedback(e instanceof Error?e.message:"Could not save storefront settings.");}});}
  return <div className="space-y-4">
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /><span><strong>Lock customer purchases</strong><span className="mt-1 block text-xs text-ink/50">When enabled, customers cannot start a new Paystack checkout. Admin access and existing orders remain available.</span></span></label>
    <label className="block text-sm text-ink/70">Customer pop-up message<textarea value={notice} onChange={e=>setNotice(e.target.value)} maxLength={1200} rows={4} placeholder="Our website will be live tomorrow by 8:00 AM WAT. Thank you for your patience." className="mt-1 w-full rounded-xl border border-cream px-3 py-2.5" /><span className="mt-1 block text-xs text-ink/45">{notice.length}/1,200 characters. This message appears on the storefront while the lock is active.</span></label>
    <label className="block text-sm text-ink/70">Scheduled reopening (WAT)<input type="datetime-local" value={reopens} onChange={e=>setReopens(e.target.value)} className="mt-1 block w-full rounded-xl border border-cream px-3 py-2.5" /><span className="mt-1 block text-xs text-ink/45">Informational only. You can unlock manually at any time using the switch above.</span></label>
    <button type="button" disabled={pending} onClick={save} className="rounded-xl bg-gold px-4 py-2 text-sm text-white disabled:opacity-50">{pending?"Saving...":"Save storefront settings"}</button>
    {feedback&&<p role="status" className="text-xs text-ink/60">{feedback}</p>}
  </div>;
}
