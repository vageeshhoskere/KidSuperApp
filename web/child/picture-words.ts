export type PictureWord = { category: "things" | "animals" | "colours" | "sizes"; word: string; emoji: string };

const mk = (category: PictureWord["category"], items: [string, string][]): PictureWord[] =>
  items.map(([word, emoji]) => ({ category, word, emoji }));

export const PICTURE_WORDS: PictureWord[] = [
  ...mk("things", [["house", "🏠"], ["car", "🚗"], ["tree", "🌳"], ["boat", "⛵"], ["rocket", "🚀"], ["castle", "🏰"], ["robot", "🤖"], ["train", "🚂"], ["flower", "🌸"], ["bridge", "🌉"]]),
  ...mk("animals", [["dog", "🐶"], ["cat", "🐱"], ["fish", "🐟"], ["bird", "🐦"], ["rabbit", "🐰"], ["horse", "🐴"], ["duck", "🦆"], ["frog", "🐸"], ["elephant", "🐘"], ["butterfly", "🦋"]]),
  ...mk("colours", [["red", "🔴"], ["blue", "🔵"], ["green", "🟢"], ["yellow", "🟡"], ["orange", "🟠"], ["purple", "🟣"], ["brown", "🟤"], ["pink", "🌷"]]),
  ...mk("sizes", [["big", "🐘"], ["small", "🐜"], ["tall", "🦒"], ["short", "🐕"], ["long", "🐍"], ["round", "⚽"], ["tiny", "🔬"], ["huge", "🏔"]]),
];
