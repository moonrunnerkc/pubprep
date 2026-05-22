import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import {
  CONVERGENCE_AGENT_NAME,
  REVIEWER_AGENT_NAMES,
  formatRunTimestamp,
  getCombinedReviewPath,
  getLatestSymlink,
  getManifestPath,
  getOutputPath,
  getRunDir,
  type AgentName,
} from "./paths.js";
import { runAgent, type QueryFn, type RunAgentResult } from "./run-agent.js";
import {
  createInitialManifest,
  recordAgentResult,
  writeManifest,
  type Manifest,
} from "./manifest.js";

export type ExitReason = "success" | "reviewer_failure" | "convergence_failure";

export interface OrchestrateParams {
  projectRoot: string;
  dryRun?: boolean;
  now?: Date;
  query?: QueryFn;
  warnings?: string[];
  log?: (message: string) => void;
}

export interface OrchestrateResult {
  runDir: string;
  manifestPath: string;
  exitReason: ExitReason;
  manifest: Manifest;
}

const REVIEWER_PROMPT =
  "Audit the repository at the current working directory end-to-end. Use your read-only tools (Read, Grep, Glob, Bash for read-only commands) to inspect the working tree. Produce your standard output report exactly as specified in your system prompt, including the structured appendix.";

function convergencePrompt(combinedReviewPath: string, projectRoot: string): string {
  const rel = relative(projectRoot, combinedReviewPath);
  return [
    "You are operating against the git repository at the current working directory.",
    `The three upstream reviewer reports have been concatenated into ${rel}.`,
    "Read that file in full. Ingest the findings, synthesize a resolution plan, then execute that plan against the repository per your system prompt.",
    "Create the convergence branch your spec describes, make atomic commits, run tests as you go, and queue any maintainer-action items.",
    "End with the convergence report your spec specifies.",
  ].join(" ");
}

export async function orchestrate(
  params: OrchestrateParams,
): Promise<OrchestrateResult> {
  const {
    projectRoot,
    dryRun = false,
    now = new Date(),
    query,
    warnings = [],
    log = noop,
  } = params;

  const runId = formatRunTimestamp(now);
  const runDir = getRunDir(projectRoot, runId);
  mkdirSync(runDir, { recursive: true });

  const manifest = createInitialManifest({
    runId,
    targetRepo: projectRoot,
    targetHeadSha: readHeadSha(projectRoot),
    startedAt: now,
  });
  manifest.warnings = [...warnings];
  const manifestPath = getManifestPath(runDir);
  writeManifest(manifestPath, manifest);

  log(`pubprep run ${runId}`);
  log(`run dir: ${runDir}`);
  log(`dry run: ${dryRun ? "yes (reviewers only)" : "no"}`);

  log("phase 1: running three reviewers in parallel");
  const reviewerResults = await runReviewersInParallel({
    projectRoot,
    runDir,
    query,
  });
  for (const r of reviewerResults) {
    recordAgentResult(manifest, r);
  }
  writeManifest(manifestPath, manifest);

  const reviewerFailed = reviewerResults.some((r) => r.isError);
  if (reviewerFailed) {
    log("at least one reviewer failed; aborting before convergence");
    manifest.exit_reason = "reviewer_failure";
    manifest.finished_at = new Date().toISOString();
    writeManifest(manifestPath, manifest);
    updateLatestSymlink(projectRoot, runDir);
    return { runDir, manifestPath, exitReason: "reviewer_failure", manifest };
  }

  log("phase 2: concatenating reviewer outputs into combined-review.md");
  const combinedPath = getCombinedReviewPath(runDir);
  writeCombinedReview(combinedPath, reviewerResults);

  if (dryRun) {
    log("dry-run flag set; skipping convergence");
    manifest.exit_reason = "success";
    manifest.finished_at = new Date().toISOString();
    writeManifest(manifestPath, manifest);
    updateLatestSymlink(projectRoot, runDir);
    return { runDir, manifestPath, exitReason: "success", manifest };
  }

  log("phase 3: running convergence (streaming to stdout)");
  const convergenceResult = await runAgent({
    agentName: CONVERGENCE_AGENT_NAME,
    prompt: convergencePrompt(combinedPath, projectRoot),
    cwd: projectRoot,
    outputPath: getOutputPath(runDir, CONVERGENCE_AGENT_NAME),
    streamToStdout: true,
    query,
  });
  recordAgentResult(manifest, convergenceResult);
  manifest.convergence_branch = readCurrentBranch(projectRoot);

  const exitReason: ExitReason = convergenceResult.isError
    ? "convergence_failure"
    : "success";
  manifest.exit_reason = exitReason;
  manifest.finished_at = new Date().toISOString();
  writeManifest(manifestPath, manifest);
  updateLatestSymlink(projectRoot, runDir);

  return { runDir, manifestPath, exitReason, manifest };
}

async function runReviewersInParallel(args: {
  projectRoot: string;
  runDir: string;
  query?: QueryFn;
}): Promise<RunAgentResult[]> {
  const settled = await Promise.allSettled(
    REVIEWER_AGENT_NAMES.map((agentName) =>
      runAgent({
        agentName,
        prompt: REVIEWER_PROMPT,
        cwd: args.projectRoot,
        outputPath: getOutputPath(args.runDir, agentName),
        streamToStdout: false,
        query: args.query,
      }),
    ),
  );

  return settled.map((s, i) => {
    const agentName = REVIEWER_AGENT_NAMES[i] as AgentName;
    if (s.status === "fulfilled") {
      return s.value;
    }
    const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return {
      agentName,
      model: "",
      outputPath: getOutputPath(args.runDir, agentName),
      stopReason: "thrown" as const,
      isError: true,
      turnsUsed: 0,
      durationMs: 0,
      totalCostUsd: 0,
      errorMessage: reason,
    };
  });
}

function writeCombinedReview(
  combinedPath: string,
  reviewerResults: RunAgentResult[],
): void {
  const parts: string[] = [];
  for (const r of reviewerResults) {
    const title = humanTitle(r.agentName);
    const body = existsSync(r.outputPath)
      ? readFileSync(r.outputPath, "utf8")
      : "";
    parts.push(`# ${title}\n\n${body.trimEnd()}\n`);
  }
  writeFileSync(combinedPath, parts.join("\n---\n\n"));
}

function humanTitle(agentName: AgentName): string {
  switch (agentName) {
    case "tech-debt-reviewer":
      return "Tech Debt Reviewer";
    case "readme-docs-reviewer":
      return "README and Documentation Reviewer";
    case "security-reviewer":
      return "Security Reviewer";
    case "convergence-resolution-architect":
      return "Convergence Resolution Architect";
  }
}

function updateLatestSymlink(projectRoot: string, runDir: string): void {
  const linkPath = getLatestSymlink(projectRoot);
  const target = relative(dirname(linkPath), runDir);
  try {
    rmSync(linkPath, { force: true });
  } catch {
    // ignore
  }
  symlinkSync(target, linkPath, "dir");
}

function readHeadSha(projectRoot: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readCurrentBranch(projectRoot: string): string | null {
  try {
    const out = execFileSync("git", ["branch", "--show-current"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

function noop(_: string): void {
  // default log sink
}
