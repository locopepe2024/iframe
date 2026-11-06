import { expect, it } from "vitest";
import { sideFaceGuideControls, sideGuideMeasurements, sideFaceGuidePrompt } from "../lib/sideFaceGeometryGuide";
import { DEFAULT_FACE_SHAPE, faceShapeMeasurements } from "../lib/whiteFaceShape";
import { warpFacePixels } from "../lib/faceGeometryGuide";
import { trackGuidePixels } from "../lib/faceGuidePixelCheck";

export function sideFace() {
    const f = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
    const p: Record<number, [number, number]> = {
        33: [.47,.32],133:[.48,.32],362:[.5,.32],263:[.58,.32],386:[.54,.30],374:[.54,.34],
        168:[.43,.33],6:[.40,.37],197:[.38,.41],195:[.36,.44],5:[.34,.47],4:[.32,.49],1:[.30,.51],2:[.37,.54],
        0:[.39,.59],13:[.38,.61],14:[.38,.63],17:[.40,.65],18:[.42,.68],200:[.40,.72],199:[.39,.75],175:[.42,.78],152:[.46,.8],
    };
    for (const [id,[x,y]] of Object.entries(p)) f[+id]={x,y}; return f;
}
it("transfers measured profile changes in original units while preserving eyes and lips", () => {
    const shape = { ...DEFAULT_FACE_SHAPE, noseBridgeHeight:110,noseProjection:110,noseTipHeight:105,chinProjection:110 };
    const c = sideFaceGuideControls(sideFace(),shape,500,600), before = sideGuideMeasurements(c), after = sideGuideMeasurements(c,c.target);
    const m = Object.fromEntries(faceShapeMeasurements(shape).map(v=>[v.key,v.target]));
    expect(after.noseBridgeHeight/before.noseBridgeHeight*100).toBeCloseTo(m.noseBridgeHeight);
    expect(after.noseProjection/before.noseProjection*100).toBeCloseTo(m.noseProjection);
    expect((after.noseTipHeight-before.noseTipHeight)/before.length*100).toBeCloseTo(m.noseTipHeight);
    expect((after.chinProjection-before.chinProjection)/before.length*100).toBeCloseTo(m.chinProjection);
    for(const id of [-1,362,263,386,374,0,13,14,17])expect(c.target[c.indices.indexOf(id)]).toEqual(c.source[c.indices.indexOf(id)]);
    const mirrored=sideFaceGuideControls(sideFace().map(p=>({...p,x:1-p.x})),shape,500,600);
    c.target.slice(0,c.indices.length).forEach((p,i)=>{expect(mirrored.target[i].x).toBeCloseTo(500-p.x);expect(mirrored.target[i].y).toBeCloseTo(p.y)});
});
it("uses saved manual marks and rejects missing, clipped or degenerate profile inputs", () => {
    const points={sideEye:{x:.53,y:.32},sideNose:{x:.29,y:.51},sideChin:{x:.38,y:.75}};
    const c=sideFaceGuideControls(sideFace(),DEFAULT_FACE_SHAPE,500,600,points);
    expect(c.source[0]).toEqual({x:265,y:192});expect(c.source[c.indices.indexOf(1)].x).toBe(145);
    expect(()=>sideFaceGuideControls(sideFace(),DEFAULT_FACE_SHAPE,500,600,{})).toThrow(/已保存/);
    const clipped=sideFace();clipped[1].x=0;expect(()=>sideFaceGuideControls(clipped,DEFAULT_FACE_SHAPE,500,600)).toThrow(/超出原图/);
    const degenerate=sideFace();degenerate[197]=degenerate[168];expect(()=>sideFaceGuideControls(degenerate,DEFAULT_FACE_SHAPE,500,600)).toThrow(/顺序/);
});
it("verifies actual warped texture and rejects unchanged output with a changed nose", () => {
    const width=600,height=700,c=sideFaceGuideControls(sideFace(),{...DEFAULT_FACE_SHAPE,noseProjection:110},width,height);
    const pixels=Uint8ClampedArray.from({length:width*height*4},(_,i)=>{const x=Math.floor(i/4)%width,y=Math.floor(i/4/width);return i%4===3?255:125+45*Math.sin(x*.31)+40*Math.cos(y*.27)+20*Math.sin((x+y)*.41)});
    const output=warpFacePixels(pixels,width,height,c,true);
    expect(output).not.toEqual(pixels);expect(output.slice(0,width*4)).toEqual(pixels.slice(0,width*4));
    expect(trackGuidePixels(pixels,output,width,height,c,[1],true).get(1)?.reliable).toBe(true);
    expect(trackGuidePixels(pixels,pixels,width,height,c,[1],true).get(1)?.reliable).toBe(false);
    expect(trackGuidePixels(pixels,new Uint8ClampedArray(pixels.length).fill(125),width,height,c,[1],true).get(1)?.reliable).toBe(false);
    expect(sideFaceGuidePrompt("苏砚")).toContain("90°侧脸");expect(sideFaceGuidePrompt("苏砚")).not.toContain("骨相测量目标：");
});
