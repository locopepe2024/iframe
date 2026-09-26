# Browser workspace identity recovery v1

## Observed

- Workspaces, projects, and user configuration are scoped by the server-side
  `owner_profile_id`.
- Anonymous browser mode normally derives that owner from the HttpOnly
  `lumenx-browser-profile` cookie.
- The provider API key is encrypted configuration; it is not a workspace
  identity and must not be used as one.
- A browser restart or embedded runtime can lose or omit the cookie while
  retaining local storage. The server then creates a new anonymous owner and
  historical projects appear missing.

## Contract

1. Bearer identity remains authoritative when present.
2. The HttpOnly browser-profile cookie remains authoritative when present.
3. When neither is present, the frontend sends a random, browser-local
   installation identifier from local storage. The backend may use it only to
   recreate the same anonymous browser owner and must set the normal HttpOnly
   cookie again.
4. The installation identifier is a continuity hint, not authentication. It
   must never override a bearer token or an existing browser-profile cookie.
5. API keys remain provider credentials and are never converted into owner IDs.

## Success criteria

- A cookie-preserving browser keeps the existing owner behavior.
- If the cookie is missing after restart but local storage remains, the same
  owner profile and historical projects are recovered.
- Two fresh browser installations receive different owner profiles.
- Bearer requests ignore the continuity hint.
- No secret or provider API key is stored in the continuity identifier.
