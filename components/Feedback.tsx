"use client";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
export function Feedback({ error, loading, refresh }: { error: string | null; loading: boolean; refresh: () => void }) {
  if (error) return <div className="feedback" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={refresh} aria-label="Retry connection"><RefreshCw size={16} /></button></div>;
  if (loading) return <div className="loading-line" role="status"><LoaderCircle className="spin" size={16} />Connecting to the event…</div>;
  return null;
}
