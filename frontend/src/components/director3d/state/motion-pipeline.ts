import type {
  MotionFullBundle,
  MotionFullBundleFrame,
  MotionIkResult,
  MotionRetargetMappingManifest,
  MotionRetargetFrameResult,
  MotionTrackManifest,
  MotionTrackVector3,
} from "../types";
import { evaluateFootContacts, type FootContactOptions } from "./foot-contact";
import { solveLegIk } from "./leg-ik";
import { retargetAndCleanupMotionTrack } from "./motion-retarget";

function sourceJoint(frame: MotionTrackManifest["frames"][number], id: string): MotionTrackVector3 | null {
  return frame.semanticJoints[id] ?? null;
}

function ikForSide(
  side: "left" | "right",
  frame: MotionTrackManifest["frames"][number],
  retargeted: MotionRetargetFrameResult,
  accepted: boolean,
  poleTarget: MotionTrackVector3 | null,
  maximumResidualM?: number,
): MotionIkResult | null {
  if (!accepted) return null;
  const prefix = side === "left" ? "left" : "right";
  const target = frame.footTargets[side].ankle ?? frame.footTargets[side].heel ?? frame.footTargets[side].toe;
  return solveLegIk({
    side,
    hip: sourceJoint(frame, `${prefix}_hip`),
    knee: sourceJoint(frame, `${prefix}_knee`),
    ankle: sourceJoint(frame, `${prefix}_ankle`),
    target,
    poleTarget,
    originalQuaternions: retargeted.localQuaternions,
    maximumResidualM,
  });
}

export interface MotionPipelineOptions {
  footContact?: Partial<FootContactOptions>;
  poleTargets?: Partial<Record<"left" | "right", MotionTrackVector3>>;
  maximumResidualM?: number;
}

export function buildFullMotionBundle(
  manifest: MotionTrackManifest,
  mapping: MotionRetargetMappingManifest,
  options: MotionPipelineOptions = {},
): MotionFullBundle {
  const retargeted = retargetAndCleanupMotionTrack(manifest, mapping);
  const contacts = evaluateFootContacts(manifest.frames, options.footContact);
  const frames: MotionFullBundleFrame[] = retargeted.frames.map((retargetedFrame, index) => {
    const sourceFrame = manifest.frames[index];
    const frameContacts = contacts.filter((item) => item.frame === sourceFrame.frame);
    const leftContact = frameContacts.find((item) => item.side === "left");
    const rightContact = frameContacts.find((item) => item.side === "right");
    const left = ikForSide("left", sourceFrame, retargetedFrame, leftContact?.status === "accepted", options.poleTargets?.left ?? null, options.maximumResidualM);
    const right = ikForSide("right", sourceFrame, retargetedFrame, rightContact?.status === "accepted", options.poleTargets?.right ?? null, options.maximumResidualM);
    const warnings = [...retargetedFrame.warnings];
    if (left?.status === "rejected") warnings.push(`left IK: ${left.reason}`);
    if (right?.status === "rejected") warnings.push(`right IK: ${right.reason}`);
    return {
      frame: retargetedFrame.frame,
      rootPosition: retargetedFrame.rootPosition,
      pelvisQuaternion: retargetedFrame.pelvisQuaternion,
      localQuaternions: {
        ...retargetedFrame.localQuaternions,
        ...(left?.status === "accepted" ? left.localQuaternions : {}),
        ...(right?.status === "accepted" ? right.localQuaternions : {}),
      },
      footContacts: frameContacts,
      ik: { left, right },
      warnings,
    };
  });
  return {
    schema: "full_motion.bundle.v1",
    source: { trackId: manifest.trackId, sourceRevision: manifest.sourceRevision },
    rig: { profileId: mapping.rigProfileId, mappingRevision: mapping.revision },
    mode: "retarget_cleanup_contact_ik_v1",
    cleanupProcessors: retargeted.cleanupProcessors ?? [],
    preview: { status: "ready_for_white_model", renderer: null, artifactUrl: null },
    frames,
    warnings: retargeted.warnings,
  };
}
