import type { BuildResult } from "../shared/api";
import type { Scene } from "../shared/scene";

export type Modes = { typing: boolean; pictures: boolean; voice: boolean; stt: string; tts: boolean; ttsProvider: string };
export type ChildState = { ready: boolean; child: { id: number; name: string; avatar: string } | null; modes: Modes };
export type Creation = { id: number; title: string; scene: Scene; thumbnail: string | null; isNew: boolean };
export type BuildBody = { mode: "typed" | "voice" | "pictures"; text: string; baseScene?: Scene; parentRequestId?: string };

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
const post = <T>(url: string, body: unknown) =>
  req<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getState = () => req<ChildState>("/api/child/state");
export const build = (b: BuildBody) => post<BuildResult>("/api/child/build", b);
export const sendPicture = (id: string, png: string) => post<BuildResult>(`/api/child/build/${encodeURIComponent(id)}/picture`, { png });
export const listCreations = () => req<Creation[]>("/api/child/creations");
export const saveCreation = (title: string, scene: Scene, thumbnail: string | null) => post<{ id: number }>("/api/child/creations", { title, scene, thumbnail });
export const markSeen = (id: number) => post<{ ok: true }>(`/api/child/creations/${id}/seen`, {});
export const transcribe = (blob: Blob) =>
  req<{ text: string; message?: string }>("/api/child/stt", { method: "POST", headers: { "content-type": blob.type || "audio/webm" }, body: blob });
export const tts = async (text: string): Promise<Blob> => {
  const r = await fetch("/api/child/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.blob();
};
