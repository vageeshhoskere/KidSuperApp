export const SAFE_IDEAS: string[] = [
  "rocket", "treehouse", "robot", "ice cream shop", "castle", "lighthouse", "bridge", "windmill",
  "train station", "sailboat", "farm", "pyramid", "snowman", "playground", "spaceship", "tower",
  "garden", "birdhouse", "race car", "submarine", "zoo", "library",
];

export function pickIdea(rand: () => number = Math.random): string {
  return SAFE_IDEAS[Math.min(SAFE_IDEAS.length - 1, Math.floor(rand() * SAFE_IDEAS.length))];
}
