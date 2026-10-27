import { BoxGeometry, Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CharacterAuthoringState } from "../state/workbench-store";
import type { SceneObjectAuthoringState } from "../types";
type Vec = [number, number, number];
let runtime: {core: typeof import("recast-navigation"); generators: typeof import("recast-navigation/generators")} | null = null;
let loading: Promise<void> | null = null;
export function initializeNavigation(): Promise<void> {
  return loading ??= (async () => {
    const [core, generators] = await Promise.all([import("recast-navigation"), import("recast-navigation/generators")]);
    await core.init(); runtime = {core, generators};
  })().catch((error) => {loading = null; throw error;});
}
/** Flat-ground proxy navmesh, Z-up -> right-handed Y-up (x,z,-y). */
export function navmeshRoute(from: Vec, to: Vec, objects: Record<string, SceneObjectAuthoringState>, stationary: CharacterAuthoringState[]): Vec[] {
  if (!runtime) throw new Error("导航网格尚未初始化，请重新预览。");
  const positions: number[] = [], indices: number[] = [];
  const ground = from[2];
  if (Math.abs(to[2]-ground) > .001) throw new Error("导航网格首版仅支持同高地面。");
  const bounds = [Math.min(from[0],to[0])-4, Math.min(from[1],to[1])-4, Math.max(from[0],to[0])+4, Math.max(from[1],to[1])+4];
  // Bounds include relevant proxy geometry; cap rasterization cost before allocating WASM.
  const obstacles = Object.values(objects).filter((o) => o.visible && o.objectKind !== "empty");
  const append = (geometry: BoxGeometry, matrix: Matrix4) => {
    geometry.applyMatrix4(matrix);
    const vertices = geometry.getAttribute("position"), offset = positions.length/3;
    for (let i=0;i<vertices.count;i++) {
      const x=vertices.getX(i), y=vertices.getY(i), z=vertices.getZ(i);
      if (![x,y,z].every(Number.isFinite)) { geometry.dispose(); throw new Error("导航几何坐标无效。"); }
      positions.push(x,z,-y);
    }
    const idx = geometry.index!; for (let i=0;i<idx.count;i++) indices.push(offset+idx.getX(i));
    geometry.dispose();
  };
  for (const o of obstacles) {
    if (o.primitiveKind !== "cube" || o.transform.rotationDeg.slice(0,2).some((v)=>v!==0) || o.transform.scale.some((v)=>v<=0)) throw new Error("导航网格目前支持绕 Z 轴旋转及缩放的方盒代理；其他模型请先配置代理。");
    const min=o.boundingBoxM.minimum, max=o.boundingBoxM.maximum;
    const dimensions=max.map((v,i)=>v-min[i]) as Vec;
    const center=min.map((v,i)=>(v+max[i])/2) as Vec;
    const matrix=new Matrix4().compose(new Vector3(...o.transform.position),new Quaternion().setFromEuler(new Euler(0,0,o.transform.rotationDeg[2]*Math.PI/180)),new Vector3(...o.transform.scale));
    const worldCenter=new Vector3(...center).applyMatrix4(matrix);
    const radius=Math.hypot(dimensions[0]*o.transform.scale[0],dimensions[1]*o.transform.scale[1])/2;
    bounds[0]=Math.min(bounds[0],worldCenter.x-radius-1); bounds[1]=Math.min(bounds[1],worldCenter.y-radius-1);
    bounds[2]=Math.max(bounds[2],worldCenter.x+radius+1); bounds[3]=Math.max(bounds[3],worldCenter.y+radius+1);
    append(new BoxGeometry(...dimensions),matrix.clone().multiply(new Matrix4().makeTranslation(...center)));
  }
  for (const actor of stationary) {
    const p=actor.transform.position;
    append(new BoxGeometry(.64,.64,1.8),new Matrix4().makeTranslation(p[0],p[1],p[2]+.9));
  }
  if (bounds.some((v)=>Math.abs(v)>100) || (bounds[2]-bounds[0])*(bounds[3]-bounds[1])>3600 || obstacles.length>100) throw new Error("导航网格范围或障碍数量超限，请缩小街区。");
  const offset=positions.length/3;
  positions.push(bounds[0],ground,-bounds[1], bounds[2],ground,-bounds[1], bounds[2],ground,-bounds[3], bounds[0],ground,-bounds[3]);
  indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  const built=runtime.generators.generateSoloNavMesh(positions,indices,{cs:.1,ch:.05,walkableHeight:36,walkableClimb:0,walkableRadius:4,walkableSlopeAngle:30,minRegionArea:0,mergeRegionArea:0,maxSimplificationError:.5});
  runtime.core.Raw.destroy(built.intermediates.buildContext.raw);
  if (!built.success) throw new Error(`导航网格构建失败：${built.error}`);
  const query=new runtime.core.NavMeshQuery(built.navMesh);
  try {
    const convert=(p:Vec)=>({x:p[0],y:p[2],z:-p[1]});
    const start=convert(from), end=convert(to), halfExtents={x:.15,y:.2,z:.15};
    for (const point of [start,end]) {
      const nearest=query.findClosestPoint(point,{halfExtents});
      if (!nearest.success || !nearest.isPointOverPoly || Math.abs(nearest.point.y-point.y)>.11) throw new Error("导航起点或目标被占据或不在可行走区域。");
    }
    const result=query.computePath(start,end,{halfExtents,maxPathPolys:2048,maxStraightPathPoints:512});
    if (!result.success || result.path.length<2) throw new Error("导航目标不可达，请检查门口和通道。");
    const last=result.path.at(-1)!;
    if (Math.hypot(last.x-end.x,last.z-end.z)>.05) throw new Error("导航目标不可达，拒绝使用部分路径。");
    return result.path.map((point,i)=>i===0 ? [...from] : i===result.path.length-1 ? [...to] : [point.x, -point.z, ground]) as Vec[];
  } finally {query.destroy(); built.navMesh.destroy();}
}
