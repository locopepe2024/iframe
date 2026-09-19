import rigProfileData from "./rig-profile.v1.json";

import type { RigProfile } from "../types";

export const CHARACTER_A_ID = "character-female-a001";
export const CHARACTER_B_ID = "character-female-b001";
export const CHARACTER_ID = CHARACTER_A_ID;
export const CHARACTER_LABEL = "女性运动服白模 A";
export const CHARACTER_LABELS = {
  [CHARACTER_A_ID]: "女性运动服白模 A",
  [CHARACTER_B_ID]: "女性运动服白模 B",
} as const;
export const humanoidUrl = "/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb";
export const rigProfile = rigProfileData as RigProfile;
