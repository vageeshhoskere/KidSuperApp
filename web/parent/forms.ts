import type { ModelChoice } from "../../server/settings";

const PROVIDERS = ["openai", "anthropic", "google"] as const;

export const validatePin = (pin: string): string | null => (/^\d{6}$/.test(pin) ? null : "PIN must be exactly 6 digits");
export const pinsMatch = (a: string, b: string) => a === b;
export const canFinishWizard = (s: {
  builder: ModelChoice | null; checker?: ModelChoice | null; moderation: string; moderationOffAcknowledged: boolean;
}): boolean => !!s.builder?.model && (!s.checker || !!s.checker.model) && (s.moderation !== "off" || s.moderationOffAcknowledged);

/** Confirmation text before saving cloud speech settings. */
export const cloudWarnings = (s: { stt: string; tts: boolean; ttsProvider: string }): string[] => [
  ...(s.stt !== "browser" ? [`Your child's voice will be sent to ${s.stt}.`] : []),
  ...(s.tts && s.ttsProvider !== "browser" ? [`The words the app speaks will be sent to ${s.ttsProvider}.`] : []),
];

/** Picking a provider never picks a model: the parent must choose one (no "first in the list" default). */
export const modelChoiceFor = (p: string): ModelChoice | null => (p ? { provider: p as ModelChoice["provider"], model: "" } : null);

/** Providers offered in a model picker: those with a tested model list, plus the saved one. */
export const pickProviders = (models: Partial<Record<ModelChoice["provider"], string[]>>, value: ModelChoice | null) =>
  PROVIDERS.filter((p) => models[p]?.length || value?.provider === p);
