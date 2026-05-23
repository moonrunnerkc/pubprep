import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

vi.mock("../src/claude-code.js", () => ({
  findClaudeCodeBinary: vi.fn(() => null),
}));

vi.mock("../src/orchestrate.js", () => ({
  orchestrate: vi.fn(),
}));

import { findClaudeCodeBinary } from "../src/claude-code.js";
import { main, USAGE, VERSION } from "../src/cli.js";
import { orchestrate } from "../src/orchestrate.js";

const findBinaryMock = vi.mocked(findClaudeCodeBinary);
const orchestrateMock = vi.mocked(orchestrate);

function makeCleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-cli-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), ".pubprep/\n.env\n");
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function makeDirtyRepo(): string {
  const dir = makeCleanRepo();
  writeFileSync(join(dir, "dirty.txt"), "uncommitted\n");
  return dir;
}

function successfulOrchestrate(): Awaited<ReturnType<typeof orchestrate>> {
  return {
    runDir: "/tmp/run",
    manifestPath: "/tmp/run/manifest.json",
    exitReason: "success",
    manifest: {
      run_id: "test-run",
      started_at: "2026-05-22T00:00:00Z",
      finished_at: "2026-05-22T00:01:00Z",
      target_repo: "/tmp/run",
      target_head_sha: "deadbeef",
      agents: [],
      convergence_branch: null,
      exit_reason: "success",
      publish_gate: null,
      pull_request: null,
      warnings: [],
    },
  };
}

describe("main()", () => {
  let stdoutSpy: MockInstance<(chunk: string) => boolean>;
  let stderrSpy: MockInstance<(chunk: string) => boolean>;
  let originalApiKey: string | undefined;
  let repo: string | null;
  let fakeHome: string;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true) as MockInstance<(chunk: string) => boolean>;
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true) as MockInstance<(chunk: string) => boolean>;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    findBinaryMock.mockReset();
    findBinaryMock.mockReturnValue(null);
    orchestrateMock.mockReset();
    orchestrateMock.mockResolvedValue(successfulOrchestrate());
    repo = null;
    fakeHome = mkdtempSync(join(tmpdir(), "pubprep-cli-home-"));
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    if (repo !== null) {
      rmSync(repo, { recursive: true, force: true });
    }
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function stdoutText(): string {
    return stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
  }
  function stderrText(): string {
    return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("prints USAGE and exits 0 on --help", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(0);
    expect(stdoutText()).toBe(USAGE);
  });

  it("prints the version and exits 0 on --version", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(stdoutText()).toBe(`${VERSION}\n`);
  });

  it("rejects an unknown flag with exit 1", async () => {
    const code = await main(["--nope"]);
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/Unknown flag: --nope/);
  });

  it("returns 1 when neither claude binary nor ANTHROPIC_API_KEY is available", async () => {
    repo = makeCleanRepo();
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/no auth available/);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it("returns 1 when ANTHROPIC_API_KEY is set to a placeholder (no claude binary)", async () => {
    repo = makeCleanRepo();
    process.env.ANTHROPIC_API_KEY = "sk-ant-placeholder";
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/looks like a placeholder/);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it("runs orchestrate in subscription mode and clears ANTHROPIC_API_KEY", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    process.env.ANTHROPIC_API_KEY = "should-be-cleared";
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    const call = orchestrateMock.mock.calls[0]?.[0];
    expect(call?.projectRoot).toBe(repo);
    expect(call?.parallelReviewers).toBe(false);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(stdoutText()).toMatch(/Claude Code subscription/);
  });

  it("runs orchestrate in API-key mode and passes parallelReviewers=true", async () => {
    repo = makeCleanRepo();
    process.env.ANTHROPIC_API_KEY = `sk-ant-${"x".repeat(100)}`;
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
    expect(orchestrateMock.mock.calls[0]?.[0]?.parallelReviewers).toBe(true);
    expect(stdoutText()).toMatch(/ANTHROPIC_API_KEY \(per-token billing\)/);
  });

  it("forwards --dry-run to orchestrate", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main(["--dry-run"], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock.mock.calls[0]?.[0]?.dryRun).toBe(true);
  });

  it("returns 1 when the working tree is dirty without --allow-dirty", async () => {
    repo = makeDirtyRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/uncommitted changes/);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it("proceeds on a dirty tree when --allow-dirty is passed", async () => {
    repo = makeDirtyRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main(["--allow-dirty"], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock).toHaveBeenCalledTimes(1);
  });

  it("returns 1 when not inside a git repository", async () => {
    repo = mkdtempSync(join(tmpdir(), "pubprep-cli-nogit-"));
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(1);
    expect(stderrText()).toMatch(/not inside a git repository/);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it("returns 2 when orchestrate reports reviewer_failure", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    orchestrateMock.mockResolvedValueOnce({
      ...successfulOrchestrate(),
      exitReason: "reviewer_failure",
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(2);
  });

  it("returns 2 and writes a stderr message when orchestrate throws", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    orchestrateMock.mockRejectedValueOnce(new Error("boom"));
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(2);
    expect(stderrText()).toMatch(/error: boom/);
  });

  it("forwards --no-publish-gate to orchestrate", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main(["--no-publish-gate"], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock.mock.calls[0]?.[0]?.publishGate).toBe(false);
  });

  it("prints publish-ready and a push hint on success when the PR phase did not run", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const base = successfulOrchestrate();
    orchestrateMock.mockResolvedValueOnce({
      ...base,
      manifest: {
        ...base.manifest,
        convergence_branch: "convergence/2026-05-22-fixes",
      },
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    const out = stdoutText();
    expect(out).toMatch(/publish-ready: yes/);
    expect(out).toMatch(
      /git push -u origin convergence\/2026-05-22-fixes/,
    );
  });

  it("prints the PR URL on success when openPullRequest opened a new PR", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const base = successfulOrchestrate();
    orchestrateMock.mockResolvedValueOnce({
      ...base,
      manifest: {
        ...base.manifest,
        convergence_branch: "convergence/2026-05-22-fixes",
        pull_request: {
          ran: true,
          opened: true,
          existed: false,
          url: "https://github.com/o/r/pull/12",
          branch: "convergence/2026-05-22-fixes",
          skipped: null,
          failure: null,
        },
      },
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    const out = stdoutText();
    expect(out).toMatch(/publish-ready: yes/);
    expect(out).toMatch(/PR opened: https:\/\/github\.com\/o\/r\/pull\/12/);
    expect(out).toMatch(/review the PR on GitHub and merge/);
  });

  it("prints the existing PR URL when the branch already has one", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const base = successfulOrchestrate();
    orchestrateMock.mockResolvedValueOnce({
      ...base,
      manifest: {
        ...base.manifest,
        convergence_branch: "convergence/2026-05-22-fixes",
        pull_request: {
          ran: true,
          opened: false,
          existed: true,
          url: "https://github.com/o/r/pull/9",
          branch: "convergence/2026-05-22-fixes",
          skipped: null,
          failure: null,
        },
      },
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    const out = stdoutText();
    expect(out).toMatch(/PR already open .* https:\/\/github\.com\/o\/r\/pull\/9/);
  });

  it("prints a skip reason and manual hint when PR-open was skipped (e.g. gh missing)", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const base = successfulOrchestrate();
    orchestrateMock.mockResolvedValueOnce({
      ...base,
      manifest: {
        ...base.manifest,
        convergence_branch: "convergence/2026-05-22-fixes",
        pull_request: {
          ran: true,
          opened: false,
          existed: false,
          url: null,
          branch: "convergence/2026-05-22-fixes",
          skipped: {
            check: "gh_installed",
            detail: "GitHub CLI (gh) is not installed.",
          },
          failure: null,
        },
      },
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    const out = stdoutText();
    expect(out).toMatch(/PR not opened \(gh_installed\)/);
    expect(out).toMatch(
      /git push -u origin convergence\/2026-05-22-fixes && gh pr create --fill --head convergence\/2026-05-22-fixes/,
    );
  });

  it("forwards --no-open-pr to orchestrate", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const code = await main(["--no-open-pr"], { cwd: repo, home: fakeHome });
    expect(code).toBe(0);
    expect(orchestrateMock.mock.calls[0]?.[0]?.openPr).toBe(false);
  });

  it("prints publish-ready: NO and the failure detail when the gate fails", async () => {
    repo = makeCleanRepo();
    findBinaryMock.mockReturnValue("/opt/homebrew/bin/claude");
    const base = successfulOrchestrate();
    orchestrateMock.mockResolvedValueOnce({
      ...base,
      exitReason: "not_publish_ready",
      manifest: {
        ...base.manifest,
        exit_reason: "not_publish_ready",
        publish_gate: {
          ran: true,
          passed: false,
          checked: ["clean_tree", "typecheck"],
          skipped: ["tests"],
          failures: [
            { check: "typecheck", detail: "src/foo.ts(10,3): TS2304: Cannot find name 'bar'." },
          ],
        },
      },
    });
    const code = await main([], { cwd: repo, home: fakeHome });
    expect(code).toBe(2);
    const out = stdoutText();
    expect(out).toMatch(/publish-ready: NO/);
    expect(out).toMatch(/typecheck:/);
    expect(out).toMatch(/Cannot find name 'bar'/);
  });
});
