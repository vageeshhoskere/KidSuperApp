import { useState } from "react";
import { testBuild } from "./api";

/** Runs one fixed safe build through the chosen providers. `save` stores the choices first (wizard). */
export default function TestBuild({ save, disabled }: { save?: () => Promise<unknown>; disabled?: boolean }) {
  const [msg, setMsg] = useState("");
  async function run() {
    setMsg("Testing…");
    try {
      await save?.();
      const r = await testBuild();
      setMsg(r.ok ? `Works! It built: ${r.title}` : `Failed at ${r.stage}`);
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <div className="field">
      <button type="button" disabled={disabled} onClick={() => void run()}>Test build</button>
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}
