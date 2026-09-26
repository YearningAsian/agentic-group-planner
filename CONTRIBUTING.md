# Contributing

## Setup

Requires Node 24+, pnpm 11, Python 3.12, and [gitleaks](https://github.com/gitleaks/gitleaks) 8.30 or later.

```bash
pnpm install                 # also points git at .githooks/ (the root "prepare" script)
cd optimizer && pip install -r requirements-dev.txt
```

Install gitleaks with your package manager: `winget install Gitleaks.Gitleaks` on Windows, `brew install gitleaks` on macOS, or a release binary on Linux.

## Secrets

Keys live only in gitignored env files: `web/.env.local`, `optimizer/.env`, and `.env.test.local`. The `.env.example` files hold placeholders and are the only env files in git.

A pre-commit hook in `.githooks/pre-commit` runs `gitleaks git --pre-commit --staged` and blocks any commit whose staged changes contain a secret. It also blocks the commit if gitleaks isn't installed, rather than skipping the scan. If `pnpm install` didn't enable it (for example, you haven't installed yet), run:

```bash
git config core.hooksPath .githooks
```

If the hook flags a finding:

1. Unstage the file, and move the value into the right env file.
2. If it's a false positive, add the finding's fingerprint to `.gitleaksignore` in the same commit, and say why in the commit message.
3. Don't bypass the hook with `--no-verify`.

GitHub secret scanning and push protection are also on for this repository. If a real secret ever reaches GitHub, rotate it first, then remove it from history.

## Before you commit

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test
cd optimizer && ruff check && pytest
python planning/tools/check_plan.py   # after editing anything under planning/
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(web): …`, `fix(db): …`, `docs: …`. Keep each commit to one purpose, and never force-push to `main`.
