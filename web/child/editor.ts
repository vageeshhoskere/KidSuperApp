import { parseScene, type ColorName, type Scene } from "../../shared/scene";

export type EditorState = { scene: Scene; history: Scene[] };
export type EditorAction =
  | { type: "recolor"; index: number; color: ColorName }
  | { type: "delete"; index: number }
  | { type: "add"; shape: Scene["blocks"][number]["shape"] }
  | { type: "move"; index: number; delta: [number, number, number] }
  | { type: "undo" };

const clamp = (n: number) => Math.max(-20, Math.min(20, n));

export function editorReducer(state: EditorState, a: EditorAction): EditorState {
  if (a.type === "undo") {
    const prev = state.history.at(-1);
    return prev ? { scene: prev, history: state.history.slice(0, -1) } : state;
  }
  const { blocks } = state.scene;
  if (a.type !== "add" && !blocks[a.index]) return state;
  let next: Scene["blocks"];
  switch (a.type) {
    case "recolor": next = blocks.map((b, i) => (i === a.index ? { ...b, color: a.color } : b)); break;
    case "delete": next = blocks.filter((_, i) => i !== a.index); break;
    case "add": next = [...blocks, { shape: a.shape, color: "blue", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] }]; break;
    case "move": next = blocks.map((b, i) => i === a.index ? { ...b, position: b.position.map((p, k) => clamp(p + a.delta[k])) as [number, number, number] } : b); break;
  }
  const scene = parseScene({ ...state.scene, blocks: next });
  return scene ? { scene, history: [...state.history, state.scene] } : state;
}
