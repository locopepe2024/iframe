"""Process-local, single-worker binding boundary for the OpenTalking demo.

The authenticated integration server owns this registry. Never expose bind()
directly as an unauthenticated browser route or pass its credentials to models.
"""
import secrets
import time
from dataclasses import dataclass, field
from typing import Callable

import httpx

from .opentalking_context import IframeContextReader, IframeGroundedLLM


class BindingUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class _Binding:
    owner: str
    actor: str
    expires_at: float
    headers: dict[str, str] = field(repr=False)
    generation: str = field(repr=False)


class SessionBindings:
    def __init__(self, *, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._bindings: dict[str, _Binding] = {}
        self._gateway_tokens: dict[str, str] = {}

    def bind(self, session_id: str, *, owner: str, actor: str,
             identity_headers: dict[str, str], expires_at: float):
        self.sweep()
        if not session_id or not owner or not actor or not self._clock() < expires_at <= self._clock() + 3600:
            raise ValueError('Invalid session binding')
        if session_id in self._bindings:
            raise BindingUnavailable('Session already bound; create a new session')
        if len(self._bindings) >= 1000:
            raise BindingUnavailable('Session binding capacity reached')
        # A validated short-lived bearer is required. Browser fingerprints are
        # intentionally not upgraded into credentials by this module.
        header = identity_headers.get('Authorization', '')
        if not header.startswith('Bearer ') or not header[7:].strip():
            raise ValueError('Validated bearer identity is required')
        self._bindings[session_id] = _Binding(owner, actor, expires_at,
            {'Authorization': header}, secrets.token_hex(16))

    def issue_gateway_token(self, session_id: str, *, owner: str, actor: str) -> str:
        self._require(session_id, owner, actor)
        token = secrets.token_urlsafe(32)
        self._gateway_tokens[token] = session_id
        return token

    def resolve_gateway_token(self, token: str) -> tuple[str, _Binding]:
        self.sweep()
        session_id = self._gateway_tokens.get(token)
        if not session_id:
            raise BindingUnavailable('Context gateway token unavailable')
        entry = self._bindings.get(session_id)
        if entry is None:
            self._gateway_tokens.pop(token, None)
            raise BindingUnavailable('Context gateway token expired')
        return session_id, entry

    def release_gateway_token(self, token: str) -> str:
        """Revoke a gateway token and its session binding idempotently only on success."""
        self.sweep()
        session_id = self._gateway_tokens.pop(token, None)
        if not session_id:
            raise BindingUnavailable('Context gateway token unavailable')
        if session_id in self._bindings:
            del self._bindings[session_id]
        return session_id

    def sweep(self):
        expired = [sid for sid, entry in self._bindings.items() if entry.expires_at <= self._clock()]
        for sid in expired:
            del self._bindings[sid]
        if expired:
            expired_sessions = set(expired)
            for token, session_id in list(self._gateway_tokens.items()):
                if session_id in expired_sessions:
                    del self._gateway_tokens[token]

    def _require(self, session_id: str, owner: str, actor: str) -> _Binding:
        self.sweep()
        entry = self._bindings.get(session_id)
        if entry is None or (entry.owner, entry.actor) != (owner, actor):
            raise BindingUnavailable('Session binding unavailable')
        return entry

    def release(self, session_id: str, *, owner: str, actor: str):
        self._require(session_id, owner, actor)
        del self._bindings[session_id]
        for token, bound_session in list(self._gateway_tokens.items()):
            if bound_session == session_id:
                del self._gateway_tokens[token]

    def revoke_owner(self, owner: str):
        for sid in [sid for sid, entry in self._bindings.items() if entry.owner == owner]:
            self.release(sid, owner=owner, actor=self._bindings[sid].actor)

    async def grounded_llm(self, session_id: str, *, owner: str, actor: str,
                           client: httpx.AsyncClient, companion_base: str,
                           knowledge_base: str, identity_base: str, upstream):
        """Return a stream wrapper that rechecks binding + identity each turn."""
        initial = self._require(session_id, owner, actor)
        registry = self

        class BoundLLM:
            async def chat_stream(self, messages):
                entry = registry._require(session_id, owner, actor)
                if entry.generation != initial.generation:
                    raise BindingUnavailable('Session binding changed')
                try:
                    response = await client.get(identity_base.rstrip('/') + '/auth/me',
                        headers=entry.headers, timeout=3.0, follow_redirects=False)
                    response.raise_for_status()
                    identity = response.json()
                    actual = (identity['profile']['profile_id'], identity['user']['user_id'])
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    raise BindingUnavailable('iframe identity verification failed') from None
                if actual != (owner, actor):
                    raise BindingUnavailable('iframe identity changed')
                if registry._require(session_id, owner, actor) != entry:
                    raise BindingUnavailable('Session binding changed')
                reader = IframeContextReader(client, companion_base=companion_base,
                    knowledge_base=knowledge_base, identity_headers=entry.headers)
                def recheck():
                    if registry._require(session_id, owner, actor) != entry:
                        raise BindingUnavailable('Session binding changed')
                async for chunk in IframeGroundedLLM(upstream, reader,
                        before_llm=recheck).chat_stream(messages):
                    # A logout/release/expiry during a streaming reply must stop
                    # emitting further chunks from that binding.
                    if registry._require(session_id, owner, actor) != entry:
                        raise BindingUnavailable('Session binding changed')
                    yield chunk

        return BoundLLM()
