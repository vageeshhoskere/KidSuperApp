// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { editorReducer } from "../../web/child/editor";
import { PICTURE_WORDS } from "../../web/child/picture-words";
import { checkWords } from "../../server/safety/wordlist";
import { parseScene, type Scene } from "../../shared/scene";

const blk = (o = {}) => ({ shape: "cube" as const, color: "red" as const, position: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], ...o });
const st = (n = 2) => ({ scene: { title: "Test", blocks: Array.from({ length: n }, () => blk()) } as Scene, history: [] as Scene[] });

describe("editorReducer", () => {
  it("recolor changes one block", () => {
    const r = editorReducer(st(), { type: "recolor", index: 1, color: "blue" });
    expect(r.scene.blocks.map((b) => b.color)).toEqual(["red", "blue"]);
    expect(r.history).toHaveLength(1);
  });
  it("delete of the last block is ignored", () => {
    const s = st(1);
    expect(editorReducer(s, { type: "delete", index: 0 })).toBe(s);
    expect(editorReducer(st(2), { type: "delete", index: 0 }).scene.blocks).toHaveLength(1);
  });
  it("add beyond 200 is ignored", () => {
    const s = st(200);
    expect(editorReducer(s, { type: "add", shape: "cone" })).toBe(s);
    expect(editorReducer(st(), { type: "add", shape: "cone" }).scene.blocks[2].shape).toBe("cone");
  });
  it("move clamps to [-20,20]", () => {
    const r = editorReducer(st(), { type: "move", index: 0, delta: [99, -99, 1] });
    expect(r.scene.blocks[0].position).toEqual([20, -20, 1]);
    expect(parseScene(r.scene)).not.toBeNull();
  });
  it("undo restores the previous scene; ignores bad index", () => {
    const s = st();
    const r = editorReducer(s, { type: "recolor", index: 0, color: "green" });
    expect(editorReducer(r, { type: "undo" }).scene).toEqual(s.scene);
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    expect(editorReducer(s, { type: "recolor", index: 9, color: "green" })).toBe(s);
  });
});

describe("PICTURE_WORDS", () => {
  it("has >= 8 per category, all passing checkWords", () => {
    for (const c of ["things", "animals", "colours", "sizes"]) expect(PICTURE_WORDS.filter((w) => w.category === c).length).toBeGreaterThanOrEqual(8);
    for (const w of PICTURE_WORDS) expect(checkWords(w.word, [], []).pass, w.word).toBe(true);
  });
});

describe("static", () => {
  it("web/child has no external href", () => {
    const dir = path.resolve(import.meta.dirname, "../../web/child");
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f), "utf8"), f).not.toContain('href="http');
  });
});
