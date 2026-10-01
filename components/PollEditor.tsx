"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Check, LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { OptionCard } from "@/components/OptionCard";
import { optionStyle, type SessionSettings, type Snapshot, type VotingOption } from "@/lib/voting/types";

export type Mutate = (path: string, body: Record<string, unknown>, label: string, method?: "POST" | "PATCH" | "DELETE") => Promise<boolean>;

function SessionFields({ value, onChange, disabled }: { value: SessionSettings; onChange: (value: SessionSettings) => void; disabled: boolean }) {
  return <div className="session-fields">
    <label>Session name<input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} required maxLength={100} disabled={disabled} placeholder="Name your event or round" /></label>
    <label>Voting question<input value={value.question} onChange={(e) => onChange({ ...value, question: e.target.value })} required maxLength={150} disabled={disabled} placeholder="What should participants choose?" /></label>
    <label>Description <span>(optional)</span><textarea value={value.description} onChange={(e) => onChange({ ...value, description: e.target.value })} maxLength={300} rows={3} disabled={disabled} placeholder="A short instruction for participants" /></label>
  </div>;
}

export function SessionEditor({ data, busy, mutate }: { data: Snapshot; busy: string | null; mutate: Mutate }) {
  const [value, setValue] = useState<SessionSettings>({ name: data.session.name, question: data.session.question, description: data.session.description ?? "" });
  return <section className="editor-card"><h2>Voting Session Settings</h2><p className="editor-description">Set the question your audience will see. These details can be updated during voting.</p>
    <form onSubmit={(e) => { e.preventDefault(); void mutate("/api/admin/session", { ...value, sessionId: data.session.id }, "Save changes", "PATCH"); }}>
      <SessionFields value={value} onChange={setValue} disabled={!!busy} />
      <button className="button button-primary" type="submit" disabled={!!busy}>{busy === "Save changes" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Save changes</button>
    </form>
  </section>;
}

function OptionEditorRow({ option, index, count, locked, busy, mutate, sessionId, reorder, remove }: { option: VotingOption; index: number; count: number; locked: boolean; busy: string | null; mutate: Mutate; sessionId: string; reorder: (index: number, delta: number) => void; remove: (option: VotingOption) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(option.name);
  const disabled = locked || !!busy;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (await mutate(`/api/admin/options/${option.id}`, { sessionId, name }, `Rename ${option.id}`, "PATCH")) setEditing(false);
  }
  return <div className="option-editor-row" style={optionStyle(option.display_order)}>
    <span className="group-letter">{index + 1}</span>
    {editing ? <form onSubmit={(e) => void save(e)} className="option-rename"><input aria-label="Option name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={80} disabled={disabled} /><button className="icon-button" type="submit" aria-label={`Save ${option.name}`} disabled={disabled}>{busy === `Rename ${option.id}` ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button><button className="icon-button" type="button" aria-label="Cancel rename" disabled={!!busy} onClick={() => { setName(option.name); setEditing(false); }}><X size={16} /></button></form> : <span className="option-editor-name">{option.name}</span>}
    <div className="option-editor-actions">
      {!editing && <button className="icon-button" aria-label={`Edit ${option.name}`} title="Edit option" disabled={disabled} onClick={() => setEditing(true)}><Pencil size={15} /></button>}
      <button className="icon-button" aria-label={`Move ${option.name} up`} title="Move up" disabled={disabled || index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={16} /></button>
      <button className="icon-button" aria-label={`Move ${option.name} down`} title="Move down" disabled={disabled || index === count - 1} onClick={() => reorder(index, 1)}><ArrowDown size={16} /></button>
      <button className="icon-button delete-option" aria-label={`Delete ${option.name}`} title={count <= 2 ? "A session needs at least two options" : "Delete option"} disabled={disabled || count <= 2} onClick={() => remove(option)}><Trash2 size={15} /></button>
    </div>
  </div>;
}

export function OptionsEditor({ data, busy, mutate, remove }: { data: Snapshot; busy: string | null; mutate: Mutate; remove: (option: VotingOption) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const containsVotes = data.options.some((o) => o.vote_count > 0);
  const locked = containsVotes || data.session.is_open;
  const disabled = locked || !!busy;
  function reorder(index: number, delta: number) {
    const ids = data.options.map((o) => o.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void mutate("/api/admin/options/reorder", { sessionId: data.session.id, optionIds: ids }, "Reorder options");
  }
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (await mutate("/api/admin/options", { sessionId: data.session.id, name }, "Add option")) { setName(""); setAdding(false); }
  }
  return <section className="editor-card"><div className="editor-card-title"><h2>Voting Options</h2><span>{data.options.length} / 20</span></div><p className="editor-description">Choose 2–20 options. Use the arrows to set their display order.</p>
    {locked && <div className="options-lock-note">{containsVotes ? "This session already contains votes. Start a new voting session to change voting options." : "Close voting before changing voting options."}</div>}
    <div className="option-editor-list">{data.options.map((option, index) => <OptionEditorRow key={`${option.id}:${option.name}`} option={option} index={index} count={data.options.length} locked={locked} busy={busy} mutate={mutate} sessionId={data.session.id} reorder={reorder} remove={remove} />)}</div>
    {adding ? <form onSubmit={(e) => void add(e)} className="add-option-form"><label>Option name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} disabled={disabled} autoFocus /></label><div><button className="button button-secondary" type="button" disabled={!!busy} onClick={() => { setAdding(false); setName(""); }}>Cancel</button><button className="button button-primary" type="submit" disabled={disabled}>{busy === "Add option" ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Add option</button></div></form> : <button className="button button-secondary" disabled={disabled || data.options.length >= 20} onClick={() => setAdding(true)}><Plus size={16} />Add option</button>}
  </section>;
}

export function PollPreview({ data }: { data: Snapshot }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <section className="editor-card poll-preview"><h2>Current Poll Preview</h2><p className="editor-description">The current participant view. Preview selections do not cast votes.</p><div className="preview-content"><span className="eyebrow">{data.session.name}</span><h3>{data.session.question}</h3>{data.session.description && <p>{data.session.description}</p>}<div className="voting-groups">{data.options.map((option) => <OptionCard key={option.id} option={option} selected={selected === option.id} disabled={false} onSelect={() => setSelected(option.id)} />)}</div></div></section>;
}

export function NewSessionForm({ current, busy, mutate, cancel, done }: { current: Snapshot | null; busy: string | null; mutate: Mutate; cancel: () => void; done: () => void }) {
  const [expectedSessionId] = useState(current?.session.id ?? null);
  const [value, setValue] = useState<SessionSettings>({ name: "", question: current?.session.question ?? "", description: current?.session.description ?? "" });
  const [options, setOptions] = useState(() => (current?.options.map((o) => o.name) ?? ["", ""]).map((name, i) => ({ key: String(i), name })));
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (await mutate("/api/admin/new-session", { ...value, options: options.map((o) => o.name), sessionId: expectedSessionId, confirm: true }, "Create session")) done();
  }
  return <form className="new-session-form" onSubmit={(e) => void create(e)}><h2 id="confirm-title">Start a new voting session</h2><p className="editor-description">The current session will close. Previous votes are preserved. Your new session starts closed.</p>
    <SessionFields value={value} onChange={setValue} disabled={!!busy} />
    <div className="editor-card-title"><h3>Voting Options</h3><span>{options.length} / 20</span></div>
    <div className="new-session-options">{options.map((option, i) => <div key={option.key}><span>{i + 1}</span><input aria-label={`Option ${i + 1} name`} value={option.name} onChange={(e) => setOptions(options.map((o) => o.key === option.key ? { ...o, name: e.target.value } : o))} required maxLength={80} disabled={!!busy} placeholder="Option name" /><button className="icon-button delete-option" type="button" aria-label={`Remove option ${i + 1}`} disabled={!!busy || options.length <= 2} onClick={() => setOptions(options.filter((o) => o.key !== option.key))}><Trash2 size={16} /></button></div>)}</div>
    <button className="button button-secondary" type="button" disabled={!!busy || options.length >= 20} onClick={() => setOptions([...options, { key: crypto.randomUUID(), name: "" }])}><Plus size={16} />Add option</button>
    <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={!!busy} onClick={cancel}>Cancel</button><button className="button button-primary" type="submit" disabled={!!busy}>{busy === "Create session" ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Create session</button></div>
  </form>;
}
