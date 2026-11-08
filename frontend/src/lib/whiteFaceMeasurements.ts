import anchors from "./whiteFaceMeasurementAnchors.json";
import { deformFacePositions } from "./whiteFaceDeformation";
import type { FaceShapeNumbers } from "./whiteFaceShape";

type Point = { x: number; y: number; z: number };
type Points = Record<keyof typeof anchors.groups, Point>;
type Definition = {
    key: string; label: string; view: "正面" | "侧面"; definition: string;
    unit?: "angle" | "position"; read: (p: Points) => number;
};
export type FaceMeasurement = Omit<Definition, "read"> & {
    baseline: number; target: number; baselineMeshValue: number; targetMeshValue: number;
};

const eyeY = (p: Points) => (p.leftEye.y + p.rightEye.y) / 2;
const eyeZ = (p: Points) => (p.leftEye.z + p.rightEye.z) / 2;
const faceLength = (p: Points) => eyeY(p) - p.chinBottom.y;
const tilt = (inner: Point, outer: Point) => Math.atan2(outer.y - inner.y, Math.abs(outer.x - inner.x)) * 180 / Math.PI;

// Fixed anatomical intervals. In particular, eye-line-to-chin is not a hairline measurement.
const DEFINITIONS: Definition[] = [
    { key: "faceLength", label: "面部长度（眼线至下巴）", view: "正面", definition: "两眼中心连线到下巴最低点的垂直距离", read: faceLength },
    { key: "faceWidth", label: "面部宽度", view: "正面", definition: "左右太阳穴外缘之间的水平距离", read: p => p.rightTemple.x - p.leftTemple.x },
    { key: "foreheadWidth", label: "额头宽度", view: "正面", definition: "额头中部左右外缘之间的水平距离", read: p => p.rightForehead.x - p.leftForehead.x },
    { key: "cheekWidth", label: "颧部宽度", view: "正面", definition: "左右颧骨最外侧之间的水平距离", read: p => p.rightCheek.x - p.leftCheek.x },
    { key: "cheekHeight", label: "颧部位置", view: "正面", definition: "左右颧骨外侧点平均高度相对眼线的垂直位置，向下为正", unit: "position", read: p => eyeY(p) - (p.leftCheek.y + p.rightCheek.y) / 2 },
    { key: "jawWidth", label: "下颌宽度", view: "正面", definition: "左右下颌角之间的水平距离", read: p => p.rightJaw.x - p.leftJaw.x },
    { key: "jawHeight", label: "下颌位置", view: "正面", definition: "左右下颌角平均高度相对眼线的垂直位置，向下为正", unit: "position", read: p => eyeY(p) - (p.leftJaw.y + p.rightJaw.y) / 2 },
    { key: "chinWidth", label: "下巴宽度", view: "正面", definition: "下巴下部左右轮廓之间的水平距离", read: p => p.rightChin.x - p.leftChin.x },
    { key: "chinProjection", label: "下巴前突", view: "侧面", definition: "下巴前端相对过眼中心竖直线的水平位置，向鼻尖方向为正", unit: "position", read: p => p.chinFront.z - eyeZ(p) },
    { key: "noseRootHeight", label: "鼻根前突", view: "侧面", definition: "鼻根（山根）前缘相对过眼中心竖直线的水平位置，向鼻尖方向为正", unit: "position", read: p => p.noseRootFront.z - eyeZ(p) },
    { key: "noseBridgeHeight", label: "鼻梁隆起高度", view: "侧面", definition: "鼻梁中段前缘到过眼中心竖直线的水平距离", read: p => p.bridgeFront.z - eyeZ(p) },
    { key: "noseBridgeWidth", label: "鼻梁宽度", view: "正面", definition: "鼻梁中段左右边缘之间的水平距离", read: p => p.rightBridge.x - p.leftBridge.x },
    { key: "noseProjection", label: "鼻尖突出度", view: "侧面", definition: "鼻尖到过眼中心竖直线的水平距离", read: p => p.noseTip.z - eyeZ(p) },
    { key: "noseTipHeight", label: "鼻尖位置", view: "侧面", definition: "鼻尖相对眼中心水平线的垂直位置，向下为正", unit: "position", read: p => eyeY(p) - p.noseTip.y },
    { key: "noseTipWidth", label: "鼻尖宽度", view: "正面", definition: "鼻尖左右边缘之间的水平距离", read: p => p.rightTip.x - p.leftTip.x },
    { key: "nostrilWidth", label: "鼻翼宽度", view: "正面", definition: "左右鼻翼最外缘之间的水平距离", read: p => p.rightNostril.x - p.leftNostril.x },
    { key: "eyeSpacing", label: "眼距", view: "正面", definition: "左右眼中心之间的水平距离", read: p => p.rightEye.x - p.leftEye.x },
    { key: "eyeSize", label: "眼睛睁开高度", view: "正面", definition: "上眼睑到下眼睑的垂直距离，取双眼平均值", read: p => (p.leftEyeUpper.y - p.leftEyeLower.y + p.rightEyeUpper.y - p.rightEyeLower.y) / 2 },
    { key: "eyeDepth", label: "眼窝后缩", view: "侧面", definition: "眼中心相对眉骨前缘的水平后缩位置，向后为正", unit: "position", read: p => (p.leftBrow.z + p.rightBrow.z) / 2 - eyeZ(p) },
    { key: "eyeTiltLeft", label: "画面左眼倾斜", view: "正面", definition: "内外眼角连线相对水平线的角度，外眼角上扬为正", unit: "angle", read: p => tilt(p.leftEyeInner, p.leftEyeOuter) },
    { key: "eyeTiltRight", label: "画面右眼倾斜", view: "正面", definition: "内外眼角连线相对水平线的角度，外眼角上扬为正", unit: "angle", read: p => tilt(p.rightEyeInner, p.rightEyeOuter) },
    { key: "browEyeDistance", label: "眉眼距离", view: "正面", definition: "眉毛中部到眼中心的垂直距离，取双眼平均值", read: p => (p.leftBrow.y + p.rightBrow.y) / 2 - eyeY(p) },
    { key: "mouthWidth", label: "嘴宽", view: "正面", definition: "左右嘴角之间的水平距离", read: p => p.rightMouth.x - p.leftMouth.x },
    { key: "upperLipThickness", label: "上唇厚度", view: "正面", definition: "上唇中央外缘到唇缝中央的垂直距离", read: p => p.lipTop.y - p.lipLine.y },
    { key: "lowerLipThickness", label: "下唇厚度", view: "正面", definition: "唇缝中央到下唇中央外缘的垂直距离", read: p => p.lipLine.y - p.lipBottom.y },
    { key: "philtrumLength", label: "人中长度", view: "正面", definition: "鼻底中央到上唇中央外缘的垂直距离", read: p => p.noseBase.y - p.lipTop.y },
    { key: "mouthCornerTilt", label: "嘴角倾斜", view: "正面", definition: "唇缝中央至嘴角连线相对水平线的角度，嘴角上提为正，取两侧平均值", unit: "angle", read: p => (tilt(p.lipLine, p.leftMouth) + tilt(p.lipLine, p.rightMouth)) / 2 },
];

function points(value: FaceShapeNumbers): Points {
    const positions = deformFacePositions(anchors.positions, value);
    return Object.fromEntries(Object.entries(anchors.groups).map(([name, ids]) => {
        const point = { x: 0, y: 0, z: 0 };
        for (const id of ids) {
            const i = anchors.sourceVertexIds.indexOf(id) * 3;
            point.x += positions[i] / ids.length;
            point.y += positions[i + 1] / ids.length;
            point.z += positions[i + 2] / ids.length;
        }
        return [name, point];
    })) as Points;
}

const rounded = (n: number) => Math.round(n * 100) / 100 || 0;

/** Relative editing targets transferred from measured mesh changes, not photo pixel measurements. */
export function measureFaceTargets(baseline: FaceShapeNumbers, current: FaceShapeNumbers): FaceMeasurement[] {
    const base = points(baseline), next = points(current);
    return DEFINITIONS.map(({ read, ...definition }) => {
        const a = read(base), b = read(next);
        const neutral = definition.unit ? 0 : 100;
        const target = definition.unit === "angle" ? b - a : definition.unit === "position"
            ? (b - a) / faceLength(base) * 100 : b / a * 100;
        if (!Number.isFinite(target)) throw new Error(`面部测量无效：${definition.label}`);
        return { ...definition, baseline: neutral, target: rounded(target), baselineMeshValue: a, targetMeshValue: b };
    });
}

export function faceMeasurementTargetText(item: FaceMeasurement): string {
    const signed = item.target < 0 ? `${item.target}` : `+${item.target}`;
    if (item.unit === "angle") return `参考图原角度为θ₀，目标θ₀${signed}°`;
    if (item.unit === "position") return `参考图原位置为0，眼线至下巴距离为100单位，目标${signed}单位`;
    return `参考图该距离为100，目标${item.target}`;
}
