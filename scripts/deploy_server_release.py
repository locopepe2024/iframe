"""Retired compatibility entry.

The old script guessed service names and modified nginx in place. It is
intentionally non-executable as a deployment path; use ``iframe_release.py``.
"""

raise SystemExit(
    "deploy_server_release.py is retired; use scripts/iframe_release.py "
    "inspect, then sudo scripts/iframe_release.py prepare/deploy --revision <full-sha>"
)
