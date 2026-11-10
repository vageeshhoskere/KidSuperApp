import { useReducer, useRef, useState } from "react";
import { build, saveCreation, sendPicture, type Creation, type Modes } from "../api";
import type { BuildResult } from "../../shared/api";
import type { Scene } from "../../shared/scene";
import { COPY } from "../../shared/copy";
import { editorReducer } from "./editor";
import { renderSnapshot } from "./snapshot";
import { say } from "./speech";
import Viewer from "./Viewer";
import EditTools from "./EditTools";
import PictureButtons from "./PictureButtons";
import MicButton from "./MicButton";
import Gallery from "./Gallery";

type Shown = { scene: Scene; requestId?: string; key: number };

function Workspace({ shown, busy, onChange, onSaveError }: { shown: Shown; busy: boolean; onChange: (scene: Scene, requestId?: string) => void; onSaveError: () => void }) {
  const [ed, dispatch] = useReducer(editorReducer, { scene: shown.scene, history: [] });
  const [sel, setSel] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const act: typeof dispatch = (a) => { setSaved(false); if (a.type === "delete" || a.type === "undo") setSel(null); dispatch(a); };
  const save = async () => {
    try {
      await saveCreation(ed.scene.title, ed.scene, "data:image/png;base64," + (await renderSnapshot(ed.scene)));
      setSaved(true);
    } catch { onSaveError(); }
  };
  return (
    <>
      <h2>{ed.scene.title}</h2>
      <div className="viewer"><Viewer scene={ed.scene} selected={sel} onSelect={setSel} /></div>
      <EditTools selected={sel} canUndo={ed.history.length > 0} dispatch={act} />
      <div className="row">
        <button className="big go" disabled={busy} onClick={() => onChange(ed.scene, shown.requestId)}>✏️ Change it!</button>
        <button className="big" onClick={save}>{saved ? "✅" : "💾"} Save</button>
      </div>
    </>
  );
}

export default function BuildScreen({ modes }: { modes: Modes }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [gallery, setGallery] = useState(false);
  const used = useRef({ voice: false, pictures: false });
  const keyN = useRef(0);

  const show = (scene: Scene, requestId?: string) => setShown({ scene, requestId, key: ++keyN.current });

  const handle = async (r: BuildResult): Promise<void> => {
    switch (r.status) {
      case "needs_picture":
        return handle(await sendPicture(r.requestId, await renderSnapshot(r.scene)));
      case "shown":
        show(r.scene, r.requestId);
        if (modes.tts) void say(r.speak, modes);
        return;
      case "redirected": setMessage(r.message); setIdeas(r.ideas.slice(0, 3)); return;
      case "held": case "closed": case "error": case "busy": setMessage(r.message); return;
      case "empty": return;
    }
  };

  const go = async (base?: { scene: Scene; requestId?: string }) => {
    if (busy) return;
    const mode = used.current.voice ? "voice" : used.current.pictures ? "pictures" : "typed";
    setBusy(true); setMessage(""); setIdeas([]);
    if (base) setShown(null); // keep the viewer hidden while the picture check runs
    try {
      await handle(await build({ mode, text, baseScene: base?.scene, parentRequestId: base?.requestId }));
    } catch { setMessage(COPY.oops); }
    setBusy(false);
  };

  const edit = (t: string) => { setText(t); if (!t) used.current = { voice: false, pictures: false }; };

  if (gallery)
    return <Gallery onBack={() => setGallery(false)} onOpen={(c: Creation) => { show(c.scene); setGallery(false); }} />;

  return (
    <main>
      <div className="row">
        <button className="big" aria-label="My things" onClick={() => setGallery(true)}>🖼 My things</button>
      </div>
      {modes.typing && (
        <input className="text" aria-label="What do you want to build?" maxLength={300} value={text} onChange={(e) => { used.current = { voice: false, pictures: false }; edit(e.target.value); }} />
      )}
      {!modes.typing && text && <p className="msg">{text}</p>}
      <div className="row">
        <MicButton modes={modes} onText={(t) => { used.current.voice = true; setText(t); }} onMessage={setMessage} />
        <button className="big go" disabled={busy || !text.trim()} onClick={() => go()}>🔨 Build!</button>
      </div>
      {modes.pictures && <PictureButtons onPick={(w) => { used.current.pictures = true; setText((t) => (t ? t + " " : "") + w); }} />}
      {busy && <p className="msg" aria-live="polite">{COPY.busy}</p>}
      {message && <p className="msg" role="status">{message}</p>}
      {ideas.length > 0 && (
        <div className="row">
          {ideas.map((i) => <button key={i} className="big" onClick={() => { used.current = { voice: false, pictures: false }; setText(i); }}>{i}</button>)}
        </div>
      )}
      {shown && <Workspace key={shown.key} shown={shown} busy={busy} onChange={(scene, requestId) => go({ scene, requestId })} onSaveError={() => setMessage(COPY.oops)} />}
    </main>
  );
}
