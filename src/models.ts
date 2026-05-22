import type { AgentName } from "./paths.js";

const OPUS = "claude-opus-4-7";

export function modelForAgent(_agent: AgentName): string {
  return OPUS;
}

export const DEFAULT_MAX_TURNS = 100;
