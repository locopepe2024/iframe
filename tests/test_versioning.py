from pathlib import Path
import shutil

import pytest

from scripts.versioning import collect_mismatches, read_version, update_surfaces, validate_version


VERSION_SURFACES = (
    "VERSION",
    "package.json",
    "frontend/package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src/apps/comic_gen/api.py",
    "README.md",
    "README_EN.md",
    "README_IFRAME.md",
    "frontend/src/components/settings/SettingsPage.tsx",
    "frontend/src/components/layout/GlobalSidebar.tsx",
    "frontend/src/components/layout/PipelineSidebar.tsx",
)


def _copy_version_surfaces(source: Path, target: Path) -> None:
    for relative in VERSION_SURFACES:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, destination)


def test_version_update_keeps_all_surfaces_consistent(tmp_path):
    source = Path(__file__).resolve().parents[1]
    _copy_version_surfaces(source, tmp_path)

    update_surfaces("0.1.2", root=tmp_path)

    assert read_version(tmp_path / "VERSION") == "0.1.2"
    assert collect_mismatches(root=tmp_path) == []


@pytest.mark.parametrize("value", ["0.1", "v0.1.1", "01.1.1", "1.2.3.4", ""])
def test_version_validation_rejects_non_semver(value):
    with pytest.raises(ValueError):
        validate_version(value)

