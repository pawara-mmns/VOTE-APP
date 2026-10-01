import { Radio, RefreshCw } from "lucide-react";
export function VotingStatus({ open, loading = false }: { open?: boolean; loading?: boolean }) {
  return <span className={`status-badge ${loading ? "status-loading" : open ? "status-open" : "status-closed"}`}><span className="status-dot" />{loading ? "CONNECTING" : open ? "VOTING OPEN" : "VOTING CLOSED"}</span>;
}
export function LiveIndicator({ live }: { live: boolean }) {
  return <span className={`live-indicator ${live ? "is-live" : ""}`}>{live ? <Radio size={14} /> : <RefreshCw size={13} />}<span>{live ? "Updating live" : "Syncing automatically"}</span></span>;
}
