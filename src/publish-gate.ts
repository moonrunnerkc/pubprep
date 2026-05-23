import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PublishGateCheck = "clean_tree" | "typecheck" | "tests";

export type PublishGateFailure = {
  check: PublishGateCheck;
  detail: string;
};

export type PublishGateResult = {
  ran: boolean;
  passed: boolean;
  failures: PublishGateFailure[];
  skipped: PublishGateCheck[];
  checked: PublishGateCheck[];
};

export interface PublishGateParams {
  projectRoot: string;
  log?: (message: string) => void;
}

export function verifyPublishReadiness(
  params: PublishGateParams,
): PublishGateResult {
  const { projectRoot, log = () => {} } = params;
  const failures: PublishGateFailure[] = [];
  const checked: PublishGateCheck[] = [];
  const skipped: PublishGateCheck[] = [];

  log("publish gate: checking working tree is clean");
  checked.push("clean_tree");
  const dirty = readPorcelainStatus(projectRoot);
  if (dirty !== null) {
    const userDirty = filterPubprepPaths(dirty);
    if (userDirty.length > 0) {
      failures.push({
        check: "clean_tree",
        detail: `working tree has uncommitted changes:\n${userDirty}`,
      });
    }
  }

  const scripts = readPackageScripts(projectRoot);

  if (scripts.has("typecheck")) {
    log("publish gate: running npm run typecheck");
    checked.push("typecheck");
    const r = runScript(projectRoot, "typecheck");
    if (!r.ok) {
      failures.push({
        check: "typecheck",
        detail: tailLines(r.output, 40) || "(no output captured)",
      });
    }
  } else {
    skipped.push("typecheck");
  }

  if (scripts.has("test")) {
    log("publish gate: running npm test");
    checked.push("tests");
    const r = runScript(projectRoot, "test");
    if (!r.ok) {
      failures.push({
        check: "tests",
        detail: tailLines(r.output, 40) || "(no output captured)",
      });
    }
  } else {
    skipped.push("tests");
  }

  return {
    ran: true,
    passed: failures.length === 0,
    failures,
    skipped,
    checked,
  };
}

export function skippedPublishGate(): PublishGateResult {
  return { ran: false, passed: true, failures: [], skipped: [], checked: [] };
}

function readPorcelainStatus(projectRoot: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function readPackageScripts(projectRoot: string): Set<string> {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return new Set();
  }
  if (typeof parsed !== "object" || parsed === null) return new Set();
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== "object" || scripts === null) return new Set();
  return new Set(Object.keys(scripts as Record<string, unknown>));
}

function runScript(
  projectRoot: string,
  scriptName: string,
): { ok: boolean; output: string } {
  const r = spawnSync("npm", ["run", "--silent", scriptName], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) {
    return { ok: false, output: `${r.error.message}\n${output}` };
  }
  return { ok: r.status === 0, output };
}

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n").trim();
}

/**
 * Strip porcelain entries that point inside .pubprep/. In real use the
 * pre-flight gitignore check enforces a .pubprep/ entry, so this never
 * matters; in tests and projects that opted out, it prevents pubprep's
 * own run-output directory from tripping the clean-tree check.
 */
function filterPubprepPaths(porcelain: string): string {
  return porcelain
    .split("\n")
    .filter((line) => {
      if (line.length === 0) return false;
      const path = line.slice(3);
      return !path.startsWith(".pubprep/") && path !== ".pubprep";
    })
    .join("\n");
}
