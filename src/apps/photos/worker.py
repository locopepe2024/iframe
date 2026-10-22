"""Explicit worker: python -m src.apps.photos.worker /absolute/photos.db"""

import logging
import signal
import sys
from pathlib import Path
from threading import Event

from .time_tasks import PhotoTaskStore


def main():
    path = Path(sys.argv[1])
    if not path.is_absolute() or not path.is_file():
        raise SystemExit("Existing absolute photo database required")
    store = PhotoTaskStore(path, initialize=False)
    stopping = Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())
    while not stopping.is_set():
        try:
            if not store.process_time_item():
                stopping.wait(0.5)
        except Exception as failure:
            logging.error("photo worker iteration failed: %s", type(failure).__name__)
            stopping.wait(2)


if __name__ == "__main__":
    main()
