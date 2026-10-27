import {beforeAll, expect, it} from "vitest";
import {initializeNavigation, navmeshRoute} from "@/components/director3d/design/navmesh-routing";
import {compileStreetLayout} from "@/components/director3d/design/street-layout";
import {useWorkbenchStore} from "@/components/director3d/state/workbench-store";
beforeAll(async()=>{await initializeNavigation();});
function box() {
 const initial=useWorkbenchStore.getState(); initial.addPrimitive("cube");
 const result=structuredClone(Object.values(useWorkbenchStore.getState().sceneObjects).at(-1)!);
 useWorkbenchStore.setState(initial,true);
 result.transform.position=[0,0,0]; result.transform.rotationDeg=[0,0,45];
 return result;
}
it("builds actual WASM navmesh and routes around a rotated proxy",()=>{
 const path=navmeshRoute([-3,0,0],[3,0,0],{box:box()},[]);
 expect(path.length).toBeGreaterThan(2);
 expect(path[0]).toEqual([-3,0,0]); expect(path.at(-1)).toEqual([3,0,0]);
 expect(path.slice(1,-1).some(p=>Math.abs(p[1])>.7)).toBe(true);
});
it("preserves grain-shop doorway connectivity",()=>{
 const objects=Object.fromEntries(compileStreetLayout({kind:"street_layout",layoutId:"design-street-grain",centerM:[0,0,0],widthM:6,lengthM:12,
 buildings:[{id:"shop",label:"粮铺",centerM:[0,9,0],dimensionsM:[6,6,4],doorWidthM:2,frontSide:"negative_y"}],trees:[]},0).map(o=>[o.sceneObjectId,o]));
 const path=navmeshRoute([0,3,0],[0,9,0],objects,[]);
 expect(path.at(-1)).toEqual([0,9,0]);
});
it("rejects occupied destinations and unsupported models",()=>{
 expect(()=>navmeshRoute([-3,0,0],[0,0,0],{box:box()},[])).toThrow("占据");
 const invalid=box(); invalid.primitiveKind="sphere";
 expect(()=>navmeshRoute([-3,0,0],[3,0,0],{invalid},[])).toThrow("代理");
});

it("rejects disconnected enclosed targets instead of accepting a partial route",()=>{
 const objects=Object.fromEntries(compileStreetLayout({kind:"street_layout",layoutId:"design-street-closed",centerM:[0,0,0],widthM:6,lengthM:12,
 buildings:[{id:"shop",label:"粮铺",centerM:[0,9,0],dimensionsM:[6,6,4],doorWidthM:2,frontSide:"negative_y"}],trees:[]},0).map(o=>[o.sceneObjectId,o]));
 const wall=box();wall.transform.rotationDeg=[0,0,0];wall.transform.position=[0,6.075,0];wall.boundingBoxM={minimum:[-1.1,-.2,0],maximum:[1.1,.2,3]};
 objects.wall=wall;
 expect(()=>navmeshRoute([0,3,0],[0,9,0],objects,[])).toThrow("不可达");
});
it("compiles navmesh crowd routes atomically and preserves the baked result across import",async()=>{
 const {compileDesignProposal,designRevision}=await import("@/components/director3d/design/design-proposal");
 const initial=useWorkbenchStore.getState();
 try {
  const obstacle=box();obstacle.transform.scale=[1.5,1,1];
  useWorkbenchStore.setState({sceneObjects:{obstacle},actorPaths:{},cameraPaths:{},rigAdmissionStatus:"passed",dialogueTimeline:{...initial.dialogueTimeline,tracks:[]},undoStack:[],redoStack:[]});
  const before=useWorkbenchStore.getState();
  const proposal={schemaVersion:"iframe.director3d.design-proposal.v1" as const,baseRevision:designRevision(before),summary:"绕行柜台",assumptions:[],clarification:null,
   operations:[{kind:"crowd_motion" as const,groupId:"design-crowd-nav",label:"绕行",behavior:"pass" as const,members:[{actorId:"design-extra-nav",positionM:[-3,2,0] as [number,number,number],destinationM:[3,-2,0] as [number,number,number],yawDeg:0,startSeconds:0,durationSeconds:6}]}]};
  const candidate=compileDesignProposal(before,proposal,"navmesh");expect(useWorkbenchStore.getState()).toBe(before);
  before.applyDesignProposal(proposal,"navmesh");
  const bundle=useWorkbenchStore.getState().exportDirectorDesignBundle();
  expect(useWorkbenchStore.getState().dialogueTimeline).toEqual(candidate.dialogueTimeline);
  useWorkbenchStore.getState().undo();expect(useWorkbenchStore.getState().characters).toEqual(before.characters);
  expect(useWorkbenchStore.getState().importDirectorDesignBundle(JSON.parse(JSON.stringify(bundle)))).toEqual({ok:true});
  expect(useWorkbenchStore.getState().dialogueTimeline).toEqual(candidate.dialogueTimeline);
 }finally{useWorkbenchStore.setState(initial,true);}
});
