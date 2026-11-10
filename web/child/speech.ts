import { transcribe, tts, type Modes } from "../api";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR = (): any => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const micSupported = (modes: Modes) =>
  modes.stt === "browser" ? !!SR() : typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Starts listening; returns stop(). Browser STT streams interim text; otherwise records until stop(), then uploads. */
export function startListening(modes: Modes, onText: (t: string) => void, onMessage: (m: string) => void = () => {}): () => void {
  if (modes.stt === "browser") {
    const rec = new (SR())();
    rec.interimResults = true;
    rec.onerror = () => { try { rec.stop(); } catch { /* already stopped */ } };
    rec.onresult = (e: any) => onText(Array.from(e.results as ArrayLike<any>).map((r) => r[0].transcript).join(""));
    try { rec.start(); } catch { return () => {}; }
    return () => { try { rec.stop(); } catch { /* already stopped */ } };
  }
  let stopFn = () => {};
  let stopped = false;
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(stream); } catch { stream.getTracks().forEach((t) => t.stop()); return; }
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        const r = await transcribe(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
        if (r.text) onText(r.text);
        if (r.message) onMessage(r.message);
      } catch { /* silent: the child can simply try again */ }
    };
    mr.start();
    stopFn = () => mr.stop();
    if (stopped) stopFn();
  }).catch(() => {});
  return () => { stopped = true; stopFn(); };
}

const speakBrowser = (text: string) => {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

/** Picture-button words: browser voice only, never sent to the server. */
export const sayWord = speakBrowser;

/** Spoken build result; call only when modes.tts is on. */
export async function say(text: string, modes: Modes): Promise<void> {
  if (modes.ttsProvider === "browser") return speakBrowser(text);
  try {
    const url = URL.createObjectURL(await tts(text));
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
  } catch { /* voice is optional */ }
}
