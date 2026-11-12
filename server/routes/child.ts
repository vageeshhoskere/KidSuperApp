import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, MB, parse } from "../http";
import type { Ctx } from "../app";
import { getRequest } from "../audit";
import { DEFAULT_CHILD_SETTINGS, getGlobal, type ChildSettings } from "../settings";
import { checkGates } from "../gates";
import { findPii } from "../safety/pii";
import { checkWords } from "../safety/wordlist";
import { finishPictureCheck, screenText, startBuild } from "../pipeline";
import { PROVIDER_TIMEOUT_MS } from "../safety/layers";
import { parseScene, SceneSchema } from "../../shared/scene";
import { COPY, fill } from "../../shared/copy";
import type { BuildResult } from "../../shared/api";

const BuildBody = z.strictObject({
  mode: z.enum(["typed", "voice", "pictures"]), text: z.string(),
  baseScene: z.unknown().optional(), parentRequestId: z.string().optional(),
});
const PictureBody = z.strictObject({ png: z.string().min(1).regex(/^[A-Za-z0-9+/]*={0,2}$/) });
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_INPUT = 300;
const CreationBody = z.strictObject({
  title: SceneSchema.shape.title, scene: z.unknown(),
  thumbnail: z.string().max(MB).regex(/^data:image\//).nullable(),
});
const IdParam = z.object({ id: z.string().min(1) });
const NumIdParam = z.object({ id: z.coerce.number().int() });

/** Decodes a base64 PNG body, enforcing the 2 MB decoded limit. */
export function decodePng(body: unknown): Buffer {
  const png = Buffer.from(parse(PictureBody, body).png, "base64");
  if (png.length > 2 * MB) throw new HttpError(400, "picture too large");
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new HttpError(400, "not a PNG");
  return png;
}

export function childRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, deps } = ctx;
  const child = () => {
    const c = ctx.currentChild();
    if (!c) throw new HttpError(403, "not set up", { error: "not set up", message: COPY.setup });
    return c;
  };
  /** Speech routes honour the allowed hours (setup is checked by child()); mode and limit are not build gates here. */
  const requireOpen = (s: ChildSettings) => {
    const g = checkGates({ global: getGlobal(db), child: { ...s, voice: true }, mode: "voice", buildsToday: 0, now: ctx.now() });
    if (!g.ok) throw new HttpError(403, "closed", { error: "closed", message: g.reason === "setup" ? COPY.setup : COPY.closed });
  };
  const track = (childId: number, r: BuildResult) => {
    if (r.status === "shown") ctx.lastShown.set(childId, r.scene.title);
    if (r.status === "needs_picture") ctx.owners.set(r.requestId, childId);
    return r;
  };

  app.get("/api/child/state", async () => {
    const c = ctx.currentChild();
    const s = c?.settings ?? DEFAULT_CHILD_SETTINGS;
    return {
      ready: !!c, child: c && { id: c.id, name: c.name, avatar: c.avatar },
      modes: { typing: s.typing, pictures: s.pictures, voice: s.voice, stt: s.stt, tts: s.tts, ttsProvider: s.ttsProvider },
    };
  });

  app.post("/api/child/build", async (req) => {
    const b = parse(BuildBody, req.body);
    const c = ctx.currentChild();
    if (!c) return { status: "closed", message: COPY.setup } satisfies BuildResult;
    const baseScene = b.baseScene === undefined ? undefined : parseScene(b.baseScene);
    if (baseScene === null) throw new HttpError(400, "invalid baseScene");
    if (b.parentRequestId !== undefined && getRequest(db, b.parentRequestId)?.childId !== c.id)
      throw new HttpError(400, "invalid parentRequestId");
    return track(c.id, await startBuild(deps, { childId: c.id, mode: b.mode, text: b.text, baseScene, parentRequestId: b.parentRequestId }));
  });

  // ~3 MB of JSON carries a 2 MB picture after base64 overhead; the decoded size is checked in decodePng
  app.post("/api/child/build/:id/picture", { bodyLimit: 3 * MB }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const c = child();
    if (ctx.owners.get(id) !== c.id) throw new HttpError(403, "not your build");
    const png = decodePng(req.body);
    ctx.owners.delete(id);
    return track(c.id, await finishPictureCheck(deps, id, png));
  });

  app.register(async (a) => {
    a.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: 5 * MB }, (_req, body, done) => done(null, body));
    a.post("/api/child/stt", { bodyLimit: 5 * MB }, async (req) => {
      const c = child();
      const s = c.settings;
      requireOpen(s);
      if (!s.voice || s.stt === "browser") throw new HttpError(403, "speech input is off");
      const mime = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!mime.startsWith("audio/") || !Buffer.isBuffer(req.body)) throw new HttpError(415, "audio expected");
      const p = ctx.registry().get(s.stt);
      if (!p?.transcribe) throw new Error(`stt provider ${s.stt} unavailable`);
      const text = await p.transcribe(req.body, mime, PROVIDER_TIMEOUT_MS, s.sttModel);
      // R18 + R24: the transcript is provider text shown to the child: PII, words and length here, then Layers 2 and 3
      const blocked = (stage: string, message: string) => {
        deps.audit.logEvent("stt_blocked", { stage, text: findPii(text).masked }); // never the unmasked transcript
        return { text: "", message };
      };
      if (findPii(text).found) return blocked("pii", COPY.pii);
      if (!checkWords(text, s.wordAdditions, s.allowedPhrases).pass) return blocked("words", COPY.oops);
      if (text.length > MAX_INPUT) return blocked("length", COPY.tooLong);
      const stage = await screenText(deps, c.id, text);
      return stage ? blocked(stage, COPY.oops) : { text };
    });
  });

  app.post("/api/child/tts", async (req, reply) => {
    const { text } = parse(z.strictObject({ text: z.string() }), req.body);
    const c = child();
    const s = c.settings;
    requireOpen(s);
    const title = ctx.lastShown.get(c.id);
    if (!s.tts || s.ttsProvider === "browser" || title === undefined || text !== fill(COPY.here, { title }))
      throw new HttpError(403, "not allowed");
    const p = ctx.registry().get(s.ttsProvider);
    if (!p?.speak) throw new Error(`tts provider ${s.ttsProvider} unavailable`);
    const audio = await p.speak(text, PROVIDER_TIMEOUT_MS, s.ttsModel);
    return reply.type(audio.subarray(0, 4).toString() === "RIFF" ? "audio/wav" : "audio/mpeg").send(audio);
  });

  app.get("/api/child/creations", async () => {
    const rows = db.prepare("SELECT id, title, scene, thumbnail, is_new FROM creations WHERE child_id = ? ORDER BY id DESC")
      .all(child().id) as { id: number; title: string; scene: string; thumbnail: string | null; is_new: number }[];
    return rows.map((r) => ({ id: r.id, title: r.title, scene: JSON.parse(r.scene), thumbnail: r.thumbnail, isNew: r.is_new === 1 }));
  });

  app.post("/api/child/creations", async (req) => {
    const b = parse(CreationBody, req.body);
    const scene = parseScene(b.scene);
    if (!scene) throw new HttpError(400, "invalid scene");
    const r = db.prepare("INSERT INTO creations (child_id, title, scene, thumbnail, is_new, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(child().id, b.title, JSON.stringify(scene), b.thumbnail, ctx.now().toISOString());
    return { id: Number(r.lastInsertRowid) };
  });

  app.post("/api/child/creations/:id/seen", async (req) => {
    const { id } = parse(NumIdParam, req.params);
    const r = db.prepare("UPDATE creations SET is_new = 0 WHERE id = ? AND child_id = ?").run(id, child().id);
    if (!r.changes) throw new HttpError(404, "not found");
    return { ok: true };
  });
}
