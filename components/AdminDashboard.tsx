"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChartNoAxesColumnIncreasing, Check, CircleStop, LoaderCircle, LogOut, Play, Plus, QrCode, ShieldCheck, X } from "lucide-react";
import { PageShell } from "@/components/Shell";
import { VotingStatus, LiveIndicator } from "@/components/VotingStatus";
import { Feedback } from "@/components/Feedback";
import { SessionEditor, OptionsEditor, PollPreview, NewSessionForm, type Mutate } from "@/components/PollEditor";
import { AntiAbuseEditor, VotingCodes } from "@/components/AntiAbuseEditor";
import { api, ApiError, errorMessage } from "@/lib/client-api";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { optionStyle, totalVotes, type Snapshot, type VotingOption } from "@/lib/voting/types";

export function AdminDashboard() {
  const router = useRouter();
  const { data, loading, error, live, refresh, accept } = useLiveSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [codesBusy, setCodesBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"new" | "close" | VotingOption | null>(null);
  const [modalKey, setModalKey] = useState(0);
  const [modalSessionId, setModalSessionId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const total = totalVotes(data);
  const controlsBusy = !!busy || codesBusy;
  const mutate: Mutate = async (path, body, label, method) => {
    if (inFlight.current || codesBusy) return false;
    inFlight.current = true; setBusy(label); setActionError(null); setNotice(null);
    try {
      const result = await api<{ snapshot?: Snapshot | null }>(path, body, method);
      if (path.endsWith("/logout")) router.refresh();
      else { if (result.snapshot) accept(result.snapshot); refresh(); setNotice(`${label} completed.`); }
      return true;
    } catch (err) {
      setActionError(errorMessage(err));
      if (err instanceof ApiError && err.status === 401) router.refresh();
      refresh();
      return false;
    } finally { inFlight.current = false; setBusy(null); }
  };
  function showModal(value: "new" | "close" | VotingOption) { setActionError(null); setModalSessionId(data?.session.id ?? null); setModal(value); setModalKey((key) => key + 1); dialog.current?.showModal(); }
  function closeModal() { dialog.current?.close(); setModal(null); }
  async function confirm() {
    if (!modalSessionId || !modal || modal === "new") return;
    const deleting = typeof modal === "object";
    if (await mutate(deleting ? `/api/admin/options/${modal.id}` : "/api/admin/close", { sessionId: modalSessionId, confirm: true }, deleting ? "Delete option" : "Close voting", deleting ? "DELETE" : "POST")) closeModal();
  }
  const canCreate = !loading && (!error || (!data && error.startsWith("No active voting session.")));
  return <PageShell page="admin"><main className="admin-main">
    <div className="admin-heading"><div><div className="eyebrow"><span className="tiny-line" />ORGANIZER DASHBOARD</div><h1>You run the moment<span className="title-dot">.</span></h1><p>Configure your poll, then let the room decide.</p></div><button className="button button-secondary logout-button" onClick={() => void mutate("/api/admin/logout", {}, "Sign out")} disabled={controlsBusy}><LogOut size={16} />Sign out</button></div>
    <Feedback error={error} loading={loading} refresh={refresh} />{actionError && !modal && <div className="feedback" role="alert">{actionError}</div>}{notice && <div className="notice" role="status"><Check size={17} />{notice}</div>}
    <div className="admin-layout">
      <section className="admin-control-card"><div className="card-eyebrow"><span>CURRENT SESSION</span><ShieldCheck size={17} /></div>
        {data && <div className="session-summary"><h2>{data.session.name}</h2><p>{data.session.question}</p>{data.session.description && <p className="summary-description">{data.session.description}</p>}<span>{data.options.length} voting options</span></div>}
        <div className="admin-status"><span className={`large-status-dot ${data?.session.is_open ? "open" : ""}`} /><h2>{data ? data.session.is_open ? "Open" : "Closed" : loading ? "Connecting" : "No session"}</h2><VotingStatus open={data?.session.is_open} loading={loading} /></div>
        <p>{data?.session.is_open ? "Participants can cast their votes right now." : "Configure the options, then open voting when you’re ready."}</p>
        <div className="admin-status-buttons"><button className="button button-primary" disabled={controlsBusy || !data || !!error || data.session.is_open} onClick={() => void mutate("/api/admin/open", { sessionId: data?.session.id }, "Open voting")}>{busy === "Open voting" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}Open voting</button><button className="button button-secondary" disabled={controlsBusy || !data || !!error || !data.session.is_open} onClick={() => showModal("close")}><CircleStop size={17} />Close voting</button></div>
        <div className="admin-new-session"><h3>A fresh start</h3><p>Create a named session with your own options.<br />Previous sessions stay safely saved.</p><button className="button button-secondary" disabled={controlsBusy || !canCreate} onClick={() => showModal("new")}><Plus size={17} />Start new voting session</button></div>
      </section>
      <section className="admin-count-card"><div className="card-eyebrow"><span>CURRENT RESULTS</span><LiveIndicator live={!!data && live && !error} /></div><div className="admin-counts">{data?.options.map((option) => <div key={option.id} style={optionStyle(option.display_order)}><span className="group-letter">{option.display_order}</span><span>{option.name}</span><strong>{option.vote_count.toLocaleString()}<small> votes</small></strong></div>)}</div>{data && total === 0 && <p className="waiting-votes">Waiting for votes…</p>}<div className="admin-total"><span>Total votes</span><strong>{data ? total.toLocaleString() : "—"}</strong></div></section>
    </div>
    {data && <div className="admin-editor-layout"><div><SessionEditor key={`${data.session.id}:${data.session.name}:${data.session.question}:${data.session.description}`} data={data} busy={busy || (codesBusy ? "Generate codes" : null)} mutate={mutate} /><OptionsEditor key={data.session.id} data={data} busy={busy || (codesBusy ? "Generate codes" : null)} mutate={mutate} remove={showModal} /><AntiAbuseEditor key={`${data.session.id}:${data.session.ip_protection_enabled}:${data.session.max_votes_per_ip}:${data.session.voting_mode}`} data={data} busy={busy} mutate={mutate} codesBusy={codesBusy} /></div><div><PollPreview key={data.session.id} data={data} /><VotingCodes key={data.session.id} data={data} busy={busy} onBusy={setCodesBusy} /></div></div>}
    <div className="admin-display-links"><Link href="/" target="_blank" rel="noopener noreferrer"><QrCode size={25} /><div><strong>Show QR code</strong><span>The same QR works across sessions</span></div><ArrowRight size={18} /></Link><Link href="/results" target="_blank" rel="noopener noreferrer"><ChartNoAxesColumnIncreasing size={25} /><div><strong>Show live results</strong><span>Put every vote on the big screen</span></div><ArrowRight size={18} /></Link></div>
    {data && <p className="session-info">Active session · {data.session.id.slice(0, 8)} · Started {new Date(data.session.created_at).toLocaleString()}</p>}
    <dialog ref={dialog} className={`confirm-dialog ${modal === "new" ? "session-dialog" : ""}`} aria-labelledby="confirm-title" onCancel={(e) => { if (busy) e.preventDefault(); else setModal(null); }} onClose={() => setModal(null)}>
      <button className="dialog-close" aria-label="Close dialog" disabled={!!busy} onClick={closeModal}><X size={20} /></button>
      {modal === "new" ? <NewSessionForm key={modalKey} current={data} busy={busy} mutate={mutate} cancel={closeModal} done={closeModal} /> : <><h2 id="confirm-title">{typeof modal === "object" && modal ? `Delete “${modal.name}”?` : "Close voting?"}</h2><p>{typeof modal === "object" && modal ? "This action cannot be undone." : "Participants will no longer be able to submit votes. You can reopen this session later."}</p><div className="dialog-actions"><button className="button button-secondary" autoFocus disabled={!!busy} onClick={closeModal}>Cancel</button><button className="button button-primary" disabled={!!busy} onClick={() => void confirm()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{typeof modal === "object" && modal ? "Delete option" : "Close voting"}</button></div></>}
      {actionError && <p className="inline-error" role="alert">{actionError}</p>}
    </dialog>
  </main></PageShell>;
}
