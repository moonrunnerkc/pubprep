#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv, requireApiKey } from "./env.js";
import { orchestrate } from "./orchestrate.js";
import {
  checkEnvFilePresentAndIgnored,
  checkGitignoreCovers,
  checkInGitRepo,
  checkWorkingTreeClean,
  type Prereq,
} from "./prereqs.js";

export type CliArgs = {
  dryRun: boolean;
  allowDirty: boolean;
  help: boolean;
  version: boolean;
};

export const VERSION = "0.1.0";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    allowDirty: false,
    help: false,
    version: false,
  };
  for (const a of argv) {
    switch (a) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--allow-dirty":
        args.allowDirty = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-v":
      case "--version":
        args.version = true;
        break;
      default:
        throw new Error(`Unknown flag: ${a}. Run pubprep --help for usage.`);
    }
  }
  return args;
}

export const USAGE = `Usage: pubprep [options]

Runs four bundled review agents against the git repo at the current working
directory. Three reviewers run in parallel and write reports under
.pubprep/runs/<timestamp>/, then convergence reads the combined report and
executes fixes against the working tree on its own branch.

Options:
  --dry-run        Run the three reviewers only; skip convergence.
  --allow-dirty    Proceed even if the working tree has uncommitted changes.
  -h, --help       Show this message.
  -v, --version    Print the pubprep version.

Setup (one-time):
  echo 'ANTHROPIC_API_KEY=sk-ant-...' > ~/.pubprep/.env
  mkdir -p ~/.pubprep  # if needed

Per-project .env and shell export still work and take precedence in that
order. Gitignore .env and .pubprep/ in any project before running.
`;

export async function main(argv: readonly string[]): Promise<number> {
  let parsed: CliArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const projectRoot = process.cwd();
  loadEnv(projectRoot);

  try {
    requireApiKey();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  const prereqChecks: Prereq[] = [
    checkInGitRepo(projectRoot),
    checkWorkingTreeClean(projectRoot, parsed.allowDirty),
    checkGitignoreCovers(projectRoot, ".pubprep/"),
    checkEnvFilePresentAndIgnored(projectRoot),
  ];

  const warnings: string[] = [];
  for (const check of prereqChecks) {
    if (check === "ok") continue;
    if (check.kind === "error") {
      process.stderr.write(`error: ${check.message}\n`);
      return 1;
    }
    warnings.push(check.message);
    process.stderr.write(`warning: ${check.message}\n`);
  }

  try {
    const result = await orchestrate({
      projectRoot,
      dryRun: parsed.dryRun,
      warnings,
      log: (m) => process.stdout.write(`${m}\n`),
    });
    printSummary(result);
    return result.exitReason === "success" ? 0 : 2;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 2;
  }
}

function printSummary(result: Awaited<ReturnType<typeof orchestrate>>): void {
  process.stdout.write("\n--- run summary ---\n");
  process.stdout.write(`run dir: ${result.runDir}\n`);
  process.stdout.write(`manifest: ${result.manifestPath}\n`);
  process.stdout.write(`exit: ${result.exitReason}\n`);
  for (const a of result.manifest.agents) {
    const cost = a.totalCostUsd.toFixed(4);
    const seconds = (a.durationMs / 1000).toFixed(1);
    const err = a.errorMessage ? ` :: ${a.errorMessage}` : "";
    process.stdout.write(
      `  ${a.agentName}  stop=${a.stopReason}  turns=${a.turnsUsed}  ${seconds}s  $${cost}${err}\n`,
    );
  }
  if (result.manifest.convergence_branch) {
    process.stdout.write(
      `convergence branch: ${result.manifest.convergence_branch}\n`,
    );
  }
}

function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    const thisFile = realpathSync(fileURLToPath(import.meta.url));
    const entry = realpathSync(argv1);
    return thisFile === entry;
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
      process.exit(2);
    });
}
