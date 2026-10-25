"""Host-side bounded demo TURN setup. Does not edit cloud/host firewall rules."""
import json
from pathlib import Path
import secrets
import subprocess

root = Path('/srv/lumenx/opentalking-mock')
config = root / 'turnserver.conf'
credential = secrets.token_urlsafe(32)
username = 'mock-demo'
config.write_text('\n'.join([
    'listening-port=3478', 'listening-ip=0.0.0.0', 'relay-ip=10.203.0.10',
    'external-ip=101.32.100.239/10.203.0.10', 'realm=opentalking-mock',
    'lt-cred-mech', f'user={username}:{credential}', 'fingerprint',
    'min-port=49160', 'max-port=49200', 'user-quota=8', 'total-quota=8',
    'no-cli', 'no-tls', 'no-dtls', 'no-multicast-peers', 'log-file=stdout',
    'simple-log', 'no-tcp-relay',
]) + '\n')
config.chmod(0o600)
settings = {
    'OPENTALKING_WEBRTC_TURN_URLS': 'turn:garage.uniart.fun:3478?transport=tcp,turn:garage.uniart.fun:3478?transport=udp',
    'OPENTALKING_WEBRTC_TURN_USERNAME': username,
    'OPENTALKING_WEBRTC_TURN_CREDENTIAL': credential,
    'OPENTALKING_WEBRTC_ICE_TRANSPORT_POLICY': 'relay',
    'OPENTALKING_WEBRTC_SERVER_ICE_SERVERS': '[{"urls":"stun:stun.cloudflare.com:3478"}]',
}
pending = root / 'turn-env.json'
pending.write_text(json.dumps(settings))
pending.chmod(0o600)
subprocess.run(['docker', 'run', '-d', '--name', 'iframe-opentalking-turn',
    '--network', 'host', '--restart', 'unless-stopped', '--memory', '128m',
    '--cpus', '0.5', '--user', '0', '-v', f'{config}:/etc/coturn/turnserver.conf:ro',
    'coturn/coturn:4.6.3', '-c', '/etc/coturn/turnserver.conf'], check=True)
print('TURN listening; settings staged only, not yet applied to Mock')
