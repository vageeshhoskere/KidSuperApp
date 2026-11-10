import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { AuditRequest } from "./audit";
import type { GlobalSettings } from "./settings";
import { findPii } from "./safety/pii";

type MakeTransport = (o: SMTPTransport.Options) => { sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown> };

const failingLayer = (r: AuditRequest) =>
  (["layer1", "layer2", "layer3"] as const).find((k) => r[k].result === "fail") ?? (r.outputText?.result === "fail" ? "output" : "unknown");

export function makeNotify(
  getSmtp: () => GlobalSettings["smtp"], createTransport: MakeTransport = nodemailer.createTransport,
): (r: AuditRequest) => Promise<void> {
  return async (r) => {
    const s = getSmtp();
    if (!s) throw new Error("smtp not configured");
    const t = createTransport({ host: s.host, port: s.port, secure: s.port === 465, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000, auth: s.user ? { user: s.user, pass: s.pass } : undefined });
    await t.sendMail({
      from: s.from, to: s.to, subject: "Kid 3D Builder: a request was flagged",
      text: [
        `Time: ${r.createdAt}`, `Request: ${findPii(r.inputText).masked}`, `Intent: ${r.intent ?? "-"}`,
        `Summary: ${r.summary ?? "-"}`, `Failing layer: ${failingLayer(r)}`,
      ].join("\n"),
    });
  };
}
