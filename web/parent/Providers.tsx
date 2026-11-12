import { useEffect, useState } from "react";
import { getKeys, getStatus, putKey, testKey } from "./api";

export const PROVIDERS = ["openai", "anthropic", "google"] as const;
export type Models = Partial<Record<(typeof PROVIDERS)[number], string[]>>;

/** API keys with a Test button; a successful Test reports that provider's model list. */
export default function Providers({ onModels }: { onModels: (provider: string, models: string[]) => void }) {
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [fake, setFake] = useState(false); // FAKE_PROVIDERS test mode: the server refuses keys
  useEffect(() => { void getKeys().then(setSaved).catch(() => {}); void getStatus().then((s) => setFake(!!s.fakeProviders)).catch(() => {}); }, []);
  const say = (p: string, m: string) => setMsg((s) => ({ ...s, [p]: m }));

  async function test(p: string) {
    try {
      const key = draft[p]?.trim();
      if (key) { await putKey(p, key); setSaved((s) => ({ ...s, [p]: `…${key.slice(-4)}` })); setDraft((d) => ({ ...d, [p]: "" })); }
      const r = await testKey(p);
      if (r.ok) { onModels(p, r.models); say(p, `Works: ${r.models.length} models`); } else say(p, "Test failed. Check the key.");
    } catch (e) { say(p, (e as Error).message); }
  }
  return (
    <div>
      {PROVIDERS.map((p) => (
        <div key={p} className="field">
          <strong>{p}</strong> {fake ? <span>fake provider (no key)</span> : saved[p] ? <span>saved ({saved[p]})</span> : <span>no key</span>}
          {!fake && <input type="password" autoComplete="off" placeholder="paste key (20+ characters)" aria-label={`${p} key`} value={draft[p] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [p]: e.target.value }))} />}
          <button type="button" disabled={!fake && !saved[p] && (draft[p] ?? "").trim().length < 20} onClick={() => void test(p)}>Test</button>
          {msg[p] && <span role="status">{msg[p]}</span>}
        </div>
      ))}
    </div>
  );
}
