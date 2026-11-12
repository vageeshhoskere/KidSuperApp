import { z } from "zod";

export const SHAPES = ["cube", "sphere", "cylinder", "cone", "pyramid", "torus"] as const;

export const PALETTE = {
  red: "#e53935",
  orange: "#fb8c00",
  yellow: "#fdd835",
  lime: "#c0ca33",
  green: "#43a047",
  teal: "#00897b",
  cyan: "#00acc1",
  blue: "#1e88e5",
  navy: "#1a237e",
  purple: "#8e24aa",
  pink: "#ec407a",
  brown: "#6d4c41",
  white: "#fafafa",
  gray: "#9e9e9e",
  black: "#212121",
  gold: "#ffc107",
} as const;

export type ColorName = keyof typeof PALETTE;
const COLOR_NAMES = Object.keys(PALETTE) as [ColorName, ...ColorName[]];

const vec3 = (min: number, max: number) =>
  z.tuple([z.number().min(min).max(max), z.number().min(min).max(max), z.number().min(min).max(max)]);

const BlockSchema = z.strictObject({
  shape: z.enum(SHAPES),
  color: z.enum(COLOR_NAMES),
  position: vec3(-20, 20),
  size: vec3(0.1, 10),
  rotation: vec3(-360, 360),
});

export const SceneSchema = z.strictObject({
  title: z
    .string()
    .max(40)
    .regex(/^[A-Za-z0-9 ]+$/)
    .refine((t) => {
      const n = t.split(" ").filter(Boolean).length;
      return n >= 1 && n <= 5;
    }),
  blocks: z.array(BlockSchema).min(1).max(200),
});

export type Scene = z.infer<typeof SceneSchema>;

export function parseScene(x: unknown): Scene | null {
  const r = SceneSchema.safeParse(x);
  return r.success ? r.data : null;
}
