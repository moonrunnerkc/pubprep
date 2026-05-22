import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkEnvFilePresentAndIgnored,
  checkGitignoreCovers,
  checkInGitRepo,
  checkWorkingTreeClean,
} from "../src/prereqs.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-prereq-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function makeNonRepo(): string {
  return mkdtempSync(join(tmpdir(), "pubprep-nonrepo-"));
}

describe("checkInGitRepo", () => {
  let repo: string;
  let nonrepo: string;
  beforeEach(() => {
    repo = makeRepo();
    nonrepo = makeNonRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(nonrepo, { recursive: true, force: true });
  });

  it("returns ok inside a git repo", () => {
    expect(checkInGitRepo(repo)).toBe("ok");
  });

  it("returns an error outside a git repo", () => {
    const result = checkInGitRepo(nonrepo);
    expect(result).not.toBe("ok");
    if (result !== "ok") {
      expect(result.kind).toBe("error");
      expect(result.message).toMatch(/not inside a git repository/);
    }
  });
});

describe("checkWorkingTreeClean", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns ok when the tree is clean", () => {
    expect(checkWorkingTreeClean(repo, false)).toBe("ok");
  });

  it("returns an error when the tree is dirty and allowDirty is false", () => {
    writeFileSync(join(repo, "dirty.txt"), "x");
    const result = checkWorkingTreeClean(repo, false);
    expect(result).not.toBe("ok");
    if (result !== "ok") {
      expect(result.kind).toBe("error");
      expect(result.message).toMatch(/uncommitted changes/);
    }
  });

  it("returns ok when the tree is dirty but allowDirty is true", () => {
    writeFileSync(join(repo, "dirty.txt"), "x");
    expect(checkWorkingTreeClean(repo, true)).toBe("ok");
  });
});

describe("checkGitignoreCovers", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pubprep-gi-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns when no .gitignore exists at all", () => {
    const r = checkGitignoreCovers(dir, ".pubprep/");
    expect(r).not.toBe("ok");
    if (r !== "ok") {
      expect(r.kind).toBe("warning");
      expect(r.message).toMatch(/no \.gitignore/);
    }
  });

  it("matches a bare directory pattern", () => {
    writeFileSync(join(dir, ".gitignore"), ".pubprep/\n");
    expect(checkGitignoreCovers(dir, ".pubprep/")).toBe("ok");
  });

  it("matches a pattern with a leading slash", () => {
    writeFileSync(join(dir, ".gitignore"), "/.env\n");
    expect(checkGitignoreCovers(dir, ".env")).toBe("ok");
  });

  it("matches when the gitignore has the slash-suffix variant", () => {
    writeFileSync(join(dir, ".gitignore"), "dist/\n");
    expect(checkGitignoreCovers(dir, "dist")).toBe("ok");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(
      join(dir, ".gitignore"),
      "# a comment\n\n   \n.env\n",
    );
    expect(checkGitignoreCovers(dir, ".env")).toBe("ok");
  });

  it("warns when the pattern is not present", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    const r = checkGitignoreCovers(dir, ".env");
    expect(r).not.toBe("ok");
    if (r !== "ok") {
      expect(r.kind).toBe("warning");
      expect(r.message).toMatch(/does not cover/);
    }
  });
});

describe("checkEnvFilePresentAndIgnored", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pubprep-envchk-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns ok when no .env exists (nothing to leak)", () => {
    expect(checkEnvFilePresentAndIgnored(dir)).toBe("ok");
  });

  it("returns ok when .env exists and is gitignored", () => {
    writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-ant-x\n");
    writeFileSync(join(dir, ".gitignore"), ".env\n");
    expect(checkEnvFilePresentAndIgnored(dir)).toBe("ok");
  });

  it("warns when .env exists and is not gitignored", () => {
    writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-ant-x\n");
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    const r = checkEnvFilePresentAndIgnored(dir);
    expect(r).not.toBe("ok");
    if (r !== "ok") {
      expect(r.kind).toBe("warning");
      expect(r.message).toMatch(/does not cover/);
    }
  });
});
