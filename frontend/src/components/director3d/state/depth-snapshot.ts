import * as THREE from 'three';

export interface DepthSnapshot {
  schema_version: 'director-scene-depth-snapshot.v1';
  frame: number; fps: number; cameraLabel: string; nearM: number; farM: number;
  width: number; height: number;
  camera: { type: 'PERSP' | 'ORTHO'; matrixWorld: number[][]; near: number; far: number; aspect: number; verticalFovDeg: number; orthoHeight: number };
  meshes: { positions: number[][]; triangles: number[][] }[];
}
let capture: ((near: number, far: number) => DepthSnapshot) | null = null;
export function installDepthCapture(callback: NonNullable<typeof capture>) {
  capture = callback;
  return () => { if (capture === callback) capture = null; };
}
export function captureDepthSnapshot(near: number, far: number) {
  if (!capture) throw new Error('三维场景尚未准备好。');
  if (!Number.isFinite(near) || !Number.isFinite(far) || near < 0 || far <= near) throw new Error('远端距离必须大于近端距离。');
  return capture(near, far);
}
export function bakeDepthMeshes(scene: THREE.Scene) {
  const meshes: DepthSnapshot['meshes'] = [];
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    let admitted = false;
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return;
      if (node.userData.directorDepthGeometry) admitted = true;
    }
    if (!admitted) return;
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    const attribute = object.geometry.getAttribute('position');
    if (!attribute) return;
    const positions: number[][] = [];
    const point = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i++) {
      object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
      positions.push(point.toArray());
    }
    const index = object.geometry.index;
    const count = index?.count ?? attribute.count;
    const triangles: number[][] = [];
    for (let i = 0; i + 2 < count; i += 3) triangles.push([0, 1, 2].map(offset => index ? index.getX(i + offset) : i + offset));
    meshes.push({ positions, triangles });
  });
  if (!meshes.length) throw new Error('场景中没有可导出的实体，请等待白模加载完成。');
  if (meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0) > 300000) throw new Error('场景超过深度导出的顶点上限。');
  return meshes;
}
