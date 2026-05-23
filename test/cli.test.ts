import { describe, expect, it } from "vitest";
import { parseArgs, USAGE, VERSION } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to a non-dry, non-allow-dirty run with the default budget cap and publish gate on", () => {
    const a = parseArgs([]);
    expect(a).toEqual({
      dryRun: false,
      allowDirty: false,
      help: false,
      version: false,
      maxBudgetUsd: 20,
      publishGate: true,
    });
  });

  it("parses --no-publish-gate", () => {
    expect(parseArgs(["--no-publish-gate"]).publishGate).toBe(false);
  });

  it("parses --max-budget-usd <n>", () => {
    expect(parseArgs(["--max-budget-usd", "5"]).maxBudgetUsd).toBe(5);
    expect(parseArgs(["--max-budget-usd", "0"]).maxBudgetUsd).toBe(0);
  });

  it("parses --no-max-budget-usd as null", () => {
    expect(parseArgs(["--no-max-budget-usd"]).maxBudgetUsd).toBeNull();
  });

  it("rejects --max-budget-usd without a value", () => {
    expect(() => parseArgs(["--max-budget-usd"])).toThrow(
      /--max-budget-usd requires a numeric value/,
    );
  });

  it("rejects non-numeric or negative --max-budget-usd values", () => {
    expect(() => parseArgs(["--max-budget-usd", "abc"])).toThrow(
      /non-negative number/,
    );
    expect(() => parseArgs(["--max-budget-usd", "-1"])).toThrow(
      /non-negative number/,
    );
  });

  it("parses --dry-run", () => {
    expect(parseArgs(["--dry-run"]).dryRun).toBe(true);
  });

  it("parses --allow-dirty", () => {
    expect(parseArgs(["--allow-dirty"]).allowDirty).toBe(true);
  });

  it("parses combined flags in any order", () => {
    const a = parseArgs(["--allow-dirty", "--dry-run"]);
    expect(a.dryRun).toBe(true);
    expect(a.allowDirty).toBe(true);
  });

  it("supports -h / --help and -v / --version", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  it("throws on unknown flags", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown flag: --nope/);
  });
});

describe("CLI constants", () => {
  it("USAGE mentions every supported flag", () => {
    expect(USAGE).toContain("--dry-run");
    expect(USAGE).toContain("--allow-dirty");
    expect(USAGE).toContain("--max-budget-usd");
    expect(USAGE).toContain("--no-max-budget-usd");
    expect(USAGE).toContain("--no-publish-gate");
    expect(USAGE).toContain("ANTHROPIC_API_KEY");
  });

  it("VERSION matches package.json semver shape", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
