import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { HttpError } from "./http";
import type { Db } from "./db";
import { makeAuditWriter } from "./audit";
import { readKeys } from "./keys";
import { makeRegistry } from "./providers/registry";
import type { Registry } from "./providers/types";
import { makeNotify } from "./notify";
import { getChild, getGlobal } from "./settings";
import type { Deps } from "./pipeline";
import { childRoutes } from "./routes/child";
import { parentRoutes } from "./routes/parent";

/** Shared state for the route modules. */
export type Ctx = {
  db: Db; dataDir: string; deps: Deps; now: () => Date;
  registry: () => Registry; rebuildRegistry: () => void;
  /** pending picture checks: requestId → owning child id, or "parent" for an approved held request */
  // shortcut: entries of abandoned picture checks are never removed (one small entry each); prune if it ever matters
  owners: Map<string, number | "parent">;
  /** R4: last title shown to each child; TTS speaks only fill(COPY.here, {title}) */
  lastShown: Map<number, string>;
  /** v1 has one child: the first row. null before setup is complete. */
  currentChild: () => NonNullable<ReturnType<typeof getChild>> | null;
};

export function buildApp(o: { db: Db; dataDir: string; registry?: Registry; now?: () => Date }): FastifyInstance {
  const { db, dataDir } = o;
  const now = o.now ?? (() => new Date());
  let registry = o.registry ?? makeRegistry(readKeys(dataDir));
  const audit = makeAuditWriter(db);
  const deps: Deps = {
    db, audit, now,
    get registry() { return registry; }, // R5: a rebuild after a key change takes effect for the next call
    notify: makeNotify(() => getGlobal(db).smtp),
  };
  const ctx: Ctx = {
    db, dataDir, deps, now,
    registry: () => registry,
    rebuildRegistry: () => { if (!o.registry) registry = makeRegistry(readKeys(dataDir)); },
    owners: new Map(),
    lastShown: new Map(),
    currentChild: () => {
      if (!getGlobal(db).setupComplete) return null;
      const r = db.prepare("SELECT id FROM children ORDER BY id LIMIT 1").get() as { id: number } | undefined;
      return r ? getChild(db, r.id) : null;
    },
  };

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" && !process.env.VITEST });
  app.register(cookie);

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send(err.body ?? { error: err.message });
    const status = err.statusCode ?? 500;
    // never echo provider data or stack traces
    if (status >= 500) {
      req.log.error(err);
      return reply.status(500).send({ error: "internal" });
    }
    return reply.status(status).send({ error: "bad request" });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "not found" }));
  app.register(async (a) => childRoutes(a, ctx));
  app.register(async (a) => parentRoutes(a, ctx));

  const web = path.resolve(import.meta.dirname, "../dist/web");
  if (fs.existsSync(path.join(web, "index.html"))) {
    app.register(fastifyStatic, { root: web });
    app.get("/parent", (_req: FastifyRequest, reply: FastifyReply) => reply.sendFile("index.html"));
  } else {
    const msg = "The web app is not built yet. Run `npm run build`, then restart.";
    app.get("/", (_req, reply) => reply.type("text/plain").send(msg));
    app.get("/parent", (_req, reply) => reply.type("text/plain").send(msg));
  }
  return app;
}
