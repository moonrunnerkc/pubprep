import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ANTHROPIC_API_KEY_PREFIX = "sk-ant-";
const ANTHROPIC_API_KEY_VAR = "ANTHROPIC_API_KEY";

export const USER_CONFIG_DIR = ".pubprep";
export const USER_ENV_FILE = ".env";

export function userEnvPath(home: string = homedir()): string {
  return join(home, USER_CONFIG_DIR, USER_ENV_FILE);
}

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

export function loadEnv(cwd: string, home: string = homedir()): void {
  const projectPath = join(cwd, ".env");
  if (existsSync(projectPath)) {
    dotenvConfig({ path: projectPath, override: false, quiet: true });
  }
  const userPath = userEnvPath(home);
  if (existsSync(userPath)) {
    dotenvConfig({ path: userPath, override: false, quiet: true });
  }
}

export function requireApiKey(): string {
  const raw = process.env[ANTHROPIC_API_KEY_VAR];
  if (raw === undefined || raw.trim() === "") {
    throw new MissingApiKeyError(
      `Set it once at ${userEnvPath()} (mkdir -p ~/.pubprep && echo 'ANTHROPIC_API_KEY=sk-ant-...' > ~/.pubprep/.env), or per-project in <project>/.env, or export it in your shell.`,
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

