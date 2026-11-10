import type { Scene } from "../shared/scene";
import type { ModelChoice } from "./settings";

export type LayerResult = { result: "pass" | "fail" | "skipped"; detail: unknown };
export type AuditRequest = {
  id: string; createdAt: string; childId: number;
  inputMode: "typed" | "voice" | "pictures"; inputText: string;
  layer1: LayerResult; layer2: LayerResult; layer3: LayerResult;
  intent: string | null; summary: string | null;
  builder: ModelChoice | null; checker: ModelChoice | null;
  outputText: LayerResult | null; pictureCheck: LayerResult | null;
  outcome: "shown" | "redirected" | "held" | "closed" | "error"; errorDetail: string | null;
  raw: string[]; scene: Scene | null; parentRequestId: string | null;
};
export type AuditEventType = "settings_change" | "pin_success" | "pin_fail" | "hold_decision" | "purge";
export type AuditWriter = {
  logRequest(r: AuditRequest): void;
  logEvent(type: AuditEventType, detail: unknown, relatedRequestId?: string): void;
};
