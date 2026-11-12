import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../../server/db";
import { createChild, getChild, updateChild, updateGlobal, type ChildSettings } from "../../server/settings";
import { countBuildsSince, getRequest, listEvents, listHeld, listRequests, makeAuditWriter, type AuditRequest, type AuditWriter } from "../../server/audit";
import { makeFakeProvider, type FakeProvider } from "../../server/providers/fake";
import { ProviderError, type ProviderId } from "../../server/providers/types";
import { __resetPipelineState, approveHeld, BUILDER_SYSTEM_PROMPT, finishPictureCheck, rejectHeld, startBuild, testBuild, TEST_PROMPT, type Deps } from "../../server/pipeline";
import { makeNotify } from "../../server/notify";
import { COPY } from "../../shared/copy";
import type { BuildResult } from "../../shared/api";
import { PALETTE, SHAPES, type Scene } from "../../shared/scene";
import { SAFE_IDEAS } from "../../server/safety/ideas";

const NOW = new Date(2026, 10, 10, 10, 0); // 10:00 local, inside default hours
const v = (verdict: string) => ({ intent: "build a tower", summary: "a red tower", verdict, categories: [], reason: "ok" });
const SCENE: Scene = {
  title: "Red Tower",
  blocks: [{ shape: "cube", color: "red", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] }],
};
const PNG = Buffer.from("png");

afterEach(() => __resetPipelineState());

type Opts = {
  verdicts?: string[]; build?: unknown[] | ((o: never) => unknown); builderFail?: "timeout" | "malformed";
  scores?: Record<string, number>; modFail?: "timeout"; child?: Partial<ChildSettings>; age?: number; audit?: AuditWriter;
  notify?: Deps["notify"]; pictureTimeoutMs?: number;
};

function setup(o: Opts = {}) {
  const db: Db = openDb(":memory:");
  const realAudit = makeAuditWriter(db);
  updateGlobal(db, {
    setupComplete: true, moderation: "openai",
    builder: { provider: "anthropic", model: "b-model" }, checker: { provider: "google", model: "c-model" },
    smtp: { host: "h", port: 25, user: "", pass: "", from: "f@x", to: "t@x" },
  }, realAudit);
  const childId = createChild(db, { name: "Sam", avatar: "a", age: o.age ?? 7 });
  updateChild(db, childId, { pictureCheck: false, ...o.child }, realAudit);
  const verdicts = [...(o.verdicts ?? [])];
  const mod = makeFakeProvider({ moderate: o.scores ?? { violence: 0.01 }, fail: o.modFail });
  // a verdict of "timeout" or "error" makes that checker call throw instead
  const checker = makeFakeProvider({
    json: () => {
      const next = verdicts.shift() ?? "safe";
      if (next === "timeout" || next === "error") throw new ProviderError(next);
      return v(next);
    },
  });
  const builder = makeFakeProvider(
    o.builderFail ? { fail: o.builderFail } : { json: (o.build as unknown[] | undefined) ?? [SCENE, SCENE, SCENE] },
  );
  const providers: Partial<Record<ProviderId, FakeProvider>> = { openai: mod, google: checker, anthropic: builder };
  const notify = o.notify ?? vi.fn(async () => {});
  const d: Deps = {
    db, audit: o.audit ?? realAudit, registry: { get: (id) => providers[id] ?? null }, now: () => NOW,
    notify, rand: () => 0.5, pictureTimeoutMs: o.pictureTimeoutMs,
  };
  return { db, d, childId, mod, checker, builder, notify };
}

const rows = (db: Db) => listRequests(db, {});
const row = (db: Db, id?: string) => getRequest(db, id!)!;
const creations = (db: Db) => db.prepare("SELECT * FROM creations").all() as { is_new: number; title: string; child_id: number }[];
const input = (childId: number, text = "a red tower") => ({ childId, mode: "typed" as const, text });
const noCalls = (...ps: FakeProvider[]) => ps.forEach((p) => expect(p.calls.generateJson + p.calls.moderate).toBe(0));

describe("startBuild", () => {
  it("settingsOverride applies to that build only and is never persisted", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true } });
    const before = getChild(db, childId)!.settings;
    const r = await startBuild(d, { ...input(childId), settingsOverride: { pictureCheck: false } });
    expect(r.status).toBe("shown"); // without the override this would be needs_picture
    expect(getChild(db, childId)!.settings).toEqual(before);
    expect((await startBuild(d, input(childId))).status).toBe("needs_picture");
  });

  it("happy path with picture check off returns shown and audits shown", async () => {
    const { db, d, childId, builder } = setup();
    const r = await startBuild(d, input(childId));
    expect(r).toEqual({ status: "shown", requestId: expect.any(String), scene: SCENE, speak: "Here's your Red Tower!" });
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("shown");
    expect(a).toMatchObject({
      inputText: "a red tower", intent: "build a tower", summary: "a red tower", scene: SCENE,
      layer1: { result: "pass" }, layer2: { result: "pass" }, layer3: { result: "pass" }, outputText: { result: "pass" },
      builder: { provider: "anthropic", model: "b-model" }, checker: { provider: "google", model: "c-model" },
    });
    expect(a.raw.length).toBe(5); // moderation, checker, builder, output moderation, output checker
    expect(builder.last.generateJson?.system).toBe(BUILDER_SYSTEM_PROMPT);
    // adapters wrap in <child_data> (once); the pipeline passes the plain data
    expect(builder.last.generateJson?.data).toBe("Request: a red tower");
    expect(creations(db)).toHaveLength(0);
  });

  it("picture check on returns needs_picture, then finishPictureCheck pass → shown", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true } });
    const r = await startBuild(d, input(childId));
    expect(r).toMatchObject({ status: "needs_picture", scene: SCENE });
    const id = (r as { requestId: string }).requestId;
    expect(getRequest(db, id)).toBeNull(); // not audited until the picture comes back
    const f = await finishPictureCheck(d, id, PNG);
    expect(f).toMatchObject({ status: "shown", requestId: id, scene: SCENE, speak: "Here's your Red Tower!" });
    expect(row(db, id).outcome).toBe("shown");
    expect(row(db, id).pictureCheck).toMatchObject({ result: "pass" });
    const again = await startBuild(d, input(childId));
    expect(again.status).toBe("needs_picture"); // lock released
    await finishPictureCheck(d, (again as { requestId: string }).requestId, PNG);
  });

  it("finishPictureCheck fail → redirected; unknown id → error", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true }, verdicts: ["safe", "safe", "unsafe"] });
    const r = await startBuild(d, input(childId));
    const id = (r as { requestId: string }).requestId;
    const f = await finishPictureCheck(d, id, PNG);
    expect(f).toMatchObject({ status: "redirected", requestId: id });
    expect(f).not.toHaveProperty("scene");
    expect(row(db, id).outcome).toBe("redirected");
    expect(await finishPictureCheck(d, id, PNG)).toEqual({ status: "error", message: COPY.oops });
    expect(rows(db)).toHaveLength(1);
  });

  it("layer1 fail → redirected", async () => {
    const { db, d, childId, mod, checker, builder } = setup();
    const r = await startBuild(d, input(childId, "a big gun"));
    expect(r).toMatchObject({ status: "redirected", message: expect.stringContaining("Let's build something else!") });
    const ideas = (r as { ideas: string[] }).ideas;
    expect(new Set(ideas).size).toBe(3);
    ideas.forEach((i) => expect(SAFE_IDEAS).toContain(i));
    expect((r as { message: string }).message).toBe(`Let's build something else! How about a ${ideas[0]}?`);
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("redirected");
    expect(a.layer1.result).toBe("fail");
    noCalls(mod, checker, builder);
  });

  it("layer2 fail → redirected", async () => {
    const { db, d, childId, checker, builder } = setup({ scores: { violence: 0.9 } });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("redirected");
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("redirected");
    expect(a.layer2.result).toBe("fail");
    expect(a.intent).toBeNull();
    noCalls(checker, builder);
  });

  it("layer3 unsure → redirected, no builder call", async () => {
    const { db, d, childId, builder } = setup({ verdicts: ["unsure"] });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("redirected");
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("redirected");
    expect(a.layer3.result).toBe("fail");
    expect(builder.calls.generateJson).toBe(0);
  });

  it("pii → COPY.pii, audit inputText masked, no provider called", async () => {
    const { db, d, childId, mod, checker, builder } = setup();
    const r = await startBuild(d, input(childId, "my house at 12 Oak Tree Road"));
    expect(r).toEqual({ status: "redirected", requestId: expect.any(String), message: COPY.pii, ideas: expect.any(Array) });
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("redirected");
    expect(a.inputText).toBe("my house at [address]");
    noCalls(mod, checker, builder);
  });

  it("builder malformed → error, COPY.oops", async () => {
    const { db, d, childId } = setup({ build: [{ title: "x", blocks: [] }] });
    const r = await startBuild(d, input(childId));
    expect(r).toEqual({ status: "error", requestId: expect.any(String), message: COPY.oops });
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("error");
    expect(a.scene).toBeNull();
    expect(a.errorDetail).toContain("malformed");
  });

  it("builder timeout → error", async () => {
    const { db, d, childId } = setup({ builderFail: "timeout" });
    const r = await startBuild(d, input(childId));
    expect(r).toMatchObject({ status: "error", message: COPY.oops });
    expect(row(db, (r as { requestId: string }).requestId)).toMatchObject({ outcome: "error", errorDetail: expect.stringContaining("timeout") });
  });

  it("output checker unsafe → redirected, scene not returned", async () => {
    const { db, d, childId } = setup({ verdicts: ["safe", "unsafe"] });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("redirected");
    expect(r).not.toHaveProperty("scene");
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("redirected");
    expect(a.outputText).toMatchObject({ result: "fail", detail: { layer3: { result: "fail" } } });
  });

  it("output title failing layer 1 or containing pii → redirected", async () => {
    const bad = { ...SCENE, title: "Gun Tower" };
    const pii = { ...SCENE, title: "Call 5551234567" };
    const { db, d, childId } = setup({ build: [bad, pii] });
    for (const layer of ["layer1", "pii"]) {
      const r = await startBuild(d, input(childId));
      expect(r.status).toBe("redirected");
      expect(row(db, (r as { requestId: string }).requestId)).toMatchObject({
        outcome: "redirected", outputText: { result: "fail", detail: { [layer]: { result: "fail" } } },
      });
    }
  });

  it("audit write failure → COPY.oops, never shown", async () => {
    const audit: AuditWriter = { logRequest: () => { throw new Error("disk full"); }, logEvent: () => {} };
    const { db, d, childId } = setup({ audit });
    const r = await startBuild(d, input(childId));
    expect(r).toMatchObject({ status: "error", message: COPY.oops });
    expect(rows(db)).toHaveLength(0);
  });

  it("missing builder provider → error", async () => {
    const { db, d, childId } = setup();
    d.registry = { get: (id) => (id === "anthropic" ? null : makeFakeProvider({ moderate: { a: 0 }, json: [v("safe")] })) };
    const r = await startBuild(d, input(childId));
    expect(r).toMatchObject({ status: "error", message: COPY.oops });
    expect(row(db, (r as { requestId: string }).requestId).outcome).toBe("error");
  });

  it("notify handling calls notify once; notify throwing still returns redirected", async () => {
    const { db, d, childId, notify } = setup({ child: { flagHandling: "notify" }, verdicts: ["unsafe"] });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("redirected");
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ outcome: "redirected", layer3: { result: "fail" } });
    expect(row(db, (r as { requestId: string }).requestId).outcome).toBe("redirected");

    d.notify = async () => { throw new Error("smtp down"); };
    const r2 = await startBuild(d, input(childId, "a gun"));
    expect(r2.status).toBe("redirected");
    expect(row(db, (r2 as { requestId: string }).requestId)).toMatchObject({ outcome: "redirected", errorDetail: "notify failed: smtp down" });
    expect(rows(db)).toHaveLength(2);
  });

  it("gate closed → closed (setup and hours)", async () => {
    const { db, d, childId, mod } = setup();
    d.now = () => new Date(2026, 10, 10, 21, 0);
    const r = await startBuild(d, input(childId));
    expect(r).toEqual({ status: "closed", message: COPY.closed });
    expect(rows(db)[0].outcome).toBe("closed");
    updateGlobal(db, { setupComplete: false }, makeAuditWriter(db));
    expect(await startBuild(d, input(childId))).toEqual({ status: "closed", message: COPY.setup });
    expect(rows(db).map((r) => r.outcome)).toEqual(["closed", "closed"]);
    noCalls(mod);
  });
});

describe("provider errors in safety layers fail closed", () => {
  const errorRow = (db: Db, r: BuildResult) => {
    expect(r).toMatchObject({ status: "error", message: COPY.oops });
    const a = row(db, (r as { requestId: string }).requestId);
    expect(a.outcome).toBe("error");
    return a;
  };

  it("moderation timeout → error", async () => {
    const { db, d, childId, checker, builder } = setup({ modFail: "timeout" });
    const a = errorRow(db, await startBuild(d, input(childId)));
    expect(a.layer2).toMatchObject({ result: "fail", detail: { error: "timeout" } });
    noCalls(checker, builder);
  });

  it("input checker timeout → error, not held (hold mode)", async () => {
    const { db, d, childId, builder } = setup({ child: { flagHandling: "hold" }, verdicts: ["timeout"] });
    const a = errorRow(db, await startBuild(d, input(childId)));
    expect(a.layer3).toMatchObject({ result: "fail", detail: { error: "timeout" } });
    expect(listHeld(db)).toHaveLength(0);
    expect(builder.calls.generateJson).toBe(0);
  });

  it("input checker error under notify → error, notify not called", async () => {
    const { db, d, childId, notify } = setup({ child: { flagHandling: "notify" }, verdicts: ["error"] });
    errorRow(db, await startBuild(d, input(childId)));
    expect(notify).not.toHaveBeenCalled();
  });

  it("output checker timeout → error", async () => {
    const { db, d, childId } = setup({ verdicts: ["safe", "timeout"] });
    const r = await startBuild(d, input(childId));
    expect(r).not.toHaveProperty("scene");
    const a = errorRow(db, r);
    expect(a.outputText).toMatchObject({ detail: { layer3: { result: "fail", detail: { error: "timeout" } } } });
  });

  it("picture check timeout → error", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true }, verdicts: ["safe", "safe", "timeout"] });
    const id = ((await startBuild(d, input(childId))) as { requestId: string }).requestId;
    const f = await finishPictureCheck(d, id, PNG);
    expect(f).not.toHaveProperty("scene");
    const a = errorRow(db, f);
    expect(a.pictureCheck).toMatchObject({ result: "fail", detail: { error: "timeout" } });
    expect((await startBuild(d, input(childId))).status).toBe("needs_picture"); // lock released
  });

  it("audit write failure in finishPictureCheck → COPY.oops, never shown", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true } });
    const id = ((await startBuild(d, input(childId))) as { requestId: string }).requestId;
    d.audit = { logRequest: () => { throw new Error("disk full"); }, logEvent: () => {} };
    expect(await finishPictureCheck(d, id, PNG)).toEqual({ status: "error", message: COPY.oops });
    expect(getRequest(db, id)).toBeNull();
  });

  it("audit write failure in approveHeld → COPY.oops, never shown, no creation", async () => {
    const { db, d, childId } = setup({ child: { flagHandling: "hold" }, verdicts: ["unsure"] });
    const heldId = ((await startBuild(d, input(childId))) as { requestId: string }).requestId;
    const real = d.audit;
    d.audit = { logRequest: () => { throw new Error("disk full"); }, logEvent: real.logEvent };
    expect(await approveHeld(d, heldId)).toEqual({ status: "error", message: COPY.oops });
    expect(rows(db).map((r) => r.outcome)).toEqual(["held"]);
    expect(creations(db)).toHaveLength(0);
  });
});

describe("held requests", () => {
  it("hold handling → held; approveHeld runs builder and output checks and creates is_new creation", async () => {
    const { db, d, childId, builder, checker } = setup({ child: { flagHandling: "hold", pictureCheck: true }, verdicts: ["unsure"] });
    const r = await startBuild(d, input(childId, "a spooky tower"));
    expect(r).toEqual({ status: "held", requestId: expect.any(String), message: COPY.held });
    const heldId = (r as { requestId: string }).requestId;
    expect(row(db, heldId).outcome).toBe("held");
    expect(builder.calls.generateJson).toBe(0);
    expect(listHeld(db).map((h) => h.id)).toEqual([heldId]);

    const a = await approveHeld(d, heldId);
    expect(a).toMatchObject({ status: "needs_picture", scene: SCENE });
    const newId = (a as { requestId: string }).requestId;
    expect(builder.calls.generateJson).toBe(1);
    expect(listHeld(db)).toHaveLength(0);
    expect(listEvents(db, { type: "hold_decision" })).toMatchObject([
      { relatedRequestId: heldId, detail: { decision: "approve", newRequestId: newId } },
    ]);
    const checks = checker.calls.generateJson;
    const f = await finishPictureCheck(d, newId, PNG);
    expect(f.status).toBe("shown");
    expect(checker.calls.generateJson).toBe(checks + 1);
    const n = row(db, newId);
    expect(n).toMatchObject({ outcome: "shown", inputText: "a spooky tower", layer3: { result: "fail" }, parentRequestId: heldId });
    expect(row(db, heldId).outcome).toBe("held"); // held row untouched
    expect(creations(db)).toMatchObject([{ child_id: childId, title: "Red Tower", is_new: 1 }]);
    expect(await approveHeld(d, heldId)).toMatchObject({ status: "error" }); // already decided
  });

  it("approveHeld with unsafe output → redirected, no creation", async () => {
    const { db, d, childId } = setup({ child: { flagHandling: "hold" }, verdicts: ["unsure", "unsafe"] });
    const heldId = ((await startBuild(d, input(childId))) as { requestId: string }).requestId;
    const a = await approveHeld(d, heldId);
    expect(a.status).toBe("redirected");
    expect(row(db, (a as { requestId: string }).requestId).outcome).toBe("redirected");
    expect(creations(db)).toHaveLength(0);
  });

  it("rejectHeld logs a reject decision", async () => {
    const { db, d, childId } = setup({ child: { flagHandling: "hold" }, verdicts: ["unsure"] });
    const heldId = ((await startBuild(d, input(childId))) as { requestId: string }).requestId;
    rejectHeld(d, heldId);
    expect(row(db, heldId).outcome).toBe("held");
    expect(listEvents(db, { type: "hold_decision" })).toMatchObject([{ relatedRequestId: heldId, detail: { decision: "reject" } }]);
    expect(listHeld(db)).toHaveLength(0);
    expect(() => rejectHeld(d, heldId)).toThrow();
  });
});

describe("follow-ups and review focus", () => {
  it("follow-up passes baseScene in builder data and records parentRequestId", async () => {
    const { db, d, childId, builder } = setup();
    const r = await startBuild(d, { ...input(childId, "make it taller"), baseScene: SCENE, parentRequestId: "prev-1" });
    expect(r.status).toBe("shown");
    expect(builder.last.generateJson?.data).toContain(JSON.stringify(SCENE));
    expect(builder.last.generateJson?.data).toContain("make it taller");
    expect(row(db, (r as { requestId: string }).requestId)).toMatchObject({ outcome: "shown", parentRequestId: "prev-1" });
  });

  it("rejects concurrent build for same child", async () => {
    const { db, d, childId, mod, builder } = setup();
    const first = startBuild(d, input(childId));
    const second = await startBuild(d, input(childId));
    expect(second).toEqual({ status: "busy", message: COPY.busy });
    expect((await first).status).toBe("shown");
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0].outcome).toBe("shown");
    expect(builder.calls.generateJson).toBe(1);
    expect(mod.calls.moderate).toBe(2); // input + output of the first build only
  });

  it("abandoned picture check is audited as error after 60s", async () => {
    const { db, d, childId } = setup({ child: { pictureCheck: true }, pictureTimeoutMs: 20 });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("needs_picture");
    const id = (r as { requestId: string }).requestId;
    expect((await startBuild(d, input(childId))).status).toBe("busy");
    await new Promise((res) => setTimeout(res, 60));
    expect(row(db, id)).toMatchObject({ outcome: "error", errorDetail: "picture check not returned" });
    // R25 (final wave) supersedes "counts towards the limit": error rows never use up the child's day
    expect(countBuildsSince(db, childId, new Date(2026, 10, 10).toISOString())).toBe(0);
    expect(await finishPictureCheck(d, id, PNG)).toMatchObject({ status: "error" });
    const again = await startBuild(d, input(childId));
    expect(again.status).toBe("needs_picture"); // lock released
    await finishPictureCheck(d, (again as { requestId: string }).requestId, PNG);
  });

  it("input over 300 chars is rejected before providers", async () => {
    const { db, d, childId, mod, checker, builder } = setup();
    const r = await startBuild(d, input(childId, "a".repeat(301)));
    expect(r).toEqual({ status: "redirected", requestId: expect.any(String), message: COPY.tooLong, ideas: expect.any(Array) });
    expect(row(db, (r as { requestId: string }).requestId).outcome).toBe("redirected");
    noCalls(mod, checker, builder);
  });

  it("whitespace input does nothing", async () => {
    const { db, d, childId, mod, checker, builder } = setup();
    expect(await startBuild(d, input(childId, "  \n\t "))).toEqual({ status: "empty" });
    expect(rows(db)).toHaveLength(0);
    expect(countBuildsSince(db, childId, "2000-01-01T00:00:00.000Z")).toBe(0);
    noCalls(mod, checker, builder);
  });

  it("settings snapshot is taken at start", async () => {
    const { db, d, childId, checker } = setup({ child: { pictureCheck: true }, verdicts: ["safe", "safe", "unsafe"], age: 6 });
    const r = await startBuild(d, input(childId));
    expect(r.status).toBe("needs_picture");
    const id = (r as { requestId: string }).requestId;
    updateChild(db, childId, { pictureCheck: false }, makeAuditWriter(db));
    db.prepare("UPDATE children SET age = 12 WHERE id = ?").run(childId);
    const f = await finishPictureCheck(d, id, PNG);
    expect(f.status).toBe("redirected"); // picture still required and checked
    expect(checker.last.generateJson?.system).toContain("age 6");
    expect(row(db, id).outcome).toBe("redirected");
  });
});

describe("BUILDER_SYSTEM_PROMPT", () => {
  it("names every shape and colour, the limits and the data rule", () => {
    for (const s of SHAPES) expect(BUILDER_SYSTEM_PROMPT).toContain(s);
    for (const c of Object.keys(PALETTE)) expect(BUILDER_SYSTEM_PROMPT).toContain(c);
    for (const n of ["200", "-20", "0.1", "360", "<child_data>"]) expect(BUILDER_SYSTEM_PROMPT).toContain(n);
  });
});

describe("makeNotify", () => {
  const req = { createdAt: "2026-11-10T10:00:00.000Z", inputText: "a gun", intent: "x", summary: "y",
    layer1: { result: "fail", detail: null }, layer2: { result: "pass", detail: null }, layer3: { result: "skipped", detail: null } } as unknown as AuditRequest;
  it("sends one mail with the subject and body fields", async () => {
    const sent: { subject?: string; text?: string; to?: string }[] = [];
    const opts: unknown[] = [];
    const notify = makeNotify(() => ({ host: "smtp.x", port: 587, user: "u", pass: "p", from: "f@x", to: "t@x" }), (o) => {
      opts.push(o);
      return { sendMail: async (m) => { sent.push(m as never); return {}; } };
    });
    await notify(req);
    expect(opts[0]).toMatchObject({ host: "smtp.x", port: 587, auth: { user: "u", pass: "p" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ subject: "Kid 3D Builder: a request was flagged", to: "t@x" });
    for (const s of ["2026-11-10T10:00:00.000Z", "a gun", "layer1"]) expect(sent[0].text).toContain(s);
  });
  it("throws without smtp", async () => {
    await expect(makeNotify(() => null)(req)).rejects.toThrow();
  });
});

describe("final review fixes: source, limit, held baseScene", () => {
  it("source defaults to child and a code-only source is recorded", async () => {
    const { db, d, childId } = setup();
    const a = await startBuild(d, input(childId));
    const b = await startBuild(d, { ...input(childId), source: "redteam" });
    expect(row(db, (a as { requestId: string }).requestId).source).toBe("child");
    expect(row(db, (b as { requestId: string }).requestId).source).toBe("redteam");
  });

  it("red-team, test and error builds do not use up the child's daily limit", async () => {
    const { d, childId } = setup({ child: { buildsPerDay: 1 }, build: [SCENE, SCENE, SCENE, { nope: 1 }, SCENE] });
    expect((await startBuild(d, { ...input(childId), source: "redteam" })).status).toBe("shown");
    expect((await startBuild(d, { ...input(childId), source: "test" })).status).toBe("shown");
    expect((await startBuild(d, input(childId))).status).toBe("shown"); // first child build of the day
    expect((await startBuild(d, input(childId))).status).toBe("closed"); // limit 1 reached
  });

  it("an error build does not count towards the limit", async () => {
    const { d, childId } = setup({ child: { buildsPerDay: 1 }, build: [{ nope: 1 }, SCENE] });
    expect((await startBuild(d, input(childId))).status).toBe("error");
    expect((await startBuild(d, input(childId))).status).toBe("shown");
  });

  it("approving a held follow-up passes its baseScene to the builder", async () => {
    const { db, d, childId, builder } = setup({ child: { flagHandling: "hold" }, verdicts: ["unsure"] });
    const base: Scene = { ...SCENE, title: "Blue Base" };
    const heldId = ((await startBuild(d, { ...input(childId, "make it taller"), baseScene: base })) as { requestId: string }).requestId;
    expect(row(db, heldId).baseScene).toEqual(base);
    expect((await approveHeld(d, heldId)).status).toBe("shown");
    expect(builder.last.generateJson?.data).toContain(JSON.stringify(base));
  });
});

describe("final review #5: builder timeout and size", () => {
  it("builder call gets 60000 ms, checker and moderation calls 20000 ms", async () => {
    const { d, childId, builder, checker } = setup();
    const seen: number[] = [];
    const orig = checker.generateJson.bind(checker);
    checker.generateJson = (o) => { seen.push(o.timeoutMs); return orig(o); };
    expect((await startBuild(d, input(childId))).status).toBe("shown");
    expect(builder.last.generateJson?.timeoutMs).toBe(60_000);
    expect(seen).toEqual([20_000, 20_000]);
  });
  it("builder prompt asks for 10 to 40 blocks", () => {
    expect(BUILDER_SYSTEM_PROMPT).toMatch(/10 to 40 blocks/);
  });
});

describe("testBuild (final review #7)", () => {
  it("runs the fixed safe prompt with source test and reports the title", async () => {
    const { db, d, childId, builder } = setup({ child: { pictureCheck: true, flagHandling: "hold", buildsPerDay: 1 } });
    expect(TEST_PROMPT).toBe("a small red house");
    expect(await testBuild(d, childId)).toEqual({ ok: true, stage: null, status: "shown", title: "Red Tower" });
    expect(builder.last.generateJson?.data).toBe("Request: a small red house");
    expect(rows(db)[0]).toMatchObject({ source: "test", outcome: "shown", inputText: TEST_PROMPT });
    expect(creations(db)).toHaveLength(0);
    expect((await startBuild(d, input(childId))).status).toBe("needs_picture"); // child's own settings and limit untouched
  });

  it("works before setup is complete and outside the child's hours", async () => {
    const { db, d, childId } = setup();
    updateGlobal(db, { setupComplete: false }, makeAuditWriter(db));
    d.now = () => new Date(2026, 10, 10, 23, 59, 30);
    expect((await testBuild(d, childId)).ok).toBe(true);
  });

  it.each([
    ["moderation", { scores: { violence: 0.9 } }],
    ["moderation", { modFail: "timeout" }],
    ["checker", { verdicts: ["unsure"] }],
    ["checker", { verdicts: ["timeout"] }],
    ["builder", { builderFail: "malformed" }],
    ["builder", { builderFail: "timeout" }],
    ["output-check", { verdicts: ["safe", "unsafe"] }],
  ] as [string, Opts][])("names the failing stage %s", async (stage, o) => {
    const { d, childId } = setup(o);
    expect(await testBuild(d, childId)).toMatchObject({ ok: false, stage });
  });

  it("a missing provider is a setup failure", async () => {
    const { d, childId } = setup();
    d.registry = { get: () => null };
    expect(await testBuild(d, childId)).toEqual({ ok: false, stage: "setup", status: "error" });
  });
});
