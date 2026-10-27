// @vitest-environment node
import {createHash} from "node:crypto";
import {SEATED_FIT} from "./design-poses";
import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {Bone,Group,Vector3,Quaternion,Euler,MathUtils} from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {solveFlatFoot, LEG_CONTACT} from "./foot-contact";
import {rigProfile} from "../data/humanoid";
it("matches foot targets and preserves ankle orientation on actual shipped GLB through a complete stride",async()=>{
 const bytes=readFileSync(new URL("../../../../public/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb",import.meta.url));
 expect(createHash("sha256").update(bytes).digest("hex")).toBe(SEATED_FIT.sourceSha256);
 const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"");
 const root=new Group(); root.rotation.x=Math.PI/2;root.add(scene);root.updateMatrixWorld(true);
 const bones=new Map<string,Bone>(),rest=new Map<string,Quaternion>(),orientation=new Map<string,Quaternion>();
 scene.traverse(n=>{if(n instanceof Bone){bones.set(n.name,n);rest.set(n.name,n.quaternion.clone());if(n.name.startsWith("ankle_"))orientation.set(n.name,n.getWorldQuaternion(new Quaternion()));}});
 for(let i=0;i<=24;i++) {
  const solved=solveFlatFoot(i*Math.PI/12,true);
  for(const [id,r] of Object.entries(solved.rotations)) {
   const bone=bones.get(id)!;bone.quaternion.copy(rest.get(id)!).multiply(new Quaternion().setFromEuler(new Euler(r.x*MathUtils.DEG2RAD,0,0)));
   const limits=rigProfile.joints.find(j=>j.joint_id===id)!.rotation_limits_deg.x!;
   expect(r.x).toBeGreaterThanOrEqual(limits[0]);expect(r.x).toBeLessThanOrEqual(limits[1]);
  }
  root.updateMatrixWorld(true);
  for(const side of ["l","r"]) {
   const ankle=bones.get(`ankle_${side}`)!;const p=ankle.getWorldPosition(new Vector3());
   expect(p.y).toBeCloseTo(solved.targets[side].y,5);expect(p.z).toBeCloseTo(solved.targets[side].z,5);
   expect(p.z).toBeGreaterThanOrEqual(LEG_CONTACT.ankleZ-1e-5);
   expect(ankle.getWorldQuaternion(new Quaternion()).angleTo(orientation.get(ankle.name)!)).toBeLessThan(1e-5);
  }
 }
});
it("returns calibrated standing ankle targets for waiting",()=>{
 const result=solveFlatFoot(1.4,false);
 expect(result.targets.l).toEqual({y:LEG_CONTACT.ankleY,z:LEG_CONTACT.ankleZ});
 expect(result.targets.r).toEqual(result.targets.l);
});

it("keeps actual GLB support ankles within 1 cm through baked interpolation, departure, arrival and headings",async()=>{
 const {crowdGait}=await import('./crowd-navigation');
 const {evaluateDirectorFrame}=await import('../timeline/timeline-evaluation');
 const {useWorkbenchStore}=await import('../state/workbench-store');
 const bytes=readFileSync(new URL('../../../../public/models/director3d/white-model-neutral-female-v1/white-model-neutral-female-v1.glb',import.meta.url));
 const {scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const world=new Group(),pelvis=new Group(),model=new Group(); model.rotation.x=Math.PI/2;
 world.add(pelvis);pelvis.add(model);model.add(scene);world.updateMatrixWorld(true);
 const bones=new Map<string,Bone>(),rest=new Map<string,Quaternion>();
 scene.traverse(n=>{if(n instanceof Bone){bones.set(n.name,n);rest.set(n.name,n.quaternion.clone());}});
 const state=useWorkbenchStore.getState();
 const original=Object.values(state.characters)[0];
 for(const yaw of [0,-90,37]) for(const length of [.025,.24,.77,2.4]) {
  const angle=yaw*MathUtils.DEG2RAD;
  const direction=new Vector3(-Math.sin(angle),Math.cos(angle),0);
  const actor={...original,transform:{...original.transform,position:[0,0,0] as [number,number,number],rotationDeg:[0,0,yaw] as [number,number,number],scale:[1,1,1] as [number,number,number]},poseRootOffsetM:[0,0,0] as [number,number,number],jointRotations:{}};
  const track: import('../types').TimelineTrackState={trackId:'walk',trackKind:'character_transform',propertyKey:'transform.position_m',target:{targetType:'character',targetId:actor.characterId},keyframes:[
   {keyframeId:'hold',timeSeconds:0,value:[0,0,0],interpolation:'linear'},
   {keyframeId:'start',timeSeconds:1,value:[0,0,0],interpolation:'linear'},
   {keyframeId:'end',timeSeconds:3,value:direction.clone().multiplyScalar(length).toArray(),interpolation:'linear'}]};
  const tracks=[track,...crowdGait(track,actor)];
  // JSON replay and real timeline evaluator, including samples between baked keys.
  const replay=JSON.parse(JSON.stringify(tracks));
  const count=Math.max(2,Math.ceil(length/.12/2)*2),step=length/count;
  for(let n=0;n<=420;n++) {
   const time=n/100;
   const evaluated=evaluateDirectorFrame({frame:n+1,fps:100,durationSeconds:5,tracks:replay,activeCameraTrackId:null,selectedCameraId:'',characters:{[actor.characterId]:actor},cameras:{},sceneObjects:{},actorPaths:{},cameraPaths:{}}).characters[actor.characterId];
   world.position.fromArray(evaluated.transform.position);world.rotation.z=evaluated.transform.rotationDeg[2]*MathUtils.DEG2RAD;
   pelvis.position.fromArray(evaluated.poseRootOffsetM);
   expect(evaluated.jointRotations).not.toHaveProperty('pose_root_offset_m');
   for(const [id,bone] of Array.from(bones)) {
    bone.quaternion.copy(rest.get(id)!);
    const r=evaluated.jointRotations[id];
    if(r) {
     bone.quaternion.multiply(new Quaternion().setFromEuler(new Euler(r.x*MathUtils.DEG2RAD,r.y*MathUtils.DEG2RAD,r.z*MathUtils.DEG2RAD)));
     const limits=rigProfile.joints.find(j=>j.joint_id===id)?.rotation_limits_deg.x;
     if(limits){expect(r.x).toBeGreaterThanOrEqual(limits[0]);expect(r.x).toBeLessThanOrEqual(limits[1]);}
    }
   }
   world.updateMatrixWorld(true);
   const d=Math.max(0,Math.min(length,(time-1)*length/2));
   const index=Math.min(count-1,Math.floor(d/step));
   for(const [side,parity] of [['l',0],['r',1]] as const) {
    const p=bones.get(`ankle_${side}`)!.getWorldPosition(new Vector3());
    expect(p.z).toBeGreaterThanOrEqual(LEG_CONTACT.ankleZ-.001);
    if(time>1&&time<3&&index%2===parity) continue;
    const last=index-1-((index-1-parity+2)%2);
    const anchor=time<=1?0:time>=3?length:last<0?0:Math.min(length,(last+2)*step);
    const expected=direction.clone().multiplyScalar(anchor+LEG_CONTACT.ankleY);
    expect(Math.abs(p.dot(direction)-expected.dot(direction))).toBeLessThan(.01);
    expect(Math.abs(p.z-LEG_CONTACT.ankleZ)).toBeLessThan(.001);
   }
  }
 }
});
