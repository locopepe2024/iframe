import { readFileSync, writeFileSync } from "node:fs";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error("Usage: node scripts/build_makehuman_face.mjs <base.obj> <head.json>");
}

const sourceVertices = [];
const faces = [];
let inBody = false;

for (const line of readFileSync(sourcePath, "utf8").split(/\r?\n/)) {
  if (line.startsWith("v ")) {
    sourceVertices.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
  } else if (line.startsWith("g ")) {
    inBody = line.trim() === "g body";
  } else if (inBody && line.startsWith("f ")) {
    const face = line.trim().split(/\s+/).slice(1).map((part) => Number(part.split("/")[0]) - 1);
    if (face.every((index) => sourceVertices[index]?.[1] >= 6.2)) faces.push(face);
  }
}

const sourceVertexIds = [...new Set(faces.flat())].sort((a, b) => a - b);
const localIds = new Map(sourceVertexIds.map((id, local) => [id, local]));
const positions = sourceVertexIds.flatMap((id) => {
  const [x, y, z] = sourceVertices[id];
  return [x * 0.8, (y - 7.25) * 0.8, (z - 0.5) * 0.8];
});
const indices = faces.flatMap((face) => {
  const triangles = [];
  for (let i = 1; i < face.length - 1; i += 1) {
    triangles.push(localIds.get(face[0]), localIds.get(face[i]), localIds.get(face[i + 1]));
  }
  return triangles;
});

if (sourceVertexIds.length < 1000 || indices.length < 3000 || positions.some((value) => !Number.isFinite(value))) {
  throw new Error("Invalid MakeHuman head extraction");
}
writeFileSync(outputPath, JSON.stringify({ schema: "makehuman-head.v1", sourceVertexIds, positions, indices }));
process.stdout.write(`Head mesh: ${sourceVertexIds.length} vertices, ${indices.length / 3} triangles\n`);
