"use client";
import Link from "next/link";
import { ArrowUpRight, QrCode, Users } from "lucide-react";
import { PageShell } from "@/components/Shell";
import { VotingStatus, LiveIndicator } from "@/components/VotingStatus";
import { VoteResults } from "@/components/VoteResults";
import { Feedback } from "@/components/Feedback";
import { useLiveSession } from "@/lib/voting/use-live-session";
import { totalVotes } from "@/lib/voting/types";

export function ResultsPage() {
  const { data, loading, error, live, refresh } = useLiveSession();
  const total = totalVotes(data);
  return <PageShell page="results"><main className="results-main"><div className="results-heading"><div><div className="eyebrow"><span className="tiny-line" />{data?.session.name ?? "EVENT VOTING"}</div><h1>Live results<span className="title-dot">.</span></h1><p>{data && !data.session.is_open ? "Voting is closed. Here’s how the room voted." : "Every vote is part of the story. Watch it unfold."}</p></div><VotingStatus open={data?.session.is_open} loading={loading || !data} /></div><Feedback error={error} loading={loading} refresh={refresh} /><div className="results-card"><div className="results-card-heading"><span>THE ROOM HAS A VOICE</span><LiveIndicator live={live && !error} /></div><VoteResults data={data} /><div className="results-card-footer"><div><Users size={22} /><span>Total votes<strong>{data ? total.toLocaleString() : "—"}</strong></span></div><p>{total === 0 ? "The first vote starts the story." : data?.session.is_open ? "Voting is open. The next vote could be yours." : "Thank you for making your voice heard."}</p></div></div><Link className="results-join" href="/"><QrCode size={19} /><span>Want to join in? <strong>Scan the QR code</strong></span><ArrowUpRight size={18} /></Link><p className="results-note">{data?.session.is_open ? "Results update automatically. Final standings appear when voting closes." : "Tied groups with the most votes are highlighted equally."}</p></main></PageShell>;
}
