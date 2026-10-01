import { Check } from "lucide-react";
import { optionStyle, type VotingOption } from "@/lib/voting/types";

export function ResultBar({ option, rank, total, highlighted }: { option: VotingOption; rank: number; total: number; highlighted: boolean }) {
  const percent = total ? option.vote_count / total * 100 : 0;
  const tone = optionStyle(option.display_order);
  return <div className={`result-row ${highlighted ? "result-highlight" : ""}`} style={tone}>
    <div className="result-top">
      <div className="result-name"><span className="group-letter" aria-label={`Rank ${rank}`}>{rank}</span><h2>{option.name}</h2>{highlighted && <span className="top-label"><Check size={13} />TOP VOTES</span>}</div>
      <div className="result-numbers"><span>{option.vote_count.toLocaleString()} <small>{option.vote_count === 1 ? "vote" : "votes"}</small></span><strong>{percent.toFixed(1)}<small>%</small></strong></div>
    </div>
    <div className="result-track" role="progressbar" aria-label={`${option.name} share of votes`} aria-valuenow={Number(percent.toFixed(1))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${option.vote_count} votes, ${percent.toFixed(1)} percent`}>
      <div className="result-fill" style={{ width: `${percent}%`, backgroundColor: tone.color }} />
    </div>
  </div>;
}
