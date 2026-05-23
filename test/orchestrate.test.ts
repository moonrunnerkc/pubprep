import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orchestrate } from "../src/orchestrate.js";
import { createMockSdk } from "./fixtures/mock-sdk.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-int-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

describe("orchestrate", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("runs all four agents, writes outputs, combined review, and a complete manifest", async () => {
    const mock = createMockSdk(
      {
        "Tech Debt Reviewer": { textChunks: ["TD report\n"], numTurns: 2 },
        "README and Documentation Reviewer": { textChunks: ["DOCS report\n"], numTurns: 3 },
        "Security Reviewer": { textChunks: ["SEC report\n"], numTurns: 4 },
        "CONVERGENCE": { textChunks: ["CONV report\n"], numTurns: 7 },
      },
    );

    const now = new Date(Date.UTC(2026, 4, 22, 14, 30, 0));
    const result = await orchestrate({
      projectRoot: repo,
      now,
      query: mock.query,
    });

    expect(result.exitReason).toBe("success");
    expect(result.runDir).toBe(join(repo, ".pubprep", "runs", "2026-05-22T143000Z"));

    expect(readFileSync(join(result.runDir, "tech-debt-output.md"), "utf8")).toBe("TD report\n");
    expect(readFileSync(join(result.runDir, "readme-docs-output.md"), "utf8")).toBe("DOCS report\n");
    expect(readFileSync(join(result.runDir, "security-output.md"), "utf8")).toBe("SEC report\n");
    expect(readFileSync(join(result.runDir, "convergence-report.md"), "utf8")).toBe("CONV report\n");

    const combined = readFileSync(join(result.runDir, "combined-review.md"), "utf8");
    expect(combined).toContain("# Tech Debt Reviewer");
    expect(combined).toContain("# README and Documentation Reviewer");
    expect(combined).toContain("# Security Reviewer");
    expect(combined).toContain("TD report");
    expect(combined).toContain("DOCS report");
    expect(combined).toContain("SEC report");
    expect(combined).toMatch(/\n---\n/);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.runId).toBe("2026-05-22T143000Z");
    expect(manifest.exit_reason).toBe("success");
    expect(manifest.target_repo).toBe(repo);
    expect(typeof manifest.target_head_sha).toBe("string");
    expect(manifest.agents).toHaveLength(4);
    const names = manifest.agents.map((a: { agentName: string }) => a.agentName);
    expect(names).toEqual([
      "tech-debt-reviewer",
      "readme-docs-reviewer",
      "security-reviewer",
      "convergence-resolution-architect",
    ]);
    expect(manifest.agents[3].turnsUsed).toBe(7);
    expect(manifest.finished_at).not.toBeNull();

    expect(existsSync(join(repo, ".pubprep", "latest"))).toBe(true);
  });

  it("passes the right SDK options on every call", async () => {
    const mock = createMockSdk({}, { textChunks: ["x\n"] });
    await orchestrate({
      projectRoot: repo,
      now: new Date(Date.UTC(2026, 4, 22, 15, 0, 0)),
      query: mock.query,
    });
    expect(mock.calls).toHaveLength(4);
    for (const c of mock.calls) {
      expect(c.cwd).toBe(repo);
      expect(c.permissionMode).toBe("bypassPermissions");
      expect(c.settingSources).toEqual([]);
      expect(c.maxTurns).toBe(100);
    }
    expect(mock.calls[0].model).toBe("claude-sonnet-4-6");
    expect(mock.calls[1].model).toBe("claude-sonnet-4-6");
    expect(mock.calls[2].model).toBe("claude-sonnet-4-6");
    expect(mock.calls[3].model).toBe("claude-opus-4-7");
  });

  it("--dry-run skips convergence and exits success", async () => {
    const mock = createMockSdk({}, { textChunks: ["x\n"] });
    const result = await orchestrate({
      projectRoot: repo,
      dryRun: true,
      now: new Date(Date.UTC(2026, 4, 22, 16, 0, 0)),
      query: mock.query,
    });
    expect(result.exitReason).toBe("success");
    expect(mock.calls).toHaveLength(3);
    expect(existsSync(join(result.runDir, "convergence-report.md"))).toBe(false);
    expect(existsSync(join(result.runDir, "combined-review.md"))).toBe(true);
  });

  it("aborts before convergence and writes manifest when a reviewer fails", async () => {
    const mock = createMockSdk(
      { "Security Reviewer": { shouldThrow: new Error("rate limited") } },
      { textChunks: ["ok\n"] },
    );
    const result = await orchestrate({
      projectRoot: repo,
      now: new Date(Date.UTC(2026, 4, 22, 17, 0, 0)),
      query: mock.query,
    });
    expect(result.exitReason).toBe("reviewer_failure");
    expect(mock.calls).toHaveLength(3);
    expect(existsSync(join(result.runDir, "convergence-report.md"))).toBe(false);
    expect(existsSync(join(result.runDir, "combined-review.md"))).toBe(false);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.exit_reason).toBe("reviewer_failure");
    const sec = manifest.agents.find((a: { agentName: string }) => a.agentName === "security-reviewer");
    expect(sec.isError).toBe(true);
    expect(sec.stopReason).toBe("thrown");
    expect(sec.errorMessage).toContain("rate limited");
  });

  it("runs reviewers sequentially when parallelReviewers is false", async () => {
    const order: string[] = [];
    const mock = createMockSdk(
      {
        "Tech Debt Reviewer": { textChunks: ["TD\n"] },
        "README and Documentation Reviewer": { textChunks: ["DOCS\n"] },
        "Security Reviewer": { textChunks: ["SEC\n"] },
        "CONVERGENCE": { textChunks: ["CONV\n"] },
      },
    );
    const wrappedQuery: typeof mock.query = (params) => {
      const sysPrompt = typeof params.options?.systemPrompt === "string" ? params.options.systemPrompt : "";
      const firstLine = sysPrompt.split("\n", 1)[0] ?? "";
      order.push(firstLine);
      return mock.query(params);
    };
    const result = await orchestrate({
      projectRoot: repo,
      now: new Date(Date.UTC(2026, 4, 22, 19, 0, 0)),
      query: wrappedQuery,
      parallelReviewers: false,
    });
    expect(result.exitReason).toBe("success");
    expect(order).toHaveLength(4);
    expect(order[0]).toContain("Tech Debt Reviewer");
    expect(order[1]).toContain("README and Documentation Reviewer");
    expect(order[2]).toContain("Security Reviewer");
    expect(order[3]).toContain("CONVERGENCE");
  });

  it("returns convergence_failure when convergence errors out", async () => {
    const mock = createMockSdk(
      { CONVERGENCE: { shouldThrow: new Error("convergence boom") } },
      { textChunks: ["ok\n"] },
    );
    const result = await orchestrate({
      projectRoot: repo,
      now: new Date(Date.UTC(2026, 4, 22, 18, 0, 0)),
      query: mock.query,
    });
    expect(result.exitReason).toBe("convergence_failure");
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.exit_reason).toBe("convergence_failure");
  });
});
