"""Server-side handshake for an OpenTalking session with iframe context.

The caller supplies a verified iframe identity. The bearer is sent only to the
iframe bind/release routes; OpenTalking receives an opaque context token.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping
from uuid import uuid4

import httpx


class OpenTalkingSessionError(RuntimeError):
    pass


@dataclass(frozen=True)
class BoundOpenTalkingSession:
    session_id: str
    context_token: str
    expires_at: float


class OpenTalkingSessionClient:
    def __init__(self, client: httpx.AsyncClient, *, iframe_base: str, opentalking_base: str):
        self.client = client
        self.iframe_base = iframe_base.rstrip('/')
        self.opentalking_base = opentalking_base.rstrip('/')

    async def create_bound(
        self,
        *,
        identity_headers: Mapping[str, str],
        create_payload: Mapping[str, object] | None = None,
        session_id: str | None = None,
        ttl_seconds: int = 900,
    ) -> BoundOpenTalkingSession:
        bearer = next((value for key, value in identity_headers.items()
                       if key.lower() == 'authorization' and value.startswith('Bearer ')), None)
        if not bearer:
            raise OpenTalkingSessionError('Verified bearer identity is required')
        sid = session_id or f'sess_{uuid4().hex[:12]}'
        payload = dict(create_payload or {})
        payload.update({
            'session_id': sid,
            'iframe_context_gateway_url': self.iframe_base + '/companion-runtime/opentalking',
        })
        bind = await self._request(
            'POST', self.iframe_base + '/companion-runtime/opentalking/bind',
            headers={'Authorization': bearer}, json={'session_id': sid, 'ttl_seconds': ttl_seconds},
        )
        token = bind.get('context_token')
        expires_at = bind.get('expires_at')
        if not isinstance(token, str) or not token or not isinstance(expires_at, (int, float)):
            raise OpenTalkingSessionError('iframe returned an invalid context binding')
        payload['iframe_context_token'] = token
        try:
            created = await self._request('POST', self.opentalking_base + '/sessions', json=payload)
            actual_id = created.get('session_id')
            if actual_id != sid:
                raise OpenTalkingSessionError('OpenTalking did not preserve the bound session id')
        except Exception:
            await self._release(token)
            raise
        return BoundOpenTalkingSession(sid, token, float(expires_at))

    async def close(self, session: BoundOpenTalkingSession) -> None:
        try:
            response = await self.client.delete(
                f'{self.opentalking_base}/sessions/{session.session_id}', timeout=5.0,
                follow_redirects=False,
            )
            response.raise_for_status()
        finally:
            await self._release(session.context_token)

    async def _release(self, token: str) -> None:
        try:
            response = await self._request(
                'POST', self.iframe_base + '/companion-runtime/opentalking/release',
                json={'context_token': token},
            )
            if response.get('status') != 'released':
                raise OpenTalkingSessionError('iframe did not release context binding')
        except (httpx.HTTPError, OpenTalkingSessionError):
            # Expiry remains the safety boundary; callers should log this state.
            return

    async def _request(self, method: str, url: str, **kwargs) -> dict:
        try:
            response = await self.client.request(method, url, timeout=5.0,
                follow_redirects=False, **kwargs)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise OpenTalkingSessionError('OpenTalking context handshake failed') from exc
        if not isinstance(payload, dict):
            raise OpenTalkingSessionError('OpenTalking returned an invalid response')
        return payload
