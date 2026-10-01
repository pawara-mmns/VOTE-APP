import { Check } from "lucide-react";
import { GROUP_STYLES, type Group } from "@/lib/voting/types";

export function ResultBar({ group, count, total, highlighted, final }: { group: Group; count: number; total: number; highlighted: boolean; final: boolean }) {
  const percent = total ? count / total * 100 : 0;
  return <div className={`result-row ${GROUP_STYLES[group].className} ${highlighted ? "result-highlight" : ""}`}><div className="result-top"><div className="result-name"><span className="group-letter">{group}</span><h2>Group {group}</h2>{highlighted && <span className="top-label"><Check size={13} />{final ? "TOP VOTES" : ""}</span>}</div><div className="result-numbers"><span>{count.toLocaleString()} <small>{count === 1 ? "vote" : "votes"}</small></span><strong>{percent.toFixed(1)}<small>%</small></strong></div></div><div className="result-track" role="progressbar" aria-label={`Group ${group} share of votes`} aria-valuenow={Number(percent.toFixed(1))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${count} votes, ${percent.toFixed(1)} percent`}><div className="result-fill" style={{ width: `${percent}%`, backgroundColor: GROUP_STYLES[group].color }} /></div></div>;
}
