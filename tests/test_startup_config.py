import json
import os
from pathlib import Path
import subprocess
import sys


def test_packaged_config_precedes_pipeline_and_static_mounts(tmp_path):
    root = tmp_path / 'selected'
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'config.json').write_text(json.dumps({
        'IFRAME_MEDIA_ROOT': str(root),
        'IFRAME_STORAGE_BACKEND': 'local',
        'PROVIDER_MEDIA_URL_TTL_SECONDS': 321,
        'IFRAME_DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS': 4567,
    }))
    env = {k: v for k, v in os.environ.items() if not k.startswith(('IFRAME_', 'LUMENX_', 'LUMEN_X_'))}
    env.update(LUMEN_X_PACKAGED='true', IFRAME_DATA_DIR=str(data), PYTHONPATH=str(Path.cwd()))
    script = '''
import os
from pathlib import Path
from src.apps.comic_gen import api
from src.apps.comic_gen.models import DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS
root = Path(os.environ['EXPECTED_ROOT'])
assert Path(api.MEDIA_ROOT) == root, (api.MEDIA_ROOT, root)
assert Path(api.pipeline.output_root) == root
mount = next(route for route in api.app.routes if getattr(route, 'path', '') == '/files')
assert Path(mount.app.directory) == root
assert os.environ['PROVIDER_MEDIA_URL_TTL_SECONDS'] == '321'
assert DIRECTOR_EXECUTION_SUMMARY_MAX_CHARS == 4567
assert not Path('output').exists()
'''
    env['EXPECTED_ROOT'] = str(root)
    result = subprocess.run([sys.executable, '-c', script], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
