# pubprep

A CLI that runs four bundled review agents — tech debt, README/docs, security, and a convergence agent that fixes what the first three flag — against the git repo in your current directory. One command, four agents, real edits committed on a branch you review.

## What it does

Three reviewer agents run in parallel against your working tree using the Claude Agent SDK's read-only tools (filesystem, grep, bash). They each write a structured report to `.pubprep/runs/<timestamp>/`. The three reports are concatenated into `combined-review.md`, and the convergence agent reads that file and executes the resolution plan against your repo — atomic commits on a new `convergence/<date>-<theme>` branch, tests run as it goes, anything irreversible queued as a maintainer-action item.

## Install

```
npm install -g pubprep
```

Requires Node 18+. Linux and macOS only (Windows via WSL).

Set your key **once** in a user-level config file and pubprep finds it from any project:

```
mkdir -p ~/.pubprep
echo "ANTHROPIC_API_KEY=sk-ant-..." > ~/.pubprep/.env
chmod 600 ~/.pubprep/.env
```

Get a key at https://console.anthropic.com/. From then on, `pubprep` works in any git repo with no per-project setup.

Precedence (highest first): `process.env.ANTHROPIC_API_KEY` (shell export) → project `.env` → `~/.pubprep/.env`. A per-project `.env` still works if you want a different key for one repo.

Also gitignore `.pubprep/` in any project you run pubprep against — that's where it writes reports.

## Usage

```
pubprep                # full run: three reviewers, then convergence
pubprep --dry-run      # reviewers only; skip convergence
pubprep --allow-dirty  # proceed even with uncommitted changes
pubprep --help
pubprep --version
```

Exit codes:
- `0` — clean run
- `1` — user-facing error (missing key, not in a git repo, dirty tree without `--allow-dirty`)
- `2` — agent or orchestration failure

## Output

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

`manifest.json` is the audit trail: run ID, target repo + HEAD SHA, per-agent model / turn count / wall time / USD cost, convergence branch name, exit reason, and any prereq warnings.

## Architecture

```
pubprep
  └─> load .env (ANTHROPIC_API_KEY)
  └─> orchestrate
        ├─> run-agent(tech-debt)    ─┐
        ├─> run-agent(readme-docs)   ├─ parallel (Promise.allSettled)
        └─> run-agent(security)     ─┘
             ↓ (all complete)
        concatenate to combined-review.md
             ↓
        run-agent(convergence) ─ executes against repo, streaming to stdout
             ↓
        write manifest, update latest symlink
```

Three layers, each minimal:

1. **CLI** (`src/cli.ts`): argv parsing, `.env` load, API-key validation, prereq checks, exit codes.
2. **Orchestrator** (`src/orchestrate.ts`): parallel reviewer phase, concatenation, sequential convergence.
3. **Agent runner** (`src/run-agent.ts`): thin wrapper around `@anthropic-ai/claude-agent-sdk`'s `query()` — one async generator iteration loop per agent.

The agents themselves are markdown files in `agents/` that ship with the package. Editing an agent means editing its `.md` and reinstalling pubprep; there's no per-project override system.

## Cost

A full run hits the Anthropic API for four sessions — three reading the whole repo, one making edits with multi-turn tool use. Expect somewhere between a dollar and several dollars per run on a medium repo depending on size and how much work convergence does. Run `pubprep --dry-run` first to see what the reviewers find before paying for convergence.

The model is configured in one place (`src/models.ts`). To run reviewers on Sonnet 4.6 for cheaper audits while keeping convergence on Opus 4.7, branch on agent name in `modelForAgent()`.

## Development

```
npm install
npm run build       # tsc → dist/
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm link            # global symlink for local pubprep
```

The orchestrator integration test uses a mock SDK (`test/fixtures/mock-sdk.ts`) injected via `runAgent({ query })`. Pure path / env logic has unit tests; the orchestrator is exercised end-to-end against a real temp git repo.

## License

MIT. See `LICENSE`.
