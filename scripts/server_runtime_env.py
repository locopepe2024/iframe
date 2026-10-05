"""One-time bootstrap and validation for the iFrame host runtime env file."""

import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess


DEFAULT_PATH = Path('/srv/lumenx/runtime/iframe-backend.env')
KEY_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def parse_entries(entries):
    values = {}
    for entry in entries:
        if '\n' in entry or '\r' in entry or '=' not in entry:
            raise ValueError('Invalid environment entry')
        key, value = entry.split('=', 1)
        if not KEY_PATTERN.fullmatch(key) or key in values:
            raise ValueError(f'Invalid or duplicate environment key: {key}')
        values[key] = value
    return values


def runtime_entries(container_entries, image_entries):
    image = parse_entries(image_entries)
    container = parse_entries(container_entries)
    return [f'{key}={value}' for key, value in container.items() if image.get(key) != value]


def validate_file(path=DEFAULT_PATH):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('Runtime env must be a regular file with mode 0600')
    if info.st_uid != os.geteuid():
        raise ValueError('Runtime env must be owned by the deployment user')
    parent = path.parent.stat()
    if stat.S_IMODE(parent.st_mode) != 0o700 or parent.st_uid != os.geteuid():
        raise ValueError('Runtime env directory must be owned by the deployment user with mode 0700')
    entries = path.read_text().splitlines()
    values = parse_entries(entries)
    if not values:
        raise ValueError('Runtime env is empty')
    return list(values)


def docker_inspect(kind, name):
    result = subprocess.check_output(['docker', kind, 'inspect', name], text=True)
    return json.loads(result)[0]


def bootstrap(path=DEFAULT_PATH, container='iframe-backend'):
    path = Path(path)
    if path.exists() or path.is_symlink():
        raise FileExistsError('Runtime env already exists; refusing to overwrite it')
    current = docker_inspect('container', container)
    image = docker_inspect('image', current['Config']['Image'])
    container_entries = current['Config']['Env']
    parse_entries(container_entries)
    entries = runtime_entries(container_entries, image['Config']['Env'])
    if not entries:
        raise ValueError('No application environment entries found')
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.stat()
    if stat.S_IMODE(parent.st_mode) != 0o700 or parent.st_uid != os.geteuid():
        raise ValueError('Runtime env directory must be owned by the deployment user with mode 0700')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write('\n'.join(entries) + '\n')
        keys = validate_file(path)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return keys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['bootstrap', 'validate'])
    parser.add_argument('--path', type=Path, default=DEFAULT_PATH)
    parser.add_argument('--container', default='iframe-backend')
    args = parser.parse_args()
    keys = bootstrap(args.path, args.container) if args.action == 'bootstrap' else validate_file(args.path)
    print(f'{args.action}: {len(keys)} environment keys in {args.path}')


if __name__ == '__main__':
    main()
