import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentName } from "./paths.js";
import type { RunAgentResult, RunStopReason } from "./run-agent.js";

export type AgentManifestEntry = {
  agentName: AgentName;
  model: string;
  outputPath: string;
  stopReason: RunStopReason;
  isError: boolean;
  turnsUsed: number;
  durationMs: number;
  totalCostUsd: number;
  errorMessage?: string;
};

export type Manifest = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  target_repo: string;
  target_head_sha: string | null;
  agents: AgentManifestEntry[];
  convergence_branch: string | null;
  exit_reason:
    | "success"
    | "reviewer_failure"
    | "convergence_failure"
    | "budget_exceeded"
    | "in_progress";
  warnings: string[];
};

export function createInitialManifest(args: {
  runId: string;
  targetRepo: string;
  targetHeadSha: string | null;
  startedAt: Date;
}): Manifest {
  return {
    run_id: args.runId,
    started_at: args.startedAt.toISOString(),
    finished_at: null,
    target_repo: args.targetRepo,
    target_head_sha: args.targetHeadSha,
    agents: [],
    convergence_branch: null,
    exit_reason: "in_progress",
    warnings: [],
  };
}

export function recordAgentResult(
  manifest: Manifest,
  result: RunAgentResult,
): void {
  const entry: AgentManifestEntry = {
    agentName: result.agentName,
    model: result.model,
    outputPath: result.outputPath,
    stopReason: result.stopReason,
    isError: result.isError,
    turnsUsed: result.turnsUsed,
    durationMs: result.durationMs,
    totalCostUsd: result.totalCostUsd,
  };
  if (result.errorMessage !== undefined) {
    entry.errorMessage = result.errorMessage;
  }
  manifest.agents.push(entry);
}

export function writeManifest(path: string, manifest: Manifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
