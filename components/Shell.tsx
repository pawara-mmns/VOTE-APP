import Link from "next/link";
import { ArrowUpRight, AudioLines, ChartNoAxesColumnIncreasing, QrCode, ShieldCheck } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="LiveVote home"><span className="brand-mark"><AudioLines size={20} strokeWidth={2.5} /></span><span>live<span className="brand-light">vote</span><span className="brand-dot">.</span></span>{!compact && <span className="brand-divider" />}</Link>;
}
export function Header({ page }: { page: "home" | "results" | "admin" }) {
  return <header className="site-header"><div className="brand-row"><Brand /><span className="header-caption">THE LIVE EVENT EXPERIENCE</span></div><nav aria-label="Main navigation"><Link className={`nav-link ${page === "home" ? "nav-active" : ""}`} href="/"><QrCode size={16} /><span>Join the vote</span></Link><Link className={`nav-link ${page === "results" ? "nav-active" : ""}`} href="/results"><ChartNoAxesColumnIncreasing size={16} /><span>Live results</span></Link><Link className={`admin-link ${page === "admin" ? "nav-active" : ""}`} href="/admin" aria-label="Admin controls"><ShieldCheck size={18} /></Link></nav></header>;
}
export function Footer() {
  return <footer className="site-footer"><span>FOUR GROUPS. ONE SHARED MOMENT.</span><Link href="/vote">Every voice counts <ArrowUpRight size={13} /></Link></footer>;
}
export function PageShell({ page, children }: { page: "home" | "results" | "admin"; children: React.ReactNode }) {
  return <div className="app-shell"><Header page={page} />{children}<Footer /></div>;
}
