import { useEffect, useState } from "react";
import { getState, type ChildState } from "../api";
import { COPY } from "../../shared/copy";
import BuildScreen from "./BuildScreen";
import "./child.css";

export default function App() {
  const [state, setState] = useState<ChildState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { getState().then(setState, () => setFailed(true)); }, []);
  if (failed) return <main><p className="msg" role="alert">{COPY.oops}</p></main>;
  if (!state) return <main><p className="msg">⏳</p></main>;
  if (!state.ready) return <main><p className="msg">{COPY.setup}</p></main>;
  return <BuildScreen modes={state.modes} />;
}
