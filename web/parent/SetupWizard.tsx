import { useState } from "react";
import { putGlobal, setup } from "./api";
import { canFinishWizard, modelChoiceFor, pickProviders, pinsMatch, validatePin } from "./forms";
import Providers, { PROVIDERS, type Models } from "./Providers";
import type { ModelChoice } from "../../server/settings";

export const AVATARS = ["🐶", "🐱", "🦊", "🐼", "🐸", "🦁", "🐵", "🐧", "🦄", "🐙", "🦖", "🐢"];
const STEPS = ["PIN", "Child", "Keys", "Models", "Done"];

export function ModelPick({ label, value, models, onChange }: { label: string; value: ModelChoice | null; models: Models; onChange: (v: ModelChoice | null) => void }) {
  return (
    <div className="field">
      <strong>{label}</strong>
      <select aria-label={`${label} provider`} value={value?.provider ?? ""} onChange={(e) => onChange(modelChoiceFor(e.target.value))}>
        <option value="">choose provider</option>
        {pickProviders(models, value).map((p) => <option key={p}>{p}</option>)}
      </select>
      {value && <select aria-label={`${label} model`} value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })}>
        <option value="">choose model</option>
        {[...new Set([value.model, ...(models[value.provider] ?? [])])].filter(Boolean).map((m) => <option key={m}>{m}</option>)}
      </select>}
    </div>
  );
}

/** `resume` = PIN and child already exist (setup was left unfinished): start at the Keys step. */
export default function SetupWizard({ resume, onDone }: { resume: boolean; onDone: () => void }) {
  const [step, setStep] = useState(resume ? 2 : 0);
  const [pin, setPin] = useState(""), [pin2, setPin2] = useState("");
  const [name, setName] = useState(""), [avatar, setAvatar] = useState(AVATARS[0]), [age, setAge] = useState(7);
  const [models, setModels] = useState<Models>({});
  const [builder, setBuilder] = useState<ModelChoice | null>(null), [checker, setChecker] = useState<ModelChoice | null>(null);
  const [moderation, setModeration] = useState<"openai" | "google" | "off">("off");
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState("");

  const pinErr = validatePin(pin) ?? (pinsMatch(pin, pin2) ? null : "PINs do not match");
  const childOk = name.trim().length > 0 && age >= 3 && age <= 12;
  const next = () => { setErr(""); setStep((s) => s + 1); };

  async function createChild() {
    try { await setup(pin, { name: name.trim(), avatar, age }); next(); } catch (e) { setErr((e as Error).message); }
  }
  async function finish() {
    try { await putGlobal({ builder, checker, moderation, moderationOffAcknowledged: ack, setupComplete: true }); onDone(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="card-box">
      <h1>Set up</h1>
      <p className="steps">{STEPS.map((s, i) => <span key={s} className={i === step ? "on" : ""}>{i + 1}. {s} </span>)}</p>
      {step === 0 && (<>
        <label>PIN (6 digits) <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        <label>Repeat PIN <input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value)} /></label>
        {pin && pinErr && <p className="err">{pinErr}</p>}
        <button disabled={!!pinErr} onClick={next}>Next</button>
      </>)}
      {step === 1 && (<>
        <label>Child's name <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <div role="radiogroup" aria-label="Avatar" className="avatars">
          {AVATARS.map((a) => <button key={a} type="button" role="radio" aria-checked={a === avatar} className={a === avatar ? "sel" : ""} onClick={() => setAvatar(a)}>{a}</button>)}
        </div>
        <label>Age <input type="number" min={3} max={12} value={age} onChange={(e) => setAge(Number(e.target.value))} /></label>
        <button disabled={!childOk} onClick={() => void createChild()}>Next</button>
      </>)}
      {step === 2 && (<>
        <p>Add a key for at least one provider, then press Test.</p>
        <Providers onModels={(p, m) => setModels((s) => ({ ...s, [p]: m }))} />
        <button disabled={!PROVIDERS.some((p) => models[p]?.length)} onClick={next}>Next</button>
      </>)}
      {step === 3 && (<>
        <ModelPick label="Builder" value={builder} models={models} onChange={setBuilder} />
        <ModelPick label="Checker" value={checker} models={models} onChange={setChecker} />
        <label>Moderation (Layer 2) <select value={moderation} onChange={(e) => setModeration(e.target.value as typeof moderation)}>
          <option value="off">off</option>{(["openai", "google"] as const).map((p) => <option key={p}>{p}</option>)}</select></label>
        {moderation === "off" && <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand Layer 2 is off</label>}
        <button disabled={!canFinishWizard({ builder, checker, moderation, moderationOffAcknowledged: ack })} onClick={next}>Next</button>
      </>)}
      {step === 4 && (<>
        <p>All set. Finish to open the child's screen.</p>
        <button onClick={() => void finish()}>Finish</button>
      </>)}
      {err && <p role="alert" className="err">{err}</p>}
    </div>
  );
}
