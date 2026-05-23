#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findClaudeCodeBinary } from "./claude-code.js";
import {
  InvalidApiKeyError,
  loadEnv,
  MissingApiKeyError,
  requireApiKey,
} from "./env.js";
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
  maxBudgetUsd: number | null;
};

const DEFAULT_MAX_BUDGET_USD = 20;

export const VERSION: string = readPackageVersion();

function readPackageVersion(): string {
  const url = new URL("../package.json", import.meta.url);
  const raw = readFileSync(fileURLToPath(url), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof (parsed as { version: unknown }).version === "string"
  ) {
    return (parsed as { version: string }).version;
  }
  throw new Error("package.json is missing a string 'version' field");
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    allowDirty: false,
    help: false,
    version: false,
    maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
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
      case "--no-max-budget-usd":
        args.maxBudgetUsd = null;
        break;
      case "--max-budget-usd": {
        const raw = argv[i + 1];
        if (raw === undefined) {
          throw new Error("--max-budget-usd requires a numeric value (USD).");
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(
            `--max-budget-usd requires a non-negative number, got: ${raw}`,
          );
        }
        args.maxBudgetUsd = n;
        i++;
        break;
      }
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
  --dry-run                Run the three reviewers only; skip convergence.
  --allow-dirty            Proceed even if the working tree has uncommitted changes.
  --max-budget-usd <n>     Hard cap on cumulative API spend across the run, in
                           USD. Defaults to ${DEFAULT_MAX_BUDGET_USD}. Has no
                           effect under subscription auth (cost is reported as
                           zero per call).
  --no-max-budget-usd      Disable the budget cap.
  -h, --help               Show this message.
  -v, --version            Print the pubprep version.

Auth:
  Uses your locally-installed Claude Code (~/.local/bin/claude or
  /opt/homebrew/bin/claude) for subscription-based auth — no API key
  needed if you're already logged into Claude Code. To force per-token
  API billing instead, export ANTHROPIC_API_KEY and ensure 'claude'
  is not on your PATH.
`;

export interface MainOptions {
  cwd?: string;
  home?: string;
}

export async function main(
  argv: readonly string[],
  options: MainOptions = {},
): Promise<number> {
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

  const projectRoot = options.cwd ?? process.cwd();
  if (options.home !== undefined) {
    loadEnv(projectRoot, options.home);
  } else {
    loadEnv(projectRoot);
  }

  const claudeBinary = findClaudeCodeBinary();
  const usingSubscription = claudeBinary !== null;
  if (usingSubscription) {
    process.stdout.write(`auth: Claude Code subscription via ${claudeBinary}\n`);
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    const hasApiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim().length > 0;
    if (!hasApiKey) {
      process.stderr.write(
        "error: no auth available. Install Claude Code (https://claude.ai/code) and log in, or export ANTHROPIC_API_KEY.\n",
      );
      return 1;
    }
    try {
      requireApiKey();
    } catch (err) {
      if (err instanceof MissingApiKeyError || err instanceof InvalidApiKeyError) {
        process.stderr.write(`error: ${err.message}\n`);
        return 1;
      }
      throw err;
    }
    process.stdout.write("auth: ANTHROPIC_API_KEY (per-token billing)\n");
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
      parallelReviewers: !usingSubscription,
      maxBudgetUsd: parsed.maxBudgetUsd,
    });
    printSummary(result, usingSubscription);
    return result.exitReason === "success" ? 0 : 2;
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    return 2;
  }
}

function printSummary(
  result: Awaited<ReturnType<typeof orchestrate>>,
  usingSubscription: boolean,
): void {
  process.stdout.write("\n--- run summary ---\n");
  process.stdout.write(`run dir: ${result.runDir}\n`);
  process.stdout.write(`manifest: ${result.manifestPath}\n`);
  process.stdout.write(`exit: ${result.exitReason}\n`);
  for (const a of result.manifest.agents) {
    const seconds = (a.durationMs / 1000).toFixed(1);
    const err = a.errorMessage ? ` :: ${a.errorMessage}` : "";
    const cost = usingSubscription ? "subscription" : `$${a.totalCostUsd.toFixed(4)}`;
    process.stdout.write(
      `  ${a.agentName}  stop=${a.stopReason}  turns=${a.turnsUsed}  ${seconds}s  ${cost}${err}\n`,
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
