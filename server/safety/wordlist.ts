import words from "./default-words.json";
import { normalize } from "./normalize";

const DEFAULTS: [string, string][] = Object.entries(words as Record<string, string[]>).flatMap(([cat, ts]) =>
  ts.map((t): [string, string] => [cat, t]),
);

// "g u n" -> "gun": join runs of single characters so short terms still match.
const joinSingles = (s: string) => s.replace(/(?<![a-z0-9])[a-z0-9]( [a-z0-9])+(?![a-z0-9])/g, (m) => m.replace(/ /g, ""));

export function checkWords(text: string, extra: string[], allowed: string[]): { pass: boolean; matched: string[]; category?: string } {
  const n = normalize(text);
  let spaced = ` ${n.spaced} `;
  let squashed = n.squashed;
  for (const a of allowed) {
    const an = normalize(a);
    if (!an.spaced) continue;
    spaced = spaced.split(` ${an.spaced} `).join("  ");
    squashed = squashed.split(an.squashed).join(" ");
  }
  spaced = ` ${spaced.replace(/ +/g, " ").trim()} `;
  const joined = ` ${joinSingles(spaced.trim())} `;
  const matched: string[] = [];
  let category: string | undefined;
  for (const [cat, term] of [...DEFAULTS, ...extra.map((t): [string, string] => ["parent", t])]) {
    const t = normalize(term);
    if (!t.spaced) continue;
    const hit =
      spaced.includes(` ${t.spaced} `) || joined.includes(` ${t.spaced} `) || (t.squashed.length >= 4 && squashed.includes(t.squashed));
    if (hit) {
      matched.push(term);
      category ??= cat;
    }
  }
  return { pass: matched.length === 0, matched, category };
}
