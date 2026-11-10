import { describe, it, expect } from "vitest";
import { findPii } from "../../server/safety/pii";

describe("findPii", () => {
  it("masks phone numbers", () => {
    expect(findPii("call 555-123-4567")).toEqual({ found: true, masked: "call [phone]" });
    expect(findPii("+44 20 7946 0958").found).toBe(true);
    expect(findPii("(555) 123.4567").masked).toBe("[phone]");
  });
  it("masks email", () => {
    expect(findPii("mom@example.com").masked).toBe("[email]");
  });
  it("masks addresses", () => {
    expect(findPii("I live at 42 Maple Street").masked).toBe("I live at [address]");
    expect(findPii("12 Oak Rd").found).toBe(true);
  });
  it("leaves harmless text", () => {
    expect(findPii("a tower 100 blocks tall")).toEqual({ found: false, masked: "a tower 100 blocks tall" });
    expect(findPii("3 red cubes").found).toBe(false);
  });
});

describe("address regex (final review minor)", () => {
  it("does not flag 'way' followed by up/down/over/around/to", () => {
    for (const t of ["10 cubes all the way up", "5 blocks the way down", "3 bridges all the way over", "2 roads the way around", "4 steps the way to the top"])
      expect(findPii(t).found, t).toBe(false);
  });
  it("still flags real addresses", () => {
    expect(findPii("I live at 42 Maple Way").found).toBe(true);
    expect(findPii("12 Green Lane, London").found).toBe(true);
  });
});
