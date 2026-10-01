"use client";
import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, Save, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/client-api";
import { totalVotes, type CodeStats, type Snapshot } from "@/lib/voting/types";
import type { Mutate } from "@/components/PollEditor";

export function AntiAbuseEditor({ data, busy, mutate, codesBusy }: { data: Snapshot; busy: string | null; mutate: Mutate; codesBusy: boolean }) {
  const [enabled, setEnabled] = useState(data.session.ip_protection_enabled);
  const [limit, setLimit] = useState(String(data.session.max_votes_per_ip));
  const [mode, setMode] = useState(data.session.voting_mode);
  const modeLocked = data.session.is_open || totalVotes(data) > 0;
  return <section className="editor-card"><h2>Anti-Abuse Protection</h2><div className="protection-device"><span>Device Protection</span><strong><ShieldCheck size={16} />Enabled</strong></div>
    <form onSubmit={(e) => { e.preventDefault(); void mutate("/api/admin/anti-abuse", { sessionId: data.session.id, ipProtectionEnabled: enabled, maxVotesPerIp: Number(limit), votingMode: mode }, "Save protection", "PATCH"); }}>
      <div className="session-fields">
        <label>IP Protection<select value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")} disabled={!!busy || codesBusy}><option value="on">ON</option><option value="off">OFF</option></select></label>
        <label>Maximum Votes Per Network<input type="number" min={1} max={100} step={1} required value={limit} disabled={!!busy || codesBusy} onChange={(e) => setLimit(e.target.value)} /></label>
        <label>Voting mode<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} disabled={!!busy || codesBusy || modeLocked}><option value="standard">Standard — device and network protection</option><option value="strict_code">Strict Code — one-time voting codes</option></select></label>
      </div>
      <p className="editor-description">Multiple phones connected to the same Wi-Fi can share one public IP address. Do not set this to 1 unless each voter is expected to use a separate network.</p>
      <p className="editor-description">Strict Code requires a unique code for each participant. Device and network protections still apply. Choose the mode before opening voting; start a new session to change it after votes exist.</p>
      <button className="button button-primary" type="submit" disabled={!!busy || codesBusy}>{busy === "Save protection" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save Settings</button>
    </form>
  </section>;
}

export function VotingCodes({ data, busy, onBusy }: { data: Snapshot; busy: string | null; onBusy: (value: boolean) => void }) {
  const [count, setCount] = useState("100");
  const [codes, setCodes] = useState<string[]>([]);
  const [stats, setStats] = useState<CodeStats | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const update = async () => {
      try { const result = await api<{ stats: CodeStats }>(`/api/admin/codes?sessionId=${data.session.id}`); if (active) setStats(result.stats); }
      catch (err) { if (active) setError(errorMessage(err)); }
    };
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => { active = false; mounted.current = false; clearInterval(timer); };
  }, [data.session.id]);
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    inFlight.current = true; setGenerating(true); onBusy(true); setError(null);
    try {
      const result = await api<{ codes: string[]; stats: CodeStats }>("/api/admin/codes", { sessionId: data.session.id, count: Number(count) });
      if (mounted.current) { setCodes(result.codes); setStats(result.stats); }
    } catch (err) { if (mounted.current) setError(errorMessage(err)); }
    finally { inFlight.current = false; if (mounted.current) setGenerating(false); onBusy(false); }
  }
  function download() {
    const blob = new Blob([`Voting session: ${data.session.name}\r\nOne code per participant. Each code works once in this session.\r\n\r\n${codes.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `voting-codes-${data.session.id.slice(0, 8)}.txt`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="editor-card"><h2>One-Time Voting Codes</h2><p className="editor-description">{data.session.voting_mode === "strict_code" ? "Give one code to each participant before voting." : "Generate codes now, then enable Strict Code before opening voting."} Codes are saved as hashes. Plain codes are only shown for this generated batch.</p>
    {stats && <p className="code-stats" aria-live="polite">{stats.total} generated · {stats.used} used · {stats.available} available</p>}
    <form onSubmit={(e) => void generate(e)}><div className="session-fields"><label>Number of voting codes<input type="number" min={1} max={1000} step={1} required value={count} onChange={(e) => setCount(e.target.value)} disabled={!!busy || generating} /></label></div><button className="button button-secondary" disabled={!!busy || generating}>{generating && <LoaderCircle className="spin" size={16} />}{generating ? "Generating…" : "Generate voting codes"}</button></form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {codes.length > 0 && <div className="generated-codes"><p className="options-lock-note">Download this batch before leaving the page or generating more codes. Plain codes cannot be retrieved later.</p><textarea aria-label="Generated voting codes" readOnly value={codes.join("\n")} rows={8} spellCheck={false} /><button className="button button-primary" onClick={download}><Download size={16} />Download {codes.length} codes</button></div>}
  </section>;
}
