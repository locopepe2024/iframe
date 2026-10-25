"""Inside Mock container: apply staged TURN settings without printing credentials."""
import json
from pathlib import Path
import shutil
from dotenv import dotenv_values

root = Path('/mock')
env = root / '.env'
backup = root / '.env.before-turn'
if not backup.exists():
    shutil.copy2(env, backup)
    backup.chmod(0o600)
values = dict(dotenv_values(env))
values.update(json.loads((root / 'turn-env.json').read_text()))
env.write_text('\n'.join(k + '=' + json.dumps(v, ensure_ascii=False)
                         for k, v in values.items()) + '\n')
env.chmod(0o600)
print('TURN settings applied; restart Mock to activate')
