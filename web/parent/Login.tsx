import { useState } from "react";
import { login } from "./api";

export default function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await login(pin); onDone(); } catch (x) { setErr((x as Error).message); setPin(""); }
  };
  return (
    <form onSubmit={submit} className="card-box">
      <h1>Parent area</h1>
      <label>PIN <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} autoFocus /></label>
      {err && <p role="alert" className="err">{err}</p>}
      <button type="submit" disabled={pin.length !== 6}>Unlock</button>
    </form>
  );
}
