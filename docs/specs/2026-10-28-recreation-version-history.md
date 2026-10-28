# Recreation source identity and project history

## Scope

PR #227 currently opens existing Recreation source projects. This slice adds
project revision history; it does not provide a standalone multi-video Assembly
editor. That editor remains separate follow-up work. Library selection currently
opens the original Recreation project, so the UI must disclose that behavior.

## Contract

- Source identity is the owner-scoped media ID plus SHA-256, not project revision.
- Project revision is monotonic. Each persisted revision has an immutable snapshot.
- Existing projects gain a baseline snapshot on their next save or restore.
- History reads and restores require the same owner as the project.
- Restore uses an expected current revision, rejects active analysis, and checks
  source identity and bytes before applying a historical snapshot.
- Restore produces a new revision and records the restored revision. Historical
  tasks and rendered outputs retain their original revision; restore does not
  relaunch paid tasks or relabel old outputs as current.
- Active analysis snapshots cannot be restored. Source and owner identity remain
  fixed; restoring history does not replace uploaded media.

## Verification

Targeted tests cover owner isolation, stale restore, monotonic revision, preserved
history, active-analysis rejection, and source mutation rejection. Frontend checks:
typecheck, Recreation UI tests, production build. No deployment in this slice.
