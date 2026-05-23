<p align="center">
  <img src="./assets/cover.svg" alt="pubprep cover" width="100%">
</p>

# pubprep

`pubprep` runs three AI reviewer agents (tech debt, docs, security) against the git repo in your current directory, then a convergence agent that reads their combined output and applies fixes on a new branch. One command from "almost ready" to "worth merging."

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Node: ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square)](./tsconfig.json)
[![Version](https://img.shields.io/badge/version-0.1.0-orange?style=flat-square)](./package.json)

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
pubprep                # full run: three reviewers, then convergence
pubprep --dry-run      # reviewers only; skip convergence
pubprep --allow-dirty  # proceed even with uncommitted changes
pubprep --help
pubprep --version
```

pubprep requires a clean working tree by default. Commit or stash before running, or pass `--allow-dirty` to skip the check.

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

`manifest.json` records the run ID, target repo path, HEAD SHA at run time, per-agent model, turn count, wall time, USD cost (in API-key mode), convergence branch name, and exit reason.

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
