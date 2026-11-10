import { useEffect, useState } from "react";
import { auditQuery, listAudit, listChildren, type AuditFilter, type Child } from "./api";
import AuditDetail from "./AuditDetail";
import HeldQueue from "./HeldQueue";
import type { AuditRequest } from "../../server/audit";

const PAGE = 50;

export default function AuditList() {
  const [f, setF] = useState<AuditFilter>({});
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AuditRequest[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { void listChildren().then(setChildren).catch(() => {}); }, []);
  // date inputs give YYYY-MM-DD; "to" must include that whole day
  const range = { from: f.from, to: f.to ? `${f.to}T23:59:59.999Z` : undefined };
  useEffect(() => { void listAudit({ ...f, ...range, limit: PAGE, offset: page * PAGE }).then(setRows).catch(() => {}); }, [f, page, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof AuditFilter, v: string) => { setPage(0); setF((o) => ({ ...o, [k]: v })); };

  if (open) return <AuditDetail id={open} onClose={() => setOpen(null)} />;
  return (
    <div>
      <HeldQueue onChange={() => setTick((t) => t + 1)} />
      <h2>Requests</h2>
      <div className="filters">
        <label>Child <select value={f.childId ?? ""} onChange={(e) => set("childId", e.target.value)}><option value="">all</option>{children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>From <input type="date" value={f.from ?? ""} onChange={(e) => set("from", e.target.value)} /></label>
        <label>To <input type="date" value={f.to ?? ""} onChange={(e) => set("to", e.target.value)} /></label>
        <label>Outcome <select value={f.outcome ?? ""} onChange={(e) => set("outcome", e.target.value)}><option value="">all</option>{["shown", "redirected", "held", "closed", "error"].map((o) => <option key={o}>{o}</option>)}</select></label>
        <a href={`/api/parent/audit.csv?${auditQuery(range)}`} download="audit.csv">Export CSV</a>
      </div>
      <ul className="rows">
        {rows.map((r) => (
          <li key={r.id} className={r.outcome === "shown" ? "" : "bad"}>
            <button onClick={() => setOpen(r.id)}>{new Date(r.createdAt).toLocaleString()} · {r.outcome}{r.source !== "child" && ` · ${r.source}`} · {r.inputText.slice(0, 60)}</button>
          </li>))}
        {rows.length === 0 && <li>Nothing here.</li>}
      </ul>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
        <span>Page {page + 1}</span>
        <button disabled={rows.length < PAGE} onClick={() => setPage(page + 1)}>Older</button>
      </div>
    </div>
  );
}
