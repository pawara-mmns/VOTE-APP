import { Check, ArrowUpRight } from "lucide-react";
import { GROUP_STYLES, type Group } from "@/lib/voting/types";

export function GroupCard({ group, selected, disabled, onSelect }: { group: Group; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return <button type="button" className={`vote-group ${GROUP_STYLES[group].className} ${selected ? "is-selected" : ""}`} onClick={onSelect} disabled={disabled} aria-pressed={selected}><span className="vote-group-icon">{group}</span><span className="vote-group-name">Group {group}<small>{selected ? "Your selection" : "Select this group"}</small></span><span className="vote-group-check">{selected ? <Check size={19} /> : <ArrowUpRight size={18} />}</span></button>;
}
