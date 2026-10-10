"""One-shot SSH worker: bounded ZIP stdin to depth artifacts ZIP stdout."""
import io
import hashlib
import socket
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

INPUTS = {'snapshot.json', 'render_scene_depth.py', 'render_depth_reference.py', 'render_full_motion_bundle.py'}
MAX_BYTES = 64 * 1024 * 1024


def main():
    payload = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError('depth payload too large')
    with tempfile.TemporaryDirectory(prefix='iframe-depth-') as directory:
        root = Path(directory)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if set(archive.namelist()) != INPUTS or len(archive.infolist()) != len(INPUTS):
                raise ValueError('invalid worker inputs')
            if sum(item.file_size for item in archive.infolist()) > MAX_BYTES:
                raise ValueError('expanded payload too large')
            for name in INPUTS:
                (root / name).write_bytes(archive.read(name))
        subprocess.run([sys.argv[1], '--background', '--factory-startup', '--threads', '1',
            '--python-exit-code', '1', '--python', str(root / 'render_scene_depth.py'), '--',
            '--snapshot', str(root / 'snapshot.json'), '--output', str(root / 'result')],
            stdout=sys.stderr, stderr=sys.stderr, check=True, timeout=120)
        result = root / 'result'
        manifest = json.loads((result / 'depth-reference.v1.json').read_text())
        manifest['executionHost'] = socket.gethostname()
        manifest['snapshotChecksum'] = hashlib.sha256((root / 'snapshot.json').read_bytes()).hexdigest()
        (result / 'depth-reference.v1.json').write_text(json.dumps(manifest))
        names = ['depth-reference.v1.json', *manifest['outputs']['meters'], *manifest['outputs']['preview']]
        if len(names) != 3 or any(Path(name).name != name for name in names):
            raise ValueError('invalid worker outputs')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_STORED) as archive:
            for name in names:
                if (result / name).stat().st_size > MAX_BYTES:
                    raise ValueError('output too large')
                archive.write(result / name, name)
        sys.stdout.buffer.write(buffer.getvalue())


if __name__ == '__main__':
    main()
