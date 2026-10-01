"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/Shell";
import { api, errorMessage } from "@/lib/client-api";

export function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !password) return;
    inFlight.current = true; setLoading(true); setError(null);
    try {
      await api("/api/admin/login", { password });
      setPassword(""); router.refresh();
    } catch (err) { setError(errorMessage(err)); }
    finally { inFlight.current = false; setLoading(false); }
  }
  return <PageShell page="admin"><main className="login-main"><section className="login-card"><div className="login-icon"><LockKeyhole size={27} /></div><span className="eyebrow">BEHIND THE MOMENT</span><h1>Event controls<span className="title-dot">.</span></h1><p>Sign in to manage your voting session.</p><form onSubmit={login}><label htmlFor="password">Admin password</label><div className="password-field"><KeyRound size={18} /><input id="password" type="password" required maxLength={512} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} placeholder="Enter your password" /></div>{error && <p className="inline-error" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={loading || !password}>{loading ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}{loading ? "Signing in…" : "Sign in"}<ArrowRight size={18} /></button></form><span className="login-note"><LockKeyhole size={13} />Secure access for event organizers</span></section></main></PageShell>;
}

export { AdminDashboard } from "./AdminDashboard";
