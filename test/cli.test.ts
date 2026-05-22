import { describe, expect, it } from "vitest";
import { parseArgs, USAGE, VERSION } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to a non-dry, non-allow-dirty run", () => {
    const a = parseArgs([]);
    expect(a).toEqual({
      dryRun: false,
      allowDirty: false,
      help: false,
      version: false,
    });
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
  it("USAGE mentions the two real flags", () => {
    expect(USAGE).toContain("--dry-run");
    expect(USAGE).toContain("--allow-dirty");
    expect(USAGE).toContain("ANTHROPIC_API_KEY");
  });

  it("VERSION matches package.json semver shape", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
