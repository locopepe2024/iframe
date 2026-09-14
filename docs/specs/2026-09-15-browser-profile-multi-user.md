# Browser-profile multi-user boundary

## Decision

LumenX does not present or proxy a second UniArt login flow. The default web
identity is a browser-scoped anonymous profile, represented by an HttpOnly
cookie. Existing UniArt Bearer sessions remain accepted for compatibility, but
are not required for normal LumenX use.

## Evidence and boundary

- The previous `/auth/login` implementation synchronously called Canvas's
  `/api/auth/login`; a 502 therefore represented an unnecessary identity
  dependency, not a generation failure.
- Canvas's browser client persists a client session context and sends it with
  API requests; LumenX needs the same owner-scoped behavior without duplicating
  the login screen.
- Browser profiles are isolation namespaces, not authenticated UniArt
  accounts. A user changing or copying the cookie is outside this boundary.

## Behavior

- First API request creates a random browser profile and sets
  `lumenx-browser-profile` as an HttpOnly, SameSite=Lax cookie.
- Subsequent requests derive `owner_user_id` and `owner_profile_id` from that
  cookie and use the existing owner-aware stores.
- API keys remain encrypted at rest and are never returned in full.
- The login UI and login gate are removed from the normal web path.
- Bearer authentication remains available for existing integrations.

## Success criteria

- Opening LumenX does not call `/auth/login` or require credentials.
- Two independent browser cookie jars receive different owner scopes.
- Each browser can save and read only its own configuration and data.
- `/health` and normal frontend routing remain available.
- Existing authenticated Bearer requests continue to work.
