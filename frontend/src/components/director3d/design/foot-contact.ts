import type { Rotation } from "../types";

/** Measured canonical GLB, same asset/hash as SEATED_FIT. Coordinates after viewer Z-up transform. */
export const LEG_CONTACT = {
  hipY: .051799924576116846, hipZ: .9440997982037931,
  kneeY: .032300309983700155, kneeZ: .5346994916597596,
  ankleY: .07650065083097318, ankleZ: .07069952403615842,
};
export function solveFlatFoot(phase: number, walking: boolean): { rotations: Record<string, Rotation>; targets: Record<string, {y: number; z: number}> } {
  const c = LEG_CONTACT;
  const upper = Math.hypot(c.kneeY-c.hipY,c.kneeZ-c.hipZ);
  const lower = Math.hypot(c.ankleY-c.kneeY,c.ankleZ-c.kneeZ);
  const restUpper = Math.atan2(c.kneeY-c.hipY,c.hipZ-c.kneeZ);
  const restLower = Math.atan2(c.ankleY-c.kneeY,c.kneeZ-c.ankleZ);
  const rotations: Record<string, Rotation> = {}, targets: Record<string,{y:number;z:number}> = {};
  for (const [side, offset] of [["l",0],["r",Math.PI]] as const) {
    const p = phase + offset;
    const y = c.ankleY + (walking ? .03*Math.cos(p) : 0);
    const z = c.ankleZ + (walking ? .06*Math.max(0,Math.sin(p)) : 0);
    const dy=y-c.hipY, down=c.hipZ-z, reach=Math.hypot(dy,down);
    if (reach>upper+lower || reach<Math.abs(upper-lower)) throw new Error("足部目标超出标准白模腿部可达范围。");
    const bend=Math.acos(Math.max(-1,Math.min(1,(reach*reach-upper*upper-lower*lower)/(2*upper*lower))));
    const hip=Math.atan2(dy,down)-Math.atan2(lower*Math.sin(bend),upper+lower*Math.cos(bend))-restUpper;
    const knee=bend-(restLower-restUpper);
    const deg=(v:number)=>(v*180/Math.PI)||0;
    rotations[`upper_leg_${side}`]={x:deg(hip),y:0,z:0};
    rotations[`lower_leg_${side}`]={x:deg(knee),y:0,z:0};
    rotations[`ankle_${side}`]={x:deg(-hip-knee),y:0,z:0};
    targets[side]={y,z};
  }
  return {rotations, targets};
}
