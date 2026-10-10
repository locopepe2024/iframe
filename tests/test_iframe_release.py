import importlib.util
import io
from pathlib import Path
import subprocess

import pytest


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "iframe_release.py"
spec = importlib.util.spec_from_file_location("iframe_release", MODULE_PATH)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def topology():
    backend = {
        "Mounts": [{"Destination": "/app/output", "Source": str(release.OUTPUT), "Type": "bind", "RW": True}],
        "NetworkSettings": {"Networks": {release.NETWORK: {}}},
        "HostConfig": {"PortBindings": {"17177/tcp": [{"HostIp": "127.0.0.1", "HostPort": "17177"}]}},
    }
    frontend = {
        "Mounts": [
            {"Destination": "/usr/share/nginx/html", "Source": str(release.STATIC), "Type": "bind"},
            {"Destination": "/etc/nginx/conf.d/default.conf", "Source": "/srv/lumenx/repo/docker/nginx.conf", "Type": "bind", "RW": False},
        ],
        "NetworkSettings": {"Networks": {release.NETWORK: {}}},
        "HostConfig": {"PortBindings": {"80/tcp": [{"HostIp": "", "HostPort": "3000"}]}},
        "Config": {"Image": "nginx:alpine"},
    }
    return backend, frontend


def test_release_accepts_only_current_service_topology():
    backend, frontend = topology()
    release.verify_topology(backend, frontend)
    backend["Mounts"][0]["RW"] = False
    with pytest.raises(RuntimeError, match="output mount"):
        release.verify_topology(backend, frontend)
    backend["Mounts"][0]["RW"] = True
    frontend["Mounts"][0]["Source"] = "/srv/lumenx/old-static"
    with pytest.raises(RuntimeError, match="static mount"):
        release.verify_topology(backend, frontend)


def test_release_accepts_only_read_only_knowledge_secret_mount():
    backend, frontend = topology()
    mount = {"Destination": release.KNOWLEDGE_MOUNT, "Source": str(release.KNOWLEDGE_SECRETS),
             "Type": "bind", "RW": False}
    backend["Mounts"].append(mount)
    release.verify_topology(backend, frontend)
    mount["RW"] = True
    with pytest.raises(RuntimeError, match="Unexpected backend mounts"):
        release.verify_topology(backend, frontend)


def test_release_requires_complete_private_knowledge_runtime(monkeypatch, tmp_path):
    env_file = tmp_path / "backend.env"
    secrets = tmp_path / "knowledge-secrets"
    secrets.mkdir()
    secrets.chmod(0o700)
    monkeypatch.setattr(release, "KNOWLEDGE_SECRETS", secrets)
    env_file.write_text("APP_ENV=production\n")
    assert not release.knowledge_runtime(env_file)
    env_file.write_text("IFRAME_KNOWLEDGE_PG_HOST=10.0.0.1\n")
    with pytest.raises(RuntimeError, match="Incomplete knowledge"):
        release.knowledge_runtime(env_file)
    names = (
        "IFRAME_KNOWLEDGE_PG_HOST", "IFRAME_KNOWLEDGE_PG_USER",
        "IFRAME_KNOWLEDGE_PG_PASSWORD_FILE", "IFRAME_KNOWLEDGE_PG_CA_FILE",
        "IFRAME_KNOWLEDGE_BLOB_BACKEND", "IFRAME_KNOWLEDGE_COS_REGION",
        "IFRAME_KNOWLEDGE_COS_BUCKET", "IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE",
        "IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE",
    )
    overrides = {
        "IFRAME_KNOWLEDGE_PG_PASSWORD_FILE": f"{release.KNOWLEDGE_MOUNT}/knowledge-pg-app-password",
        "IFRAME_KNOWLEDGE_PG_CA_FILE": f"{release.KNOWLEDGE_MOUNT}/knowledge-pg-ca.pem",
        "IFRAME_KNOWLEDGE_COS_SECRET_ID_FILE": f"{release.KNOWLEDGE_MOUNT}/knowledge-cos-secret-id",
        "IFRAME_KNOWLEDGE_COS_SECRET_KEY_FILE": f"{release.KNOWLEDGE_MOUNT}/knowledge-cos-secret-key",
        "IFRAME_KNOWLEDGE_BLOB_BACKEND": "cos",
    }
    env_file.write_text("".join(f"{name}={overrides.get(name, 'configured')}\n" for name in names))
    for name in ("knowledge-pg-app-password", "knowledge-pg-ca.pem",
                 "knowledge-cos-secret-id", "knowledge-cos-secret-key"):
        path = secrets / name
        path.write_text("configured")
        path.chmod(0o600)
    assert release.knowledge_runtime(env_file)
    (secrets / "knowledge-cos-secret-key").chmod(0o644)
    with pytest.raises(RuntimeError, match="unsafe knowledge secret"):
        release.knowledge_runtime(env_file)


def test_release_requires_explicit_matching_remote_revision(monkeypatch, tmp_path):
    sha = "a" * 40
    monkeypatch.setattr(release.os, "geteuid", lambda: 0)
    monkeypatch.setattr(release, "revision", lambda _repo, expected: sha if expected == sha else None)
    monkeypatch.setattr(release, "run", lambda *args: "feature/iframe-3d-director-v1")
    monkeypatch.setattr(release, "github_branch_revision", lambda _repo, _branch: f"{sha}\trefs/heads/feature/iframe-3d-director-v1")
    assert release.require_release_authority(tmp_path, sha) == sha
    with pytest.raises(RuntimeError, match="full 40-character"):
        release.require_release_authority(tmp_path, "short")
    monkeypatch.setattr(release, "github_branch_revision", lambda _repo, _branch: "b" * 40 + "\trefs/heads/feature/iframe-3d-director-v1")
    with pytest.raises(RuntimeError, match="GitHub feature branch"):
        release.require_release_authority(tmp_path, sha)


def test_release_rejects_non_release_branch(monkeypatch, tmp_path):
    sha = "a" * 40
    monkeypatch.setattr(release.os, "geteuid", lambda: 0)
    monkeypatch.setattr(release, "revision", lambda _repo, expected: sha)
    monkeypatch.setattr(release, "run", lambda *args: "main")
    with pytest.raises(RuntimeError, match="Unexpected release branch"):
        release.require_release_authority(tmp_path, sha)


def test_github_check_uses_source_owner_identity(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(release, "run", lambda *args: calls.append(args) or "revision")
    assert release.github_branch_revision(tmp_path, "feature/iframe-3d-director-v1") == "revision"
    assert calls[0][:4] == ("sudo", "-n", "-u", release.pwd.getpwuid(tmp_path.stat().st_uid).pw_name)


def test_release_rejects_symlinks_in_isolated_output(tmp_path):
    (tmp_path / "projects.json").write_text("{}")
    (tmp_path / "series.json").write_text("{}")
    (tmp_path / "library_assets.json").symlink_to("/srv/lumenx/output/library_assets.json")
    with pytest.raises(RuntimeError, match="Unsafe state"):
        release.copy_state_snapshot(tmp_path, tmp_path / "snapshot")


def test_release_requires_private_managed_environment(monkeypatch, tmp_path):
    env_file = tmp_path / "iframe-backend.env"
    monkeypatch.setattr(release, "ENV_FILE", env_file)
    with pytest.raises(RuntimeError, match="Missing managed"):
        release.managed_env()
    env_file.write_text("APP_ENV=production\n")
    env_file.chmod(0o644)
    with pytest.raises(RuntimeError, match="must be private"):
        release.managed_env()
    env_file.chmod(0o600)
    assert release.managed_env() == env_file


def test_release_checks_served_static_revision(monkeypatch):
    class Response(io.BytesIO):
        status = 200

    monkeypatch.setattr(release, "urlopen", lambda _url, timeout: Response(b'{"source_revision":"old"}'))
    monkeypatch.setattr(release.time, "sleep", lambda _seconds: None)
    with pytest.raises(RuntimeError, match="wrong revision"):
        release.wait_http("http://localhost/build-manifest.json", expected_revision="new", attempts=1)
    monkeypatch.setattr(release, "urlopen", lambda _url, timeout: Response(b'{"source_revision":"new"}'))
    release.wait_http("http://localhost/build-manifest.json", expected_revision="new", attempts=1)


def test_store_check_imports_application_from_container_workdir(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(release, "run", lambda *args: calls.append(args) or '{"projects": 2, "series": 1}')
    assert release.store_identity("image:test", tmp_path) == {"projects": 2, "series": 1}
    assert ("-e", "PYTHONPATH=/app") == calls[0][3:5]


def test_frontend_recreation_preserves_verified_mounts_and_port(monkeypatch):
    _, frontend = topology()
    calls = []
    monkeypatch.setattr(release, "run", lambda *args: calls.append(args) or "")
    release.create_frontend("lumenx-frontend", frontend)
    args = calls[0]
    assert f"{release.STATIC}:/usr/share/nginx/html:ro" in args
    assert "/srv/lumenx/repo/docker/nginx.conf:/etc/nginx/conf.d/default.conf:ro" in args
    assert "3000:80" in args
    assert args[-1] == "nginx:alpine"


def test_release_snapshot_excludes_large_media(tmp_path):
    (tmp_path / "projects.json").write_text("{}")
    (tmp_path / "series.json").write_text("{}")
    (tmp_path / "extraction-jobs.sqlite3").write_bytes(b"sqlite")
    media = tmp_path / "users"
    media.mkdir()
    (media / "image.png").write_bytes(b"large-media")
    target = tmp_path / "snapshot"
    release.copy_state_snapshot(tmp_path, target)
    assert sorted(path.name for path in target.iterdir()) == ["extraction-jobs.sqlite3", "projects.json", "series.json"]


def test_retired_deployment_script_cannot_run():
    old = MODULE_PATH.with_name("deploy_server_release.py")
    result = subprocess.run(["python3", str(old)], capture_output=True, text=True)
    assert result.returncode != 0
    assert "retired" in result.stderr
