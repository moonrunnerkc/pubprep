import { describe, expect, it } from "vitest";
import {
  openPullRequest,
  skippedPublishPr,
  type ExecFn,
  type ExecResult,
} from "../src/publish-pr.js";

type ExecCall = { cmd: string; args: string[] };

function makeExec(
  responses: Array<(call: ExecCall) => ExecResult | null>,
): { exec: ExecFn; calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: ExecFn = (cmd, args) => {
    const call: ExecCall = { cmd, args: [...args] };
    calls.push(call);
    for (const matcher of responses) {
      const r = matcher(call);
      if (r !== null) return r;
    }
    return { ok: false, stdout: "", stderr: `no matcher for ${cmd} ${args.join(" ")}` };
  };
  return { exec, calls };
}

const ok = (stdout = ""): ExecResult => ({ ok: true, stdout, stderr: "" });
const fail = (stderr = ""): ExecResult => ({ ok: false, stdout: "", stderr });

const matchExact = (
  cmd: string,
  args: readonly string[],
  result: ExecResult,
) => (call: ExecCall) =>
  call.cmd === cmd && call.args.join(" ") === args.join(" ") ? result : null;

const matchPrefix = (
  cmd: string,
  argPrefix: readonly string[],
  result: ExecResult,
) => (call: ExecCall) =>
  call.cmd === cmd &&
  argPrefix.every((a, i) => call.args[i] === a)
    ? result
    : null;

describe("openPullRequest", () => {
  it("returns a skip when gh is not installed", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], fail("command not found")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.ran).toBe(true);
    expect(r.opened).toBe(false);
    expect(r.skipped?.check).toBe("gh_installed");
    expect(r.failure).toBeNull();
  });

  it("returns a skip when gh is not authenticated", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], fail("not logged in")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.skipped?.check).toBe("gh_authenticated");
  });

  it("returns a skip when origin is not a GitHub URL", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("git@gitlab.com:me/x.git\n")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.skipped?.check).toBe("github_remote");
    expect(r.skipped?.detail).toContain("gitlab.com");
  });

  it("returns a skip when the branch IS the default branch", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("main\n")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "main", exec });
    expect(r.skipped?.check).toBe("non_default_branch");
  });

  it("returns a failure when git push fails", () => {
    const { exec, calls } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("main\n")),
      matchPrefix("git", ["push", "-u", "origin", "fix/x"], fail("rejected — non-fast-forward")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.failure?.check).toBe("push");
    expect(r.failure?.detail).toContain("non-fast-forward");
    expect(calls.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(true);
  });

  it("returns the existing PR URL when one is already open for the branch", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("main\n")),
      matchPrefix("git", ["push", "-u", "origin", "fix/x"], ok("")),
      matchPrefix("gh", ["pr", "view", "fix/x"], ok("https://github.com/a/b/pull/7\n")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.ran).toBe(true);
    expect(r.opened).toBe(false);
    expect(r.existed).toBe(true);
    expect(r.url).toBe("https://github.com/a/b/pull/7");
  });

  it("creates the PR via gh pr create --fill --head <branch> and captures the URL", () => {
    const { exec, calls } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("main\n")),
      matchPrefix("git", ["push", "-u", "origin", "fix/x"], ok("")),
      matchPrefix("gh", ["pr", "view", "fix/x"], fail("no pull requests found")),
      matchPrefix(
        "gh",
        ["pr", "create", "--fill", "--head", "fix/x"],
        ok("Creating pull request for fix/x into main\nhttps://github.com/a/b/pull/42\n"),
      ),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.ran).toBe(true);
    expect(r.opened).toBe(true);
    expect(r.existed).toBe(false);
    expect(r.url).toBe("https://github.com/a/b/pull/42");

    const createCall = calls.find(
      (c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "create",
    );
    expect(createCall?.args).toEqual([
      "pr",
      "create",
      "--fill",
      "--head",
      "fix/x",
    ]);
  });

  it("returns a failure when gh pr create exits non-zero", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("main\n")),
      matchPrefix("git", ["push", "-u", "origin", "fix/x"], ok("")),
      matchPrefix("gh", ["pr", "view", "fix/x"], fail("no pr")),
      matchPrefix(
        "gh",
        ["pr", "create", "--fill", "--head", "fix/x"],
        fail("must have a commit"),
      ),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "fix/x", exec });
    expect(r.failure?.check).toBe("create");
    expect(r.failure?.detail).toContain("must have a commit");
  });

  it("falls back to git symbolic-ref when gh repo view does not return a default branch", () => {
    const { exec } = makeExec([
      matchExact("gh", ["--version"], ok("gh 2.0.0")),
      matchPrefix("gh", ["auth", "status"], ok("logged in")),
      matchExact("git", ["remote", "get-url", "origin"], ok("https://github.com/a/b.git\n")),
      matchPrefix("gh", ["repo", "view"], ok("")),
      matchPrefix("git", ["symbolic-ref"], ok("origin/main\n")),
      matchPrefix("git", ["push", "-u", "origin", "main"], ok("")),
    ]);
    const r = openPullRequest({ projectRoot: "/repo", branch: "main", exec });
    expect(r.skipped?.check).toBe("non_default_branch");
  });
});

describe("skippedPublishPr", () => {
  it("returns a non-run result with no url", () => {
    const r = skippedPublishPr();
    expect(r.ran).toBe(false);
    expect(r.opened).toBe(false);
    expect(r.url).toBeNull();
    expect(r.branch).toBeNull();
  });
});
