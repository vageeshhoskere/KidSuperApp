import type { Scene } from "../../shared/scene";

/** Plain-text view of a scene for the checker; groups by colour + shape in order of first appearance. */
export function describeScene(s: Scene): string {
  const groups = new Map<string, number>();
  for (const b of s.blocks) groups.set(`${b.color} ${b.shape}`, (groups.get(`${b.color} ${b.shape}`) ?? 0) + 1);
  const parts = [...groups].map(([k, n]) => `${n} ${n === 1 ? k : k + "s"}`);
  return `Title "${s.title}": ${s.blocks.length} ${s.blocks.length === 1 ? "block" : "blocks"}: ${parts.join(", ")}`;
}
