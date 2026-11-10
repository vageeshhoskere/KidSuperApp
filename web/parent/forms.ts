import type { ModelChoice } from "../../server/settings";

const PROVIDERS = ["openai", "anthropic", "google"] as const;

export const validatePin = (pin: string): string | null => (/^\d{6}$/.test(pin) ? null : "PIN must be exactly 6 digits");
export const pinsMatch = (a: string, b: string) => a === b;
export const canFinishWizard = (s: {
  builder: ModelChoice | null; checker?: ModelChoice | null; moderation: string; moderationOffAcknowledged: boolean;
}): boolean => !!s.builder?.model && (!s.checker || !!s.checker.model) && (s.moderation !== "off" || s.moderationOffAcknowledged);

/** Picking a provider never picks a model: the parent must choose one (no "first in the list" default). */
export const modelChoiceFor = (p: string): ModelChoice | null => (p ? { provider: p as ModelChoice["provider"], model: "" } : null);

/** Providers offered in a model picker: those with a tested model list, plus the saved one. */
export const pickProviders = (models: Partial<Record<ModelChoice["provider"], string[]>>, value: ModelChoice | null) =>
  PROVIDERS.filter((p) => models[p]?.length || value?.provider === p);
