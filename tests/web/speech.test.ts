// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { startListening } from "../../web/child/speech";
import { COPY } from "../../shared/copy";

const modes = { typing: true, pictures: false, voice: true, stt: "openai", tts: false, ttsProvider: "browser" } as const;

describe("cloud STT failures (final review minor)", () => {
  it("a failed upload tells the child COPY.oops instead of staying silent", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } });
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {
      mimeType = "audio/webm"; ondataavailable?: (e: { data: Blob }) => void; onstop?: () => void;
      start() {} stop() { this.ondataavailable?.({ data: new Blob(["a"]) }); void this.onstop?.(); }
    };
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as never;
    const onText = vi.fn(), onMessage = vi.fn();
    const stop = startListening(modes as never, onText, onMessage);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith(COPY.oops));
    expect(onText).not.toHaveBeenCalled();
  });
});
