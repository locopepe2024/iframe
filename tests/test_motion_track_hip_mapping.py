import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parents[1]
ADAPTER = ROOT / "tools/motion_track/pose_to_blender_state.py"


def _landmarks(*, hip_y=0.55, shoulder_y=0.35):
    points = [[0.5, 0.5, 0.0, 1.0] for _ in range(33)]
    points[11] = [0.45, shoulder_y, 0.0, 1.0]
    points[12] = [0.55, shoulder_y, 0.0, 1.0]
    points[13] = [0.40, 0.45, 0.0, 1.0]
    points[14] = [0.60, 0.45, 0.0, 1.0]
    points[15] = [0.35, 0.55, 0.0, 1.0]
    points[16] = [0.65, 0.55, 0.0, 1.0]
    points[23] = [0.46, hip_y, 0.0, 1.0]
    points[24] = [0.54, hip_y, 0.0, 1.0]
    points[25] = [0.46, 0.72, 0.0, 1.0]
    points[26] = [0.54, 0.72, 0.0, 1.0]
    points[27] = [0.46, 0.90, 0.0, 1.0]
    points[28] = [0.54, 0.90, 0.0, 1.0]
    return points


def _run_adapter(tmp_path, landmarks):
    source = tmp_path / "track.json"
    output = tmp_path / "state.json"
    source.write_text(
        json.dumps(
            {
                "schema": "motion-track.v1",
                "source": {"fps": 24},
                "target_selection": {"target_subject_id": "person-center"},
                "frames": [
                    {
                        "frame": 1,
                        "timestamp_seconds": 0.0,
                        "target_landmarks": landmarks,
                        "selection_status": "tracked",
                    }
                ],
            }
        )
    )
    subprocess.run(
        [sys.executable, str(ADAPTER), "--track", str(source), "--out", str(output)],
        check=True,
        cwd=ROOT,
    )
    return json.loads(output.read_text())["actors"][1]["motion_track"][0]


def test_hip_landmarks_drive_body_centers_pelvis_and_spine(tmp_path):
    sample = _run_adapter(tmp_path, _landmarks())

    assert "hips" in sample["body_centers"]
    assert sample["body_centers"]["pelvis_width"] > 0
    for name in ("pelvis", "spine_lower", "spine_mid", "spine_chest"):
        assert name in sample["joint_rotations_deg"]
        assert name in sample["joint_vectors"]


def test_missing_hip_landmark_does_not_fabricate_pelvis_pose(tmp_path):
    landmarks = _landmarks()
    landmarks[23][3] = 0.0
    sample = _run_adapter(tmp_path, landmarks)

    assert "hips" not in sample["body_centers"]
    assert "pelvis" not in sample["joint_rotations_deg"]
