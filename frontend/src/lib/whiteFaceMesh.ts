import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from "three";
import { effectiveFaceShape, type FaceShape } from "./whiteFaceShape";

export type WhiteFaceMeshData = {
    schema: "makehuman-head.v1";
    sourceVertexIds: number[];
    positions: number[];
    indices: number[];
};

const bell = (value: number, center: number, spread: number) => Math.exp(-0.5 * ((value - center) / spread) ** 2);

export function faceShellGeometry(shape: FaceShape, data: WhiteFaceMeshData): BufferGeometry {
    if (data.schema !== "makehuman-head.v1" || data.positions.length !== data.sourceVertexIds.length * 3 || data.indices.length % 3) {
        throw new Error("Invalid white face mesh");
    }
    const value = effectiveFaceShape(shape);
    const change = (key: Exclude<keyof FaceShape, "basePreset" | "calibration">) => (value[key] - 100) / 25;
    const positions = new Float32Array(data.positions.length);
    for (let i = 0; i < positions.length; i += 3) {
        const x = data.positions[i], y = data.positions[i + 1], z = data.positions[i + 2];
        const front = Math.max(0, Math.min(1, (z + 0.05) / 0.55));
        const noseBridge = bell(x, 0, 0.14) * bell(y, -0.12, 0.19) * front;
        const noseTip = bell(x, 0, 0.16) * bell(y, -0.28, 0.13) * front;
        const nostril = bell(x, 0, 0.2) * bell(y, -0.41, 0.1) * front;
        const eye = bell(Math.abs(x), 0.28, 0.14) * bell(y, -0.02, 0.14) * front;
        const brow = bell(Math.abs(x), 0.3, 0.19) * bell(y, 0.15, 0.1) * front;
        const mouth = bell(x, 0, 0.29) * bell(y, -0.55, 0.1) * front;
        const upperLip = mouth * bell(y, -0.52, 0.045);
        const lowerLip = mouth * bell(y, -0.59, 0.045);
        // Fixed source-space regions: height changes stay attached to the same anatomy.
        const contourFront = Math.max(0, Math.min(1, (z + 0.05) / 0.25));
        const cheekHeight = bell(Math.abs(x), 0.55, 0.18) * bell(y, -0.13, 0.2) * bell(z, 0.3, 0.22) * contourFront;
        const jawHeight = bell(Math.abs(x), 0.43, 0.17) * bell(y, -0.58, 0.18) * bell(z, 0.33, 0.23) * contourFront;

        positions[i] = x * (1 + 0.11 * change("faceWidth")
            + 0.1 * change("foreheadWidth") * bell(y, 0.47, 0.3)
            + 0.1 * change("cheekWidth") * bell(y, -0.2, 0.2)
            + 0.12 * change("jawWidth") * bell(y, -0.56, 0.2)
            + 0.12 * change("chinWidth") * bell(y, -0.73, 0.12)
            + 0.34 * change("noseBridgeWidth") * noseBridge
            + 0.2 * change("noseTipWidth") * noseTip
            + 0.17 * change("nostrilWidth") * nostril
            + 0.1 * change("mouthWidth") * mouth)
            + Math.sign(x) * 0.035 * change("eyeSpacing") * eye;
        positions[i + 1] = y * (1 + 0.1 * change("faceLength"))
            + 0.025 * change("eyeSize") * eye * Math.sign(y + 0.02)
            + 0.025 * change("eyeTilt") * eye * Math.sign(x) * (Math.abs(x) - 0.28)
            + 0.035 * change("browEyeDistance") * brow
            + 0.025 * change("upperLipThickness") * upperLip
            - 0.025 * change("lowerLipThickness") * lowerLip
            - 0.035 * change("philtrumLength") * mouth
            + 0.03 * change("mouthCornerTilt") * mouth * bell(Math.abs(x), 0.25, 0.08)
            + 0.14 * change("cheekHeight") * cheekHeight
            + 0.12 * change("jawHeight") * jawHeight
            + 0.1 * change("noseTipHeight") * noseTip;
        positions[i + 2] = z
            + 0.09 * change("chinProjection") * bell(x, 0, 0.24) * bell(y, -0.74, 0.13) * front
            + 0.18 * change("noseBridgeHeight") * noseBridge
            + 0.12 * change("noseProjection") * noseTip
            - 0.045 * change("eyeDepth") * eye;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new Uint16BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    return geometry;
}
