import * as THREE from "three";
import { PALETTE, type Scene } from "../../shared/scene";

type Block = Scene["blocks"][number];

export function geometryFor(shape: Block["shape"]): THREE.BufferGeometry {
  switch (shape) {
    case "cube": return new THREE.BoxGeometry(1, 1, 1);
    case "sphere": return new THREE.SphereGeometry(0.5, 32, 16);
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case "cone": return new THREE.ConeGeometry(0.5, 1, 32);
    case "pyramid": return new THREE.ConeGeometry(0.5, 1, 4);
    case "torus": return new THREE.TorusGeometry(0.4, 0.15, 16, 32);
  }
}

/** One mesh per block; shared by the Viewer and renderSnapshot so they cannot diverge. */
export function buildMesh(b: Block): THREE.Mesh {
  const m = new THREE.Mesh(geometryFor(b.shape), new THREE.MeshStandardMaterial({ color: PALETTE[b.color] }));
  m.position.set(...b.position);
  m.scale.set(...b.size);
  m.rotation.set(...(b.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]));
  return m;
}
