"""Read-only SimpleVO trajectory diagnostic with an explicit watermark toggle."""

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pycolmap

from hmr4d.utils.preproc.relpose.matcher_wrapper import Matcher
from hmr4d.utils.preproc.relpose.solver_two_view import CameraParams, TwoPairSolver
from hmr4d.utils.preproc.relpose.utils import focal_length_from_mm
from hmr4d.utils.video_io_utils import read_video_np


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rotation_deg(rotation):
    cosine = np.clip((np.trace(rotation) - 1.0) / 2.0, -1.0, 1.0)
    return math.degrees(math.acos(cosine))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--scale", required=True, type=float)
    parser.add_argument("--step", required=True, type=int)
    parser.add_argument("--disable-watermark-check", action="store_true")
    args = parser.parse_args()
    if not 0 < args.scale <= 1 or args.step < 1:
        parser.error("scale must be in (0,1] and step must be positive")

    decoded = read_video_np(str(args.video), scale=args.scale)
    source_count = len(decoded)
    selected = np.arange(0, source_count, args.step)
    if selected[-1] != source_count - 1:
        selected = np.append(selected, source_count - 1)
    frames = decoded[selected]
    height, width = frames.shape[1:3]
    matcher = Matcher("sift")
    solver = TwoPairSolver(
        CameraParams(width, height, focal_length=focal_length_from_mm(width, height, 24)),
        solver="pycolmap",
    )
    solver.solver.options.detect_watermark = not args.disable_watermark_check
    config_names = {
        item.value: name
        for name, item in pycolmap.TwoViewGeometryConfiguration.__members__.items()
    }

    transforms = [np.eye(4)]
    pairs = []
    for index in range(1, len(frames)):
        record = {"frames": [int(selected[index - 1]), int(selected[index])]}
        try:
            pts0, pts1 = matcher.match_np(frames[index - 1], frames[index])
            record["matches"] = len(pts0)
            match_ids = np.arange(len(pts0))
            answer = pycolmap.estimate_calibrated_two_view_geometry(
                solver.solver.camera,
                pts0.astype(np.float64),
                solver.solver.camera,
                pts1.astype(np.float64),
                matches=np.stack([match_ids, match_ids], axis=-1),
                options=solver.solver.options,
            )
            record["configuration"] = config_names.get(int(answer.config), str(answer.config))
            if answer.cam2_from_cam1 is None:
                raise ValueError("no_relative_pose")
            delta = np.eye(4)
            delta[:3] = answer.cam2_from_cam1.matrix().astype(np.float32)
            transforms.append(delta @ transforms[-1])
            record["rotation_step_deg"] = rotation_deg(delta[:3, :3])
        except (ValueError, RuntimeError, AttributeError) as error:
            record["failure"] = f"{type(error).__name__}: {error}"
            pairs.append(record)
            break
        pairs.append(record)

    rotations = np.asarray([item["rotation_step_deg"] for item in pairs if "rotation_step_deg" in item])
    result = {
        "schema": "gvhmr-simplevo-trajectory-probe.v1",
        "source_sha256": sha256(args.video),
        "source_frames": source_count,
        "scale": args.scale,
        "step": args.step,
        "sampled_frames": selected.tolist(),
        "watermark_check_enabled": not args.disable_watermark_check,
        "status": "completed" if len(transforms) == len(selected) else "failed",
        "pairs": pairs,
        "rotation_step_deg": {
            "max": float(rotations.max()) if len(rotations) else None,
            "median": float(np.median(rotations)) if len(rotations) else None,
            "sum": float(rotations.sum()) if len(rotations) else None,
        },
        "end_rotation_from_start_deg": (
            rotation_deg(transforms[-1][:3, :3]) if len(transforms) == len(selected) else None
        ),
        "note": "Pairwise translation scale is not metric. Completed means only that every sampled pair returned a pose; it does not validate a camera trajectory.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in (
        "source_sha256", "scale", "step", "watermark_check_enabled",
        "status", "rotation_step_deg", "end_rotation_from_start_deg",
    )}))


if __name__ == "__main__":
    main()
