import type { Scene } from "./scene";

export type BuildResult =
  | { status: "shown"; requestId: string; scene: Scene; speak: string }
  | { status: "needs_picture"; requestId: string; scene: Scene }
  | { status: "redirected"; requestId: string; message: string; ideas: string[] }
  | { status: "held"; requestId: string; message: string }
  | { status: "closed"; message: string }
  | { status: "error"; requestId?: string; message: string }
  | { status: "busy"; message: string }
  | { status: "empty" };
