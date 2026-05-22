import { CONVERGENCE_AGENT_NAME, type AgentName } from "./paths.js";

const OPUS = "claude-opus-4-7";
const SONNET = "claude-sonnet-4-6";

export function modelForAgent(agent: AgentName): string {
  return agent === CONVERGENCE_AGENT_NAME ? OPUS : SONNET;
}

export const DEFAULT_MAX_TURNS = 100;
