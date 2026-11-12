import { z } from "zod";

export class HttpError extends Error {
  /** body replaces the default {error: message} response */
  constructor(public statusCode: number, message: string, public body?: object) {
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

/** Every address the child's device might reach this computer on (a laptop can have Wi-Fi and Ethernet). */
export function lanUrls(ifaces: NodeJS.Dict<{ family: string; internal: boolean; address: string }[]>, port: number): string[] {
  const ips = Object.values(ifaces).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
  return (ips.length ? ips : ["localhost"]).map((ip) => `http://${ip}:${port}`);
}
