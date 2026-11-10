import { useEffect, useRef, useState } from "react";
import type { Modes } from "../api";
import { micSupported, startListening } from "./speech";

/** Hold to talk. Hidden when voice is off or the browser can't listen. */
export default function MicButton({ modes, onText, onMessage }: { modes: Modes; onText: (t: string) => void; onMessage: (m: string) => void }) {
  const stop = useRef<(() => void) | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => stop.current?.(), []);
  if (!modes.voice || !micSupported(modes)) return null;
  const begin = () => { if (!stop.current) { setOn(true); stop.current = startListening(modes, onText, onMessage); } };
  const end = () => { stop.current?.(); stop.current = null; setOn(false); };
  return (
    <button className={on ? "big hot" : "big"} aria-label="Talk" onPointerDown={begin} onPointerUp={end} onPointerLeave={end} onKeyDown={(e) => e.key === " " && begin()} onKeyUp={(e) => e.key === " " && end()}>
      🎤
    </button>
  );
}
