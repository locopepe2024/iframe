"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, Html, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import * as THREE from "three";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const WHITE_MODEL_SOURCE = "/models/makehuman/base.obj";

export interface WhiteModelViewerLabels {
  reset: string;
  wireframe: string;
  solid: string;
  loading: string;
  unavailable: string;
  failed: string;
}

interface WhiteModelProps {
  src: string;
  wireframe: boolean;
}

function WhiteModel({ src, wireframe }: WhiteModelProps) {
  const source = useLoader(OBJLoader, src);
  const model = useMemo(() => {
    const clone = source.clone(true);
    clone.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      // The MakeHuman export also contains rig-helper and joint meshes. The
      // reference stage is a silhouette guide, so only the CC0 body surface
      // is shown; joint markers are not a user-editable rig in this slice.
      if (child.name !== "body") {
        child.visible = false;
        return;
      }
      const material = new THREE.MeshStandardMaterial({
        color: "#d8dde7",
        roughness: 0.78,
        metalness: 0,
        wireframe,
      });
      child.material = material;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }, [source]);

  useEffect(() => {
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        if (material instanceof THREE.Material && "wireframe" in material) {
          (material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial).wireframe = wireframe;
          material.needsUpdate = true;
        }
      });
    });
  }, [model, wireframe]);

  useEffect(() => () => {
    model.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material.dispose());
    });
  }, [model]);

  return <primitive object={model} />;
}

function LoadingLabel({ children }: { children: string }) {
  return <Html center className="pointer-events-none whitespace-nowrap text-xs text-white/75">{children}</Html>;
}

function supportsWebGL() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

class ModelErrorBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * A small, deliberately read-only model stage. It accepts a local or signed
 * OBJ URL so the viewer can later be reused for an explicit Media variant;
 * v1 does not persist the URL or create an Asset automatically.
 */
export default function WhiteModelViewer({
  src = WHITE_MODEL_SOURCE,
  labels,
}: {
  src?: string;
  labels: WhiteModelViewerLabels;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const [wireframe, setWireframe] = useState(false);
  const [canRender, setCanRender] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => setCanRender(supportsWebGL()), []);

  if (!canRender) {
    return <div role="status" className="grid min-h-64 place-items-center rounded-xl bg-surface-inset p-4 text-center text-sm text-text-secondary">{labels.unavailable}</div>;
  }

  return <div className="space-y-3">
    <div className="relative h-[min(60vh,32rem)] min-h-64 overflow-hidden rounded-xl border border-border bg-[#10131a]">
      {failed ? <div role="alert" className="absolute inset-0 z-10 grid place-items-center p-4 text-center text-sm text-red-300">{labels.failed}</div> : <ModelErrorBoundary onError={() => setFailed(true)}>
        <Canvas
          camera={{ position: [0, 7, 18], fov: 38 }}
          dpr={[1, 1.5]}
          shadows
          onCreated={({ gl }) => { gl.setClearColor("#10131a"); }}
        >
          <ambientLight intensity={1.2} />
          <directionalLight castShadow position={[4, 10, 8]} intensity={2.4} />
          <directionalLight position={[-4, 5, -5]} intensity={0.6} color="#8aa7ff" />
          <Suspense fallback={<LoadingLabel>{labels.loading}</LoadingLabel>}>
            <Bounds fit clip margin={1.2}>
              <Center bottom>
                <WhiteModel src={src} wireframe={wireframe} />
              </Center>
            </Bounds>
          </Suspense>
          <gridHelper args={[24, 24, "#374151", "#202733"]} position={[0, 0, 0]} />
          <OrbitControls
            ref={controls}
            makeDefault
            enablePan={false}
            minDistance={2}
            maxDistance={40}
            minPolarAngle={0.15}
            maxPolarAngle={Math.PI - 0.15}
          />
        </Canvas>
      </ModelErrorBoundary>}
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="glass-button" onClick={() => controls.current?.reset()} disabled={failed}>{labels.reset}</button>
      <button type="button" className="glass-button" onClick={() => setWireframe(value => !value)} disabled={failed} aria-pressed={wireframe}>{wireframe ? labels.solid : labels.wireframe}</button>
    </div>
  </div>;
}
