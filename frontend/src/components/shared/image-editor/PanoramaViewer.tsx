'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useState } from 'react';
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

function Sphere({ src, onError, onReady }: { src: string; onError: () => void; onReady: () => void }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let active = true;
    setTexture(null);
    new THREE.TextureLoader().load(src, loaded => {
      if (!active) { loaded.dispose(); return; }
      loaded.colorSpace = THREE.SRGBColorSpace;
      setTexture(loaded);
      onReady();
    }, undefined, () => { if (active) onError(); });
    return () => { active = false; };
  }, [src, onError, onReady]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return <mesh rotation={[0, -Math.PI / 2, 0]}><sphereGeometry args={[10, 64, 32]} /><meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} /></mesh>;
}

export default function PanoramaViewer({ src, label }: { src: string; label: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const onError = useCallback(() => setStatus('error'), []);
  const onReady = useCallback(() => setStatus('ready'), []);
  return <div className="relative h-full w-full bg-black" role="img" aria-label={label}>
    <Canvas camera={{ fov: 75, near: 0.01, far: 30, position: [0, 0, 0.1] }} dpr={[1, 1.5]}>
      <Sphere src={src} onError={onError} onReady={onReady} />
      <LookControls />
    </Canvas>
    {status !== 'ready' && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white" role="status">{status === 'error' ? '全景图片加载失败' : '正在载入全景…'}</p>}
  </div>;
}
