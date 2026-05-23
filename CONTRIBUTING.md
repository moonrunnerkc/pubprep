# Contributing

## Dev setup

Requires Node 18+.

```bash
git clone https://github.com/<owner>/pubprep
cd pubprep
npm install
npm run build       # tsc → dist/; sets dist/cli.js executable
npm test            # vitest run, all tests once
npm run typecheck   # tsc --noEmit
npm link            # installs pubprep globally from your local build
```

For faster iteration without a rebuild step:

```bash
npm run dev -- [flags]   # runs tsx src/cli.ts directly
```

## Project structure

```
src/
  cli.ts          : argv parsing, auth detection, prereq checks, entry point
  orchestrate.ts  : reviewer + convergence phases, manifest lifecycle
  run-agent.ts    : wrapper around @anthropic-ai/claude-agent-sdk query()
  models.ts       : model and max-turn assignments per agent
  env.ts          : .env loading and API key validation
  paths.ts        : all path derivation; output file name constants
  prereqs.ts      : pre-flight checks (git repo, clean tree, gitignore)
  manifest.ts     : Manifest type and write helpers

agents/            : bundled agent system prompts (ship with the package)
test/              : vitest tests; fixtures/mock-sdk.ts stubs the SDK
```

## Editing agents

Agent behavior is defined by the markdown files in `agents/`. To change an agent:

1. Edit the relevant `.md` file in `agents/`.
2. Rebuild (`npm run build`) if testing via the installed `pubprep` binary; skip if using `npm run dev`.
3. There's no per-project override system; changes affect every subsequent run globally.

The root-level `*-agent.md` files (e.g., `tech-debt-reviewer-agent.md`) are gitignored working copies used during development. The canonical files shipped with the package are in `agents/`.

## Tests

```bash
npm test            # run all tests once
npm run test:watch  # rerun on file change
```

Tests spin up real temporary git repos in `beforeEach` and clean them up in `afterEach`. The orchestrator integration test injects a mock SDK via `test/fixtures/mock-sdk.ts`, so no Claude API calls are made during the test suite. Test timeout is 15 seconds.

## Pull requests

Open an issue before starting work on anything beyond a typo or an obvious bug. This is early-stage; significant changes to the orchestration model or agent pipeline need discussion first.

Keep commits focused: one logical change per commit. Run `npm test && npm run typecheck` before opening a PR.
