import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const COMMON_LOCATIONS = [
  `${process.env.HOME ?? ""}/.local/bin/claude`,
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

export function findClaudeCodeBinary(): string | null {
  try {
    const out = execFileSync("which", ["claude"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length > 0 && existsSync(out)) {
      return out;
    }
  } catch {
    // fall through
  }
  for (const candidate of COMMON_LOCATIONS) {
    if (candidate.length > 0 && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
