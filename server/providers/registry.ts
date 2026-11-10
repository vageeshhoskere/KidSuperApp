import type { readKeys } from "../keys";
import type { Provider, ProviderId, Registry } from "./types";
import { makeOpenAI } from "./openai";
import { makeAnthropic } from "./anthropic";
import { makeGoogle } from "./google";

const makers: Record<ProviderId, (key: string, fetchImpl: typeof fetch) => Provider> = {
  openai: makeOpenAI,
  anthropic: makeAnthropic,
  google: makeGoogle,
};

export function makeRegistry(keys: ReturnType<typeof readKeys>, fetchImpl: typeof fetch = fetch): Registry {
  const built = new Map<ProviderId, Provider>();
  return {
    get(id) {
      const key = keys[id];
      if (!key) return null;
      if (!built.has(id)) built.set(id, makers[id](key, fetchImpl));
      return built.get(id)!;
    },
  };
}
