import { useEffect, useState } from "react";
import { getGlobal, listChildren, putChild, putGlobal, type Child, type GlobalView } from "./api";
import Providers, { type Models } from "./Providers";
import { ModelPick } from "./SetupWizard";
import type { ChildSettings } from "../../server/settings";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function ChildForm({ child }: { child: Child }) {
  const [s, setS] = useState<ChildSettings>(child.settings);
  const [words, setWords] = useState(s.wordAdditions.join("\n")), [phrases, setPhrases] = useState(s.allowedPhrases.join("\n"));
  const [msg, setMsg] = useState("");
  const set = <K extends keyof ChildSettings>(k: K, v: ChildSettings[K]) => setS((o) => ({ ...o, [k]: v }));
  const cloud = (p: string) => `Your child's voice will be sent to ${p}.`;

  async function save() {
    const w = [s.stt !== "browser" && cloud(s.stt), s.tts && s.ttsProvider !== "browser" && cloud(s.ttsProvider)].filter(Boolean);
    if (w.length && !confirm(w.join("\n"))) return;
    try {
      await putChild(child.id, { ...s, wordAdditions: lines(words), allowedPhrases: lines(phrases) });
      setMsg("Saved.");
    } catch (e) { setMsg((e as Error).message); }
  }
  const Check = ({ k, label }: { k: "typing" | "pictures" | "voice" | "tts" | "pictureCheck"; label: string }) =>
    <label><input type="checkbox" checked={s[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>;
  return (
    <fieldset>
      <legend>{child.avatar} {child.name}</legend>
      <Check k="typing" label="Typing" /><Check k="pictures" label="Picture buttons" /><Check k="voice" label="Voice input" />
      <label>Speech to text <select value={s.stt} onChange={(e) => set("stt", e.target.value as ChildSettings["stt"])}>
        <option>browser</option><option>openai</option><option>google</option></select></label>
      {s.stt !== "browser" && <><label>STT model <input value={s.sttModel} onChange={(e) => set("sttModel", e.target.value)} /></label>
        <p className="warn">Your child's voice will be sent to {s.stt}.</p></>}
      <Check k="tts" label="Spoken replies" />
      <label>Text to speech <select value={s.ttsProvider} onChange={(e) => set("ttsProvider", e.target.value as ChildSettings["ttsProvider"])}>
        <option>browser</option><option>openai</option><option>google</option></select></label>
      {s.ttsProvider !== "browser" && <><label>TTS model <input value={s.ttsModel} onChange={(e) => set("ttsModel", e.target.value)} /></label>
        {s.tts && <p className="warn">Your child's voice will be sent to {s.ttsProvider}.</p>}</>}
      <label>When a request is flagged <select value={s.flagHandling} onChange={(e) => set("flagHandling", e.target.value as ChildSettings["flagHandling"])}>
        <option value="redirect">redirect</option><option value="notify">redirect + notify</option><option value="hold">hold</option></select></label>
      <Check k="pictureCheck" label="Picture check" />
      <label>Extra blocked words (one per line) <textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} /></label>
      <label>Allowed phrases (one per line) <textarea rows={3} value={phrases} onChange={(e) => setPhrases(e.target.value)} /></label>
      <label>Builds per day <input type="number" min={1} max={500} value={s.buildsPerDay} onChange={(e) => set("buildsPerDay", Number(e.target.value))} /></label>
      <label>Allowed from <input type="time" value={s.hoursStart} onChange={(e) => set("hoursStart", e.target.value)} /></label>
      <label>Allowed until <input type="time" value={s.hoursEnd} onChange={(e) => set("hoursEnd", e.target.value)} /></label>
      <button onClick={() => void save()}>Save {child.name}'s settings</button>
      {msg && <p role="status" className={msg === "Saved." ? "" : "err"}>{msg}</p>}
    </fieldset>
  );
}

function GlobalForm({ g, onSaved }: { g: GlobalView; onSaved: () => void }) {
  const [v, setV] = useState(g);
  const [models, setModels] = useState<Models>({});
  const [msg, setMsg] = useState("");
  const smtp = v.smtp ?? { host: "", port: 587, user: "", pass: "", from: "", to: "" };
  const setSmtp = (k: keyof typeof smtp, x: string | number) => setV({ ...v, smtp: { ...smtp, [k]: x } });
  async function save() {
    try {
      const { pinHash: _p, setupComplete: _s, ...rest } = v;
      const emptySmtp = !smtp.host && !smtp.to;
      await putGlobal({ ...rest, smtp: emptySmtp ? null : v.smtp });
      setMsg("Saved."); onSaved();
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <fieldset>
      <legend>Everyone</legend>
      <Providers onModels={(p, m) => setModels((s) => ({ ...s, [p]: m }))} />
      <ModelPick label="Builder" value={v.builder} models={models} onChange={(b) => setV({ ...v, builder: b })} />
      <ModelPick label="Checker" value={v.checker} models={models} onChange={(b) => setV({ ...v, checker: b })} />
      <label>Moderation (Layer 2) <select value={v.moderation} onChange={(e) => setV({ ...v, moderation: e.target.value as GlobalView["moderation"] })}>
        <option>off</option><option>openai</option><option>google</option></select></label>
      {v.moderation === "off" && <label><input type="checkbox" checked={v.moderationOffAcknowledged} onChange={(e) => setV({ ...v, moderationOffAcknowledged: e.target.checked })} /> I understand Layer 2 is off</label>}
      <label>Moderation threshold (0.05 to 0.5) <input type="number" step={0.05} min={0.05} max={0.5} value={v.moderationThreshold} onChange={(e) => setV({ ...v, moderationThreshold: Number(e.target.value) })} /></label>
      <label>Keep audit log (days) <input type="number" min={1} value={v.retentionDays} onChange={(e) => setV({ ...v, retentionDays: Number(e.target.value) })} /></label>
      <h3>Email (needed for "notify")</h3>
      {(["host", "user", "pass", "from", "to"] as const).map((k) => (
        <label key={k}>SMTP {k === "to" ? "parent email" : k} <input type={k === "pass" ? "password" : "text"} value={smtp[k]} onChange={(e) => setSmtp(k, e.target.value)} /></label>))}
      <label>SMTP port <input type="number" value={smtp.port} onChange={(e) => setSmtp("port", Number(e.target.value))} /></label>
      <button onClick={() => void save()}>Save</button>
      {msg && <p role="status" className={msg === "Saved." ? "" : "err"}>{msg}</p>}
    </fieldset>
  );
}

export default function Settings() {
  const [g, setG] = useState<GlobalView | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  useEffect(() => { void getGlobal().then(setG); void listChildren().then(setChildren); }, []);
  if (!g) return <p>Loading…</p>;
  return <div>{children.map((c) => <ChildForm key={c.id} child={c} />)}<GlobalForm g={g} onSaved={() => void getGlobal().then(setG)} /></div>;
}
