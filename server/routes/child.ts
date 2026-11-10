import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, MB, parse } from "../http";
import type { Ctx } from "../app";
import { getRequest } from "../audit";
import { DEFAULT_CHILD_SETTINGS } from "../settings";
import { finishPictureCheck, startBuild } from "../pipeline";
import { PROVIDER_TIMEOUT_MS } from "../safety/layers";
import { parseScene, SceneSchema } from "../../shared/scene";
import { COPY, fill } from "../../shared/copy";
import type { BuildResult } from "../../shared/api";

const BuildBody = z.strictObject({
  mode: z.enum(["typed", "voice", "pictures"]), text: z.string(),
  baseScene: z.unknown().optional(), parentRequestId: z.string().optional(),
});
const PictureBody = z.strictObject({ png: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/) });
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
  return png;
}

export function childRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, deps } = ctx;
  const child = () => {
    const c = ctx.currentChild();
    if (!c) throw new HttpError(403, "not set up");
    return c;
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
      const s = child().settings;
      if (!s.voice || s.stt === "browser" || !Buffer.isBuffer(req.body)) throw new HttpError(403, "speech input is off");
      const p = ctx.registry().get(s.stt);
      if (!p?.transcribe) throw new Error(`stt provider ${s.stt} unavailable`);
      return { text: await p.transcribe(req.body, req.headers["content-type"]!, PROVIDER_TIMEOUT_MS, s.sttModel) };
    });
  });

  app.post("/api/child/tts", async (req, reply) => {
    const { text } = parse(z.strictObject({ text: z.string() }), req.body);
    const c = child();
    const s = c.settings;
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
