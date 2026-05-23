import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  skippedPublishGate,
  verifyPublishReadiness,
} from "../src/publish-gate.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-gate-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function writePkg(dir: string, scripts: Record<string, string>): void {
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", scripts }, null, 2),
  );
  execFileSync("git", ["add", "package.json"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "add pkg"], { cwd: dir });
}

describe("verifyPublishReadiness", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("passes on a clean repo with no scripts and skips typecheck/tests", () => {
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(true);
    expect(r.checked).toEqual(["clean_tree"]);
    expect(r.skipped).toEqual(["typecheck", "tests"]);
    expect(r.failures).toEqual([]);
  });

  it("fails clean_tree when the working tree has uncommitted changes", () => {
    writeFileSync(join(repo, "dirty.txt"), "uncommitted\n");
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].check).toBe("clean_tree");
    expect(r.failures[0].detail).toContain("dirty.txt");
  });

  it("runs typecheck and tests when defined, passes when they succeed", () => {
    writePkg(repo, { typecheck: "true", test: "true" });
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(true);
    expect(r.checked).toEqual(["clean_tree", "typecheck", "tests"]);
    expect(r.skipped).toEqual([]);
  });

  it("reports a typecheck failure with output detail", () => {
    writePkg(repo, {
      typecheck: 'node -e "console.error(\\"type error\\"); process.exit(1)"',
    });
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].check).toBe("typecheck");
    expect(r.failures[0].detail).toContain("type error");
  });

  it("reports a test failure", () => {
    writePkg(repo, {
      test: 'node -e "console.log(\\"FAIL: 1 test failed\\"); process.exit(1)"',
    });
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(false);
    expect(r.failures.map((f) => f.check)).toEqual(["tests"]);
    expect(r.failures[0].detail).toContain("FAIL");
  });

  it("aggregates multiple failures", () => {
    writeFileSync(join(repo, "dirty.txt"), "uncommitted\n");
    writePkg(repo, {
      test: 'node -e "process.exit(1)"',
    });
    const r = verifyPublishReadiness({ projectRoot: repo });
    expect(r.passed).toBe(false);
    expect(r.failures.map((f) => f.check)).toEqual(["clean_tree", "tests"]);
  });
});

describe("skippedPublishGate", () => {
  it("returns a non-run result that counts as passed", () => {
    const r = skippedPublishGate();
    expect(r.ran).toBe(false);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });
});
