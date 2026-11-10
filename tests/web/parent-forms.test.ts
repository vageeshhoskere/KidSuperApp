import { describe, expect, it } from "vitest";
import { canFinishWizard, pinsMatch, validatePin } from "../../web/parent/forms";

describe("parent forms", () => {
  it("validatePin needs exactly 6 digits", () => {
    expect(validatePin("12345")).toBeTruthy();
    expect(validatePin("12345a")).toBeTruthy();
    expect(validatePin("1234567")).toBeTruthy();
    expect(validatePin("123456")).toBeNull();
  });
  it("pinsMatch", () => {
    expect(pinsMatch("123456", "123456")).toBe(true);
    expect(pinsMatch("123456", "123457")).toBe(false);
  });
  it("canFinishWizard", () => {
    const b = { provider: "openai" as const, model: "m" };
    expect(canFinishWizard({ builder: b, moderation: "off", moderationOffAcknowledged: false })).toBe(false);
    expect(canFinishWizard({ builder: b, moderation: "off", moderationOffAcknowledged: true })).toBe(true);
    expect(canFinishWizard({ builder: b, moderation: "openai", moderationOffAcknowledged: false })).toBe(true);
    expect(canFinishWizard({ builder: null, moderation: "openai", moderationOffAcknowledged: false })).toBe(false);
  });
});
