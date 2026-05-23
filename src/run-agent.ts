import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  query as realQuery,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { findClaudeCodeBinary } from "./claude-code.js";
import {
  CONVERGENCE_AGENT_NAME,
  type AgentName,
  getAgentDefinitionPath,
} from "./paths.js";
import { maxTurnsForAgent, modelForAgent } from "./models.js";

/**
 * Tools the three reviewer agents are allowed to call. Reviewers inspect the
 * repo only; they should never edit, write, or run shell commands that mutate
 * state. The system prompt asks for this; this allowlist enforces it at the
 * SDK boundary as a second layer.
 */
const REVIEWER_ALLOWED_TOOLS: readonly string[] = ["Read", "Grep", "Glob", "Bash"];

export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => Query;

export interface RunAgentParams {
  agentName: AgentName;
  prompt: string;
  cwd: string;
  outputPath: string;
  streamToStdout?: boolean;
  maxTurns?: number;
  query?: QueryFn;
  pathToClaudeCodeExecutable?: string | null;
}

export type RunStopReason =
  | "success"
  | "error_during_execution"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_max_structured_output_retries"
  | "no_result"
  | "thrown";

export interface RunAgentResult {
  agentName: AgentName;
  model: string;
  outputPath: string;
  stopReason: RunStopReason;
  isError: boolean;
  turnsUsed: number;
  durationMs: number;
  totalCostUsd: number;
  errorMessage?: string;
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const {
    agentName,
    prompt,
    cwd,
    outputPath,
    streamToStdout = false,
    maxTurns = maxTurnsForAgent(params.agentName),
    query = realQuery,
    pathToClaudeCodeExecutable = findClaudeCodeBinary(),
  } = params;

  const systemPrompt = readFileSync(getAgentDefinitionPath(agentName), "utf8");
  const model = modelForAgent(agentName);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "");

  const result: RunAgentResult = {
    agentName,
    model,
    outputPath,
    stopReason: "no_result",
    isError: false,
    turnsUsed: 0,
    durationMs: 0,
    totalCostUsd: 0,
  };

  try {
    const options: Options = {
      systemPrompt,
      model,
      cwd,
      settingSources: [],
      permissionMode: "bypassPermissions",
      maxTurns,
    };
    if (agentName !== CONVERGENCE_AGENT_NAME) {
      options.allowedTools = [...REVIEWER_ALLOWED_TOOLS];
    }
    if (pathToClaudeCodeExecutable) {
      options.pathToClaudeCodeExecutable = pathToClaudeCodeExecutable;
    }
    const q = query({ prompt, options });

    for await (const message of q) {
      handleMessage(message, outputPath, streamToStdout, result);
    }
  } catch (err) {
    result.stopReason = "thrown";
    result.isError = true;
    result.errorMessage = err instanceof Error ? err.message : String(err);
  }

  return result;
}

function handleMessage(
  message: SDKMessage,
  outputPath: string,
  streamToStdout: boolean,
  result: RunAgentResult,
): void {
  if (message.type === "assistant") {
    const text = extractAssistantText(message);
    if (text.length > 0) {
      appendFileSync(outputPath, text);
      if (streamToStdout) {
        process.stdout.write(text);
      }
    }
    return;
  }
  if (message.type === "result") {
    result.stopReason = message.subtype;
    result.isError = message.is_error;
    result.turnsUsed = message.num_turns;
    result.durationMs = message.duration_ms;
    result.totalCostUsd = message.total_cost_usd;
  }
}

function extractAssistantText(message: SDKMessage & { type: "assistant" }): string {
  const content = message.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "type" in block && block.type === "text") {
      const textBlock = block as { type: "text"; text?: string };
      if (typeof textBlock.text === "string") {
        chunks.push(textBlock.text);
      }
    }
  }
  return chunks.join("");
}
