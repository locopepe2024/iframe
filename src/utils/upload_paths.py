"""Shared physical-file boundary for cloud upload adapters."""
from pathlib import Path
import tempfile
from typing import Optional


def resolve_upload_file(local_path: str, *, output_root: str = "output") -> Optional[str]:
    """Allow regular files within the explicit media root or system temp.

    Inputs are filesystem paths relative to cwd, not stored media locators.
    No configuration is retained between calls.
    """
    try:
        candidate = Path(local_path).resolve()
        roots = (Path(output_root).resolve(), Path(tempfile.gettempdir()).resolve())
        if candidate.is_file() and any(
            candidate != root and candidate.is_relative_to(root) for root in roots
        ):
            return str(candidate)
    except (OSError, ValueError, RuntimeError):
        pass
    return None
