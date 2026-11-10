import { ProviderError, type GenerateJsonOptions, type Provider } from "./types";

export type FakeScript = {
  json?: unknown[] | ((o: GenerateJsonOptions<unknown>) => unknown);
  moderate?: Record<string, number>;
  fail?: "timeout" | "error" | "malformed";
};

export type FakeProvider = Provider & {
  calls: { listModels: number; generateJson: number; moderate: number };
  last: { generateJson?: GenerateJsonOptions<unknown>; moderate?: string };
};

/** Scripted provider for tests. `moderate` exists only when the script gives scores. */
export function makeFakeProvider(script: FakeScript): FakeProvider {
  const queue = Array.isArray(script.json) ? [...script.json] : [];
  const failIfScripted = () => {
    if (script.fail) throw new ProviderError(script.fail, `fake ${script.fail}`);
  };
  const fake: FakeProvider = {
    id: "openai",
    calls: { listModels: 0, generateJson: 0, moderate: 0 },
    last: {},
    async listModels() {
      fake.calls.listModels++;
      failIfScripted();
      return ["fake-model"];
    },
    async generateJson<T>(o: GenerateJsonOptions<T>) {
      fake.calls.generateJson++;
      fake.last.generateJson = o as GenerateJsonOptions<unknown>;
      failIfScripted();
      let out: unknown;
      if (typeof script.json === "function") out = script.json(o as GenerateJsonOptions<unknown>);
      else if (queue.length) out = queue.shift();
      else throw new ProviderError("error", "fake: no scripted json left");
      const r = o.schema.safeParse(out);
      if (!r.success) throw new ProviderError("malformed", r.error.message);
      return { value: r.data, raw: JSON.stringify(out) };
    },
  };
  if (script.moderate) {
    const scores = script.moderate;
    fake.moderate = async (text) => {
      fake.calls.moderate++;
      fake.last.moderate = text;
      failIfScripted();
      return { scores, raw: JSON.stringify(scores) };
    };
  }
  return fake;
}
