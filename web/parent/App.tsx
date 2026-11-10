import { useCallback, useEffect, useRef, useState } from "react";
import { getGlobal, isSetUp, logout } from "./api";
import Login from "./Login";
import SetupWizard from "./SetupWizard";
import Settings from "./Settings";
import AuditList from "./AuditList";
import "./parent.css";

const IDLE_MS = 10 * 60 * 1000;
type View = "loading" | "setup" | "login" | "resume" | "main";

export default function ParentApp() {
  const [view, setView] = useState<View>("loading");
  const [tab, setTab] = useState<"audit" | "settings">("audit");
  const timer = useRef<number>();

  const lock = useCallback(() => { setView("login"); }, []);
  const route = useCallback(async (loggedIn: boolean) => {
    try {
      if (!loggedIn) return setView((await isSetUp()) ? "login" : "setup");
      setView((await getGlobal()).setupComplete ? "main" : "resume");
    } catch { setView("login"); }
  }, []);
  useEffect(() => { void route(false); }, [route]);

  useEffect(() => {
    window.addEventListener("parent-locked", lock);
    return () => window.removeEventListener("parent-locked", lock);
  }, [lock]);

  // idle lock: only while signed in
  useEffect(() => {
    if (view !== "main" && view !== "resume") return;
    const reset = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => { void logout().catch(() => {}); lock(); }, IDLE_MS); };
    const evs = ["pointerdown", "keydown", "input", "scroll"];
    evs.forEach((e) => window.addEventListener(e, reset)); reset();
    return () => { evs.forEach((e) => window.removeEventListener(e, reset)); clearTimeout(timer.current); };
  }, [view, lock]);

  if (view === "loading") return <main><p>Loading…</p></main>;
  if (view === "setup") return <main><SetupWizard resume={false} onDone={() => void route(true)} /></main>;
  if (view === "resume") return <main><SetupWizard resume onDone={() => void route(true)} /></main>;
  if (view === "login") return <main><Login onDone={() => void route(true)} /></main>;
  return (
    <main>
      <nav>
        <button aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Audit</button>
        <button aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>Settings</button>
        <button onClick={() => { void logout().catch(() => {}); lock(); }}>Lock</button>
      </nav>
      {tab === "audit" ? <AuditList /> : <Settings />}
    </main>
  );
}
