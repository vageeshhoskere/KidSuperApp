import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app";
import { openDb, type Db } from "../../server/db";
import { __resetSessions } from "../../server/auth";
import { __resetPipelineState } from "../../server/pipeline";
import { makeFakeProvider, type FakeProvider } from "../../server/providers/fake";
import type { ProviderId } from "../../server/providers/types";
import { COPY, fill } from "../../shared/copy";
import type { Scene } from "../../shared/scene";

const NOW = new Date(2026, 10, 10, 10, 0); // inside default hours
const PIN = "123456";
const SCENE: Scene = {
  title: "Red Tower",
  blocks: [{ shape: "cube", color: "red", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] }],
};
const v = (verdict: string) => ({ intent: "build a tower", summary: "a red tower", verdict, categories: [], reason: "ok" });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG64 = PNG.toString("base64");

afterEach(() => {
  __resetSessions();
  __resetPipelineState();
});

function make(o: { verdicts?: string[] } = {}) {
  const db: Db = openDb(":memory:");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-test-"));
  const verdicts = [...(o.verdicts ?? [])];
  const mod = makeFakeProvider({ moderate: { violence: 0.01 } });
  const stt = { text: "a red tower", mime: "" };
  mod.transcribe = async (_a, mime) => { stt.mime = mime; return stt.text; };
  mod.speak = async () => Buffer.from("RIFFxxxxWAVE");
  const checker = makeFakeProvider({ json: () => v(verdicts.shift() ?? "safe") });
  const builder = makeFakeProvider({ json: () => SCENE });
  const providers: Partial<Record<ProviderId, FakeProvider>> = { openai: mod, google: checker, anthropic: builder };
  const app = buildApp({ db, dataDir, registry: { get: (id) => providers[id] ?? null }, now: () => NOW });
  return { app, db, dataDir, builder, stt };
}

/** First-run setup: PIN + child, providers chosen, setup finished. Returns the session cookie. */
async function setup(app: FastifyInstance, finish = true) {
  const r = await app.inject({ method: "POST", url: "/api/parent/setup", payload: { pin: PIN, child: { name: "Sam", avatar: "fox", age: 7 } } });
  expect(r.statusCode).toBe(200);
  const cookie = r.cookies.find((c) => c.name === "ps")!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  const headers = { cookie: `ps=${cookie.value}` };
  if (finish) {
    await put(app, headers, "/api/parent/settings/global", {
      builder: { provider: "anthropic", model: "b" }, checker: { provider: "google", model: "c" }, moderation: "openai",
    }, 200);
    await put(app, headers, "/api/parent/settings/global", { setupComplete: true }, 200);
  }
  return { headers, childId: r.json().childId as number };
}

async function login(app: FastifyInstance, pin = PIN) {
  const r = await app.inject({ method: "POST", url: "/api/parent/login", payload: { pin } });
  const c = r.cookies.find((x) => x.name === "ps");
  return { status: r.statusCode, headers: c ? { cookie: `ps=${c.value}` } : undefined };
}

async function put(app: FastifyInstance, headers: Record<string, string>, url: string, payload: unknown, status: number) {
  const r = await app.inject({ method: "PUT", url, headers, payload: payload as object });
  expect(r.statusCode, r.body).toBe(status);
  return r;
}

const build = (app: FastifyInstance, payload: object) => app.inject({ method: "POST", url: "/api/child/build", payload });

describe("parent auth", () => {
  it("every parent route except setup/login returns 401 without a cookie", async () => {
    const { app } = make();
    await setup(app);
    const routes: [string, string][] = [
      ["POST", "/api/parent/logout"], ["GET", "/api/parent/settings/global"], ["PUT", "/api/parent/settings/global"],
      ["GET", "/api/parent/settings/child/1"], ["PUT", "/api/parent/settings/child/1"], ["PUT", "/api/parent/keys/openai"],
      ["GET", "/api/parent/keys"], ["POST", "/api/parent/keys/openai/test"], ["POST", "/api/parent/children"], ["GET", "/api/parent/children"],
      ["GET", "/api/parent/audit"], ["GET", "/api/parent/audit/x"], ["GET", "/api/parent/audit.csv"],
      ["GET", "/api/parent/events"], ["GET", "/api/parent/held"], ["POST", "/api/parent/held/x/approve"],
      ["POST", "/api/parent/held/x/picture"], ["POST", "/api/parent/held/x/reject"],
    ];
    for (const [method, url] of routes) {
      const r = await app.inject({ method: method as "GET", url, payload: method === "GET" ? undefined : {} });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      const bad = await app.inject({ method: method as "GET", url, headers: { cookie: "ps=nope" } });
      expect(bad.statusCode, `${method} ${url} bad cookie`).toBe(401);
    }
  });

  it("status is public, reports setup progress and nothing else", async () => {
    const { app } = make();
    const get = async () => (await app.inject({ method: "GET", url: "/api/parent/status" })).json();
    expect(await get()).toEqual({ pinSet: false, setupComplete: false });
    await setup(app, false);
    expect(await get()).toEqual({ pinSet: true, setupComplete: false });
    const { app: app2 } = make();
    await setup(app2);
    expect((await app2.inject({ method: "GET", url: "/api/parent/status" })).json()).toEqual({ pinSet: true, setupComplete: true });
  });

  it("GET children needs a session and lists the created child", async () => {
    const { app } = make();
    const { headers, childId } = await setup(app);
    expect((await app.inject({ method: "GET", url: "/api/parent/children" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: "/api/parent/children", headers });
    expect(r.json()).toEqual([{ id: childId, name: "Sam", avatar: "fox", age: 7 }]);
  });

  it("setup is rejected once a PIN exists; login and logout work", async () => {
    const { app } = make();
    await setup(app, false);
    const again = await app.inject({ method: "POST", url: "/api/parent/setup", payload: { pin: "999999", child: { name: "X", avatar: "a", age: 5 } } });
    expect(again.statusCode).toBe(403);
    expect((await login(app, "000000")).status).toBe(401);
    const ok = await login(app);
    expect(ok.status).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/parent/held", headers: ok.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/parent/logout", headers: ok.headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/parent/held", headers: ok.headers })).statusCode).toBe(401);
  });

  it("setup needs a valid PIN and child", async () => {
    const { app } = make();
    const r = await app.inject({ method: "POST", url: "/api/parent/setup", payload: { pin: "12", child: { name: "S", avatar: "a", age: 7 } } });
    expect(r.statusCode).toBe(400);
  });

  it("setupComplete needs a builder and moderation (or its acknowledgement)", async () => {
    const { app } = make();
    const { headers } = await setup(app, false);
    await put(app, headers, "/api/parent/settings/global", { setupComplete: true }, 400);
    await put(app, headers, "/api/parent/settings/global", { builder: { provider: "anthropic", model: "b" } }, 200);
    await put(app, headers, "/api/parent/settings/global", { setupComplete: true }, 400);
    await put(app, headers, "/api/parent/settings/global", { moderationOffAcknowledged: true, setupComplete: true }, 200);
    const g = await app.inject({ method: "GET", url: "/api/parent/settings/global", headers });
    expect(g.json()).toMatchObject({ setupComplete: true, pinHash: "***" });
    expect(g.body).not.toMatch(/[0-9a-f]{32}:/);
    await put(app, headers, "/api/parent/settings/global", { pinHash: "x" }, 400);
  });

  it("setupComplete invariant holds for later patches too", async () => {
    const { app } = make();
    const { headers } = await setup(app);
    await put(app, headers, "/api/parent/settings/global", { moderation: "off" }, 400);
    await put(app, headers, "/api/parent/settings/global", { builder: null }, 400);
    await put(app, headers, "/api/parent/settings/global", { moderation: "off", moderationOffAcknowledged: true }, 200);
  });

  it("setup is atomic: a failed child insert leaves no PIN", async () => {
    const { app, db } = make();
    db.exec("DROP TABLE children");
    const r = await app.inject({ method: "POST", url: "/api/parent/setup", payload: { pin: PIN, child: { name: "S", avatar: "a", age: 7 } } });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal" });
    const pin = db.prepare("SELECT value FROM settings WHERE key = 'pinHash'").get();
    expect(pin).toBeUndefined();
  });

  it("a non-validation failure in a settings write is a 500, not a 400", async () => {
    const { app, db } = make();
    const { headers } = await setup(app);
    db.exec("DROP TABLE audit_events");
    const r = await put(app, headers, "/api/parent/settings/global", { retentionDays: 30 }, 500);
    expect(r.json()).toEqual({ error: "internal" });
  });

  it("unknown routes return 404 {error:'not found'}", async () => {
    const { app } = make();
    const r = await app.inject({ method: "GET", url: "/api/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
  });
});

describe("keys", () => {
  it("GET /api/parent/keys never contains the full key; key is stored 0600", async () => {
    const { app, dataDir } = make();
    const { headers } = await setup(app);
    const key = "sk-secret-abcdefgh1234";
    await put(app, headers, "/api/parent/keys/openai", { key }, 200);
    const r = await app.inject({ method: "GET", url: "/api/parent/keys", headers });
    expect(r.body).not.toContain(key);
    expect(r.json()).toEqual({ openai: "••••1234", anthropic: null, google: null });
    expect(fs.statSync(path.join(dataDir, "keys.json")).mode & 0o777).toBe(0o600);
    const ev = await app.inject({ method: "GET", url: "/api/parent/events", headers });
    expect(ev.body).not.toContain(key);
    await put(app, headers, "/api/parent/keys/nope", { key }, 400);
    await put(app, headers, "/api/parent/keys/google", { key: "short-key-1234" }, 400); // R19: < 20 chars
    await put(app, headers, "/api/parent/keys/google", { key: null }, 200);
  });

  it("key test returns the provider's models", async () => {
    const { app } = make();
    const { headers } = await setup(app);
    const r = await app.inject({ method: "POST", url: "/api/parent/keys/anthropic/test", headers });
    expect(r.json()).toEqual({ ok: true, models: ["fake-model"] });
  });
});

describe("child routes", () => {
  it("GET /api/child/state before setup → ready:false", async () => {
    const { app } = make();
    const r = await app.inject({ method: "GET", url: "/api/child/state" });
    expect(r.json()).toMatchObject({ ready: false, child: null });
    await setup(app, false);
    expect((await app.inject({ method: "GET", url: "/api/child/state" })).json()).toMatchObject({ ready: false });
    expect((await build(app, { mode: "typed", text: "a tower" })).json()).toEqual({ status: "closed", message: COPY.setup });
    expect((await app.inject({ method: "GET", url: "/api/child/creations" })).statusCode).toBe(403);
  });

  it("build happy path returns shown", async () => {
    const { app } = make();
    const { headers, childId } = await setup(app);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { pictureCheck: false }, 200);
    const st = (await app.inject({ method: "GET", url: "/api/child/state" })).json();
    expect(st).toMatchObject({ ready: true, child: { id: childId, name: "Sam", avatar: "fox" }, modes: { typing: true, voice: false } });
    const r = await build(app, { mode: "typed", text: "a red tower" });
    expect(r.json()).toMatchObject({ status: "shown", scene: SCENE, speak: fill(COPY.here, { title: "Red Tower" }) });
  });

  it("picture check: only the owning pending build can be finished", async () => {
    const { app } = make();
    await setup(app);
    const r = (await build(app, { mode: "typed", text: "a red tower" })).json();
    expect(r.status).toBe("needs_picture");
    const other = await app.inject({ method: "POST", url: "/api/child/build/someone-else/picture", payload: { png: PNG64 } });
    expect(other.statusCode).toBe(403);
    const big = await app.inject({ method: "POST", url: `/api/child/build/${r.requestId}/picture`, payload: { png: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") } });
    expect(big.statusCode).toBe(400);
    const empty = await app.inject({ method: "POST", url: `/api/child/build/${r.requestId}/picture`, payload: { png: "" } });
    expect(empty.statusCode).toBe(400);
    const notPng = await app.inject({ method: "POST", url: `/api/child/build/${r.requestId}/picture`, payload: { png: Buffer.from("GIF89a").toString("base64") } });
    expect(notPng.statusCode).toBe(400);
    const done = await app.inject({ method: "POST", url: `/api/child/build/${r.requestId}/picture`, payload: { png: PNG64 } });
    expect(done.json()).toMatchObject({ status: "shown", scene: SCENE });
  });

  it("rejects invalid baseScene and unknown parentRequestId", async () => {
    const { app, builder } = make();
    await setup(app);
    expect((await build(app, { mode: "typed", text: "x", baseScene: { title: "!!", blocks: [] } })).statusCode).toBe(400);
    expect((await build(app, { mode: "typed", text: "x", parentRequestId: "nope" })).statusCode).toBe(400);
    expect((await build(app, { mode: "shouting", text: "x" })).statusCode).toBe(400);
    expect(builder.calls.generateJson).toBe(0);
  });

  it("POST /api/child/tts with arbitrary text → 403; the shown line is spoken", async () => {
    const { app } = make();
    const { headers, childId } = await setup(app);
    const tts = (text: string) => app.inject({ method: "POST", url: "/api/child/tts", payload: { text } });
    expect((await tts("anything at all")).statusCode).toBe(403);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { pictureCheck: false, tts: true, ttsProvider: "openai", ttsModel: "t" }, 200);
    const line = fill(COPY.here, { title: "Red Tower" });
    expect((await tts(line)).statusCode).toBe(403); // nothing shown yet
    await build(app, { mode: "typed", text: "a red tower" });
    expect((await tts("say something rude")).statusCode).toBe(403);
    const ok = await tts(line);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("audio/wav");
  });

  it("stt is 403 unless voice is on with a cloud provider; transcript is filtered", async () => {
    const h = make();
    const { app } = h;
    const { headers, childId } = await setup(app);
    const stt = (ct = "audio/webm;codecs=opus") => app.inject({ method: "POST", url: "/api/child/stt", headers: { "content-type": ct }, payload: Buffer.from("aud") });
    expect((await stt()).statusCode).toBe(403);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { voice: true, stt: "openai", sttModel: "w", wordAdditions: ["dragon"] }, 200);
    expect((await stt()).json()).toEqual({ text: "a red tower" });
    expect(h.stt.mime).toBe("audio/webm");
    h.stt.text = "I live at 42 Maple Street";
    expect((await stt()).json()).toEqual({ text: "", message: COPY.pii });
    h.stt.text = "a big dragon";
    expect((await stt()).json()).toEqual({ text: "", message: COPY.oops });
    h.stt.text = "tower ".repeat(60);
    expect((await stt()).json()).toEqual({ text: "", message: COPY.tooLong });
    const json = await app.inject({ method: "POST", url: "/api/child/stt", payload: { a: 1 } });
    expect(json.statusCode).toBe(415);
    expect((await stt("text/plain")).statusCode).toBe(415);
  });

  it("stt and tts are closed outside hours and before setup", async () => {
    const { app } = make();
    const tts = () => app.inject({ method: "POST", url: "/api/child/tts", payload: { text: "x" } });
    const stt = () => app.inject({ method: "POST", url: "/api/child/stt", headers: { "content-type": "audio/webm" }, payload: Buffer.from("a") });
    for (const r of [await tts(), await stt()]) {
      expect(r.statusCode).toBe(403);
      expect(r.json().message).toBe(COPY.setup);
    }
    const { headers, childId } = await setup(app);
    await put(app, headers, `/api/parent/settings/child/${childId}`, {
      voice: true, stt: "openai", sttModel: "w", tts: true, ttsProvider: "openai", ttsModel: "t", hoursStart: "11:00",
    }, 200);
    for (const r of [await tts(), await stt()]) {
      expect(r.statusCode).toBe(403);
      expect(r.json().message).toBe(COPY.closed);
    }
  });

  it("creations: invalid scene → 400; saved ones are listed and can be marked seen", async () => {
    const { app } = make();
    await setup(app);
    const post = (payload: object) => app.inject({ method: "POST", url: "/api/child/creations", payload });
    expect((await post({ title: "Bad", scene: { title: "Bad", blocks: [] }, thumbnail: null })).statusCode).toBe(400);
    expect((await post({ title: "Red Tower", scene: SCENE, thumbnail: "javascript:x" })).statusCode).toBe(400);
    const ok = await post({ title: "Red Tower", scene: SCENE, thumbnail: "data:image/png;base64,AAAA" });
    expect(ok.statusCode).toBe(200);
    const id = ok.json().id;
    const list = (await app.inject({ method: "GET", url: "/api/child/creations" })).json();
    expect(list).toEqual([{ id, title: "Red Tower", scene: SCENE, thumbnail: "data:image/png;base64,AAAA", isNew: false }]);
    expect((await app.inject({ method: "POST", url: `/api/child/creations/${id}/seen` })).statusCode).toBe(200);
  });
});

describe("audit and held", () => {
  it("CSV route returns text/csv with a header row", async () => {
    const { app } = make();
    const { headers, childId } = await setup(app);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { pictureCheck: false }, 200);
    await build(app, { mode: "typed", text: "a red tower" });
    const r = await app.inject({ method: "GET", url: "/api/parent/audit.csv?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z", headers });
    expect(r.headers["content-type"]).toMatch(/^text\/csv/);
    expect(r.body.split("\r\n")[0]).toMatch(/^id,createdAt,childId,/);
    expect(r.body.split("\r\n").length).toBeGreaterThan(2);
    const list = (await app.inject({ method: "GET", url: "/api/parent/audit", headers })).json();
    expect(list).toHaveLength(1);
    const one = await app.inject({ method: "GET", url: `/api/parent/audit/${list[0].id}`, headers });
    expect(one.json().id).toBe(list[0].id);
    expect((await app.inject({ method: "GET", url: "/api/parent/audit/missing", headers })).statusCode).toBe(404);
  });

  it("held request: approve → needs_picture → picture with the new id → shown in gallery", async () => {
    const { app } = make({ verdicts: ["unsafe"] });
    const { headers, childId } = await setup(app);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { flagHandling: "hold" }, 200);
    expect((await build(app, { mode: "typed", text: "a red tower" })).json().status).toBe("held");
    const held = (await app.inject({ method: "GET", url: "/api/parent/held", headers })).json();
    expect(held).toHaveLength(1);
    const a = (await app.inject({ method: "POST", url: `/api/parent/held/${held[0].id}/approve`, headers })).json();
    expect(a.status).toBe("needs_picture");
    // the child cannot finish the parent's pending check
    expect((await app.inject({ method: "POST", url: `/api/child/build/${a.requestId}/picture`, payload: { png: PNG64 } })).statusCode).toBe(403);
    const p = await app.inject({ method: "POST", url: `/api/parent/held/${a.requestId}/picture`, headers, payload: { png: PNG64 } });
    expect(p.json().status).toBe("shown");
    const gallery = (await app.inject({ method: "GET", url: "/api/child/creations" })).json();
    expect(gallery).toMatchObject([{ title: "Red Tower", isNew: true }]);
    expect((await app.inject({ method: "POST", url: `/api/parent/held/${held[0].id}/reject`, headers })).statusCode).toBe(404);
  });

  it("a follow-up build may link an existing request of this child", async () => {
    const { app } = make();
    const { headers, childId } = await setup(app);
    await put(app, headers, `/api/parent/settings/child/${childId}`, { pictureCheck: false }, 200);
    const first = (await build(app, { mode: "typed", text: "a red tower" })).json();
    const r = await build(app, { mode: "typed", text: "make it taller", baseScene: SCENE, parentRequestId: first.requestId });
    expect(r.json().status).toBe("shown");
  });
});

describe("errors and static", () => {
  it("a 500 returns {error:'internal'} only", async () => {
    const { app } = make();
    const { headers } = await setup(app);
    // voice + cloud stt with a provider missing from the registry throws inside the route
    await put(app, headers, "/api/parent/settings/child/1", { voice: true, stt: "google", sttModel: "w" }, 200);
    const r = await app.inject({ method: "POST", url: "/api/child/stt", headers: { "content-type": "audio/webm" }, payload: Buffer.from("a") });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal" });
  });

  it("serves / and /parent", async () => {
    const { app } = make();
    for (const url of ["/", "/parent"]) {
      const r = await app.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(200);
    }
  });
});
