'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MIN_FOV = 35;
const MAX_FOV = 95;

function LookControls({ fov }: { fov: number }) {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = -0.4;
    const redraw = () => invalidate();
    controls.addEventListener('change', redraw);
    return () => { controls.removeEventListener('change', redraw); controls.dispose(); };
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = fov;
    perspective.updateProjectionMatrix();
    invalidate();
  }, [camera, fov, invalidate]);
  return null;
}

function PanoramaScene({ texture, fov }: { texture: THREE.Texture; fov: number }) {
  return <>
    <mesh rotation={[0, -Math.PI / 2, 0]}><sphereGeometry args={[10, 64, 32]} /><meshBasicMaterial map={texture} side={THREE.BackSide} toneMapped={false} /></mesh>
    <LookControls fov={fov} />
  </>;
}

export default function PanoramaViewer({ src, label }: { src: string; label: string }) {
  const t = useTranslations('imageEditor');
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [failed, setFailed] = useState(false);
  const [fov, setFov] = useState(75);
  useEffect(() => {
    let active = true;
    let loaded: THREE.Texture | null = null;
    setTexture(null);
    setFailed(false);
    new THREE.TextureLoader().load(src, next => {
      if (!active) { next.dispose(); return; }
      next.colorSpace = THREE.SRGBColorSpace;
      loaded = next;
      setTexture(next);
    }, undefined, () => { if (active) setFailed(true); });
    return () => { active = false; loaded?.dispose(); };
  }, [src]);
  const zoom = (step: number) => setFov(current => Math.max(MIN_FOV, Math.min(MAX_FOV, current + step)));
  return <div className="relative h-full w-full bg-black" role="group" aria-label={label}>
    {texture && <Canvas frameloop="demand" camera={{ fov: 75, near: 0.01, far: 30, position: [0, 0, 0.1] }} dpr={[1, 1.5]}>
      <PanoramaScene texture={texture} fov={fov} />
    </Canvas>}
    {!texture && <div className="absolute inset-0 grid place-items-center text-sm text-white" role={failed ? 'alert' : 'status'}>
      {t(failed ? 'panoramaLoadFailed' : 'panoramaLoading')}
    </div>}
    {texture && <div className="absolute bottom-3 right-3 flex gap-2">
      <button type="button" title={t('panoramaZoomOut')} aria-label={t('panoramaZoomOut')} disabled={fov >= MAX_FOV} onClick={() => zoom(10)} className="grid h-[48px] w-[48px] place-items-center rounded border border-white/20 bg-black/70 text-white disabled:opacity-40"><ZoomOut size={18} /></button>
      <button type="button" title={t('panoramaZoomIn')} aria-label={t('panoramaZoomIn')} disabled={fov <= MIN_FOV} onClick={() => zoom(-10)} className="grid h-[48px] w-[48px] place-items-center rounded border border-white/20 bg-black/70 text-white disabled:opacity-40"><ZoomIn size={18} /></button>
    </div>}
  </div>;
}
