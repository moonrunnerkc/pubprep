import { CONVERGENCE_AGENT_NAME, type AgentName } from "./paths.js";

const OPUS = "claude-opus-4-7";
const SONNET = "claude-sonnet-4-6";

export function modelForAgent(agent: AgentName): string {
  return agent === CONVERGENCE_AGENT_NAME ? OPUS : SONNET;
}

const REVIEWER_MAX_TURNS = 100;
const CONVERGENCE_MAX_TURNS = 300;

export function maxTurnsForAgent(agent: AgentName): number {
  return agent === CONVERGENCE_AGENT_NAME
    ? CONVERGENCE_MAX_TURNS
    : REVIEWER_MAX_TURNS;
}

export const DEFAULT_MAX_TURNS = REVIEWER_MAX_TURNS;
