"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push(params.get("callbackUrl") || "/admin/dashboard");
  }

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl shadow-soft p-8">
      <h1 className="font-display text-2xl text-ink mb-1">Giftij Brandy</h1>
      <p className="font-body text-sm text-ink/60 mb-6">Admin Portal</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="font-body text-sm text-ink/80">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>
        <div>
          <label className="font-body text-sm text-ink/80">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mt-1 rounded-xl border border-cream px-3 py-2 font-body focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </div>

        {error && <p className="text-sm text-red-600 font-body">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-gold text-white font-body py-2 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
