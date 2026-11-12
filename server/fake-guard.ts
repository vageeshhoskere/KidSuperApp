/** Returns the reason to refuse to start, or null. FAKE_PROVIDERS=1 next to real API keys means a real house is being set up unsafely. */
export function fakeProvidersRefusal(env: string | undefined, keys: Record<string, string | undefined>): string | null {
  if (env !== "1" || !Object.values(keys).some(Boolean)) return null;
  return "Refusing to start: FAKE_PROVIDERS=1 is set but this data folder has API keys. FAKE_PROVIDERS is only for tests; unset it, or use an empty DATA_DIR.";
}
