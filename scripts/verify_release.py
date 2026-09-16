"""Create or verify a release manifest. Reads code only; never reads credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'verify'])
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--repo', default='.', type=Path)
    parser.add_argument('--static', required=True, type=Path)
    parser.add_argument('--build-revision', help='Commit used to build the static export (required for create)')
    parser.add_argument('--runtime', type=Path, help='Fresh docker cp snapshot containing src/, config/, requirements-docker.txt, nginx.conf')
    args = parser.parse_args()
    repo = args.repo.resolve()
    def git(*parts):
        return run('git', '-C', str(repo), *parts)
    if args.action == 'create':
        if not args.build_revision:
            parser.error('--build-revision is required for create')
        build = git('rev-parse', args.build_revision)
        # The supplied build provenance must still match the current frontend source.
        if git('diff', build, '--', 'frontend'):
            raise SystemExit('Frontend source differs from build revision; rebuild first')
        if git('status', '--porcelain', '--untracked-files=no'):
            raise SystemExit('Tracked source has uncommitted changes')
        if not (args.static / 'index.html').is_file():
            raise SystemExit('Missing static index.html')
        runtime = [p for p in git('ls-files', 'src', 'config', 'requirements-docker.txt').splitlines() if (repo / p).is_file()]
        manifest = {
            'revision': git('rev-parse', 'HEAD'),
            'build_revision': build,
            'branch': git('branch', '--show-current'),
            'runtime': {p: digest(repo / p) for p in runtime},
            'nginx': digest(repo / 'docker/nginx.conf'),
            'static': {str(p.relative_to(args.static)): digest(p) for p in sorted(args.static.rglob('*')) if p.is_file()},
        }
        args.manifest.write_text(json.dumps(manifest, indent=2) + '\n')
        print(f"Manifest created: {manifest['revision']}; {len(manifest['static'])} static files")
        return
    manifest = json.loads(args.manifest.read_text())
    errors = []
    if git('rev-parse', 'HEAD') != manifest['revision']:
        errors.append('repository revision mismatch')
    if git('status', '--porcelain'):
        errors.append('repository has uncommitted/untracked files')
    if git('branch', '--show-current') != manifest['branch']:
        errors.append('repository branch mismatch')
    def check(root, entries, label):
        for name, expected in entries.items():
            path = root / name
            if not path.is_file() or digest(path) != expected:
                errors.append(f'{label}: {name}')
    check(repo, manifest['runtime'], 'repository source mismatch')
    check(repo, {'docker/nginx.conf': manifest['nginx']}, 'repository nginx mismatch')
    check(args.static, manifest['static'], 'static mismatch')
    if args.runtime is not None:
        check(args.runtime, manifest['runtime'], 'container source mismatch')
        check(args.runtime, {'nginx.conf': manifest['nginx']}, 'container nginx mismatch')
        # Python bytecode caches are runtime-generated, not source drift.
        expected = set(manifest['runtime'])
        for folder in ('src', 'config'):
            for path in (args.runtime / folder).rglob('*'):
                name = str(path.relative_to(args.runtime))
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc' and name not in expected:
                    errors.append(f'unexpected container source: {name}')
    else:
        errors.append('runtime snapshot missing; container version not verified')
    if errors:
        print('\n'.join(errors))
        raise SystemExit(1)
    print(f"PASS {manifest['revision']}: clean repository, runtime source, nginx and {len(manifest['static'])} static files match")
    print('Historical hashed static assets may remain for existing browser sessions; they are not included in this release.')


if __name__ == '__main__':
    main()
