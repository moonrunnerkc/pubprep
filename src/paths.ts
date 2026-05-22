import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type AgentName =
  | "tech-debt-reviewer"
  | "readme-docs-reviewer"
  | "security-reviewer"
  | "convergence-resolution-architect";

export const AGENT_NAMES: readonly AgentName[] = [
  "tech-debt-reviewer",
  "readme-docs-reviewer",
  "security-reviewer",
  "convergence-resolution-architect",
];

export const REVIEWER_AGENT_NAMES = [
  "tech-debt-reviewer",
  "readme-docs-reviewer",
  "security-reviewer",
] as const satisfies readonly AgentName[];

export const CONVERGENCE_AGENT_NAME: AgentName =
  "convergence-resolution-architect";

const PUBPREP_DIRNAME = ".pubprep";
const RUNS_DIRNAME = "runs";
const LATEST_DIRNAME = "latest";

export function formatRunTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "");
}

export function getPubprepDir(projectRoot: string): string {
  return join(projectRoot, PUBPREP_DIRNAME);
}

export function getRunsDir(projectRoot: string): string {
  return join(getPubprepDir(projectRoot), RUNS_DIRNAME);
}

export function getRunDir(projectRoot: string, timestamp: string): string {
  return join(getRunsDir(projectRoot), timestamp);
}

export function getLatestSymlink(projectRoot: string): string {
  return join(getPubprepDir(projectRoot), LATEST_DIRNAME);
}

export function getOutputPath(runDir: string, agentName: AgentName): string {
  return join(runDir, outputFilename(agentName));
}

export function getCombinedReviewPath(runDir: string): string {
  return join(runDir, "combined-review.md");
}

export function getManifestPath(runDir: string): string {
  return join(runDir, "manifest.json");
}

function outputFilename(agentName: AgentName): string {
  if (agentName === CONVERGENCE_AGENT_NAME) {
    return "convergence-report.md";
  }
  return `${agentName.replace(/-reviewer$/, "")}-output.md`;
}

const HERE = dirname(fileURLToPath(import.meta.url));

export function getAgentsDir(): string {
  return resolve(HERE, "..", "agents");
}

export function getAgentDefinitionPath(agentName: AgentName): string {
  return join(getAgentsDir(), `${agentName}.md`);
}
