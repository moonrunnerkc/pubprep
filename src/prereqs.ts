import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Prereq = "ok" | { kind: "error" | "warning"; message: string };

export function checkInGitRepo(projectRoot: string): Prereq {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return "ok";
  } catch {
    return {
      kind: "error",
      message: `${projectRoot} is not inside a git repository. pubprep requires git.`,
    };
  }
}

export function checkWorkingTreeClean(
  projectRoot: string,
  allowDirty: boolean,
): Prereq {
  if (allowDirty) {
    return "ok";
  }
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim() === "") {
      return "ok";
    }
    return {
      kind: "error",
      message:
        "working tree has uncommitted changes. Commit, stash, or pass --allow-dirty to proceed.",
    };
  } catch {
    return {
      kind: "error",
      message: "could not read git status to verify working tree state.",
    };
  }
}

export function checkGitignoreCovers(
  projectRoot: string,
  pattern: string,
): Prereq {
  const path = join(projectRoot, ".gitignore");
  if (!existsSync(path)) {
    return {
      kind: "warning",
      message: `no .gitignore at ${path}. Add one and include "${pattern}".`,
    };
  }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  const matched = lines.some((l) => matches(l, pattern));
  if (matched) {
    return "ok";
  }
  return {
    kind: "warning",
    message: `.gitignore does not cover "${pattern}". Add it to avoid committing sensitive output.`,
  };
}

function matches(line: string, pattern: string): boolean {
  const normalized = line.replace(/^\//, "").replace(/\/$/, "");
  const target = pattern.replace(/^\//, "").replace(/\/$/, "");
  return normalized === target || normalized === `${target}/`;
}

export function checkEnvFilePresentAndIgnored(projectRoot: string): Prereq {
  const envExists = existsSync(join(projectRoot, ".env"));
  if (!envExists) {
    return "ok";
  }
  return checkGitignoreCovers(projectRoot, ".env");
}
