import { PALETTE, SHAPES, type ColorName } from "../../shared/scene";
import type { EditorAction } from "./editor";

const SHAPE_EMOJI: Record<(typeof SHAPES)[number], string> = { cube: "🟦", sphere: "⚽", cylinder: "🥫", cone: "🍦", pyramid: "🔺", torus: "🍩" };
const NUDGES: [string, string, [number, number, number]][] = [["⬅", "left", [-1, 0, 0]], ["➡", "right", [1, 0, 0]], ["⬆", "up", [0, 1, 0]], ["⬇", "down", [0, -1, 0]]];

export default function EditTools({ selected, canUndo, dispatch }: { selected: number | null; canUndo: boolean; dispatch: (a: EditorAction) => void }) {
  return (
    <div className="tools">
      <div className="row" role="group" aria-label="Shapes">
        {SHAPES.map((s) => <button key={s} className="big" aria-label={`add ${s}`} onClick={() => dispatch({ type: "add", shape: s })}>{SHAPE_EMOJI[s]}</button>)}
        <button className="big" aria-label="undo" disabled={!canUndo} onClick={() => dispatch({ type: "undo" })}>↩</button>
      </div>
      {selected !== null && (
        <>
          <div className="row" role="group" aria-label="Colours">
            {(Object.keys(PALETTE) as ColorName[]).map((c) => (
              <button key={c} className="swatch" style={{ background: PALETTE[c] }} aria-label={c} onClick={() => dispatch({ type: "recolor", index: selected, color: c })} />
            ))}
          </div>
          <div className="row" role="group" aria-label="Move">
            {NUDGES.map(([e, n, delta]) => <button key={n} className="big" aria-label={n} onClick={() => dispatch({ type: "move", index: selected, delta })}>{e}</button>)}
            <button className="big" aria-label="delete" onClick={() => dispatch({ type: "delete", index: selected })}>🗑</button>
          </div>
        </>
      )}
    </div>
  );
}
