import { useCallback, useEffect, useState } from "react";
import { approve, listHeld, reject, sendPicture } from "./api";
import { renderSnapshot } from "../child/snapshot";
import type { AuditRequest } from "../../server/audit";
import type { BuildResult } from "../../shared/api";

export default function HeldQueue({ onChange }: { onChange: () => void }) {
  const [held, setHeld] = useState<AuditRequest[]>([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => void listHeld().then(setHeld).catch(() => {}), []);
  useEffect(load, [load]);

  async function decide(id: string, ok: boolean) {
    try {
      if (!ok) { await reject(id); setMsg("Rejected."); } else {
        let r: BuildResult = await approve(id);
        // R2: the picture goes to the NEW request id
        if (r.status === "needs_picture") r = await sendPicture(r.requestId, await renderSnapshot(r.scene));
        setMsg(r.status === "shown" ? "Approved: it is in the gallery." : `Approved, but the result was: ${r.status}`);
      }
    } catch (e) { setMsg((e as Error).message); }
    load(); onChange();
  }
  return (
    <section>
      <h2>Waiting for you ({held.length})</h2>
      {msg && <p role="status">{msg}</p>}
      {held.map((h) => (
        <div key={h.id} className="held">
          <span>{new Date(h.createdAt).toLocaleString()}: “{h.inputText}”</span>
          <button onClick={() => void decide(h.id, true)}>Approve</button>
          <button className="danger" onClick={() => void decide(h.id, false)}>Reject</button>
        </div>
      ))}
    </section>
  );
}
