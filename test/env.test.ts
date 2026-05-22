import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InvalidApiKeyError,
  MissingApiKeyError,
  loadEnv,
  requireApiKey,
} from "../src/env.js";

const VAR = "ANTHROPIC_API_KEY";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pubprep-env-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("requireApiKey", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[VAR];
    delete process.env[VAR];
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env[VAR];
    } else {
      process.env[VAR] = original;
    }
  });

  it("throws MissingApiKeyError when the variable is unset", () => {
    expect(() => requireApiKey()).toThrow(MissingApiKeyError);
  });

  it("throws MissingApiKeyError when the variable is blank", () => {
    process.env[VAR] = "   ";
    expect(() => requireApiKey()).toThrow(MissingApiKeyError);
  });

  it("throws InvalidApiKeyError when the prefix is wrong", () => {
    process.env[VAR] = "sk-openai-abcdef";
    expect(() => requireApiKey()).toThrow(InvalidApiKeyError);
  });

  it("returns the trimmed key when valid", () => {
    process.env[VAR] = "  sk-ant-real-key-value  ";
    expect(requireApiKey()).toBe("sk-ant-real-key-value");
  });
});

describe("loadEnv", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env[VAR];
    delete process.env[VAR];
  });
  afterEach(() => {
    if (original === undefined) {
      delete process.env[VAR];
    } else {
      process.env[VAR] = original;
    }
  });

  it("loads ANTHROPIC_API_KEY from a project-root .env", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-ant-from-file\n");
      loadEnv(dir);
      expect(process.env[VAR]).toBe("sk-ant-from-file");
    });
  });

  it("is a no-op when no .env file exists", () => {
    withTempDir((dir) => {
      loadEnv(dir);
      expect(process.env[VAR]).toBeUndefined();
    });
  });

  it("does not overwrite a value already set in the environment", () => {
    process.env[VAR] = "sk-ant-from-shell";
    withTempDir((dir) => {
      writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-ant-from-file\n");
      loadEnv(dir);
      expect(process.env[VAR]).toBe("sk-ant-from-shell");
    });
  });
});
