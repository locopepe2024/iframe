"""Run on the Demo host. Keep the existing credential and a private rollback copy."""
from pathlib import Path
import os
import shutil
import sys
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values, set_key

root = Path("/srv/lumenx/opentalking-mock")
path = root / ".env"
values = dotenv_values(path)
base = urlsplit(values["OPENTALKING_TTS_OPENAI_BASE_URL"])
assert base.scheme == "https" and base.netloc and not base.query and not base.fragment
key = values["OPENTALKING_TTS_OPENAI_API_KEY"]
assert key
backup = root / ".env.before-realtime-tts-20261030"
if not backup.exists():
    shutil.copy2(path, backup)
os.chmod(backup, 0o600)
updates = {
    "OPENTALKING_TTS_DEFAULT_PROVIDER": "dashscope",
    "OPENTALKING_TTS_PROVIDER": "dashscope",
    "OPENTALKING_TTS_DASHSCOPE_MODEL": "qwen3-tts-flash-realtime",
    "OPENTALKING_TTS_DASHSCOPE_SERVICE_URL": urlunsplit(("wss", base.netloc, base.path.rstrip("/") + "/realtime", "", "")),
    "OPENTALKING_TTS_DASHSCOPE_API_KEY": key,
    "OPENTALKING_TTS_DASHSCOPE_VOICE": "Cherry",
    "OPENTALKING_QWEN_TTS_REUSE_WS": "1",
}
for name, value in updates.items():
    if "--prepare-only" in sys.argv and name in {"OPENTALKING_TTS_DEFAULT_PROVIDER", "OPENTALKING_TTS_PROVIDER"}:
        continue
    set_key(path, name, value)
os.chmod(path, 0o600)
print("Demo realtime TTS configured; prepare-only=" + str("--prepare-only" in sys.argv))
