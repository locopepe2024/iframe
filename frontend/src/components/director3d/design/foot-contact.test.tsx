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
