import json, pathlib, subprocess, time, urllib.request, sys, tempfile, os


def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()

repo = pathlib.Path('/srv/lumenx/repo')
rev = run(['git', '-C', str(repo), 'rev-parse', 'HEAD'])
assert not run(['git', '-C', str(repo), 'status', '--porcelain']), 'Dirty repository'
root = pathlib.Path('/srv/lumenx/releases') / rev
root.mkdir(parents=True, exist_ok=True)
source = root / 'source'
source.mkdir(exist_ok=True)
archive = root / 'source.tar'
run(['git', '-C', str(repo), 'archive', '--output', str(archive), rev])
run(['tar', '-xf', str(archive), '-C', str(source)])
image = 'lumenx-backend:git-' + rev[:12]
with (root / 'build.log').open('w') as log:
    subprocess.run(['docker', 'build', '--label', 'org.opencontainers.image.revision='+rev, '-t', image, '-f', str(source/'Dockerfile.backend'), str(source)], stdout=log, stderr=subprocess.STDOUT, check=True)
run(['docker', 'run', '--rm', image, 'python', '-c', 'from src.apps.comic_gen.api import app; assert "/agent/sessions/{sid}/messages/{mid}" in app.openapi()["paths"]'])
old = json.loads(run(['docker', 'inspect', 'lumenx-backend']))[0]
backup = 'lumenx-backend-before-' + rev[:12]
# Docker inspection contains credentials. Keep it in memory; never persist it.
args = ['docker','create','--name','lumenx-backend','--network','lumenx-net','--network-alias','backend','--restart','unless-stopped']
fd, envfile = tempfile.mkstemp(prefix='lumenx-env-', dir=root)
with os.fdopen(fd, 'w') as f:
    f.write('\n'.join(old['Config']['Env']) + '\n')
args += ['--env-file', envfile]
for m in old['Mounts']:
    assert m['Type'] == 'bind'
    args += ['-v', m['Source']+':'+m['Destination']+('' if m['RW'] else ':ro')]
for port, bindings in old['HostConfig']['PortBindings'].items():
    for b in bindings:
        args += ['-p', (b['HostIp'] or '127.0.0.1')+':'+b['HostPort']+':'+port]
args += [image]
renamed = False
nginx_path = repo / 'docker/nginx.conf'
nginx_original = nginx_path.read_text()
# Git replaces the file inode; a single-file Docker bind can retain the old one.
# Read inside the container (docker cp can observe the host-side mount instead).
if run(['docker', 'exec', 'lumenx-frontend', 'cat', '/etc/nginx/conf.d/default.conf']) != nginx_original.strip():
    run(['docker', 'restart', 'lumenx-frontend'])
    assert run(['docker', 'exec', 'lumenx-frontend', 'cat', '/etc/nginx/conf.d/default.conf']) == nginx_original.strip(), 'Stale nginx bind mount'
run(['docker', 'exec', 'lumenx-frontend', 'nginx', '-t'])
maintenance = '''
    # Drain existing Chat requests; refuse new submissions during deployment.
    location ^~ /agent/ {
        default_type application/json;
        if ($request_method = POST) { return 503 '{"detail":"Chat 正在更新，请稍后重试；当前输入已保留"}'; }
        proxy_pass http://backend:17177;
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
'''
maintenance_applied = False
try:
    nginx_path.write_text(nginx_original.replace('    listen 80;', '    listen 80;' + maintenance, 1))
    maintenance_applied = True
    run(['docker', 'exec', 'lumenx-frontend', 'nginx', '-t'])
    run(['docker', 'exec', 'lumenx-frontend', 'nginx', '-s', 'reload'])
    time.sleep(2)
    for attempt in range(24):
        active = int(run(['docker', 'exec', 'lumenx-backend', 'python', '-c',
            'import sqlite3,os,time; db=sqlite3.connect(os.getenv("LUMENX_AGENT_DB","output/agent.sqlite3")); print(db.execute("SELECT count(*) FROM sessions WHERE busy>?",(time.time(),)).fetchone()[0])']))
        if not active:
            break
        print('Waiting for active Chat requests:', active, flush=True)
        time.sleep(10)
    else:
        raise RuntimeError('Active Chat requests did not drain; deployment aborted')
    run(['docker', 'stop', '--time', '210', 'lumenx-backend'])
    run(['docker', 'rename', 'lumenx-backend', backup])
    renamed = True
    run(args)
    run(['docker', 'start', 'lumenx-backend'])
    for attempt in range(30):
        try:
            with urllib.request.urlopen('http://127.0.0.1:17177/openapi.json',timeout=2) as r:
                assert '/agent/sessions/{sid}/messages/{mid}' in json.load(r)['paths']
            break
        except Exception:
            if attempt == 29: raise
            time.sleep(1)
    run(['docker','exec','lumenx-frontend','nginx','-t'])
    run(['docker','exec','lumenx-frontend','nginx','-s','reload'])
    with urllib.request.urlopen('http://127.0.0.1:3000/openapi.json', timeout=5) as r:
        assert '/agent/sessions/{sid}/messages/{mid}' in json.load(r)['paths']
    record = {'revision': rev, 'image': run(['docker','inspect','lumenx-backend','--format','{{.Image}}']), 'rollback_container': backup}
    (root/'deployment.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(record))
except Exception as e:
    if renamed:
        subprocess.run(['docker','rm','-f','lumenx-backend'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        run(['docker','rename',backup,'lumenx-backend'])
    run(['docker','start','lumenx-backend'])
    run(['docker','exec','lumenx-frontend','nginx','-s','reload'])
    print('Deployment rolled back:', type(e).__name__)
    sys.exit(1)
finally:
    if maintenance_applied:
        nginx_path.write_text(nginx_original)
        run(['docker', 'exec', 'lumenx-frontend', 'nginx', '-t'])
        run(['docker', 'exec', 'lumenx-frontend', 'nginx', '-s', 'reload'])
    os.unlink(envfile)
