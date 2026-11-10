import type { AuditRequest } from "../../server/audit";
import type { ChildSettings, GlobalSettings } from "../../server/settings";
import type { BuildResult } from "../../shared/api";

export class Unauthorized extends Error {}
export type Child = { id: number; name: string; avatar: string; age: number; settings: ChildSettings };
export type GlobalView = Omit<GlobalSettings, "pinHash"> & { pinHash: string | null };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401 && !url.endsWith("/login")) { window.dispatchEvent(new Event("parent-locked")); throw new Unauthorized(); }
  const data = await r.json().catch(() => ({}));
  // 400 messages are validation text meant for the parent
  if (!r.ok) throw new Error(r.status === 400 || r.status === 401 || r.status === 429 ? (data.message ?? data.error ?? String(r.status)) : `Request failed (${r.status})`);
  return data as T;
}
const get = <T>(u: string) => call<T>("GET", u);
const send = <T>(m: string, u: string, b: unknown = {}) => call<T>(m, u, b);

export const getGlobal = () => get<GlobalView>("/api/parent/settings/global");
export const putGlobal = (p: Partial<GlobalSettings>) => send("PUT", "/api/parent/settings/global", p);
export const setup = (pin: string, child: { name: string; avatar: string; age: number }) => send<{ childId: number }>("POST", "/api/parent/setup", { pin, child });
export const getStatus = () => get<{ pinSet: boolean; setupComplete: boolean }>("/api/parent/status");
export const login = (pin: string) => send("POST", "/api/parent/login", { pin });
export const logout = () => send("POST", "/api/parent/logout");
export const getKeys = () => get<Record<string, string | null>>("/api/parent/keys");
export const putKey = (p: string, key: string | null) => send("PUT", `/api/parent/keys/${p}`, { key });
export const testKey = (p: string) => send<{ ok: boolean; models: string[] }>("POST", `/api/parent/keys/${p}/test`);
export const listChildren = async (): Promise<Child[]> => {
  const kids = await get<Omit<Child, "settings">[]>("/api/parent/children");
  return Promise.all(kids.map((k) => get<Child>(`/api/parent/settings/child/${k.id}`)));
};
export const putChild = (id: number, p: Partial<ChildSettings>) => send("PUT", `/api/parent/settings/child/${id}`, p);
export type AuditFilter = { childId?: string; from?: string; to?: string; outcome?: string; limit?: number; offset?: number };
export const auditQuery = (f: AuditFilter) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") q.set(k, String(v));
  return q.toString();
};
export const listAudit = (f: AuditFilter) => get<AuditRequest[]>(`/api/parent/audit?${auditQuery(f)}`);
export const getAudit = (id: string) => get<AuditRequest>(`/api/parent/audit/${encodeURIComponent(id)}`);
export const listHeld = () => get<AuditRequest[]>("/api/parent/held");
export const approve = (id: string) => send<BuildResult>("POST", `/api/parent/held/${encodeURIComponent(id)}/approve`);
export const reject = (id: string) => send("POST", `/api/parent/held/${encodeURIComponent(id)}/reject`);
export const sendPicture = (id: string, png: string) => send<BuildResult>("POST", `/api/parent/held/${encodeURIComponent(id)}/picture`, { png });
