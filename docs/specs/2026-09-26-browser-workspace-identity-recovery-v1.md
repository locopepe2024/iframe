# API-key workspace identity recovery v1

## Observed

- Workspaces, projects, and user configuration are scoped by the server-side
  `owner_profile_id`.
- The open-source iframe build uses the configured provider API key as the
  stable workspace identity.
- The API key itself must not be persisted in project records or owner IDs;
  only a one-way fingerprint is used for identity lookup.

## Contract

1. Bearer identity remains authoritative when present.
2. The frontend stores only a SHA-256 fingerprint of the configured API key
   and sends it as the workspace identity hint.
3. The backend maps that fingerprint to a stable `apikey-*` owner scope.
4. A legacy browser-profile cookie is accepted only when no API-key identity
   is available; once a key is configured, the key-derived owner wins.
5. The API key fingerprint is a workspace namespace, not a provider
   authorization substitute; provider calls still use the encrypted key.
6. When an API-key request still carries a legacy browser owner hint, Studio
   may migrate only that explicitly identified legacy owner to the API-key
   owner. The old media directory is retained as a rollback copy.

## Success criteria

- Restarting the browser with the same configured API key recovers the same
  owner profile and historical projects.
- Different API keys receive different owner profiles.
- Bearer requests remain authoritative for integrations that use them.
- No plaintext API key is stored in the identity header, owner ID, or project
  data.
- Projects and series created under the identified legacy browser owner are
  visible after the first API-key request without merging unrelated browser
  workspaces.
