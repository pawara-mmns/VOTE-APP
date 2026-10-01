"use client";
import Link from "next/link";
import { ArrowRight, ChartNoAxesColumnIncreasing, Check, MousePointer2, ScanLine } from "lucide-react";
import { PageShell } from "@/components/Shell";
import { QRDisplay } from "@/components/QRDisplay";
import { VotingStatus } from "@/components/VotingStatus";
import { Feedback } from "@/components/Feedback";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { GROUPS, GROUP_STYLES, totalVotes } from "@/lib/voting/types";

export function Presentation() {
  const { data, loading, error, refresh } = useLiveSession();
  const total = totalVotes(data);
  return <PageShell page="home"><main className="presentation-main"><section className="presentation-copy"><div className="eyebrow"><span className="tiny-line" />{data?.session.name ?? "EVENT VOTING"}</div><VotingStatus open={data?.session.is_open} loading={loading || !data} /><h1>Scan to vote.<br /><span>Make it count.</span></h1><p className="hero-description">Four groups. Your choice.<br />Be part of the moment — cast your vote live.</p><div className="group-chips" aria-label="Four voting groups">{GROUPS.map((g) => <span key={g} className={GROUP_STYLES[g].className}><i />Group {g}</span>)}</div><Link href="/results" className="button button-primary hero-button"><ChartNoAxesColumnIncreasing size={18} />View live results<ArrowRight size={18} /></Link><div className="participation"><div className="avatar-stack">{GROUPS.map((g) => <span key={g} className={GROUP_STYLES[g].className}>{g}</span>)}</div><p><strong>{data ? total.toLocaleString() : "—"}</strong> votes and counting<span>Every voice makes a difference.</span></p></div><Feedback error={error} loading={loading} refresh={refresh} /></section><section className="qr-area" aria-label="Scan to vote"><div className="qr-orbit" aria-hidden="true" /><QRDisplay /><div className="scan-hint"><ScanLine size={16} /><span>No app. No sign-up. Just your voice.</span></div></section><section className="steps-strip" aria-label="How to vote"><div><span className="step-number">01</span><ScanLine size={20} /><p>Scan the code<span>Open your phone camera</span></p></div><ArrowRight className="step-arrow" size={18} /><div><span className="step-number">02</span><MousePointer2 size={20} /><p>Choose your group<span>Pick A, B, C, or D</span></p></div><ArrowRight className="step-arrow" size={18} /><div><span className="step-number">03</span><Check size={20} /><p>Confirm your vote<span>Watch the results go live</span></p></div></section></main></PageShell>;
}
