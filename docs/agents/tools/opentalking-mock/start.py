"""Container entrypoint; credentials stay in the host-mounted mode-600 file."""
import runpy
import sys

from dotenv import load_dotenv

sys.path.insert(0, "/mock/source")
load_dotenv("/mock/.env", override=True)
runpy.run_module("apps.unified.main", run_name="__main__")
