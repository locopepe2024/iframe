import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from "three";
import { deformFacePositions } from "./whiteFaceDeformation";
import { effectiveFaceShape, type FaceShape } from "./whiteFaceShape";

export type WhiteFaceMeshData = {
    schema: "makehuman-head.v1";
    sourceVertexIds: number[];
    positions: number[];
    indices: number[];
};

export function faceShellGeometry(shape: FaceShape, data: WhiteFaceMeshData): BufferGeometry {
    if (data.schema !== "makehuman-head.v1" || data.positions.length !== data.sourceVertexIds.length * 3 || data.indices.length % 3) {
        throw new Error("Invalid white face mesh");
    }
    const positions = deformFacePositions(data.positions, effectiveFaceShape(shape));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(new Uint16BufferAttribute(data.indices, 1));
    geometry.computeVertexNormals();
    return geometry;
}
