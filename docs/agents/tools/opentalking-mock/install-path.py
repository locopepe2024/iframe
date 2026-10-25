"""Run with sudo on iframe after installing the dedicated 3444 nginx site."""
from pathlib import Path
import shutil
import subprocess
import time

site = Path('/etc/nginx/sites-available/garage.uniart.fun')
original = site.read_text()
marker = '    location = /companion-demo'
addition = '''    location = /opentalking-mock { return 302 /opentalking-mock/; }
    location ^~ /opentalking-mock/ {
        proxy_pass https://127.0.0.1:3444/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
'''
if 'location ^~ /opentalking-mock/' not in original:
    assert marker in original
    shutil.copy2(site, f'/srv/lumenx/opentalking-mock/nginx-backup-{int(time.time())}.conf')
    site.write_text(original.replace(marker, addition + marker, 1))
    if subprocess.run(['nginx', '-t']).returncode:
        site.write_text(original)
        raise SystemExit('Invalid nginx configuration; restored original')
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
