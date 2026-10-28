import { expect, it } from "vitest";
import { useWorkbenchStore } from "../state/workbench-store";
import { diagnoseFraming, type FramingInput } from "./framing-diagnostics";
import type { TimelineTrackState } from "../types";

function scene(): FramingInput {
  const state = structuredClone({characters: useWorkbenchStore.getState().characters, cameras: useWorkbenchStore.getState().cameras});
  const [actor, anchor] = Object.values(state.characters);
  for (const person of [actor, anchor]) {
    person.transform = {position:[0,0,0], rotationDeg:[0,0,0], scale:[1,1,1], groundSnap:false};
    person.poseRootOffsetM = [0,0,0]; person.proxyAssetId = null;
  }
  anchor.visible = false;
  const camera = Object.values(state.cameras)[0];
  camera.transform.position = [0,-10,1]; camera.subjectTargetIds = [actor.characterId];
  camera.lookAt = {targetType:"character",targetId:anchor.characterId}; camera.follow = null;
  camera.fovDeg=90; camera.zoom=1; camera.aspectRatio="16:9";
  return {...state, selectedCameraId:camera.cameraId, sceneObjects:{}, actorPaths:{},cameraPaths:{}, tracks:[], activeCameraTrackId:null,
    durationSeconds:2,fps:10, sceneRootTransform:{position:[0,0,0],rotationDeg:[0,0,0],scale:[1,1,1],groundSnap:false}};
}
const rules = {extent:"bounds" as const, minimumHeightPercent:20};
function move(input: FramingInput, xs: number[]): TimelineTrackState {
  return {trackId:"move",trackKind:"character_transform",target:{targetType:"character",targetId:Object.keys(input.characters)[0]},propertyKey:"transform.position_m",
    keyframes:xs.map((x,i)=>({keyframeId:`k-${i}`,timeSeconds:i,value:[x,0,0],interpolation:"linear"}))};
}
it("reports projected height and small subjects without changing the scene", () => {
  const input=scene(), before=structuredClone(input);
  const report=diagnoseFraming(input,rules), row=report.subjects[0];
  expect(report.sampledFrames).toBe(21);
  expect(row.minHeightPercent).toBeCloseTo(16.5,0);
  expect(row.firstSmallFrame).toBe(1); expect(row.firstOutsideFrame).toBeNull();
  expect(input).toEqual(before);
});
it("distinguishes a centered close-up from a clipped standing envelope", () => {
  const input=scene();input.cameras[input.selectedCameraId].transform.position=[0,-1,1];
  expect(diagnoseFraming(input,rules).subjects[0].firstOutsideFrame).toBe(1);
  expect(diagnoseFraming(input,{...rules,extent:"center"}).subjects[0].firstOutsideFrame).toBeNull();
});
it("finds an intermediate departure even when start and end are in frame", () => {
  const input=scene(); input.tracks=[move(input,[0,15,0])];
  const row=diagnoseFraming(input,rules).subjects[0];
  expect(row.firstOutsideFrame).toBeGreaterThan(1); expect(row.firstOutsideFrame).toBeLessThan(11);
});
it("uses active cuts, camera zoom and portrait aspect", () => {
  const input=scene(), first=input.cameras[input.selectedCameraId];
  const second=structuredClone(first);second.cameraId="cut-camera";second.zoom=2;second.aspectRatio="9:16";
  input.cameras[second.cameraId]=second;
  input.tracks=[{trackId:"cuts",trackKind:"active_camera",target:{targetType:"timeline",targetId:"timeline-main"},propertyKey:"camera.active_id",
    keyframes:[{keyframeId:"cut",timeSeconds:1,value:second.cameraId,interpolation:"step"}]}];
  // A cut track's first value applies before its timestamp; provide the initial cut explicitly.
  input.tracks[0].keyframes.unshift({keyframeId:"start",timeSeconds:0,value:first.cameraId,interpolation:"step"});
  input.activeCameraTrackId="cuts";
  const rows=diagnoseFraming(input,rules).subjects;
  expect(rows.map(r=>r.samples)).toEqual([10,11]);
  expect(rows[1].minHeightPercent!).toBeLessThan(rows[0].minHeightPercent!);
});
it("evaluates follow bindings during motion", () => {
  const input=scene(), camera=input.cameras[input.selectedCameraId], id=Object.keys(input.characters)[0];
  camera.lookAt={targetType:"character",targetId:id};camera.follow={targetType:"character",targetId:id};
  camera.transform.position=[0,-10,0];input.tracks=[move(input,[0,15,0])];
  expect(diagnoseFraming(input,rules).subjects[0].firstOutsideFrame).toBeNull();
});
it("applies scene-root and actor transforms and skips hidden/custom/missing targets honestly", () => {
  const input=scene(), [actor,hidden]=Object.values(input.characters), camera=input.cameras[input.selectedCameraId];
  actor.transform.scale=[2,2,2];actor.poseRootOffsetM=[0,0,1];
  expect(diagnoseFraming(input,rules).subjects[0].minHeightPercent!).toBeGreaterThan(30);
  input.sceneRootTransform.position=[100,0,0];
  expect(diagnoseFraming(input,rules).subjects[0].firstOutsideFrame).toBe(1);
  actor.proxyAssetId="custom";camera.subjectTargetIds.push(hidden.characterId,"missing");
  expect(diagnoseFraming(input,rules).subjects.map(r=>r.unavailable)).toEqual(["custom_proxy","missing"]);
});
it("bounds long scans and includes the final frame", () => {
  const input=scene();input.durationSeconds=60;input.fps=24;
  input.tracks=[{...move(input,[0,0,20]),keyframes:move(input,[0,0,20]).keyframes.map((k,i)=>({...k,timeSeconds:i*30}))}];
  const report=diagnoseFraming(input,rules);
  expect(report.totalFrames).toBe(1441);expect(report.sampledFrames).toBe(301);
  expect(report.subjects[0].firstOutsideFrame).not.toBeNull();
});
it("projects declared object bounds including rotation, independently of actor estimates", () => {
  const input=scene(), state=useWorkbenchStore.getState();
  // The test needs an actual authored object; use the public add action then restore state.
  state.addPrimitive("cube");
  const added=Object.values(useWorkbenchStore.getState().sceneObjects).find(o=>!state.sceneObjects[o.sceneObjectId])!;
  useWorkbenchStore.setState(state,true);
  const box=structuredClone(added);
  box.transform={position:[0,0,0],rotationDeg:[0,0,45],scale:[1,1,1],groundSnap:false};
  box.boundingBoxM={minimum:[-1,-1,0],maximum:[1,1,2]};box.visible=true;
  input.sceneObjects={[box.sceneObjectId]:box};input.cameras[input.selectedCameraId].subjectTargetIds=[box.sceneObjectId];
  const row=diagnoseFraming(input,rules).subjects[0];
  expect(row.firstOutsideFrame).toBeNull();expect(row.firstSmallFrame).toBeNull();
  expect(row.minHeightPercent!).toBeGreaterThan(17);
});
