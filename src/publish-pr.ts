import { spawnSync } from "node:child_process";

export type PrCheck =
  | "gh_installed"
  | "gh_authenticated"
  | "github_remote"
  | "non_default_branch"
  | "push"
  | "create";

export type PrIssue = {
  check: PrCheck;
  detail: string;
};

export type PublishPrResult = {
  ran: boolean;
  opened: boolean;
  existed: boolean;
  url: string | null;
  branch: string | null;
  skipped: PrIssue | null;
  failure: PrIssue | null;
};

export interface PublishPrParams {
  projectRoot: string;
  branch: string;
  log?: (message: string) => void;
  /**
   * Override the command executor. Tests inject this to avoid actually
   * shelling out to git/gh. Defaults to a spawnSync-backed implementation.
   */
  exec?: ExecFn;
}

export type ExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type ExecFn = (cmd: string, args: readonly string[], cwd: string) => ExecResult;

const defaultExec: ExecFn = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args as string[], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) {
    return { ok: false, stdout: "", stderr: r.error.message };
  }
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
};

export function openPullRequest(params: PublishPrParams): PublishPrResult {
  const { projectRoot, branch, log = () => {}, exec = defaultExec } = params;

  const ghVersion = exec("gh", ["--version"], projectRoot);
  if (!ghVersion.ok) {
    return skipResult(
      branch,
      "gh_installed",
      "GitHub CLI (gh) is not installed. Install from https://cli.github.com, then re-run pubprep — or push and open the PR manually.",
    );
  }

  const ghAuth = exec("gh", ["auth", "status"], projectRoot);
  if (!ghAuth.ok) {
    return skipResult(
      branch,
      "gh_authenticated",
      `GitHub CLI is not authenticated. Run 'gh auth login', then re-run pubprep.\n${trimOutput(ghAuth)}`,
    );
  }

  const remote = exec("git", ["remote", "get-url", "origin"], projectRoot);
  if (!remote.ok) {
    return skipResult(
      branch,
      "github_remote",
      "no 'origin' remote configured. Add one with 'git remote add origin <url>'.",
    );
  }
  const remoteUrl = remote.stdout.trim();
  if (!isGithubUrl(remoteUrl)) {
    return skipResult(
      branch,
      "github_remote",
      `'origin' is not a GitHub URL: ${remoteUrl}`,
    );
  }

  const defaultBranch = readDefaultBranch(exec, projectRoot);
  if (defaultBranch !== null && branch === defaultBranch) {
    return skipResult(
      branch,
      "non_default_branch",
      `convergence is on the default branch ('${branch}'); nothing to open a PR against.`,
    );
  }

  log(`open pr: pushing ${branch} to origin`);
  const push = exec("git", ["push", "-u", "origin", branch], projectRoot);
  if (!push.ok) {
    return failResult(branch, "push", `git push failed:\n${trimOutput(push)}`);
  }

  const existing = exec(
    "gh",
    ["pr", "view", branch, "--json", "url", "--jq", ".url"],
    projectRoot,
  );
  const existingUrl = existing.ok ? existing.stdout.trim() : "";
  if (existingUrl.length > 0) {
    log(`open pr: existing PR for ${branch}: ${existingUrl}`);
    return {
      ran: true,
      opened: false,
      existed: true,
      url: existingUrl,
      branch,
      skipped: null,
      failure: null,
    };
  }

  log(`open pr: creating PR for ${branch}`);
  const create = exec(
    "gh",
    ["pr", "create", "--fill", "--head", branch],
    projectRoot,
  );
  if (!create.ok) {
    return failResult(
      branch,
      "create",
      `gh pr create failed:\n${trimOutput(create)}`,
    );
  }

  const url = extractPrUrl(create.stdout) ?? extractPrUrl(create.stderr);
  return {
    ran: true,
    opened: true,
    existed: false,
    url,
    branch,
    skipped: null,
    failure: null,
  };
}

export function skippedPublishPr(): PublishPrResult {
  return {
    ran: false,
    opened: false,
    existed: false,
    url: null,
    branch: null,
    skipped: null,
    failure: null,
  };
}

function isGithubUrl(url: string): boolean {
  return url.includes("github.com");
}

function readDefaultBranch(exec: ExecFn, projectRoot: string): string | null {
  const ghDefault = exec(
    "gh",
    ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
    projectRoot,
  );
  if (ghDefault.ok && ghDefault.stdout.trim().length > 0) {
    return ghDefault.stdout.trim();
  }
  const symRef = exec(
    "git",
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    projectRoot,
  );
  if (symRef.ok && symRef.stdout.trim().length > 0) {
    return symRef.stdout.trim().replace(/^origin\//, "");
  }
  return null;
}

function extractPrUrl(text: string): string | null {
  for (const raw of text.split("\n").reverse()) {
    const line = raw.trim();
    if (line.startsWith("https://") && line.includes("github.com")) {
      return line;
    }
  }
  return null;
}

function trimOutput(r: ExecResult): string {
  const combined = `${r.stderr}\n${r.stdout}`.trim();
  return combined.length > 0 ? combined : "(no output)";
}

function skipResult(
  branch: string,
  check: PrCheck,
  detail: string,
): PublishPrResult {
  return {
    ran: true,
    opened: false,
    existed: false,
    url: null,
    branch,
    skipped: { check, detail },
    failure: null,
  };
}

function failResult(
  branch: string,
  check: PrCheck,
  detail: string,
): PublishPrResult {
  return {
    ran: true,
    opened: false,
    existed: false,
    url: null,
    branch,
    skipped: null,
    failure: { check, detail },
  };
}
