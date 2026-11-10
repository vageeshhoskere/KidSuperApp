export const validatePin = (pin: string): string | null => (/^\d{6}$/.test(pin) ? null : "PIN must be exactly 6 digits");
export const pinsMatch = (a: string, b: string) => a === b;
export const canFinishWizard = (s: { builder: unknown; moderation: string; moderationOffAcknowledged: boolean }): boolean =>
  !!s.builder && (s.moderation !== "off" || s.moderationOffAcknowledged);
