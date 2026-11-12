import { useEffect, useMemo } from "react";
import type { MeshStandardMaterial } from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Scene } from "../../shared/scene";
import { buildMesh, disposeMeshes } from "./meshes";

function Block({ block, selected, onSelect }: { block: Scene["blocks"][number]; selected: boolean; onSelect: () => void }) {
  const mesh = useMemo(() => {
    const m = buildMesh(block);
    if (selected) (m.material as MeshStandardMaterial).emissive.set("#ffffff").multiplyScalar(0.45);
    return m;
  }, [block, selected]);
  useEffect(() => () => disposeMeshes([mesh]), [mesh]);
  return <primitive object={mesh} onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); onSelect(); }} />;
}

export default function Viewer({ scene, selected, onSelect }: { scene: Scene; selected?: number | null; onSelect?: (i: number | null) => void }) {
  return (
    <Canvas camera={{ position: [8, 6, 8], fov: 45 }} onPointerMissed={() => onSelect?.(null)} aria-label="3D view">
      <color attach="background" args={["#eaf4ff"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 10, 7]} intensity={1.5} />
      {scene.blocks.map((b, i) => <Block key={i} block={b} selected={selected === i} onSelect={() => onSelect?.(i)} />)}
      <OrbitControls makeDefault />
    </Canvas>
  );
}
