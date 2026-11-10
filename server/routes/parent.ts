import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { HttpError, MB, parse } from "../http";
import type { Ctx } from "../app";
import { getRequest, listEvents, listHeld, listRequests, toCsv } from "../audit";
import { checkSession, hashPin, isValidPin, login, logout } from "../auth";
import { maskKey, readKeys, writeKey } from "../keys";
import { createChild, getChild, getGlobal, updateChild, updateGlobal, type GlobalSettings } from "../settings";
import { approveHeld, finishPictureCheck, rejectHeld } from "../pipeline";
import { decodePng } from "./child";
import type { BuildResult } from "../../shared/api";

const PROVIDERS = ["openai", "anthropic", "google"] as const;
const ChildBody = z.strictObject({ name: z.string().trim().min(1).max(40), avatar: z.string().min(1).max(40), age: z.number().int().min(1).max(18) });
const SetupBody = z.strictObject({ pin: z.string(), child: ChildBody });
const ProviderParam = z.object({ provider: z.enum(PROVIDERS) });
const IdParam = z.object({ id: z.string().min(1) });
const NumIdParam = z.object({ id: z.coerce.number().int() });
const AuditQuery = z.object({
  childId: z.coerce.number().int().optional(), from: z.string().optional(), to: z.string().optional(),
  outcome: z.enum(["shown", "redirected", "held", "closed", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(), offset: z.coerce.number().int().min(0).optional(),
});
const MASK = "***";
const PUBLIC = new Set(["/api/parent/setup", "/api/parent/login"]);

/** Settings validation errors are our own messages (or zod field paths); safe to return. */
const asBadRequest = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof z.ZodError) throw new HttpError(400, `invalid: ${e.issues.map((i) => i.path.join(".")).join(", ")}`);
    throw new HttpError(400, e instanceof Error ? e.message : "invalid");
  }
};

export function parentRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, deps } = ctx;

  const startSession = (reply: FastifyReply, token: string) =>
    // secure: false — plain HTTP on the home LAN, so a Secure cookie would never be sent
    reply.setCookie("ps", token, { httpOnly: true, sameSite: "strict", path: "/", secure: false });

  app.addHook("onRequest", async (req) => {
    if (PUBLIC.has(req.routeOptions.url ?? "")) return; // the matched route pattern, not the raw URL
    if (!checkSession(req.cookies.ps, ctx.now())) throw new HttpError(401, "login required");
  });

  app.post("/api/parent/setup", async (req, reply) => {
    const b = parse(SetupBody, req.body);
    if (getGlobal(db).pinHash !== null) throw new HttpError(403, "already set up");
    if (!isValidPin(b.pin)) throw new HttpError(400, "PIN must be 6 digits");
    updateGlobal(db, { pinHash: hashPin(b.pin) }, deps.audit);
    const childId = createChild(db, b.child);
    const r = login(db, deps.audit, b.pin, ctx.now());
    if (!r.ok) throw new Error("login after setup failed");
    startSession(reply, r.token);
    return { ok: true, childId };
  });

  app.post("/api/parent/login", async (req, reply) => {
    const { pin } = parse(z.strictObject({ pin: z.string().max(20) }), req.body);
    const r = login(db, deps.audit, pin, ctx.now());
    if (!r.ok) throw new HttpError(r.locked ? 429 : 401, r.locked ? "locked" : "wrong PIN");
    startSession(reply, r.token);
    return { ok: true };
  });

  app.post("/api/parent/logout", async (req, reply) => {
    logout(req.cookies.ps!);
    reply.clearCookie("ps", { path: "/" });
    return { ok: true };
  });

  app.get("/api/parent/settings/global", async () => {
    const g = getGlobal(db);
    return { ...g, pinHash: g.pinHash && MASK, smtp: g.smtp && { ...g.smtp, pass: g.smtp.pass && MASK } };
  });

  app.put("/api/parent/settings/global", async (req) => {
    const patch = parse(z.record(z.string(), z.unknown()), req.body) as Partial<GlobalSettings>;
    if ("pinHash" in patch) throw new HttpError(400, "invalid: pinHash");
    const old = getGlobal(db);
    if (patch.smtp && patch.smtp.pass === MASK) patch.smtp = { ...patch.smtp, pass: old.smtp?.pass ?? "" };
    const next = { ...old, ...patch };
    if (patch.setupComplete && !(next.builder && (next.moderation !== "off" || next.moderationOffAcknowledged)))
      throw new HttpError(400, "setup needs a builder and a moderation choice");
    asBadRequest(() => updateGlobal(db, patch, deps.audit));
    return { ok: true };
  });

  app.get("/api/parent/settings/child/:id", async (req) => {
    const c = getChild(db, parse(NumIdParam, req.params).id);
    if (!c) throw new HttpError(404, "not found");
    return c;
  });

  app.put("/api/parent/settings/child/:id", async (req) => {
    const { id } = parse(NumIdParam, req.params);
    if (!getChild(db, id)) throw new HttpError(404, "not found");
    asBadRequest(() => updateChild(db, id, req.body as object, deps.audit));
    return { ok: true };
  });

  app.post("/api/parent/children", async (req) => ({ id: createChild(db, parse(ChildBody, req.body)) }));

  app.get("/api/parent/keys", async () => {
    const keys = readKeys(ctx.dataDir);
    return Object.fromEntries(PROVIDERS.map((p) => [p, keys[p] ? maskKey(keys[p]) : null]));
  });

  app.put("/api/parent/keys/:provider", async (req) => {
    const { provider } = parse(ProviderParam, req.params);
    const { key } = parse(z.strictObject({ key: z.string().trim().min(1).max(500).nullable() }), req.body);
    const old = readKeys(ctx.dataDir)[provider];
    writeKey(ctx.dataDir, provider, key);
    deps.audit.logEvent("settings_change", { key: `apiKey.${provider}`, old: old ? maskKey(old) : null, new: key ? maskKey(key) : null });
    ctx.rebuildRegistry();
    return { ok: true };
  });

  app.post("/api/parent/keys/:provider/test", async (req) => {
    const { provider } = parse(ProviderParam, req.params);
    const p = ctx.registry().get(provider);
    if (!p) return { ok: false, models: [] };
    try {
      return { ok: true, models: await p.listModels() };
    } catch (e) {
      req.log.warn({ provider, err: e }, "key test failed");
      return { ok: false, models: [] };
    }
  });

  app.get("/api/parent/audit", async (req) => listRequests(db, parse(AuditQuery, req.query)));

  app.get("/api/parent/audit.csv", async (req, reply) => {
    const { from, to } = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
    return reply.type("text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="audit.csv"')
      .send(toCsv(listRequests(db, { from, to })));
  });

  app.get("/api/parent/audit/:id", async (req) => {
    const r = getRequest(db, parse(IdParam, req.params).id);
    if (!r) throw new HttpError(404, "not found");
    return r;
  });

  app.get("/api/parent/events", async (req) =>
    listEvents(db, parse(z.object({ type: z.string().optional(), since: z.string().optional() }), req.query)));

  app.get("/api/parent/held", async () => listHeld(db));

  const track = (r: BuildResult) => {
    if (r.status === "needs_picture") ctx.owners.set(r.requestId, "parent");
    return r;
  };

  app.post("/api/parent/held/:id/approve", async (req) => track(await approveHeld(deps, parse(IdParam, req.params).id)));

  // R2: :id is the NEW request id that approve returned
  app.post("/api/parent/held/:id/picture", { bodyLimit: 3 * MB }, async (req) => {
    const { id } = parse(IdParam, req.params);
    if (ctx.owners.get(id) !== "parent") throw new HttpError(404, "no pending picture check");
    const png = decodePng(req.body);
    ctx.owners.delete(id);
    return await finishPictureCheck(deps, id, png);
  });

  app.post("/api/parent/held/:id/reject", async (req) => {
    const { id } = parse(IdParam, req.params);
    if (!listHeld(db).some((r) => r.id === id)) throw new HttpError(404, "not found");
    rejectHeld(deps, id);
    return { ok: true };
  });
}
