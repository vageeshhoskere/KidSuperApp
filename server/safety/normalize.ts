const LOOKALIKES: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

export function normalize(text: string): { spaced: string; squashed: string } {
  const spaced = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/([a-z])\1{2,}/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return { spaced, squashed: spaced.replace(/ /g, "") };
}
