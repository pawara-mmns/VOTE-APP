"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, LockKeyhole, LoaderCircle, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Shell";
import { VotingStatus } from "@/components/VotingStatus";
import { OptionCard } from "@/components/OptionCard";
import { Feedback } from "@/components/Feedback";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { optionStyle, isUUID } from "@/lib/voting/types";
import { api, ApiError, errorMessage } from "@/lib/client-api";

type Receipt = { sessionId: string; optionId: string | null; optionName: string | null; justSubmitted: boolean };
const DEVICE_KEY = "qr_voting_device_id";
const RECEIPT_KEY = "qr_voting_receipt";

export function VotingPage() {
  const { data, loading, error, refresh } = useLiveSession();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ id: string; sessionId: string; revision: number } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState<{ sessionId: string; value: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        let identifier = localStorage.getItem(DEVICE_KEY);
        if (!isUUID(identifier)) { identifier = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, identifier); }
        setDeviceId(identifier);
        const raw = localStorage.getItem(RECEIPT_KEY);
        if (raw) {
          try {
            const saved = JSON.parse(raw);
            // Legacy receipts still mark this session as voted, without hardcoded group labels.
            if (isUUID(saved.sessionId)) setReceipt({ sessionId: saved.sessionId, optionId: isUUID(saved.optionId) ? saved.optionId : null, optionName: typeof saved.optionName === "string" ? saved.optionName : null, justSubmitted: false });
          } catch { localStorage.removeItem(RECEIPT_KEY); }
        }
      } catch { setDeviceError("Enable browser storage and open this page over HTTPS (or localhost), then reload to vote."); }
    });
    return () => { active = false; };
  }, []);

  const currentReceipt = receipt?.sessionId === data?.session.id ? receipt : null;
  const selected = selection && selection.sessionId === data?.session.id && selection.revision === data?.session.options_revision ? data.options.find((o) => o.id === selection.id) : undefined;
  const votedOption = data?.options.find((o) => o.id === currentReceipt?.optionId);
  const disabled = submitting || loading || !!error || !!deviceError || !deviceId || !data?.session.is_open;
  const strict = data?.session.voting_mode === "strict_code";
  const votingCode = codeInput?.sessionId === data?.session.id ? codeInput?.value ?? "" : "";
  async function submit() {
    if (inFlight.current || disabled || !selected || !data || !deviceId || (strict && votingCode.trim().length !== 6)) return;
    inFlight.current = true; setSubmitting(true); setSubmitError(null);
    const submittedSession = data.session.id;
    try {
      const result = await api<{ sessionId: string; optionId: string; optionName: string }>("/api/vote", { optionId: selected.id, optionsRevision: data.session.options_revision, sessionId: submittedSession, deviceId, ...(strict ? { votingCode } : {}) });
      const saved = { ...result, justSubmitted: true };
      setReceipt(saved);
      setCodeInput(null);
      try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(saved)); } catch { /* Database uniqueness still protects a committed vote. */ }
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate") {
        const saved = { sessionId: submittedSession, optionId: null, optionName: null, justSubmitted: false };
        setReceipt(saved);
        try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(saved)); } catch { /* Database uniqueness still protects the vote. */ }
      } else {
        setSubmitError(errorMessage(err));
        if (err instanceof ApiError && ["session_changed", "options_changed", "invalid_option", "closed", "no_session", "code_required"].includes(err.code ?? "")) { setSelection(null); refresh(); }
      }
    } finally { inFlight.current = false; setSubmitting(false); }
  }
  return <div className="voting-shell">
    <header className="voting-header"><Brand compact /><VotingStatus open={data?.session.is_open} loading={loading || !data} /></header>
    <main className="voting-main">
      <span className="eyebrow">{data?.session.name ?? "EVENT VOTING"}</span>
      {currentReceipt ? <section className="vote-outcome" aria-live="polite">
        <div className="outcome-icon"><CheckCircle2 size={40} /></div>
        <h1>{currentReceipt.justSubmitted ? "Vote submitted!" : "You’ve already voted."}</h1>
        {(votedOption?.name || currentReceipt.optionName) && <><p>You voted for</p><div className="voted-group" style={optionStyle(votedOption?.display_order ?? 1)}>{votedOption?.name ?? currentReceipt.optionName}<Check size={20} /></div></>}
        <p>{currentReceipt.justSubmitted ? "Thank you for voting." : "You have already voted in this session."}<br />Follow along as the results come in.</p>
        <Link href="/results" className="button button-primary">See live results<ArrowRight size={18} /></Link>
      </section> : data && !data.session.is_open ? <section className="vote-outcome">
        <div className="outcome-icon outcome-closed"><LockKeyhole size={34} /></div><h2 className="closed-question">{data.session.question}</h2>
        <h1>Voting is currently closed.</h1><p>The organizer will open voting when it’s time.<br />This page checks automatically.</p>
        <Link href="/results" className="button button-secondary">View results<ArrowRight size={18} /></Link><Feedback error={error} loading={loading} refresh={refresh} />
      </section> : <>
        <h1>{data?.session.question ?? "Cast your vote"}<span className="title-dot">.</span></h1>
        <p className="vote-description">{data?.session.description || "Select one option below."}</p>
        <Feedback error={error} loading={loading} refresh={refresh} />
        {deviceError && <p className="inline-error" role="alert">{deviceError}</p>}
        {strict && data && <div className="voting-code-field"><label htmlFor="voting-code">Enter Voting Code</label><input id="voting-code" value={votingCode} onChange={(e) => { setCodeInput({ sessionId: data.session.id, value: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) }); setSubmitError(null); }} maxLength={6} autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={disabled} placeholder="A7K9P2" aria-describedby="voting-code-help" /><p id="voting-code-help">Use the one-time code given to you by the organizer. Each code works once in this session.</p></div>}
        <div className="voting-groups" role="group" aria-label="Choose one voting option">{data?.options.map((option) => <OptionCard key={option.id} option={option} selected={selected?.id === option.id} disabled={disabled} onSelect={() => { setSelection({ id: option.id, sessionId: data.session.id, revision: data.session.options_revision }); setSubmitError(null); }} />)}</div>
        {data && <div className="vote-confirmation">
          <p aria-live="polite">{selected ? <>You’ve selected <strong>{selected.name}</strong>. Ready?</> : "Select an option above to continue."}</p>
          {submitError && <p className="inline-error" role="alert">{submitError}</p>}
          <button className="button button-primary confirm-button" disabled={disabled || !selected || (strict && votingCode.trim().length !== 6)} onClick={() => void submit()}>{submitting ? <LoaderCircle size={19} className="spin" /> : <Check size={19} />}{submitting ? "Submitting your vote…" : "Confirm vote"}{!submitting && <ArrowRight size={18} />}</button>
          <span className="vote-privacy"><ShieldCheck size={14} />{strict ? "One-time code and device protection." : "One vote per browser, per session."}</span>
        </div>}
      </>}
    </main><footer className="voting-footer">POWERED BY LIVEVOTE <span>·</span> EVERY VOICE COUNTS</footer>
  </div>;
}
