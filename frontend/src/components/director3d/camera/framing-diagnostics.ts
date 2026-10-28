import { Euler, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { cameraProjection, cameraRuntime, evaluateDirectorFrame, stateTargetPosition } from "../timeline/timeline-evaluation";
import type { ObjectTransform } from "../types";

type Vec = [number, number, number];
export type FramingInput = Omit<Parameters<typeof evaluateDirectorFrame>[0], "frame"> & { sceneRootTransform: ObjectTransform };
export interface FramingRules { extent: "center" | "bounds"; minimumHeightPercent: number }
export interface SubjectFraming {
  cameraId: string; cameraLabel: string; targetId: string; label: string;
  samples: number; minHeightPercent: number | null; maxHeightPercent: number | null;
  firstOutsideFrame: number | null; firstSmallFrame: number | null;
  unavailable: "missing" | "custom_proxy" | null;
}
export interface FramingReport { totalFrames: number; sampledFrames: number; subjects: SubjectFraming[] }

function matrix(transform: ObjectTransform) {
  return new Matrix4().compose(new Vector3(...transform.position),
    new Quaternion().setFromEuler(new Euler(...transform.rotationDeg.map(v => v * Math.PI / 180) as Vec)),
    new Vector3(...transform.scale));
}
function corners(minimum: Vec, maximum: Vec, transform: Matrix4) {
  return [0, 1].flatMap(x => [0, 1].flatMap(y => [0, 1].map(z =>
    new Vector3(x ? maximum[0] : minimum[0], y ? maximum[1] : minimum[1], z ? maximum[2] : minimum[2]).applyMatrix4(transform))));
}

/** Read-only proxy projection, deliberately independent of visibility/occlusion claims. */
export function diagnoseFraming(input: FramingInput, rules: FramingRules): FramingReport {
  const totalFrames = Math.max(1, Math.round(input.durationSeconds * input.fps) + 1);
  const sampledFrames = Math.min(301, totalFrames);
  const rows = new Map<string, SubjectFraming>();
  const root = matrix(input.sceneRootTransform);
  for (let sample = 0; sample < sampledFrames; sample++) {
    const frame = sampledFrames === 1 ? 1 : Math.round(sample * (totalFrames - 1) / (sampledFrames - 1)) + 1;
    const evaluated = evaluateDirectorFrame({ ...input, frame });
    const camera = evaluated.cameras[evaluated.activeCameraId];
    if (!camera) continue;
    const runtime = cameraRuntime(camera, evaluated.characters, evaluated.sceneObjects);
    const projection = cameraProjection(camera.fovDeg, camera.zoom, camera.aspectRatio);
    const lens = new PerspectiveCamera(projection.verticalFovDeg, projection.aspect, .01, 100);
    lens.position.set(...runtime.positionM); lens.up.set(0, 0, 1); lens.lookAt(...runtime.targetM); lens.updateMatrixWorld(true);
    for (const targetId of Array.from(new Set(camera.subjectTargetIds))) {
      const actor = evaluated.characters[targetId], object = evaluated.sceneObjects[targetId];
      if ((actor ?? object)?.visible === false) continue;
      const key = JSON.stringify([camera.cameraId, targetId]);
      let row = rows.get(key);
      if (!row) {
        row = { cameraId: camera.cameraId, cameraLabel: camera.label, targetId, label: actor?.label ?? object?.label ?? targetId,
          samples: 0, minHeightPercent: null, maxHeightPercent: null, firstOutsideFrame: null, firstSmallFrame: null,
          unavailable: !actor && !object ? "missing" : actor?.proxyAssetId ? "custom_proxy" : null };
        rows.set(key, row);
      }
      if (row.unavailable) continue;
      row.samples++;
      const local = matrix((actor ?? object).transform);
      let points: Vector3[];
      if (actor) {
        local.multiply(new Matrix4().makeTranslation(...actor.poseRootOffsetM));
        points = corners([-.3, -.3, 0], [.3, .3, 1.8], root.clone().multiply(local));
      } else points = corners(object.boundingBoxM.minimum, object.boundingBoxM.maximum, root.clone().multiply(local));
      const projected = points.map(point => point.clone().project(lens));
      const center = new Vector3(...stateTargetPosition(targetId, evaluated.characters, evaluated.sceneObjects)!).applyMatrix4(root).project(lens);
      const inFrame = (p: Vector3) => [p.x, p.y, p.z].every(Number.isFinite) && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z >= -1 && p.z <= 1;
      if (!(rules.extent === "center" ? inFrame(center) : projected.every(inFrame))) row.firstOutsideFrame ??= frame;
      // Near-plane intersections do not have a meaningful projected proxy height.
      if (projected.every(p => Number.isFinite(p.y) && p.z >= -1 && p.z <= 1)) {
        const height = (Math.max(...projected.map(p => p.y)) - Math.min(...projected.map(p => p.y))) * 50;
        row.minHeightPercent = Math.min(row.minHeightPercent ?? height, height);
        row.maxHeightPercent = Math.max(row.maxHeightPercent ?? height, height);
        if (actor && height < rules.minimumHeightPercent) row.firstSmallFrame ??= frame;
      }
    }
  }
  return { totalFrames, sampledFrames, subjects: Array.from(rows.values()) };
}
