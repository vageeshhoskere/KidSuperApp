import * as THREE from "three";
import type { Scene } from "../../shared/scene";
import { buildMesh, disposeMeshes } from "./meshes";

/** Renders a 512x512 3/4 view off-screen; returns base64 PNG without the data-URL prefix. Verified in the Task 14 browser e2e (no WebGL in jsdom). */
export async function renderSnapshot(scene: Scene): Promise<string> {
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true, antialias: true });
  const group = new THREE.Group();
  try {
    renderer.setSize(512, 512);
    renderer.setClearColor(0xeaf4ff);
    const three = new THREE.Scene();
    three.add(new THREE.AmbientLight(0xffffff, 0.8), new THREE.DirectionalLight(0xffffff, 1.5));
    scene.blocks.forEach((b) => group.add(buildMesh(b)));
    three.add(group);
    const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    const d = Math.max(sphere.radius, 0.5) * 2.6;
    cam.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(d));
    cam.lookAt(sphere.center);
    renderer.render(three, cam);
    return renderer.domElement.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  } finally {
    disposeMeshes(group.children as THREE.Mesh[]);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
