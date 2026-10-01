import { GROUPS, totalVotes, type Snapshot } from "@/lib/voting/types";
import { ResultBar } from "@/components/ResultBar";

export function VoteResults({ data }: { data: Snapshot | null }) {
  const total = totalVotes(data);
  const max = Math.max(...GROUPS.map((g) => data?.totals[g] ?? 0));
  return <div className="result-bars">{GROUPS.map((group) => <ResultBar key={group} group={group} count={data?.totals[group] ?? 0} total={total} highlighted={!!data && !data.session.is_open && total > 0 && data.totals[group] === max} final={!!data && !data.session.is_open} />)}</div>;
}
