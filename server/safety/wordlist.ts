import words from "./default-words.json";
import { normalize } from "./normalize";

const DEFAULTS: [string, string][] = Object.entries(words as Record<string, string[]>).flatMap(([cat, ts]) =>
  ts.map((t): [string, string] => [cat, t]),
);

// Term letters with an optional single separator between each, then an optional doubled last letter
// and inflection suffix (shoot -> shooting, stab -> stabbing), bounded by non-alphanumerics.
const termRegex = (squashed: string) =>
  new RegExp(`(?<![a-z0-9])${[...squashed].join(" ?")}(?:${squashed.at(-1)})?(?:s|es|ed|ing|er|ers|y)?(?![a-z0-9])`);

export function checkWords(text: string, extra: string[], allowed: string[]): { pass: boolean; matched: string[]; category?: string } {
  let spaced = ` ${normalize(text).spaced} `;
  for (const a of allowed) {
    const as = normalize(a).spaced;
    if (as) spaced = spaced.split(` ${as} `).join("  ");
  }
  spaced = spaced.replace(/ +/g, " ").trim();
  const matched: string[] = [];
  let category: string | undefined;
  let best = 0;
  for (const [cat, term] of [...DEFAULTS, ...extra.map((t): [string, string] => ["parent", t])]) {
    const { squashed } = normalize(term);
    if (!squashed || !termRegex(squashed).test(spaced)) continue;
    if (!matched.includes(term)) matched.push(term);
    if (squashed.length > best) {
      best = squashed.length;
      category = cat;
    }
  }
  return { pass: matched.length === 0, matched, category };
}
