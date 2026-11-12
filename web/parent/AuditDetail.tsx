import { useEffect, useState } from "react";
import { getAudit } from "./api";
import Viewer from "../child/Viewer";
import type { AuditRequest } from "../../server/audit";

export default function AuditDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [r, setR] = useState<AuditRequest | null>(null);
  useEffect(() => { void getAudit(id).then(setR).catch(() => {}); }, [id]);
  if (!r) return <p>Loading…</p>;
  const { scene, ...fields } = r;
  return (
    <section className="detail">
      <button onClick={onClose}>Back to list</button>
      <dl>
        {Object.entries(fields).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{typeof v === "object" && v !== null ? <pre>{JSON.stringify(v, null, 2)}</pre> : String(v)}</dd></div>))}
        <div><dt>scene</dt><dd>{scene ? <><pre>{JSON.stringify(scene, null, 2)}</pre><div className="preview"><Viewer scene={scene} /></div></> : "null"}</dd></div>
      </dl>
    </section>
  );
}
