"""Explicit offline people worker: DATABASE MODEL_DIRECTORY; no HTTP server."""

import argparse
import logging
from pathlib import Path
import signal
from threading import Event

from .faces import LocalFaceEngine
from .people_tasks import PhotoPeopleStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',type=Path)
    parser.add_argument('models',type=Path)
    args = parser.parse_args()
    if not args.database.is_absolute() or not args.database.is_file():
        parser.error('Existing absolute photo database required; explicitly initialize first')
    model = LocalFaceEngine(args.models)
    store = PhotoPeopleStore(args.database,initialize=False)
    stopping = Event()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,lambda *_:stopping.set())
    while not stopping.is_set():
        try:
            if not store.process_people_item(model):
                stopping.wait(0.5)
        except Exception as failure:
            logging.error('people worker iteration failed: %s',type(failure).__name__)
            stopping.wait(2)


if __name__ == '__main__':
    main()
