export const GROUPS = ["A", "B", "C", "D"] as const;
export type Group = (typeof GROUPS)[number];
export type VotingSession = {
  id: string;
  name: string;
  is_open: boolean;
  created_at: string;
  closed_at: string | null;
};
export type Snapshot = { session: VotingSession; totals: Record<Group, number> };
export const GROUP_STYLES: Record<Group, { color: string; label: string; className: string }> = {
  A: { color: "#a394ff", label: "A", className: "group-a" },
  B: { color: "#65d9c1", label: "B", className: "group-b" },
  C: { color: "#f5bf70", label: "C", className: "group-c" },
  D: { color: "#f58eae", label: "D", className: "group-d" },
};
export function totalVotes(snapshot: Snapshot | null) {
  return snapshot ? GROUPS.reduce((sum, group) => sum + snapshot.totals[group], 0) : 0;
}
export function isGroup(value: unknown): value is Group {
  return typeof value === "string" && GROUPS.includes(value as Group);
}
export function isUUID(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
