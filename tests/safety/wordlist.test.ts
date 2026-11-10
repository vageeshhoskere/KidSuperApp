import { describe, it, expect } from "vitest";
import { checkWords } from "../../server/safety/wordlist";
import { normalize } from "../../server/safety/normalize";
import { SAFE_IDEAS, pickIdea } from "../../server/safety/ideas";

describe("checkWords", () => {
  it.each(["gun", "g u n", "g.u.n", "GUNNNN", "a big k1ll machine", "kíll"])("fails %s as weapons", (t) => {
    const r = checkWords(t, [], []);
    expect(r.pass).toBe(false);
    expect(r.category).toBe("weapons");
  });
  it("allowed phrase exempts an extra term", () => {
    expect(checkWords("shooting star", ["shoot"], []).pass).toBe(false);
    expect(checkWords("shooting star", ["shoot"], ["shooting star"]).pass).toBe(true);
  });
  it("passes begun and harmless text", () => {
    expect(checkWords("begun", [], []).pass).toBe(true);
    expect(checkWords("a purple castle with a dragon", [], []).pass).toBe(true);
  });
  it("fails extra terms with category parent", () => {
    expect(checkWords("a zombie", ["zombie"], [])).toMatchObject({ pass: false, matched: ["zombie"], category: "parent" });
  });
  it("handles emoji", () => {
    expect(checkWords("🏰🐉", [], []).pass).toBe(true);
  });
  it("normalises", () => {
    expect(normalize("Kíll!!").spaced).toBe("kill");
    expect(normalize("a b").squashed).toBe("ab");
  });
});

describe("ideas", () => {
  it("has ideas and picks one", () => {
    expect(SAFE_IDEAS.length).toBeGreaterThanOrEqual(20);
    expect(pickIdea(() => 0)).toBe(SAFE_IDEAS[0]);
    expect(SAFE_IDEAS).toContain(pickIdea());
  });
});
