# API-key scoped session token v1

## Contract

- `POST /auth/session-token` accepts `{ "api_key": "...", "ttl_seconds": 60..3600 }`.
- The response returns an opaque `iframe-session.*` Bearer token and its `expires_at`.
- The token contains only a SHA-256 API-key fingerprint, issue time, expiry, and a nonce; it never contains the API key.
- Requests with this token resolve to `apikey-<fingerprint>` and remain API-key scoped even when an old browser cookie or login token exists.
- The server signs tokens with `LUMENX_SESSION_TOKEN_SECRET`, or the configured `LUMENX_CONFIG_MASTER_KEY`.

## MCP / HTTPS use

```sh
curl -sS https://garage.uniart.fun/auth/session-token \
  -H 'Content-Type: application/json' \
  --data '{"api_key":"<API_KEY>","ttl_seconds":900}'

curl -sS https://garage.uniart.fun/projects \
  -H 'Authorization: Bearer <access_token>'
```

Do not put the API key in a URL, owner identifier, or project record. Do not log the token or API key.

## Upload boundary

The frontend sends business requests with the API-key identity fingerprint. When that fingerprint exists, it removes any stale browser Bearer header. Multipart upload leaves `Content-Type` unset so the browser supplies the boundary. A single-file upload is still one `POST /playground/upload`; the UI may issue multiple independent requests only when the user selects multiple files.
