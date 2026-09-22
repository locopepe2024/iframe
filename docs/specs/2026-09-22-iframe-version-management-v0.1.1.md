# iFrame Version Management v0.1.1

## Objective

Promote the COS-editable-reference fix from `436bb465` to a reproducible iFrame
Studio patch release while preventing application-version drift across the web,
backend, desktop shell, package metadata, and user-visible documentation.

## Source of truth

- `VERSION` is the canonical application version, containing a strict SemVer
  value (`0.1.1`) and a trailing newline.
- `scripts/update_version.py` is the only supported mutation path for changing
  the release version. It updates all generated/duplicated version surfaces.
- `scripts/check_version_consistency.py` is the read-only CI/local guard. It
  fails when any checked surface disagrees with `VERSION`.

## Checked surfaces

- root `package.json`
- `frontend/package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` and the `iframe-studio` package block in `Cargo.lock`
- FastAPI application metadata in `src/apps/comic_gen/api.py`
- frontend-generated `frontend/src/generated/appVersion.ts`
- settings/sidebar UI version labels
- README release headings

## Boundaries

- This slice does not change model-catalog schema versions, persisted user-data
  envelope versions, style-preset versions, dependency lock versions, or
  historical design-document references.
- It does not change updater behavior; the existing updater remains inactive.
- It does not alter the COS proxy or asset-variant behavior from `436bb465`.
- No release tag or remote push is created by the implementation slice.

## Success criteria

1. Every checked runtime/documentation surface reports `0.1.1` / `V0.1.1`.
2. The frontend imports its displayed version from the generated version module,
   rather than maintaining a component-local literal.
3. `python3 scripts/check_version_consistency.py` passes on a clean tree.
4. The updater script rejects malformed/non-SemVer values and can update the
   checked surfaces deterministically.
5. Existing focused backend/frontend checks remain runnable; no unrelated files
   are changed.

## Verification commands

```bash
python3 scripts/check_version_consistency.py
python3 scripts/update_version.py --check 0.1.1
python3 -m py_compile src/apps/comic_gen/api.py scripts/check_version_consistency.py scripts/update_version.py
cd frontend && npm run typecheck
```

