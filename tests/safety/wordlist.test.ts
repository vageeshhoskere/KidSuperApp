import { describe, it, expect } from "vitest";
import { checkWords } from "../../server/safety/wordlist";
import words from "../../server/safety/default-words.json";
import { normalize } from "../../server/safety/normalize";
import { SAFE_IDEAS, pickIdea } from "../../server/safety/ideas";

describe("checkWords", () => {
  it.each(["gun", "g u n", "a g u n", "gu n", "g.u.n", "GUNNNN", "k1ll", "a big k1ll machine", "kíll"])("fails %s as weapons", (t) => {
    const r = checkWords(t, [], []);
    expect(r.pass).toBe(false);
    expect(r.category).toBe("weapons");
  });
  it("allowed phrase exempts an extra term", () => {
    expect(checkWords("shooting star", ["shoot"], []).pass).toBe(false);
    expect(checkWords("shooting star", ["shoot"], ["shooting star"]).pass).toBe(true);
  });
  it.each(["stabbing", "shooting people", "gunner", "guns"])("fails inflected %s", (t) => {
    expect(checkWords(t, [], []).pass).toBe(false);
  });
  it("passes begun and harmless text", () => {
    expect(checkWords("begun", [], []).pass).toBe(true);
    expect(checkWords("a purple castle with a dragon", [], []).pass).toBe(true);
  });
  it.each(["build something", "a horse stable", "seaweed", "a bee ride", "begun", "skill", "menu design", "big ore"])("passes %s", (t) => {
    expect(checkWords(t, [], []).pass).toBe(true);
  });
  it("reports category of the longest match", () => {
    expect(checkWords("kill myself", [], []).category).toBe("selfHarm");
    expect(new Set(checkWords("gun gun", [], []).matched).size).toBe(1);
  });
  it("default list has >=10 per category", () => {
    for (const ts of Object.values(words)) expect(ts.length).toBeGreaterThanOrEqual(10);
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
  it("every idea passes the word check", () => {
    for (const i of SAFE_IDEAS) expect(checkWords(i, [], []).pass, i).toBe(true);
  });
  it("has ideas and picks one", () => {
    expect(SAFE_IDEAS.length).toBeGreaterThanOrEqual(20);
    expect(pickIdea(() => 0)).toBe(SAFE_IDEAS[0]);
    expect(SAFE_IDEAS).toContain(pickIdea());
  });
});
