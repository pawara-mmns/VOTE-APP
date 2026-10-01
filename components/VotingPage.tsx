"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, LockKeyhole, LoaderCircle, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Shell";
import { VotingStatus } from "@/components/VotingStatus";
import { GroupCard } from "@/components/GroupCard";
import { Feedback } from "@/components/Feedback";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { GROUPS, GROUP_STYLES, isGroup, isUUID, type Group } from "@/lib/voting/types";
import { api, ApiError, errorMessage } from "@/lib/client-api";

type Receipt = { sessionId: string; group: Group | null; justSubmitted: boolean };
const DEVICE_KEY = "qr_voting_device_id";
const RECEIPT_KEY = "qr_voting_receipt";

export function VotingPage() {
  const { data, loading, error, refresh } = useLiveSession();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Group | null>(null);
  const [selectionSession, setSelectionSession] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    // Read the external browser store after hydration, without blocking paint.
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
            if (isUUID(saved.sessionId) && (isGroup(saved.group) || saved.group === null)) setReceipt({ ...saved, justSubmitted: false });
          } catch { localStorage.removeItem(RECEIPT_KEY); }
        }
      } catch { setDeviceError("Enable browser storage and open this page over HTTPS (or localhost), then reload to vote."); }
    });
    return () => { active = false; };
  }, []);

  const currentReceipt = receipt?.sessionId === data?.session.id ? receipt : null;
  const currentSelection = selectionSession === data?.session.id ? selected : null;
  const disabled = submitting || loading || !!error || !!deviceError || !deviceId || !data?.session.is_open;
  async function submit() {
    if (inFlight.current || disabled || !currentSelection || !data || !deviceId) return;
    inFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const submittedSession = data.session.id;
    try {
      const result = await api<{ sessionId: string; group: Group }>("/api/vote", { group: currentSelection, sessionId: submittedSession, deviceId });
      const saved = { sessionId: result.sessionId, group: result.group, justSubmitted: true };
      setReceipt(saved);
      // A committed vote remains successful even if storage fails afterwards.
      try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(saved)); } catch { /* Database uniqueness still protects the vote. */ }
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate") {
        const saved = { sessionId: submittedSession, group: null, justSubmitted: false };
        setReceipt(saved);
        try { localStorage.setItem(RECEIPT_KEY, JSON.stringify(saved)); } catch { /* Database uniqueness still protects the vote. */ }
      } else {
        setSubmitError(errorMessage(err));
        if (err instanceof ApiError && ["session_changed", "closed", "no_session"].includes(err.code ?? "")) {
          setSelected(null); setSelectionSession(null); refresh();
        }
      }
    } finally { inFlight.current = false; setSubmitting(false); }
  }

  return <div className="voting-shell"><header className="voting-header"><Brand compact /><VotingStatus open={data?.session.is_open} loading={loading || !data} /></header><main className="voting-main">{currentReceipt ? <section className="vote-outcome" aria-live="polite"><div className="outcome-icon"><CheckCircle2 size={40} /></div><span className="eyebrow">YOUR VOICE COUNTS</span><h1>{currentReceipt.justSubmitted ? "Vote submitted!" : "You’ve already voted."}</h1>{currentReceipt.group && <><p>You voted for</p><div className={`voted-group ${GROUP_STYLES[currentReceipt.group].className}`}><span>{currentReceipt.group}</span>Group {currentReceipt.group}<Check size={20} /></div></>}<p>{currentReceipt.justSubmitted ? "Thank you for voting." : "You have already voted in this session."}<br />Follow along as the results come in.</p><Link href="/results" className="button button-primary">See live results<ArrowRight size={18} /></Link></section> : data && !data.session.is_open ? <section className="vote-outcome"><div className="outcome-icon outcome-closed"><LockKeyhole size={34} /></div><span className="eyebrow">STAY TUNED</span><h1>Voting is currently closed.</h1><p>The organizer will open voting when it’s time.<br />This page checks automatically.</p><Link href="/results" className="button button-secondary">View results<ArrowRight size={18} /></Link><Feedback error={error} loading={loading} refresh={refresh} /></section> : <><span className="eyebrow">ONE CHOICE. YOUR VOICE.</span><h1>Cast your vote<span className="title-dot">.</span></h1><p className="vote-description">Choose one group. Make your moment count.</p><Feedback error={error} loading={loading} refresh={refresh} />{deviceError && <p className="inline-error" role="alert">{deviceError}</p>}<div className="voting-groups" role="group" aria-label="Choose one group">{GROUPS.map((group) => <GroupCard key={group} group={group} selected={currentSelection === group} disabled={disabled} onSelect={() => { setSelected(group); setSelectionSession(data?.session.id ?? null); setSubmitError(null); }} />)}</div><div className="vote-confirmation"><p aria-live="polite">{currentSelection ? <>You’ve selected <strong>Group {currentSelection}</strong>. Ready?</> : "Select a group above to continue."}</p>{submitError && <p className="inline-error" role="alert">{submitError}</p>}<button className="button button-primary confirm-button" disabled={disabled || !currentSelection} onClick={() => void submit()}>{submitting ? <LoaderCircle size={19} className="spin" /> : <Check size={19} />}{submitting ? "Submitting your vote…" : "Confirm vote"}{!submitting && <ArrowRight size={18} />}</button><span className="vote-privacy"><ShieldCheck size={14} />One vote per browser, per session.</span></div></>}</main><footer className="voting-footer">POWERED BY LIVEVOTE <span>·</span> EVERY VOICE COUNTS</footer></div>;
}
