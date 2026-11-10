import { z } from "zod";

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Zod parse at the route; failures are a 400 that names no input values. */
export function parse<T>(schema: z.ZodType<T>, x: unknown): T {
  const r = schema.safeParse(x);
  if (!r.success) throw new HttpError(400, `invalid: ${r.error.issues.map((i) => i.path.join(".") || "body").join(", ")}`);
  return r.data;
}

export const MB = 1024 * 1024;
