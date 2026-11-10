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

export const wrapData = (data: string) => `<child_data>\n${data}\n</child_data>`;

export const jsonSchemaOf = (schema: z.ZodType) => z.toJSONSchema(schema) as Record<string, unknown>;

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
