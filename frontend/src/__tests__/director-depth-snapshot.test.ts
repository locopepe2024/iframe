import { expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeDepthMeshes } from '../components/director3d/state/depth-snapshot';
it('exports admitted world geometry and excludes helpers and hidden ancestors', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
  mesh.userData.directorDepthGeometry = true;
  mesh.position.set(2,3,4); scene.add(mesh);
  const helper = new THREE.Mesh(new THREE.SphereGeometry()); scene.add(helper);
  const hidden = new THREE.Group(); hidden.visible = false;
  const hiddenMesh = mesh.clone(); hidden.add(hiddenMesh); scene.add(hidden);
  const result = bakeDepthMeshes(scene);
  expect(result).toHaveLength(1);
  expect(result[0].positions.every(p => p[0] >= 1.5 && p[0] <= 2.5 && p[2] >= 3.5 && p[2] <= 4.5)).toBe(true);
  expect(result[0].triangles).toHaveLength(12);
});
it('bakes current bone deformation instead of rest vertices', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0),4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0],4));
  const mesh = new THREE.SkinnedMesh(geometry);
  const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  mesh.userData.directorDepthGeometry = true;
  bone.position.z = 2;
  const scene = new THREE.Scene(); scene.add(mesh);
  const [result] = bakeDepthMeshes(scene);
  expect(result.positions.map(point => point[2])).toEqual([2,2,2]);
});
