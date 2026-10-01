"use client";
import { Check, ArrowUpRight } from "lucide-react";
import { optionStyle, type VotingOption } from "@/lib/voting/types";

export function OptionCard({ option, selected, disabled, onSelect }: { option: VotingOption; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return <button type="button" className={`vote-group ${selected ? "is-selected" : ""}`} style={optionStyle(option.display_order)} onClick={onSelect} disabled={disabled} aria-pressed={selected}>
    <span className="vote-group-icon">{option.display_order}</span>
    <span className="vote-group-name">{option.name}<small>{selected ? "Your selection" : "Select this option"}</small></span>
    <span className="vote-group-check">{selected ? <Check size={19} /> : <ArrowUpRight size={18} />}</span>
  </button>;
}
