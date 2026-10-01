export type VotingSession = {
  id: string;
  name: string;
  question: string;
  description: string | null;
  options_revision: number;
  ip_protection_enabled: boolean;
  max_votes_per_ip: number;
  voting_mode: "standard" | "strict_code";
  is_open: boolean;
  created_at: string;
  closed_at: string | null;
};
export type VotingOption = { id: string; name: string; display_order: number; vote_count: number };
export type Snapshot = { session: VotingSession; options: VotingOption[] };
export type SessionSettings = { name: string; question: string; description: string };
export type CodeStats = { total: number; used: number; available: number };
// Visual colors do not encode voting options or impose a limit on their number.
const COLORS = ["#a394ff", "#65d9c1", "#f5bf70", "#f58eae", "#77baff", "#b8dc7e"];
export function optionStyle(order: number) {
  const color = COLORS[(order - 1) % COLORS.length] ?? COLORS[0];
  return { "--group-color": color, "--group-bg": `${color}13`, color };
}
export function totalVotes(snapshot: Snapshot | null) {
  return snapshot?.options.reduce((sum, option) => sum + option.vote_count, 0) ?? 0;
}
export function rankedOptions(options: VotingOption[]) {
  const sorted = [...options].sort((a, b) => b.vote_count - a.vote_count || a.display_order - b.display_order);
  return sorted.map((option) => ({ ...option, rank: sorted.findIndex((o) => o.vote_count === option.vote_count) + 1 }));
}
export function isUUID(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
