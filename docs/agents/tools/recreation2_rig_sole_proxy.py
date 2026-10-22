#!/usr/bin/env python3
"""Read-only GLB rig/foot-mesh inspection for recreation2.

This tool does not evaluate animation or modify any production asset.  It
reports rest node transforms, skin inverse-bind metadata, and conservative
foot-chain mesh candidates.  Coordinates remain in the GLB's local units;
axis semantics are deliberately not inferred here.
"""
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np


COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4,
              "MAT3": 9, "MAT4": 16}
DTYPES = {5121: ("u1", 1), 5123: ("u2", 2), 5125: ("u4", 4), 5126: ("f4", 4)}
FOOT_NAMES = ("ankle", "foot", "DEF_foot", "toe", "toe_attachment")


def load_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError("not a GLB")
    pos = 12
    doc = None
    blob = b""
    while pos < len(data):
        length, kind = struct.unpack_from("<II", data, pos)
        chunk = data[pos + 8:pos + 8 + length]
        pos += 8 + length
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
    if doc is None:
        raise ValueError("missing JSON chunk")
    return doc, blob


def accessor(doc, blob, index):
    a = doc["accessors"][index]
    bv = doc["bufferViews"][a["bufferView"]]
    dtype, item_size = DTYPES[a["componentType"]]
    width = COMPONENTS[a["type"]]
    stride = bv.get("byteStride", width * item_size)
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    rows = []
    for i in range(a["count"]):
        rows.append(np.frombuffer(blob, dtype=dtype, count=width,
                                  offset=start + i * stride))
    return np.stack(rows)


def local_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape(4, 4, order="F")
    t = np.array(node.get("translation", [0, 0, 0]), dtype=float)
    q = np.array(node.get("rotation", [0, 0, 0, 1]), dtype=float)
    s = np.array(node.get("scale", [1, 1, 1]), dtype=float)
    x, y, z, w = q
    r = np.array([
        [1 - 2*y*y - 2*z*z, 2*x*y - 2*z*w, 2*x*z + 2*y*w],
        [2*x*y + 2*z*w, 1 - 2*x*x - 2*z*z, 2*y*z - 2*x*w],
        [2*x*z - 2*y*w, 2*y*z + 2*x*w, 1 - 2*x*x - 2*y*y],
    ])
    m = np.eye(4)
    m[:3, :3] = r @ np.diag(s)
    m[:3, 3] = t
    return m


def node_worlds(doc):
    nodes = doc.get("nodes", [])
    parents = [None] * len(nodes)
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parents[c] = i
    cache = {}
    def world(i):
        if i in cache:
            return cache[i]
        p = parents[i]
        cache[i] = local_matrix(nodes[i]) if p is None else world(p) @ local_matrix(nodes[i])
        return cache[i]
    return [world(i) for i in range(len(nodes))], parents


def vec(v):
    return [float(x) for x in np.asarray(v).ravel()]


def side_report(doc, blob, skin, joint_index, side):
    names = [doc["nodes"][j].get("name") for j in skin["joints"]]
    chain = [i for i, n in enumerate(names)
             if n and n.endswith("_" + side) and any(n.startswith(x) for x in FOOT_NAMES)]
    chain_names = [names[i] for i in chain]
    mesh_rows = []
    all_points = []
    weighted_points = []
    for mi, mesh in enumerate(doc.get("meshes", [])):
        for pi, prim in enumerate(mesh.get("primitives", [])):
            attrs = prim.get("attributes", {})
            if not {"POSITION", "JOINTS_0", "WEIGHTS_0"}.issubset(attrs):
                continue
            p = accessor(doc, blob, attrs["POSITION"]).astype(float)
            j = accessor(doc, blob, attrs["JOINTS_0"]).astype(int)
            w = accessor(doc, blob, attrs["WEIGHTS_0"]).astype(float)
            influence = np.where(np.isin(j, chain), w, 0.0).sum(axis=1)
            positive = influence > 1e-6
            max_joint = j[np.arange(len(j)), np.argmax(w, axis=1)]
            max_chain = np.isin(max_joint, chain)
            if positive.any():
                pts = p[positive]
                all_points.append(pts)
                weighted_points.append(p[influence >= 0.5])
                min_i = int(np.argmin(pts[:, 1]))
                row = {
                    "mesh": mi, "primitive": pi,
                    "vertices_any_chain_weight": int(positive.sum()),
                    "vertices_chain_weight_ge_0p5": int((influence >= 0.5).sum()),
                    "vertices_max_joint_in_chain": int(max_chain.sum()),
                    "bounds_any_chain_weight": {"min": vec(pts.min(0)), "max": vec(pts.max(0))},
                    "lowest_y_candidate": vec(pts[min_i]),
                    "percentiles_y": {str(q): float(np.percentile(pts[:, 1], q)) for q in [0, 1, 5, 50, 95, 99, 100]},
                }
                mesh_rows.append(row)
    points = np.concatenate(all_points) if all_points else np.empty((0, 3))
    weighted = np.concatenate(weighted_points) if weighted_points else np.empty((0, 3))
    return {
        "side": side, "chain_joint_indices": chain, "chain_joint_names": chain_names,
        "mesh_candidates": mesh_rows,
        "all_chain_weight_bounds": ({"min": vec(points.min(0)), "max": vec(points.max(0))}
                                     if len(points) else None),
        "weight_ge_0p5_bounds": ({"min": vec(weighted.min(0)), "max": vec(weighted.max(0))}
                                  if len(weighted) else None),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    doc, blob = load_glb(args.glb)
    worlds, parents = node_worlds(doc)
    skin = doc["skins"][0]
    joints = skin["joints"]
    ibm = accessor(doc, blob, skin["inverseBindMatrices"]) if "inverseBindMatrices" in skin else None
    selected = []
    for ji, ni in enumerate(joints):
        name = doc["nodes"][ni].get("name", "")
        if name in {"ankle_l", "foot_l", "DEF_foot_l", "toe_l", "toe_attachment_l",
                    "ankle_r", "foot_r", "DEF_foot_r", "toe_r", "toe_attachment_r"}:
            m = worlds[ni]
            selected.append({
                "skin_joint_index": ji, "node_index": ni, "name": name,
                "parent_node_index": parents[ni],
                "local_translation": vec(doc["nodes"][ni].get("translation", [0, 0, 0])),
                "local_matrix": np.asarray(local_matrix(doc["nodes"][ni])).round(10).tolist(),
                "rest_world_translation": vec(m[:3, 3]),
                "inverse_bind_matrix": (np.asarray(ibm[ji]).reshape(4, 4).round(10).tolist()
                                         if ibm is not None else None),
            })
    result = {
        "schema": "recreation2-rig-sole-proxy-v1",
        "glb": str(args.glb), "nodes": len(doc.get("nodes", [])),
        "meshes": len(doc.get("meshes", [])), "skin_joints": len(joints),
        "coordinate_note": "Values are GLB/rest local units; axis meaning and shoe material semantics are not inferred.",
        "foot_chain_nodes": selected,
        "sides": {s: side_report(doc, blob, skin, joints, s) for s in ("l", "r")},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"out": str(args.out), "nodes": result["nodes"], "skin_joints": result["skin_joints"]}))


if __name__ == "__main__":
    main()
