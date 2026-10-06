"""Version-pinned release entry for the current iFrame host topology.

Run on the host: python3 scripts/iframe_release.py inspect
                 sudo python3 scripts/iframe_release.py prepare|deploy --revision <full-sha>
"""

import argparse
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys
import time
from urllib.request import urlopen


BACKEND = "iframe-backend"
FRONTEND = "lumenx-frontend"
OUTPUT = Path("/srv/lumenx/output")
STATIC = Path("/srv/lumenx/chat-static")
RELEASES = Path("/srv/lumenx/iframe-static-releases")
ENV_FILE = Path("/srv/lumenx/runtime/iframe-backend.env")
NETWORK = "lumenx-net"
BACKEND_PORT = 17177
CANDIDATE_PORT = 17178
REQUIRED_PATHS = {"/asset-index/preview", "/projects", "/series"}


def run(*args, capture=True):
    result = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else ""


def docker_inspect(name):
    return json.loads(run("docker", "inspect", name))[0]


def revision(repo, expected=None):
    value = run("git", "-C", str(repo), "rev-parse", "HEAD")
    if len(value) != 40 or run("git", "-C", str(repo), "status", "--porcelain"):
        raise RuntimeError("Release source must be a clean, pinned Git commit")
    if expected is not None and value != expected:
        raise RuntimeError(f"Host source revision differs from requested release: {value}")
    return value


def github_branch_revision(repo, branch):
    owner = pwd.getpwuid(repo.stat().st_uid).pw_name
    return run("sudo", "-n", "-u", owner, "git", "-C", str(repo), "ls-remote",
               "git@github.com:locopepe2024/iframe.git", f"refs/heads/{branch}")


def require_release_authority(repo, expected):
    if os.geteuid() != 0:
        raise RuntimeError("prepare/deploy require root for owner-scoped data snapshots")
    if not expected or len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise RuntimeError("Provide the full 40-character --revision")
    current = revision(repo, expected)
    branch = run("git", "-C", str(repo), "branch", "--show-current")
    if branch != "feature/iframe-3d-director-v1":
        raise RuntimeError(f"Unexpected release branch: {branch}")
    remote = github_branch_revision(repo, branch)
    if not remote or remote.split()[0] != current:
        raise RuntimeError("GitHub feature branch differs from host source")
    return current


def manifest_revision(path):
    data = json.loads(path.read_text())
    value = data.get("source_revision")
    if not isinstance(value, str) or len(value) != 40:
        raise RuntimeError(f"Invalid static manifest: {path}")
    return value


def verify_topology(backend, frontend):
    mounts = backend["Mounts"]
    output = [m for m in mounts if m["Destination"] == "/app/output"]
    if len(output) != 1 or output[0]["Type"] != "bind" or output[0]["Source"] != str(OUTPUT) or not output[0]["RW"]:
        raise RuntimeError("Unexpected backend output mount")
    if len(mounts) != 1 or NETWORK not in backend["NetworkSettings"]["Networks"]:
        raise RuntimeError("Unexpected backend mounts or network")
    binding = backend["HostConfig"]["PortBindings"].get("17177/tcp")
    if binding != [{"HostIp": "127.0.0.1", "HostPort": str(BACKEND_PORT)}]:
        raise RuntimeError("Unexpected backend port binding")
    front_mounts = {m["Destination"]: m for m in frontend["Mounts"]}
    static_mount = front_mounts.get("/usr/share/nginx/html")
    if not static_mount or static_mount["Source"] != str(STATIC):
        raise RuntimeError("Unexpected frontend static mount")
    if NETWORK not in frontend["NetworkSettings"]["Networks"]:
        raise RuntimeError("Unexpected frontend network")


def store_identity(image, output):
    result = run(
        "docker", "run", "--rm", "-v", f"{output}:/app/output:ro", image,
        "python", "scripts/check_project_store_compatibility.py", "/app/output",
    )
    return json.loads(result.splitlines()[-1])


def store_ids(output):
    result = {}
    for filename in ("projects.json", "series.json"):
        data = json.loads((output / filename).read_text())
        if not isinstance(data, dict):
            raise RuntimeError(f"Invalid {filename}: expected an object")
        result[filename] = sorted(data)
    return result


STATE_FILES = ("projects.json", "series.json", "library_assets.json")


def copy_state_snapshot(source, destination):
    """Copy only durable startup state; media can be multiple gigabytes."""
    destination.mkdir(parents=True)
    names = set(STATE_FILES)
    names.update(path.name for path in source.glob("*.sqlite3*"))
    names.update(path.name for path in source.glob("*.db*"))
    for name in sorted(names):
        path = source / name
        if path.is_symlink():
            raise RuntimeError(f"Unsafe state path: {path}")
        if not path.exists():
            if name in ("projects.json", "series.json"):
                raise RuntimeError(f"Missing required state: {path}")
            continue
        if not path.is_file():
            raise RuntimeError(f"Unsafe state path: {path}")
        shutil.copy2(path, destination / name)


def require_disk_budget(source, target):
    files = list(source.glob("*.json")) + list(source.glob("*.sqlite3*")) + list(source.glob("*.db*"))
    required = sum(path.stat().st_size for path in files if path.is_file()) * 3 + 256 * 1024 * 1024
    available = shutil.disk_usage(target).free
    if available < required:
        raise RuntimeError(f"Insufficient disk space for state snapshots: need {required}, free {available}")


def image_revision(image):
    value = docker_inspect(image)["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
    if not value or len(value) != 40:
        raise RuntimeError(f"Missing revision label on {image}")
    return value


def wait_http(url, expected_paths=None, expected_revision=None, attempts=30):
    error = None
    for _ in range(attempts):
        try:
            with urlopen(url, timeout=3) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                if expected_paths is not None or expected_revision is not None:
                    payload = json.load(response)
                if expected_paths is not None:
                    paths = payload["paths"]
                    missing = expected_paths - paths.keys()
                    if missing:
                        raise RuntimeError(f"Missing API routes: {sorted(missing)}")
                if expected_revision is not None and payload.get("source_revision") != expected_revision:
                    raise RuntimeError("Live static response has the wrong revision")
            return
        except Exception as exc:
            error = exc
            time.sleep(2)
    raise RuntimeError(f"Health check failed at {url}: {error}")


def managed_env():
    if ENV_FILE.is_symlink() or not ENV_FILE.is_file():
        raise RuntimeError(f"Missing managed backend environment: {ENV_FILE}")
    metadata = ENV_FILE.stat()
    if metadata.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise RuntimeError(f"Managed backend environment must be private: {ENV_FILE}")
    if metadata.st_size == 0:
        raise RuntimeError(f"Managed backend environment is empty: {ENV_FILE}")
    return ENV_FILE


def create_backend(name, image, env_path, output, host_port, *, restart=False):
    args = ["docker", "create", "--name", name, "--network", NETWORK, "--network-alias", "backend" if restart else name,
            "--env-file", str(env_path), "-v", f"{output}:/app/output", "-p", f"127.0.0.1:{host_port}:17177"]
    if restart:
        args += ["--restart", "unless-stopped"]
    run(*(args + [image]))


def remove_container(name):
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def inspect(repo):
    rev = revision(repo)
    backend = docker_inspect(BACKEND)
    frontend = docker_inspect(FRONTEND)
    verify_topology(backend, frontend)
    running = backend["Config"]["Labels"]["org.opencontainers.image.revision"]
    static = manifest_revision(STATIC / "build-manifest.json")
    if running != static:
        raise RuntimeError(f"Production backend/static mismatch: {running} != {static}")
    print(json.dumps({"source": rev, "backend": running, "static": static, "topology": "verified"}))
    return rev, backend


def prepare(repo, expected):
    require_release_authority(repo, expected)
    rev, backend = inspect(repo)
    release = RELEASES / rev
    if (release / "prepared.json").exists() or (release / "static").exists():
        raise RuntimeError("Release is already prepared; remove or archive it explicitly")
    release.mkdir(parents=True, exist_ok=True)
    image = f"iframe-backend:git-{rev[:12]}"
    candidate = f"iframe-backend-candidate-{rev[:12]}"
    isolated = release / "candidate-output"
    if isolated.exists():
        raise RuntimeError(f"Candidate output already exists: {isolated}")
    if run("git", "-C", str(repo), "rev-parse", "HEAD") != rev:
        raise RuntimeError("Source changed during prepare")
    run("docker", "build", "-f", str(repo / "Dockerfile.backend"), "-t", image,
        "--label", f"org.opencontainers.image.revision={rev}", str(repo), capture=False)
    run("bash", str(repo / "scripts/build_frontend_static.sh"), capture=False)
    if image_revision(image) != rev or manifest_revision(repo / "frontend/out/build-manifest.json") != rev:
        raise RuntimeError("Built backend and frontend revisions differ from source")
    shutil.copytree(repo / "frontend/out", release / "static")

    # Candidate startup writes SQLite recovery state. Copy its durable state,
    # including sidecars, while leaving large media trees outside the sandbox.
    require_disk_budget(OUTPUT, RELEASES)
    copy_state_snapshot(OUTPUT, isolated)
    env_path = managed_env()
    try:
        baseline = store_ids(isolated)
        store_identity(image, isolated)
        create_backend(candidate, image, env_path, isolated, CANDIDATE_PORT)
        run("docker", "start", candidate)
        wait_http(f"http://127.0.0.1:{CANDIDATE_PORT}/openapi.json", REQUIRED_PATHS)
        store_identity(image, isolated)
        if store_ids(isolated) != baseline:
            raise RuntimeError("Candidate startup changed project or series identities")
        (release / "prepared.json").write_text(json.dumps({"revision": rev, "image": image, "ids": baseline}, indent=2))
        print(f"Prepared {rev}: isolated candidate healthy; production unchanged")
    finally:
        remove_container(candidate)
        shutil.rmtree(isolated)


def deploy(repo, expected):
    require_release_authority(repo, expected)
    rev, backend = inspect(repo)
    release = RELEASES / rev
    prepared = json.loads((release / "prepared.json").read_text())
    image = prepared["image"]
    if prepared["revision"] != rev or image_revision(image) != rev or manifest_revision(release / "static/build-manifest.json") != rev:
        raise RuntimeError("Prepared release does not match source, image, and static files")
    if store_ids(OUTPUT) != prepared["ids"]:
        raise RuntimeError("Project/series identities changed since prepare; prepare again")
    old_name = f"{BACKEND}-before-{rev[:12]}"
    old_static = RELEASES / f"before-{rev[:12]}"
    if old_static.exists() or subprocess.run(["docker", "inspect", old_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
        raise RuntimeError("Rollback target already exists")
    staged_static = release / "static"
    backup = release / "data-before-switch"
    if backup.exists():
        raise RuntimeError("Data backup already exists")
    env_path = managed_env()
    backend_renamed = False
    static_switched = False
    try:
        # Stop incoming writes before freezing the old process and copying data.
        run("docker", "stop", FRONTEND)
        run("docker", "stop", "--time", "210", BACKEND)
        require_disk_budget(OUTPUT, RELEASES)
        copy_state_snapshot(OUTPUT, backup)
        if store_ids(OUTPUT) != prepared["ids"] or store_ids(backup) != prepared["ids"]:
            raise RuntimeError("Project/series identities changed during freeze")
        store_identity(image, backup)
        run("docker", "rename", BACKEND, old_name)
        backend_renamed = True
        create_backend(BACKEND, image, env_path, OUTPUT, BACKEND_PORT, restart=True)
        run("docker", "start", BACKEND)
        wait_http(f"http://127.0.0.1:{BACKEND_PORT}/openapi.json", REQUIRED_PATHS)
        store_identity(image, OUTPUT)
        if store_ids(OUTPUT) != prepared["ids"]:
            raise RuntimeError("Project/series identities changed after backend start")
        STATIC.rename(old_static)
        static_switched = True
        staged_static.rename(STATIC)
        run("docker", "start", FRONTEND)
        wait_http("http://127.0.0.1:3000/build-manifest.json", expected_revision=rev)
        if manifest_revision(STATIC / "build-manifest.json") != rev:
            raise RuntimeError("Live static revision mismatch")
        (release / "deployment.json").write_text(json.dumps({"revision": rev, "rollback_backend": old_name, "rollback_static": str(old_static)}, indent=2))
        print(f"Deployed {rev}; rollback preserved as {old_name} and {old_static}")
    except Exception:
        if static_switched:
            if STATIC.exists():
                STATIC.rename(release / "static-failed")
            old_static.rename(STATIC)
        if backend_renamed:
            remove_container(BACKEND)
            run("docker", "rename", old_name, BACKEND)
        run("docker", "start", BACKEND)
        run("docker", "start", FRONTEND)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "prepare", "deploy"))
    parser.add_argument("--repo", type=Path, default=Path("/srv/lumenx/repo"))
    parser.add_argument("--revision", help="Full reviewed Git commit for prepare/deploy")
    args = parser.parse_args()
    if args.action == "inspect":
        inspect(args.repo.resolve())
    elif args.action == "prepare":
        prepare(args.repo.resolve(), args.revision)
    else:
        deploy(args.repo.resolve(), args.revision)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError, ValueError, KeyError) as exc:
        print(f"iFrame release blocked: {exc}", file=sys.stderr)
        raise SystemExit(1)
