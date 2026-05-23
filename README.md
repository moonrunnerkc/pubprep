<p align="center">
  <img src="./assets/cover.svg" alt="pubprep cover" width="100%">
</p>

`pubprep` addresses multiple common issues with ai generated code that typical agents do not address:
- Tech Debt reviewer has customized instructions to keep pages under 300 lines at max, explain things simply and easy to understand. Remove redundant / dead / unused code and more.
- Docs reviewer improves current documentation (or creates new) for a more modern feel and overall easy to understand content. includes table of contents, svg cover photo and more.
- Security reviewer evaluates entire codebase for security related issues that are commonly missed / not included by coding agents.
- All findings are sent to a convergance agent that implements root cause fixes in full for all issues found. commits all work, opens a pr with it.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Output](#output)
- [Architecture](#architecture)
- [Cost](#cost)
- [Contributing](#contributing)
- [License](#license)

## Install

Requires Node 18+. Linux and macOS (Windows via WSL).

```bash
npm install -g pubprep
```

**Subscription mode (default).** If `claude` is on your PATH and you're logged in to Claude Code, pubprep routes through it. No API key needed, no per-token charges.

```bash
which claude   # /Users/you/.local/bin/claude → subscription mode
```

**API-key mode.** If `claude` isn't on your PATH, pubprep looks for `ANTHROPIC_API_KEY`. Set it once at the user level:

```bash
mkdir -p ~/.pubprep
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.pubprep/.env
chmod 600 ~/.pubprep/.env
```

Key precedence (highest first): shell export → project `.env` → `~/.pubprep/.env`.

Add `.pubprep/` to `.gitignore` in any project you run pubprep against; that's where reports land and they shouldn't be committed.

## Usage

```bash
pubprep                  # full run: reviewers → convergence → publish gate → push + open PR
pubprep --dry-run        # reviewers only; skip convergence
pubprep --allow-dirty    # proceed even with uncommitted changes
pubprep --no-publish-gate  # skip the clean-tree + typecheck + test gate
pubprep --no-open-pr     # skip the push + 'gh pr create' phase
pubprep --help
pubprep --version
```

pubprep requires a clean working tree by default. Commit or stash before running, or pass `--allow-dirty` to skip the check.

To get the auto-PR behavior, install the [GitHub CLI](https://cli.github.com) (`brew install gh`) and run `gh auth login` once. If `gh` is missing, unauthenticated, or `origin` isn't a GitHub remote, pubprep records the reason in the manifest and prints the manual `git push && gh pr create` commands instead — your local commits are still good either way.

Exit codes:
- `0`: clean run
- `1`: user error (missing auth, not in a git repo, dirty tree without `--allow-dirty`)
- `2`: agent or orchestration failure

## Output

Each run writes to a timestamped directory and updates a `latest` symlink:

```
<project>/
└── .pubprep/
    ├── latest -> runs/2026-05-22T143000Z/
    └── runs/
        └── 2026-05-22T143000Z/
            ├── manifest.json           # run metadata, per-agent stats, cost
            ├── tech-debt-output.md
            ├── readme-docs-output.md
            ├── security-output.md
            ├── combined-review.md      # what convergence reads
            └── convergence-report.md
```

`manifest.json` records the run ID, target repo path, HEAD SHA at run time, per-agent model, turn count, wall time, USD cost (in API-key mode), convergence branch name, exit reason, the publish-gate result, and the pull-request result (URL, opened/existed, or skip/failure reason).

## Architecture

```
pubprep
  └─> load .env (project, then ~/.pubprep/.env)
  └─> auth check (claude binary → subscription; else ANTHROPIC_API_KEY)
  └─> prereq checks (git repo, clean working tree, gitignore coverage)
  └─> orchestrate
        ├─> run-agent(tech-debt)    ─┐
        ├─> run-agent(readme-docs)   ├─ parallel in API-key mode
        └─> run-agent(security)     ─┘  sequential in subscription mode
             ↓ (all three complete)
        concatenate to combined-review.md
             ↓
        run-agent(convergence) ─ streams to stdout, commits, creates branch
             ↓
        publish gate (clean tree + npm run typecheck + npm test)
             ↓ (on pass)
        open PR (git push -u origin <branch> + gh pr create --fill)
             ↓
        write manifest, update .pubprep/latest symlink
```

Three layers:

1. **CLI** (`src/cli.ts`): argv parsing, `.env` loading, auth detection, prereq checks, exit codes.
2. **Orchestrator** (`src/orchestrate.ts`): reviewer phase (parallel or sequential), report concatenation, convergence.
3. **Agent runner** (`src/run-agent.ts`): thin wrapper around `@anthropic-ai/claude-agent-sdk`'s `query()`. Iterates the async generator, appends assistant text to the output file, collects result metadata.

The four agent definitions ship as markdown files in `agents/`. Editing an agent means editing its `.md` and reinstalling pubprep. There's no per-project override mechanism.

## Cost

**Subscription mode** (Claude Code on PATH): no per-run charge. Reviewers run sequentially because the locally-installed Claude Code binary doesn't support concurrent sessions. Expect roughly 10–15 minutes for the three reviewer sessions plus convergence time on top.

**API-key mode** (no `claude` binary, `ANTHROPIC_API_KEY` set): per-token billing at Anthropic's standard rates. Reviewers run in parallel. Model assignments: reviewers use `claude-sonnet-4-6` (max 100 turns each); convergence uses `claude-opus-4-7` (max 300 turns). A real self-run against this codebase saw 33–41 turns per reviewer. Run `pubprep --dry-run` on an unfamiliar repo first to read the reports before committing to the full convergence pass.

## Contributing

```bash
git clone https://github.com/<owner>/pubprep
cd pubprep
npm install
npm run build     # tsc → dist/
npm test          # vitest run
npm run typecheck # tsc --noEmit
npm link          # install globally from local source
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for project structure, agent editing, and PR expectations.

## License

MIT. See [LICENSE](./LICENSE).
