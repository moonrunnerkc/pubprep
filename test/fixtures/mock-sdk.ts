import type {
  Options,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import type { QueryFn } from "../../src/run-agent.js";

export interface MockBehavior {
  textChunks?: string[];
  shouldThrow?: Error;
  resultSubtype?: SDKResultMessage["subtype"];
  numTurns?: number;
  durationMs?: number;
  totalCostUsd?: number;
}

export type MockMap = Partial<Record<string, MockBehavior>>;

export interface MockSdkCall {
  systemPromptPreview: string;
  model: string;
  cwd: string | undefined;
  permissionMode: string | undefined;
  settingSources: unknown;
  maxTurns: number | undefined;
  prompt: string | undefined;
  allowedTools: readonly string[] | undefined;
}

export interface MockSdk {
  query: QueryFn;
  calls: MockSdkCall[];
}

export function createMockSdk(behaviors: MockMap, fallback?: MockBehavior): MockSdk {
  const calls: MockSdkCall[] = [];

  const query: QueryFn = (params: {
    prompt: string | AsyncIterable<SDKUserMessage>;
    options?: Options;
  }): Query => {
    const opts = params.options ?? {};
    const systemPrompt = typeof opts.systemPrompt === "string" ? opts.systemPrompt : "";
    const preview = systemPrompt.split("\n", 1)[0] ?? "";
    const promptStr = typeof params.prompt === "string" ? params.prompt : undefined;
    calls.push({
      systemPromptPreview: preview,
      model: opts.model ?? "",
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      settingSources: opts.settingSources,
      maxTurns: opts.maxTurns,
      prompt: promptStr,
      allowedTools: opts.allowedTools,
    });

    const behavior = pickBehavior(preview, behaviors, fallback);
    return makeQuery(behavior);
  };

  return { query, calls };
}

function pickBehavior(
  preview: string,
  behaviors: MockMap,
  fallback: MockBehavior | undefined,
): MockBehavior {
  for (const key of Object.keys(behaviors)) {
    if (preview.includes(key)) {
      return behaviors[key]!;
    }
  }
  return fallback ?? { textChunks: ["mock output\n"] };
}

function makeQuery(behavior: MockBehavior): Query {
  if (behavior.shouldThrow) {
    const err = behavior.shouldThrow;
    const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
      throw err;
    })();
    return attachQueryMethods(gen);
  }

  const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
    const sessionId = "mock-session";
    for (const chunk of behavior.textChunks ?? ["mock output\n"]) {
      const m: SDKAssistantMessage = {
        type: "assistant",
        message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model: "mock",
          stop_reason: null,
          stop_sequence: null,
          content: [{ type: "text", text: chunk }],
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
            server_tool_use: null,
            service_tier: null,
            cache_creation: null,
          },
        } as SDKAssistantMessage["message"],
        parent_tool_use_id: null,
        uuid: randomUUID() as SDKAssistantMessage["uuid"],
        session_id: sessionId,
      };
      yield m;
    }

    const subtype = behavior.resultSubtype ?? "success";
    if (subtype === "success") {
      const r: SDKResultMessage = {
        type: "result",
        subtype: "success",
        duration_ms: behavior.durationMs ?? 10,
        duration_api_ms: behavior.durationMs ?? 10,
        is_error: false,
        num_turns: behavior.numTurns ?? 1,
        result: (behavior.textChunks ?? ["mock output\n"]).join(""),
        total_cost_usd: behavior.totalCostUsd ?? 0,
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
          server_tool_use: null,
          service_tier: null,
          cache_creation: null,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: randomUUID() as SDKResultMessage["uuid"],
        session_id: sessionId,
      };
      yield r;
    } else {
      const r: SDKResultMessage = {
        type: "result",
        subtype,
        duration_ms: behavior.durationMs ?? 10,
        duration_api_ms: behavior.durationMs ?? 10,
        is_error: true,
        num_turns: behavior.numTurns ?? 1,
        total_cost_usd: behavior.totalCostUsd ?? 0,
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 0,
          server_tool_use: null,
          service_tier: null,
          cache_creation: null,
        },
        modelUsage: {},
        permission_denials: [],
        uuid: randomUUID() as SDKResultMessage["uuid"],
        session_id: sessionId,
      };
      yield r;
    }
  })();

  return attachQueryMethods(gen);
}

function attachQueryMethods(gen: AsyncGenerator<SDKMessage, void>): Query {
  const q = gen as Query;
  q.interrupt = async () => {};
  q.setPermissionMode = async () => {};
  q.setModel = async () => {};
  q.setMaxThinkingTokens = async () => {};
  q.supportedCommands = async () => [];
  q.supportedModels = async () => [];
  q.mcpServerStatus = async () => [];
  return q;
}
