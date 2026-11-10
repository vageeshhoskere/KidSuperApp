// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

vi.mock("../../web/child/Viewer", () => ({
  default: ({ scene }: { scene: { blocks: unknown[] } }) => createElement("div", { "data-blocks": scene.blocks.length }),
}));
vi.mock("../../web/child/snapshot", () => ({ renderSnapshot: async () => "x" }));
import BuildScreen from "../../web/child/BuildScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scene = { title: "Cat", blocks: [{ shape: "cube", color: "red", position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] }] };
const modes = { typing: true, pictures: false, voice: false, stt: "browser", tts: false, ttsProvider: "browser" };

describe("BuildScreen", () => {
  it("keeps the edited scene when Change it! is redirected", async () => {
    const replies = [{ status: "shown", requestId: "r1", scene, speak: "hi" }, { status: "redirected", requestId: "r2", message: "Try another!", ideas: ["boat"] }];
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(replies.shift()), { headers: { "content-type": "application/json" } })) as never;
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    const click = async (sel: string) => { await act(async () => { (el.querySelector(sel) as HTMLElement).click(); }); };
    await act(async () => { root.render(createElement(BuildScreen, { modes })); });
    const input = el.querySelector("input") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "a cat");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = () => [...el.querySelectorAll("button")];
    await act(async () => { buttons().find((b) => b.textContent?.includes("Build!"))!.click(); });
    expect(el.querySelector("[data-blocks]")!.getAttribute("data-blocks")).toBe("1");
    await click('button[aria-label="add cone"]');
    expect(el.querySelector("[data-blocks]")!.getAttribute("data-blocks")).toBe("2");
    await act(async () => { buttons().find((b) => b.textContent?.includes("Change it!"))!.click(); });
    expect(el.textContent).toContain("Try another!");
    expect(el.querySelector("[data-blocks]")!.getAttribute("data-blocks")).toBe("2");
    root.unmount();
  });
});
