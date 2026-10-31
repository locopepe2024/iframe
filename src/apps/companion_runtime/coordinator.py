"""Best-effort call to the local read-only task coordinator."""
import os

import requests


def decide(text, context):
    url = os.getenv('IFRAME_COMPANION_COORDINATOR_URL', '').strip()
    if not url:
        return None
    try:
        response = requests.post(url, json={'input': text, 'workflow_context': context}, timeout=(0.5, 3))
        response.raise_for_status()
        decision = response.json().get('decision')
        if decision.get('focus') not in {'chat', 'diary', 'album'} or not isinstance(decision.get('action'), str):
            return None
        return {'focus': decision['focus'], 'action': decision['action'][:80], 'need_clarification': bool(decision.get('need_clarification')), 'source': decision.get('source', 'model')}
    except (requests.RequestException, ValueError, TypeError, AttributeError):
        return None
