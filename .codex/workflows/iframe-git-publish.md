---
name: iframe-git-publish
description: iFrame GitHub publish workflow for safe commits, sensitive-data scans, and PR-based pushes to the GitHub mirror.
---

# iFrame GitHub Publish Workflow

Use this workflow when working in this repository and the user asks to publish work to the iFrame GitHub mirror, prepare a GitHub-ready branch, or follow the iFrame GitHub release process.

## Core Rules

- Never push directly to `main`. Use a feature, fix, or docs branch and open a PR.
- Push to the `github` remote only. Ignore `origin` for publishing.
- Run sensitive-data checks before any push.
- Commit messages must follow Conventional Commits.
- Use `Owen <owen.fang1977@gmail.com>` as the git commit author for iFrame GitHub mirror submissions in this repo.
- Open GitHub PRs with the `locopepe2024` GitHub account; switch `gh` to `locopepe2024` before running `gh pr create` when another account is active.

Repository-specific constraints:

- GitHub remote: `github`
- GitHub repository: `https://github.com/locopepe2024/iframe.git`
- Allowed branch prefixes: `feature/`, `fix/`, `docs/`

## Step 1: Confirm Branch

Check the current branch:

```bash
git branch --show-current
```

If the branch is `main`, create a safe branch first:

```bash
git checkout -b feature/<your-feature-name>
```

## Step 2: Sensitive-Data Checks

Run all of the following checks. Any hit must be reviewed and resolved before continuing.

Search for suspicious hardcoded secrets:

```bash
git grep -E "['\"][a-zA-Z0-9_-]{40,}['\"]" -- ':(exclude)*.lock' ':(exclude)node_modules'
```

Search for internal company domains:

```bash
git grep -i "alibaba-inc.com"
```

Search for credential-like patterns:

```bash
git grep -iE "(sk-|AKID|access_key|password|pwd|token|bearer)" -- ':(exclude)*.lock' ':(exclude)*.example' ':(exclude)node_modules'
```

Search tracked sensitive files:

```bash
git ls-files | grep -E "\.env$|secret|credential|\.key$|\.pem$" | grep -v "\.example"
```

## Step 3: Check .gitignore Coverage

Verify that `.gitignore` contains the expected sensitive and local paths:

```bash
grep -E "^\.env|^\.agent|^CLAUDE\.md|^output/" .gitignore
```

Expected coverage includes:

- `.env`
- `.agent/`
- `CLAUDE.md`
- `output/`

## Step 4: Workflow Mirror Parity Check (when workflow mirrors changed)

If the change touches `.claude/commands/` or `.codex/workflows/`, run:

```bash
python3 scripts/check_workflow_parity.py
```

On failure: sync the mirrored files on both sides, or record an intentional divergence with its reason in the script's `WAIVERS`.

## Step 5: Optional Quality Checks

Run relevant checks when the changed files warrant them.

Backend formatting and lint:

```bash
black --check src/
flake8 src/
```

Frontend lint:

```bash
cd frontend && npm run lint
```

## Step 6: Stage Carefully

Stage only the intended files. Do not use `git add .`.

```bash
git add <specific-files>
```

## Step 7: Commit

Create an English Conventional Commit message:

```bash
git commit -m "feat: your descriptive commit message"
```

Before committing, confirm the author identity matches the project convention:

```bash
git log -1 --format='%an <%ae>'
```

Expected author for GitHub-bound commits in this repo:

- `Owen <owen.fang1977@gmail.com>`

Common prefixes:

- `feat:`
- `fix:`
- `docs:`
- `style:`
- `refactor:`
- `test:`
- `chore:`

## Step 8: Push to GitHub

Push the current branch to the `github` remote:

```bash
git push -u github <branch-name>
```

## Step 9: Create a Pull Request

Use GitHub CLI to open the PR:

```bash
gh auth switch --hostname github.com --user locopepe2024
```

```bash
gh pr create --repo locopepe2024/iframe --title "feat: your PR title" --body "$(cat <<'EOF'
## Summary
- <change description>

## Test plan
- [ ] <test checklist>

EOF
)"
```

## Step 10: Post-Push Verification

- Confirm the branch and PR are visible on GitHub.
- Check README rendering if docs changed.
- Confirm no sensitive information leaked in the diff.

## Emergency Rollback

If the commit has not been pushed yet:

```bash
git reset --soft HEAD~1
```

If sensitive data was already pushed, the history must be cleaned with BFG Repo-Cleaner and force pushed. Contact the team for assistance.
