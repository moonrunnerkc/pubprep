import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ANTHROPIC_API_KEY_PREFIX = "sk-ant-";
const ANTHROPIC_API_KEY_VAR = "ANTHROPIC_API_KEY";

export class MissingApiKeyError extends Error {
  readonly hint: string;
  constructor(hint: string) {
    super(
      `${ANTHROPIC_API_KEY_VAR} is not set. ${hint}`,
    );
    this.name = "MissingApiKeyError";
    this.hint = hint;
  }
}

export class InvalidApiKeyError extends Error {
  readonly hint: string;
  constructor(hint: string) {
    super(
      `${ANTHROPIC_API_KEY_VAR} does not look like an Anthropic API key (expected prefix "${ANTHROPIC_API_KEY_PREFIX}"). ${hint}`,
    );
    this.name = "InvalidApiKeyError";
    this.hint = hint;
  }
}

export function loadEnv(cwd: string): void {
  const envPath = join(cwd, ".env");
  if (!existsSync(envPath)) {
    return;
  }
  dotenvConfig({ path: envPath, override: false, quiet: true });
}

export function requireApiKey(): string {
  const raw = process.env[ANTHROPIC_API_KEY_VAR];
  if (raw === undefined || raw.trim() === "") {
    throw new MissingApiKeyError(
      `Set it in a project-root .env file (ANTHROPIC_API_KEY=sk-ant-...) or export it in your shell.`,
    );
  }
  const value = raw.trim();
  if (!value.startsWith(ANTHROPIC_API_KEY_PREFIX)) {
    throw new InvalidApiKeyError(
      `Get a real key from https://console.anthropic.com/ and replace the placeholder.`,
    );
  }
  return value;
}
