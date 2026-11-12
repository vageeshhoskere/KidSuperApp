import { useEffect, useState } from "react";
import { listCreations, markSeen, type Creation } from "../api";
import { COPY } from "../../shared/copy";

export default function Gallery({ onOpen, onBack }: { onOpen: (c: Creation) => void; onBack: () => void }) {
  const [items, setItems] = useState<Creation[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { listCreations().then(setItems, () => setFailed(true)); }, []);
  const open = (c: Creation) => { markSeen(c.id).catch(() => {}); onOpen(c); };
  return (
    <main>
      <button className="big" onClick={onBack}>⬅ Back</button>
      {failed && <p role="alert">{COPY.oops}</p>}
      <div className="grid">
        {items?.map((c) => (
          <button key={c.id} className="card" aria-label={c.title} onClick={() => open(c)}>
            {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <span className="ph">🧱</span>}
            {c.isNew && <span className="badge">New!</span>}
            <span>{c.title}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
