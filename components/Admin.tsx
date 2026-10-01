"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChartNoAxesColumnIncreasing, Check, CircleStop, KeyRound, LoaderCircle, LockKeyhole, LogOut, Play, Plus, QrCode, ShieldCheck, X } from "lucide-react";
import { PageShell } from "@/components/Shell";
import { VotingStatus, LiveIndicator } from "@/components/VotingStatus";
import { Feedback } from "@/components/Feedback";
import { api, ApiError, errorMessage } from "@/lib/client-api";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { GROUPS, GROUP_STYLES, totalVotes } from "@/lib/voting/types";

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

export function AdminDashboard() {
  const router = useRouter();
  const { data, loading, error, live, refresh } = useLiveSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const total = totalVotes(data);
  async function action(name: "open" | "close" | "new-session" | "logout") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(name); setActionError(null); setNotice(null);
    try {
      await api(`/api/admin/${name}`, name === "new-session" ? { confirm: true } : {});
      if (name === "logout") router.refresh();
      else {
        refresh();
        setNotice(name === "new-session" ? "New session created. Open voting when you’re ready." : name === "open" ? "Voting is now open." : "Voting is now closed.");
      }
    } catch (err) {
      setActionError(errorMessage(err));
      if (err instanceof ApiError && err.status === 401) router.refresh();
    } finally { inFlight.current = false; setBusy(null); }
  }
  return <PageShell page="admin"><main className="admin-main"><div className="admin-heading"><div><div className="eyebrow"><span className="tiny-line" />ORGANIZER DASHBOARD</div><h1>You run the moment<span className="title-dot">.</span></h1><p>Everything you need for a smooth live vote.</p></div><button className="button button-secondary logout-button" onClick={() => void action("logout")} disabled={!!busy}><LogOut size={16} />Sign out</button></div><Feedback error={error} loading={loading} refresh={refresh} />{actionError && <div className="feedback" role="alert">{actionError}</div>}{notice && <div className="notice" role="status"><Check size={17} />{notice}</div>}<div className="admin-layout"><section className="admin-control-card"><div className="card-eyebrow"><span>VOTING STATUS</span><ShieldCheck size={17} /></div><div className="admin-status"><span className={`large-status-dot ${data?.session.is_open ? "open" : ""}`} /><h2>{data ? data.session.is_open ? "Open" : "Closed" : "Connecting"}</h2><VotingStatus open={data?.session.is_open} loading={loading || !data} /></div><p>{data?.session.is_open ? "Participants can cast their votes right now." : "Open voting when your audience is ready."}</p><div className="admin-status-buttons"><button className="button button-primary" disabled={!!busy || !data || !!error || data.session.is_open} onClick={() => void action("open")}>{busy === "open" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}Open voting</button><button className="button button-secondary" disabled={!!busy || !data || !!error || !data.session.is_open} onClick={() => void action("close")}>{busy === "close" ? <LoaderCircle className="spin" size={17} /> : <CircleStop size={17} />}Close voting</button></div><div className="admin-new-session"><div><h3>A fresh start</h3><p>Create a new session with zero votes.<br />Previous sessions stay safely saved.</p></div><button className="button button-secondary" disabled={!!busy} onClick={() => dialog.current?.showModal()}>{busy === "new-session" ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}Start new voting session</button></div></section><section className="admin-count-card"><div className="card-eyebrow"><span>SESSION AT A GLANCE</span><LiveIndicator live={live && !error} /></div><div className="admin-counts">{GROUPS.map((g) => <div key={g} className={GROUP_STYLES[g].className}><span className="group-letter">{g}</span><span>Group {g}</span><strong>{data ? data.totals[g].toLocaleString() : "—"}</strong></div>)}</div><div className="admin-total"><span>Total votes</span><strong>{data ? total.toLocaleString() : "—"}</strong></div></section></div><div className="admin-display-links"><Link href="/" target="_blank" rel="noopener noreferrer"><QrCode size={25} /><div><strong>Show QR code</strong><span>Let the room join in</span></div><ArrowRight size={18} /></Link><Link href="/results" target="_blank" rel="noopener noreferrer"><ChartNoAxesColumnIncreasing size={25} /><div><strong>Show live results</strong><span>Put every vote on the big screen</span></div><ArrowRight size={18} /></Link></div>{data && <p className="session-info">Active session · {data.session.id.slice(0, 8)} · Started {new Date(data.session.created_at).toLocaleString()}</p>}<dialog ref={dialog} className="confirm-dialog" aria-labelledby="new-session-title" aria-describedby="new-session-description"><button className="dialog-close" aria-label="Close dialog" onClick={() => dialog.current?.close()}><X size={20} /></button><div className="login-icon"><Plus size={26} /></div><h2 id="new-session-title">Start a new session?</h2><p id="new-session-description">This will close the current session and start a fresh one with zero votes. Previous votes are preserved. Voting will stay closed until you open it.</p><div className="dialog-actions"><button className="button button-secondary" autoFocus onClick={() => dialog.current?.close()}>Cancel</button><button className="button button-primary" onClick={() => { dialog.current?.close(); void action("new-session"); }}>Start new session<ArrowRight size={17} /></button></div></dialog></main></PageShell>;
}
