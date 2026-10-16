# GreenA upgrade and startup contract

Scope: upgrade the iFrame application used with GreenA after administrator merge. New One remains unchanged. Voice library, editing and composition enhancements remain deferred.

## Observed defect and fix

A fresh packaged-process test reproduced MEDIA_ROOT and Pipeline selecting output before config.json loaded. Numeric JSON values also raised an environment type error. Configuration now loads before business-module imports, pipeline construction and static mounts. Numeric values are serialized to strings. Existing .env and packaged config.json entry points remain intact.

## Independent deployment state

Keep deployment environment files outside the release checkout and inject them when creating the container. Do not bake credentials into images or Git. Packaged mode loads <IFRAME_DATA_DIR>/config.json. Preserve config.json when replacing application code.

Provider profiles, catalog names and encrypted credentials live in the user SQLite database selected by LUMENX_USER_DB_PATH, default output/lumenx_users.db. Preserve the database, identity/master-key state and media volumes. Snapshot SQLite consistently, including WAL state.

## Upgrade sequence

1. Wait for reviewed PRs to merge; pin the final full main SHA and image IDs.
2. Inventory environment/config paths, database, media mounts, frontend routing and backend image ID. Keep secrets out of logs and manifests.
3. Back up configuration and consistent databases; record rollback image IDs.
4. Build from the pinned revision. Do not overwrite deployment config, media, user databases or New One containers. Existing lumenx release tooling has different paths and must not be run unchanged on malysis.
5. Validate an isolated durable-state copy: GreenA catalog, saved catalog name, Agent references, historical media/thumb/download and publication route.
6. Cut over preserving mounts and configuration. Verify signed media and expired COS renewal. Paid generation is separate explicit acceptance.
7. Roll back to recorded images if acceptance fails.

Changing media root does not migrate files or databases. Root/backend changes require restart. This change performs no production deployment.

## Validation

Fresh-process test checks configured media root, Pipeline and static mount agreement, numeric JSON TTL and startup snapshots. Backend CI selection: 1394 passed, 5 skipped, 2 deselected. Configuration/catalog focused selection: 30 passed. These are local checks, not production acceptance.
