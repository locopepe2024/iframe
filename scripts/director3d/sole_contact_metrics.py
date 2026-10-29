"""Geometry-only diagnostics; proximity does not establish a support phase."""

import math


def summarize_sole(samples, fps):
    if isinstance(fps, bool) or not math.isfinite(fps) or fps <= 0:
        raise ValueError("invalid evaluation FPS")
    if not samples:
        raise ValueError("empty sole samples")
    count = len(samples[0]["points"])
    if not count:
        raise ValueError("empty sole region")
    frames = []
    speeds = []
    previous = None
    for sample in samples:
        points = sample["points"]
        frame = sample["frame"]
        if (not isinstance(frame, int) or isinstance(frame, bool)
                or len(points) != count
                or any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in points)):
            raise ValueError("invalid or inconsistent sole sample")
        if previous and frame != previous["frame"]+1:
            raise ValueError("sole samples must be consecutive")
        near = [i for i, p in enumerate(points) if -0.01 <= p[2] <= 0.02]
        frames.append({"frame": frame, "minZM": min(p[2] for p in points),
                       "maxZM": max(p[2] for p in points), "nearGroundVertices": len(near),
                       "penetratingVertices": sum(p[2] < -0.01 for p in points)})
        if previous:
            for i in near:
                old = previous["points"][i]
                if -0.01 <= old[2] <= 0.02:
                    speeds.append(math.hypot(points[i][0]-old[0], points[i][1]-old[1])*fps)
        previous = sample
    seam = max(math.dist(a, b) for a, b in zip(samples[0]["points"], samples[-1]["points"]))
    return {"status": "diagnostic_only", "groundZM": 0, "nearGroundBandM": [-0.01, 0.02],
            "evaluationFPS": fps, "vertexCount": count, "frames": frames,
            "minZM": min(f["minZM"] for f in frames),
            "maxZM": max(f["maxZM"] for f in frames),
            "penetratingFrames": sum(f["penetratingVertices"] > 0 for f in frames),
            "nearGroundFrames": sum(f["nearGroundVertices"] > 0 for f in frames),
            "adjacentNearGroundVertexSpeedSamples": len(speeds),
            "maxAdjacentNearGroundVertexSpeedMps": max(speeds) if speeds else None,
            "endpointMaxVertexDisplacementM": seam,
            "rootRouteCompensation": "none", "supportPhase": "unclassified"}
