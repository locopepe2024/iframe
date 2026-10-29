import type { Rotation } from "../types";

/** Measured canonical GLB, same asset/hash as SEATED_FIT. Coordinates after viewer Z-up transform. */
export const LEG_CONTACT = {
  hipY: .051799924576116846, hipZ: .9440997982037931,
  kneeY: .032300309983700155, kneeZ: .5346994916597596,
  ankleY: .07650065083097318, ankleZ: .07069952403615842,
};
export function solveFlatFoot(phase: number, walking: boolean): { rotations: Record<string, Rotation>; targets: Record<string, {y: number; z: number}> } {
  const c = LEG_CONTACT;
  return solveFootTargets(Object.fromEntries(([['l',0],['r',Math.PI]] as const).map(([side,offset]) => [side, {
    y: c.ankleY + (walking ? .03*Math.cos(phase+offset) : 0),
    z: c.ankleZ + (walking ? .06*Math.max(0,Math.sin(phase+offset)) : 0),
  }])));
}

/** Targets are actor-local; pelvis displacement is applied separately by the viewer. */
export function solveFootTargets(targets: Record<string, {y:number;z:number}>, pelvisZ = 0): {rotations: Record<string,Rotation>;targets: Record<string,{y:number;z:number}>} {
  const c = LEG_CONTACT;
  const upper = Math.hypot(c.kneeY-c.hipY,c.kneeZ-c.hipZ);
  const lower = Math.hypot(c.ankleY-c.kneeY,c.ankleZ-c.kneeZ);
  const restUpper = Math.atan2(c.kneeY-c.hipY,c.hipZ-c.kneeZ);
  const restLower = Math.atan2(c.ankleY-c.kneeY,c.kneeZ-c.ankleZ);
  const rotations: Record<string, Rotation> = {};
  for (const side of ['l','r']) {
    const {y,z} = targets[side];
    const dy=y-c.hipY, down=c.hipZ+pelvisZ-z, reach=Math.hypot(dy,down);
    if (reach>upper+lower || reach<Math.abs(upper-lower)) throw new Error("足部目标超出标准白模腿部可达范围。");
    const bend=Math.acos(Math.max(-1,Math.min(1,(reach*reach-upper*upper-lower*lower)/(2*upper*lower))));
    const hip=Math.atan2(dy,down)-Math.atan2(lower*Math.sin(bend),upper+lower*Math.cos(bend))-restUpper;
    const knee=bend-(restLower-restUpper);
    const deg=(v:number)=>(v*180/Math.PI)||0;
    rotations[`upper_leg_${side}`]={x:deg(hip),y:0,z:0};
    rotations[`lower_leg_${side}`]={x:deg(knee),y:0,z:0};
    rotations[`ankle_${side}`]={x:deg(-hip-knee),y:0,z:0};
  }
  return {rotations, targets};
}

/** Canonical flat-ground rig only; longer steps require pelvis/reach recalibration. */
export function footfallSchedule(length: number) {
  const count = Math.max(2, Math.ceil(length / .24 / 2) * 2);
  return {count, step: length / count};
}

/** Distance-domain footsteps. Each non-swing foot remains at a fixed route anchor. */
export function plantedFootPose(distance: number, length: number) {
  const {count, step} = footfallSchedule(length);
  const d = Math.max(0, Math.min(length, distance));
  const index = Math.min(count-1, Math.floor(d/step));
  const t = (d-index*step)/step;
  const pelvisZ = (-.05 * Math.min(1,d/.04,(length-d)/.04)) || 0;
  const targets: Record<string,{y:number;z:number}> = {};
  for (const [side,parity] of [['l',0],['r',1]] as const) {
    const last = index-1-((index-1-parity+2)%2);
    const anchor = last < 0 ? 0 : Math.min(length,(last+2)*step);
    const swing = index%2 === parity;
    const next = Math.min(length,(index+2)*step);
    const smooth = t*t*(3-2*t);
    targets[side] = {y: LEG_CONTACT.ankleY+(swing ? anchor+(next-anchor)*smooth : anchor)-d,
      z: LEG_CONTACT.ankleZ+(swing ? .06*Math.sin(Math.PI*t)**2 : 0)};
  }
  // Positive left-arm X counters the first (left-leg) forward swing. Fade at
  // start/stop so the standing hold has no discontinuous arm displacement.
  const armSwing = Math.cos(Math.PI*d/step) * Math.min(1,d/step,(length-d)/step);
  return {...solveFootTargets(targets,pelvisZ),pelvisZ,armSwing};
}
