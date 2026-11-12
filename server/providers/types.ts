import { z } from "zod";

export type ProviderId = "openai" | "anthropic" | "google";

export type GenerateJsonOptions<T> = {
  model: string;
  system: string;
  data: string;
  image?: Buffer;
  schema: z.ZodType<T>;
  timeoutMs: number;
};

export interface Provider {
  id: ProviderId;
  listModels(): Promise<string[]>;
  generateJson<T>(o: GenerateJsonOptions<T>): Promise<{ value: T; raw: string }>;
  moderate?(text: string, timeoutMs: number): Promise<{ scores: Record<string, number>; raw: string }>;
  // model is passed by the caller (chosen in settings): no model IDs are hardcoded.
  transcribe?(audio: Buffer, mime: string, timeoutMs: number, model: string): Promise<string>;
  speak?(text: string, timeoutMs: number, model: string): Promise<Buffer>;
}

export type Registry = { get(id: ProviderId): Provider | null };

export class ProviderError extends Error {
  constructor(public kind: "timeout" | "error" | "malformed", message?: string) {
    super(message ?? kind);
    this.name = "ProviderError";
  }
}

// Angle brackets in the data become ‹ › so no tag (nested or not) can close the wrapper early.
export const wrapData = (data: string) =>
  `<child_data>\n${data.replaceAll("<", "‹").replaceAll(">", "›")}\n</child_data>`;

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

/** Applies fn to a schema node and, recursively, to every nested schema (not to property-name maps or literals). */
function mapSchema(node: unknown, fn: (n: Json) => Json): unknown {
  if (!isObj(node)) return node;
  const out: Json = { ...node };
  for (const k of ["items", "additionalProperties", "not"]) if (isObj(out[k])) out[k] = mapSchema(out[k], fn);
  for (const k of ["prefixItems", "anyOf", "oneOf", "allOf"])
    if (Array.isArray(out[k])) out[k] = (out[k] as unknown[]).map((c) => mapSchema(c, fn));
  for (const k of ["properties", "$defs"])
    if (isObj(out[k])) out[k] = Object.fromEntries(Object.entries(out[k] as Json).map(([n, c]) => [n, mapSchema(c, fn)]));
  return fn(out);
}

/**
 * z.toJSONSchema output reduced to what every provider's structured-output subset accepts:
 * no $schema, tuples (prefixItems + items:false) become plain arrays of fixed length.
 * Replies are still validated against the full zod schema.
 */
export function jsonSchemaOf(schema: z.ZodType, drop: string[] = []): Json {
  const { $schema: _, ...root } = z.toJSONSchema(schema) as Json;
  return mapSchema(root, (n) => {
    if (Array.isArray(n.prefixItems)) {
      const tuple = n.prefixItems as unknown[];
      n = { ...n, items: tuple[0], minItems: tuple.length, maxItems: tuple.length };
      delete n.prefixItems;
    }
    if (n.items === false) delete n.items;
    for (const k of drop) delete n[k];
    return n;
  }) as Json;
}

const ScoresSchema = z.record(z.string(), z.number().finite().min(0).max(1));

/** Moderation scores must be a non-empty map of numbers in [0, 1]; anything else would fail open. */
export function parseScores(x: unknown): Record<string, number> {
  const r = ScoresSchema.safeParse(x);
  if (!r.success || Object.keys(r.data).length === 0) throw new ProviderError("malformed", "bad moderation scores");
  return r.data;
}

/** JSON.parse + schema.safeParse; any failure is "malformed". */
export function parseReply<T>(schema: z.ZodType<T>, text: string | null | undefined): { value: T; raw: string } {
  const raw = text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError("malformed", "reply is not JSON");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new ProviderError("malformed", r.error.message);
  return { value: r.data, raw };
}

/**
 * Runs one provider call under AbortSignal.timeout and maps every failure to a ProviderError.
 * Races the abort itself so a fetch that ignores its signal still cannot outlive the budget.
 * The API key is scrubbed from error messages because they end up in the audit log.
 */
export async function guard<T>(
  timeoutMs: number,
  key: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  const aborted = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new ProviderError("timeout")), { once: true }),
  );
  try {
    return await Promise.race([fn(signal), aborted]);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (signal.aborted) throw new ProviderError("timeout");
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProviderError("error", key ? msg.replaceAll(key, "[key]") : msg);
  }
}

// listModels takes no timeout argument; it gets the project-wide 20 s provider budget.
export const LIST_TIMEOUT_MS = 20_000;
