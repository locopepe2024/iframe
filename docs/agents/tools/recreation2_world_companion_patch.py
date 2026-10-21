"""Hash-pinned minimal instrumentation of the existing MediaPipe extractor."""
import argparse
import hashlib
from pathlib import Path

SOURCE_SHA256 = 'aba3f34ae3824533a8036cf73c3c5fc773dcca5c12d2b73f7c06a922df6e5546'
NL = chr(10)
POSE_LINE = "          pts=[(float(lm.x),float(lm.y),float(lm.z),float(lm.visibility or 0.0)) for lm in pose]"
WORLD_LINE = "          world=[(float(lm.x),float(lm.y),float(lm.z),float(lm.visibility or 0.0)) for lm in result.pose_world_landmarks[pose_idx]]"
REPLACEMENTS = [
    (
        POSE_LINE,
        POSE_LINE + NL +
        "          if pose_idx >= len(result.pose_world_landmarks): raise RuntimeError('world/image pose lists misaligned')" + NL +
        WORLD_LINE + NL +
        "          if len(world) != len(pts): raise RuntimeError('world/image landmark counts misaligned')",
    ),
    (
        "candidates.append({'pose_index':pose_idx,'bbox':bbox,'center':center,'landmarks':pts})",
        "candidates.append({'pose_index':pose_idx,'bbox':bbox,'center':center,'landmarks':pts,'world_landmarks':world})",
    ),
    (
        "'target_landmarks':target['landmarks'] if target else None,",
        "'target_landmarks':target['landmarks'] if target else None,'target_world_landmarks':target['world_landmarks'] if target else None,",
    ),
    (
        "payload={'schema':'motion-track.v1'",
        "payload={'schema':'motion-track-world-companion-diagnostic.v1'",
    ),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--use-source-pts', action='store_true')
    args = ap.parse_args()
    data = Path(args.source).read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != SOURCE_SHA256:
        raise ValueError(f'extractor source hash mismatch: {actual}')
    code = data.decode()
    for old, new in REPLACEMENTS:
        if code.count(old) != 1:
            raise ValueError(f'expected exactly one patch point: {old[:60]!r}')
        code = code.replace(old, new)
    if args.use_source_pts:
        patches = [
            ("import cv2\n", "import cv2\nimport subprocess\n"),
            (
                "fps=cap.get(cv2.CAP_PROP_FPS) or 30.0; width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))",
                "fps=cap.get(cv2.CAP_PROP_FPS) or 30.0; width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); pts_raw=subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',args.video],text=True); source_pts=[float(line.strip().rstrip(',')) for line in pts_raw.splitlines() if line.strip()]",
            ),
            (
                "int((frame_no-1)*1000/fps)",
                "int(round(source_pts[frame_no-1]*1000))",
            ),
            (
                "'timestamp_seconds':(frame_no-1)/fps",
                "'timestamp_seconds':source_pts[frame_no-1]",
            ),
        ]
        for old, new in patches:
            if code.count(old) != 1:
                raise ValueError(f'expected exactly one PTS patch point: {old[:60]!r}')
            code = code.replace(old, new)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(code)
    print('WORLD_COMPANION_PATCH_READY', hashlib.sha256(code.encode()).hexdigest())


if __name__ == '__main__':
    main()
