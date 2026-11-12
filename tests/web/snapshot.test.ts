// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";

const spies = { dispose: vi.fn(), lose: vi.fn() };
vi.mock("three", async (orig) => ({
  ...(await orig<typeof import("three")>()),
  WebGLRenderer: class {
    domElement = { toDataURL: () => "data:image/png;base64,QUJD" };
    setSize() {} setClearColor() {} render() {}
    dispose = spies.dispose;
    forceContextLoss = spies.lose;
  },
}));
import { renderSnapshot } from "../../web/child/snapshot";
import { buildMesh, disposeMeshes } from "../../web/child/meshes";

const block = { shape: "cube" as const, color: "red" as const, position: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] };

describe("renderSnapshot", () => {
  it("returns bare base64 and frees the renderer", async () => {
    const out = await renderSnapshot({ title: "T", blocks: [block] });
    expect(out).toBe("QUJD");
    expect(spies.dispose).toHaveBeenCalled();
    expect(spies.lose).toHaveBeenCalled();
  });
});

describe("disposeMeshes", () => {
  it("disposes every geometry and material", () => {
    const ms = [buildMesh(block), buildMesh({ ...block, shape: "torus" })];
    const spy = ms.flatMap((m) => [vi.spyOn(m.geometry, "dispose"), vi.spyOn(m.material as THREE.Material, "dispose")]);
    disposeMeshes(ms);
    spy.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });
});
