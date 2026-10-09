"""One-time, guarded reset of an episode's copied style to its Series baseline.

Run only while the backend is stopped; its in-memory project store otherwise
could overwrite the file after this operation. Director state is untouched.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile
import time


def repair(data_dir: Path, series_id: str, episode_id: str, profile_revision: int, apply: bool) -> dict:
    projects_path = data_dir / "projects.json"
    series_path = data_dir / "series.json"
    projects = json.loads(projects_path.read_text())
    series_store = json.loads(series_path.read_text())
    series = series_store.get(series_id)
    episode = projects.get(episode_id)
    if not series or not episode or episode_id not in series.get("episode_ids", []):
        raise ValueError("Episode is not a member of the requested Series")
    if episode.get("series_id") != series_id:
        raise ValueError("Episode's Series identity differs from the requested Series")
    art = episode.get("art_direction") or {}
    active = art.get("director_profile") or {}
    if active.get("revision") != profile_revision:
        raise ValueError("Confirmed episode Director revision changed")
    revisions = episode.get("director_profile_revisions") or []
    if [item.get("revision") for item in revisions] != list(range(1, profile_revision + 1)):
        raise ValueError("Episode Director history differs from the expected revision sequence")
    if not (series.get("art_direction") or {}).get("style_config"):
        raise ValueError("Series has no style baseline to inherit")
    before = {
        "episode_id": episode_id,
        "series_id": series_id,
        "director_revision": profile_revision,
        "history_count": len(revisions),
        "draft_revision": episode.get("director_profile_draft_revision", 0),
        "had_episode_style": bool(art.get("style_config")),
    }
    if not apply or not art.get("style_config"):
        return {**before, "applied": False}

    backup_dir = data_dir / "backups"
    backup_dir.mkdir(mode=0o700, exist_ok=True)
    backup = backup_dir / f"projects-before-series-style-reset-{episode_id}-{int(time.time())}.json"
    if backup.exists():
        raise FileExistsError(backup)
    shutil.copy2(projects_path, backup)

    art["selected_style_id"] = "director-profile"
    art["style_config"] = {}
    metadata = projects_path.stat()
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", dir=data_dir, prefix=".projects-style-reset-", delete=False) as handle:
            temp_path = Path(handle.name)
            json.dump(projects, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, metadata.st_mode)
        os.chown(temp_path, metadata.st_uid, metadata.st_gid)
        os.replace(temp_path, projects_path)
        directory_fd = os.open(data_dir, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()
    return {**before, "applied": True, "backup": str(backup)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("output"))
    parser.add_argument("--series-id", required=True)
    parser.add_argument("--episode-id", required=True)
    parser.add_argument("--profile-revision", required=True, type=int)
    parser.add_argument("--apply", action="store_true", help="Write the guarded change after backing up projects.json")
    args = parser.parse_args()
    print(json.dumps(repair(
        args.data_dir, args.series_id, args.episode_id, args.profile_revision, args.apply,
    ), ensure_ascii=False))


if __name__ == "__main__":
    main()
