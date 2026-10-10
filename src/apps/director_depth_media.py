"""Explicit SSH transport for media-host Blender depth jobs."""
import base64
import io
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
LIMIT = 64 * 1024 * 1024


def remote_settings():
    target = os.getenv('DIRECTOR_DEPTH_MEDIA_SSH_TARGET', '').strip()
    if not target:
        return None
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@-]{0,200}', target):
        raise ValueError('invalid media SSH target')
    binary = os.getenv('DIRECTOR_DEPTH_MEDIA_BLENDER_BIN', '/opt/blender/blender')
    if not binary.startswith('/') or len(binary) > 500:
        raise ValueError('media Blender path must be absolute')
    return target, binary


def render_remote(path, settings):
    target, binary = settings
    scripts = ROOT / 'scripts' / 'director3d'
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(path / 'snapshot.json', 'snapshot.json')
        for name in ('render_scene_depth.py', 'render_depth_reference.py', 'render_full_motion_bundle.py'):
            archive.write(scripts / name, name)
    if len(payload.getvalue()) > LIMIT:
        raise ValueError('depth payload too large')
    worker = base64.b64encode((scripts / 'media_depth_worker.py').read_bytes()).decode('ascii')
    bootstrap = "import base64;exec(compile(base64.b64decode(" + repr(worker) + "),'media-depth-worker','exec'))"
    command = 'python3 -c ' + shlex.quote(bootstrap) + ' ' + shlex.quote(binary)
    with (path / 'render.log').open('wb') as log, (path / 'result.zip').open('wb') as output:
        subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        '-o', 'ConnectTimeout=10', target, command],
                       input=payload.getvalue(), stdout=output, stderr=log, check=True, timeout=150)
    archive_path = path / 'result.zip'
    if archive_path.stat().st_size > LIMIT:
        raise ValueError('depth response too large')
    with zipfile.ZipFile(archive_path) as archive:
        items = archive.infolist()
        if len(items) != 3 or sum(item.file_size for item in items) > LIMIT:
            raise ValueError('invalid depth response size')
        names = archive.namelist()
        if len(set(names)) != 3 or any(Path(name).name != name for name in names):
            raise ValueError('unsafe depth output filename')
        manifest = json.loads(archive.read('depth-reference.v1.json'))
        if manifest.get('snapshotChecksum') != hashlib.sha256((path / 'snapshot.json').read_bytes()).hexdigest():
            raise ValueError('depth snapshot checksum mismatch')
        expected = {'depth-reference.v1.json', *manifest['outputs']['meters'], *manifest['outputs']['preview']}
        if set(names) != expected or manifest.get('status') != 'completed':
            raise ValueError('depth output manifest mismatch')
        output = path / 'result'
        output.mkdir()
        for name in names:
            (output / name).write_bytes(archive.read(name))
    archive_path.unlink()


def probe_remote(settings):
    target, binary = settings
    command = shlex.quote(binary) + ' --version'
    subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    '-o', 'ConnectTimeout=5', target, command],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=10)
