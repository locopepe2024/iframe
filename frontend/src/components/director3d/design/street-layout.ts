import type { SceneObjectAuthoringState } from "../types";
type Vec = [number, number, number];
export interface StreetLayout {
  kind: "street_layout"; layoutId: string; centerM: Vec; widthM: number; lengthM: number;
  buildings: Array<{id: string; label: string; centerM: Vec; dimensionsM: Vec; doorWidthM: number; frontSide: "negative_y" | "positive_y"}>;
  trees: Array<{id: string; positionM: Vec; heightM: number; trunkWidthM: number}>;
}
export function compileStreetLayout(op: StreetLayout, ground: number): SceneObjectAuthoringState[] {
  const output: SceneObjectAuthoringState[] = [];
  const box = (id: string, label: string, position: Vec, dimensionsM: Vec, color: string) => {
    const [w,d,h] = dimensionsM;
    output.push({sceneObjectId: `${op.layoutId}-${id}`, revision: 1, label: `${label}（街区白模）`, objectKind: "primitive", primitiveKind: "cube", proxyRepresentationType: null, proxyAssetId: null, modelAssetId: null, inputId: null,
      transform: {position, rotationDeg: [0,0,0], scale: [1,1,1], groundSnap: false}, dimensionsM, pivotM: [0,0,-h/2], boundingBoxM: {minimum: [-w/2,-d/2,0], maximum: [w/2,d/2,h]}, scaleBasis: "declared_dimension", materialHint: {color, roughness: .9}, visible: true, locked: false, browserCapabilityState: "available", compilerCapabilityState: "available", capabilityIds: [], limitations: ["参数化空间参考；不代表真实建筑测量或最终场景资产。"], calibratedPlacement: null});
  };
  if (Math.abs(op.centerM[2] - ground) > .001) throw new Error("街区必须位于当前地面。");
  const footprints = [{center: op.centerM, size: [op.widthM, op.lengthM] }];
  box("road", "长街", [op.centerM[0],op.centerM[1],ground-.1], [op.widthM,op.lengthM,.1], "#475569");
  for (const b of op.buildings) {
    if (Math.abs(b.centerM[2]-ground) > .001) throw new Error("建筑必须位于当前地面。");
    const [w,d,h] = b.dimensionsM, [x,y,z] = b.centerM, thickness = .15;
    if (b.doorWidthM > w-.6) throw new Error("门宽超出建筑开间。");
    if (footprints.some((f) => Math.abs(x-f.center[0]) < (w+f.size[0])/2 && Math.abs(y-f.center[1]) < (d+f.size[1])/2)) throw new Error("建筑占地与道路或其他建筑重叠。");
    footprints.push({center: b.centerM, size: [w,d]});
    const front = b.frontSide === "negative_y" ? -1 : 1;
    const pier = (w-b.doorWidthM)/2, doorHeight = Math.min(2.2,h-.2);
    box(`${b.id}-floor`, `${b.label}地面`, [x,y,z-.1], [w,d,.1], "#64748b");
    box(`${b.id}-back`, `${b.label}后墙`, [x,y-front*(d/2-thickness/2),z], [w,thickness,h], "#94a3b8");
    for (const side of [-1,1]) {
      box(`${b.id}-side-${side}`, `${b.label}侧墙`, [x+side*(w/2-thickness/2),y,z], [thickness,d,h], "#94a3b8");
      box(`${b.id}-pier-${side}`, `${b.label}门侧`, [x+side*(b.doorWidthM/2+pier/2),y+front*(d/2-thickness/2),z], [pier,thickness,h], "#94a3b8");
    }
    box(`${b.id}-lintel`, `${b.label}门楣`, [x,y+front*(d/2-thickness/2),z+doorHeight], [b.doorWidthM,thickness,h-doorHeight], "#94a3b8");
  }
  for (const tree of op.trees) {
    if (Math.abs(tree.positionM[2]-ground) > .001) throw new Error("树位必须位于地面。");
    if (op.buildings.some((b) => Math.abs(tree.positionM[0]-b.centerM[0]) < (b.dimensionsM[0]+tree.trunkWidthM)/2 && Math.abs(tree.positionM[1]-b.centerM[1]) < (b.dimensionsM[1]+tree.trunkWidthM)/2)) throw new Error("树位与建筑占地重叠。");
    box(`${tree.id}-trunk`, "街角树干", tree.positionM, [tree.trunkWidthM,tree.trunkWidthM,tree.heightM], "#78604b");
    box(`${tree.id}-crown`, "树冠参考", [tree.positionM[0],tree.positionM[1],ground+Math.max(2.3,tree.heightM*.7)], [2.5,2.5,1.5], "#426650");
  }
  return output;
}
