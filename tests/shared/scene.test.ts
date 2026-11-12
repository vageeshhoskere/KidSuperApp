import { describe, it, expect } from "vitest";
import { parseScene, PALETTE } from "../../shared/scene";

const block = { shape: "cube", color: "red", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] };
const scene = (over: object = {}) => ({ title: "Red Tower", blocks: [block], ...over });
const withBlock = (over: object) => scene({ blocks: [{ ...block, ...over }] });

describe("parseScene", () => {
  it("accepts a minimal valid scene", () => {
    expect(parseScene(scene())).not.toBeNull();
  });

  const bad: [string, unknown][] = [
    ["unknown shape", withBlock({ shape: "star" })],
    ["hex colour", withBlock({ color: "#ff0000" })],
    ["position out of range", withBlock({ position: [21, 0, 0] })],
    ["size zero", withBlock({ size: [0, 1, 1] })],
    ["rotation out of range", withBlock({ rotation: [361, 0, 0] })],
    ["0 blocks", scene({ blocks: [] })],
    ["201 blocks", scene({ blocks: Array(201).fill(block) })],
    ["6-word title", scene({ title: "one two three four five six" })],
    ["punctuation in title", scene({ title: "Hi!" })],
    ["41-char title", scene({ title: "a".repeat(41) })],
    ["extra block key", withBlock({ url: "x" })],
    ["extra scene key", scene({ message: "x" })],
  ];
  it.each(bad)("rejects %s", (_n, x) => {
    expect(parseScene(x)).toBeNull();
  });
});

it("PALETTE has 16 colours", () => {
  expect(Object.keys(PALETTE)).toHaveLength(16);
});
