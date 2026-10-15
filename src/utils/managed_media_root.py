"""Path/locator boundary; callers still enforce ownership and file existence."""
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ManagedMediaRoot:
    root: Path

    def __post_init__(self):
        object.__setattr__(self, 'root', Path(self.root).resolve())

    def resolve(self, locator: str) -> Path:
        if not isinstance(locator, str) or not locator.strip():
            raise ValueError('Media locator must be nonempty')
        raw = locator.strip()
        if '\x00' in raw or '\\' in raw or '://' in raw or raw.startswith(('data:', 'blob:')):
            raise ValueError('Invalid local media locator')
        path = Path(raw)
        if '..' in path.parts:
            raise ValueError('Media traversal is not allowed')
        if not path.is_absolute():
            for prefix in ('output/', 'outputs/'):
                if raw.startswith(prefix):
                    raw = raw[len(prefix):]
                    break
            path = self.root / raw
        candidate = path.resolve()
        if candidate == self.root or not candidate.is_relative_to(self.root):
            raise ValueError('Media locator is outside the managed root')
        return candidate

    def key(self, locator: str) -> str:
        return self.resolve(locator).relative_to(self.root).as_posix()
