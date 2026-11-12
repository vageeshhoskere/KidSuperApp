import { describe, expect, it } from "vitest";
import { fakeProvidersRefusal } from "../../server/fake-guard";

describe("fakeProvidersRefusal", () => {
  it("refuses only when FAKE_PROVIDERS=1 and a key exists", () => {
    expect(fakeProvidersRefusal("1", { openai: "sk-x" })).toMatch(/Refusing to start/);
    expect(fakeProvidersRefusal("1", {})).toBeNull();
    expect(fakeProvidersRefusal(undefined, { openai: "sk-x" })).toBeNull();
    expect(fakeProvidersRefusal("0", { openai: "sk-x" })).toBeNull();
  });
});
