// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { Bone, Euler, Group, Quaternion, SkinnedMesh, Vector3, MathUtils } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { posePresetById } from "../pose/pose-presets";
import { SEATED_FIT } from "./design-poses";
import { rigProfile } from "../data/humanoid";

it("calibrates seated support and ground clearance against the shipped skinned GLB, using the viewer's exact transforms", async () => {
  const bytes = readFileSync(new URL("../../../../public/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb", import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(SEATED_FIT.sourceSha256);
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const { scene } = await new GLTFLoader().parseAsync(array, "");
  const preset = posePresetById.get("seated.sit")!;
  const root = new Group();
  root.rotation.x = Math.PI / 2;
  root.position.fromArray(preset.rootOffsetM!);
  root.position.z += SEATED_FIT.groundLiftM;
  root.add(scene);
  scene.traverse((node) => {
    if (!(node instanceof Bone)) return;
    const rotation = preset.rotations[node.name];
    if (rotation) node.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...[rotation.x, rotation.y, rotation.z].map(MathUtils.degToRad) as [number, number, number], "XYZ")));
  });
  root.updateMatrixWorld(true);
  let lowest = Infinity, support = Infinity, ankleZ = Infinity, kneeForwardY = 0;
  let vertices = 0, supportVertices = 0;
  scene.traverse((node) => {
    if (node instanceof Bone && ["ankle_l", "ankle_r"].includes(node.name)) ankleZ = Math.min(ankleZ, node.getWorldPosition(new Vector3()).z);
    if (node instanceof Bone && node.name === "lower_leg_l") kneeForwardY = node.getWorldPosition(new Vector3()).y;
    if (!(node instanceof SkinnedMesh)) return;
    node.skeleton.update();
    for (let i = 0; i < node.geometry.attributes.position.count; i++) {
      const p = node.getVertexPosition(i, new Vector3()).applyMatrix4(node.matrixWorld);
      lowest = Math.min(lowest, p.z); vertices++;
      const originalZ = p.z - SEATED_FIT.groundLiftM;
      if (Math.abs(p.x) < .23 && p.y > -.18 && p.y < .14 && originalZ > .25 && originalZ < .55) {
        support = Math.min(support, p.z); supportVertices++;
      }
    }
  });
  expect(vertices).toBeGreaterThan(1000);
  expect(supportVertices).toBeGreaterThan(20);
  expect(lowest).toBeCloseTo(0, 5);
  expect(support).toBeCloseTo(SEATED_FIT.supportHeightM + SEATED_FIT.groundLiftM, 5);
  expect(ankleZ).toBeGreaterThan(0);
  // The shipped seated pose bends its knees toward -Y; chair back is +Y.
  expect(kneeForwardY).toBeLessThan(-.3);
  for (const [id, rotation] of Object.entries(preset.rotations)) {
    const joint = rigProfile.joints.find((j) => j.joint_id === id);
    if (!joint) throw new Error(`missing joint ${id}`);
    for (const axis of ["x", "y", "z"] as const) {
      const limits = joint.rotation_limits_deg[axis];
      expect(rotation[axis]).toBeGreaterThanOrEqual(limits?.[0] ?? -Infinity);
      expect(rotation[axis]).toBeLessThanOrEqual(limits?.[1] ?? Infinity);
    }
  }
});
