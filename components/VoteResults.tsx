import { rankedOptions, totalVotes, type Snapshot } from "@/lib/voting/types";
import { ResultBar } from "@/components/ResultBar";

export function VoteResults({ data }: { data: Snapshot | null }) {
  const total = totalVotes(data);
  const options = rankedOptions(data?.options ?? []);
  return <div className={`result-bars ${options.length > 6 ? "many-results" : ""}`}>
    {data && total === 0 && <p className="waiting-votes">Waiting for votes…</p>}
    {options.map((option) => <ResultBar key={option.id} option={option} rank={option.rank} total={total} highlighted={!!data && !data.session.is_open && total > 0 && option.rank === 1} />)}
  </div>;
}
