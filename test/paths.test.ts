import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  AGENT_NAMES,
  CONVERGENCE_AGENT_NAME,
  REVIEWER_AGENT_NAMES,
  formatRunTimestamp,
  getAgentDefinitionPath,
  getAgentsDir,
  getCombinedReviewPath,
  getLatestSymlink,
  getManifestPath,
  getOutputPath,
  getPubprepDir,
  getRunDir,
  getRunsDir,
} from "../src/paths.js";

describe("agent name constants", () => {
  it("exposes the four agents in a stable order", () => {
    expect(AGENT_NAMES).toEqual([
      "tech-debt-reviewer",
      "readme-docs-reviewer",
      "security-reviewer",
      "convergence-resolution-architect",
    ]);
  });

  it("reviewers do not include convergence", () => {
    expect(REVIEWER_AGENT_NAMES).not.toContain(CONVERGENCE_AGENT_NAME);
    expect(REVIEWER_AGENT_NAMES.length).toBe(3);
  });
});

describe("formatRunTimestamp", () => {
  it("returns an ISO-8601 UTC stamp with no millis and no colons", () => {
    const date = new Date(Date.UTC(2026, 4, 22, 14, 30, 0, 123));
    expect(formatRunTimestamp(date)).toBe("2026-05-22T143000Z");
  });

  it("sorts lexically in chronological order", () => {
    const stamps = [
      formatRunTimestamp(new Date("2026-05-22T14:30:00Z")),
      formatRunTimestamp(new Date("2026-05-22T14:30:01Z")),
      formatRunTimestamp(new Date("2026-05-23T00:00:00Z")),
    ];
    expect([...stamps].sort()).toEqual(stamps);
  });
});

describe("run directory layout", () => {
  const ROOT = "/tmp/sample-project";
  const STAMP = "2026-05-22T143000Z";

  it("anchors everything under <project>/.pubprep", () => {
    expect(getPubprepDir(ROOT)).toBe(`${ROOT}/.pubprep`);
    expect(getRunsDir(ROOT)).toBe(`${ROOT}/.pubprep/runs`);
    expect(getRunDir(ROOT, STAMP)).toBe(`${ROOT}/.pubprep/runs/${STAMP}`);
    expect(getLatestSymlink(ROOT)).toBe(`${ROOT}/.pubprep/latest`);
  });

  it("produces the file names the build guide promises", () => {
    const runDir = getRunDir(ROOT, STAMP);
    expect(getOutputPath(runDir, "tech-debt-reviewer")).toBe(
      `${runDir}/tech-debt-output.md`,
    );
    expect(getOutputPath(runDir, "readme-docs-reviewer")).toBe(
      `${runDir}/readme-docs-output.md`,
    );
    expect(getOutputPath(runDir, "security-reviewer")).toBe(
      `${runDir}/security-output.md`,
    );
    expect(getOutputPath(runDir, CONVERGENCE_AGENT_NAME)).toBe(
      `${runDir}/convergence-report.md`,
    );
    expect(getCombinedReviewPath(runDir)).toBe(`${runDir}/combined-review.md`);
    expect(getManifestPath(runDir)).toBe(`${runDir}/manifest.json`);
  });
});

describe("agent definition resolution", () => {
  it("resolves the agents dir to a real on-disk location", () => {
    expect(existsSync(getAgentsDir())).toBe(true);
  });

  it("resolves every bundled agent .md file", () => {
    for (const name of AGENT_NAMES) {
      const p = getAgentDefinitionPath(name);
      expect(existsSync(p), `expected ${p} to exist`).toBe(true);
    }
  });
});
