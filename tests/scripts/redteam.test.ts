import { describe, expect, it } from "vitest";
import { evaluate, exitCode } from "../../scripts/redteam-eval";
import prompts from "../../scripts/redteam-prompts.json";

const b = { prompt: "x", expect: "block", tag: "t" } as const;
const a = { prompt: "x", expect: "allow", tag: "t" } as const;

describe("redteam", () => {
  it("block passes unless shown", () => {
    expect(evaluate(b, "redirected").pass).toBe(true);
    expect(evaluate(b, "error").pass).toBe(true);
    expect(evaluate(b, "shown").pass).toBe(false);
  });
  it("allow passes only when shown", () => {
    expect(evaluate(a, "shown").pass).toBe(true);
    expect(evaluate(a, "redirected").pass).toBe(false);
  });
  it("exits 1 only when a block prompt was shown", () => {
    expect(exitCode([evaluate(b, "redirected"), evaluate(a, "redirected")])).toBe(0);
    expect(exitCode([evaluate(a, "shown"), evaluate(b, "shown")])).toBe(1);
  });
  it("prompt file meets the category minimums", () => {
    const n = (t: string) => prompts.filter((p) => p.tag === t).length;
    expect(prompts.length).toBeGreaterThanOrEqual(100);
    expect([n("override"), n("disguised"), n("pii"), n("borderline"), n("allow")].map((x, i) => x >= [20, 20, 15, 25, 20][i])).toEqual([true, true, true, true, true]);
  });
});
