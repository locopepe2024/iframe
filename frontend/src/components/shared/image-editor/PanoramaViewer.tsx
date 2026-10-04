'use client';

import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function LookControls() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 0.1;
    controls.rotateSpeed = -0.4;
    controls.enableDamping = true;
    let animation = 0;
    const update = () => { controls.update(); animation = requestAnimationFrame(update); };
    update();
    return () => { cancelAnimationFrame(animation); controls.dispose(); };
  }, [camera, gl]);
  return null;
}

function Sphere({ src }: { src: string }) {
  const texture = useLoader(THREE.TextureLoader, src);
  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    return () => texture.dispose();
  }, [texture]);
  return <mesh rotation={[0, -Math.PI / 2, 0]}><sphereGeometry args={[10, 64, 32]} /><meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} /></mesh>;
}

export default function PanoramaViewer({ src, label }: { src: string; label: string }) {
  return <div className="h-full w-full bg-black" role="img" aria-label={label}>
    <Canvas camera={{ fov: 75, near: 0.01, far: 30, position: [0, 0, 0.1] }} dpr={[1, 1.5]}>
      <Suspense fallback={null}><Sphere src={src} /></Suspense>
      <LookControls />
    </Canvas>
  </div>;
}
