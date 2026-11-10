import { describe, expect, it } from "vitest";
import { canFinishWizard, modelChoiceFor, pickProviders, pinsMatch, validatePin } from "../../web/parent/forms";

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
  it("canFinishWizard needs an explicitly chosen builder model, and a checker model if a checker provider is set (#4)", () => {
    const base = { moderation: "openai", moderationOffAcknowledged: false };
    expect(canFinishWizard({ ...base, builder: { provider: "openai", model: "" } })).toBe(false);
    expect(canFinishWizard({ ...base, builder: { provider: "openai", model: "m" }, checker: { provider: "google", model: "" } })).toBe(false);
    expect(canFinishWizard({ ...base, builder: { provider: "openai", model: "m" }, checker: null })).toBe(true);
  });
  it("modelChoiceFor: choosing a provider never picks a model (#4)", () => {
    expect(modelChoiceFor("openai")).toEqual({ provider: "openai", model: "" });
    expect(modelChoiceFor("")).toBeNull();
  });
  it("pickProviders lists the saved provider even before Test (#4)", () => {
    expect(pickProviders({}, { provider: "anthropic", model: "m" })).toEqual(["anthropic"]);
    expect(pickProviders({ google: ["g"] }, null)).toEqual(["google"]);
    expect(pickProviders({ openai: ["o"], anthropic: [] }, { provider: "openai", model: "o" })).toEqual(["openai"]);
  });
});
