# iFrame Studio V0.1.5

AI 影像创作工作台。Powered by Lumenx & Uniart.

- Repository: https://github.com/locopepe2024/iframe
- Working directory: `codex/iframe`
- Frontend / API / desktop shell: `frontend/`, `src/`, `src-tauri/`
- Data: `~/.iframe`; logs: `~/.iframe/logs` (`/root/.iframe` when running as root).
- `IFRAME_DATA_DIR` / `IFRAME_LOG_DIR` override those defaults. Legacy `LUMENX_*` configuration, browser storage and cookies remain compatible.
- Existing `~/.lumen-x` is copied on first access if `~/.iframe` does not exist. Original data is retained.
- Supplied artwork: `logo_1.png`; web logo: `frontend/public/iframe-logo.png`.
- Update checking is inactive, including the desktop updater plugin.

This source migration includes merged LumenX PR #3. Production still requires an explicit release cutover: the former `/srv/lumenx` services/data are not moved by cloning this repository. Deployment script paths now target `/srv/iframe` and `iframe-*` containers.

Original upstream and bundled-skill license notices are retained.
