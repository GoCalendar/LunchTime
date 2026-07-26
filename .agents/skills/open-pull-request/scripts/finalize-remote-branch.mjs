#!/usr/bin/env node

import { createHash, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseGitHubRepositoryFromRemoteUrl } from "./validate-finalize.mjs";

const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/;
const BRANCH_PATTERN =
  /^work\/issue-[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OID_PATTERN = /^[0-9a-f]{40}$/i;
const PLAN_PATTERN = /^[0-9a-f]{64}$/;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const PLAN_VERSION = "lunchtime-finalize-remote-branch:v1";

export class FinalizeRemoteBranchError extends Error {
  constructor(message, { usage = false } = {}) {
    super(message);
    this.name = "FinalizeRemoteBranchError";
    this.exitCode = usage ? 2 : 1;
  }
}

function fail(message, options) {
  throw new FinalizeRemoteBranchError(message, options);
}

export function canonicalRepository(value) {
  const repository = String(value ?? "");
  if (
    repository !== repository.trim() ||
    !REPOSITORY_PATTERN.test(repository)
  ) {
    fail("저장소는 credential이 없는 `OWNER/REPO` 형식이어야 합니다.");
  }
  return repository.toLowerCase();
}

export function canonicalBranch(value) {
  const branch = String(value ?? "");
  if (branch !== branch.trim() || !BRANCH_PATTERN.test(branch)) {
    fail(
      "원격 정리 branch는 `work/issue-<number>-<lowercase-slug>` 형식이어야 합니다.",
    );
  }
  return branch;
}

export function canonicalHead(value) {
  const head = String(value ?? "");
  if (head !== head.trim() || !OID_PATTERN.test(head)) {
    fail("원격 정리 head는 정확한 40자리 Git commit OID여야 합니다.");
  }
  return head.toLowerCase();
}

export function parseCanonicalGitHubRemoteUrl(remoteUrl) {
  const raw = String(remoteUrl ?? "");
  if (!raw || raw !== raw.trim() || /[\r\n]/.test(raw)) {
    fail("origin URL을 credential 없는 canonical GitHub URL로 해석할 수 없습니다.");
  }

  const repository = parseGitHubRepositoryFromRemoteUrl(raw);
  if (!repository) {
    fail("origin URL을 credential 없는 canonical GitHub URL로 해석할 수 없습니다.");
  }

  const scpLike =
    /^git@github\.com:[^/\s:]+\/[^/\s]+?(?:\.git)?$/i.test(raw);
  if (!scpLike) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      fail(
        "origin URL을 credential 없는 canonical GitHub URL로 해석할 수 없습니다.",
      );
    }
    const https =
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port;
    const ssh =
      parsed.protocol === "ssh:" &&
      parsed.username === "git" &&
      !parsed.password &&
      (!parsed.port || parsed.port === "22");
    if (
      (!https && !ssh) ||
      parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname.endsWith("/") ||
      parsed.pathname.includes("//") ||
      parsed.pathname.includes("%")
    ) {
      fail(
        "origin URL을 credential 없는 canonical GitHub URL로 해석할 수 없습니다.",
      );
    }
  }

  return canonicalRepository(repository);
}

export function remoteUrlFingerprint(remoteUrl) {
  parseCanonicalGitHubRemoteUrl(remoteUrl);
  return createHash("sha256").update(String(remoteUrl), "utf8").digest("hex");
}

function outputLines(stdout) {
  const raw = String(stdout ?? "");
  if (!raw) return [];
  const withoutTerminalNewline = raw.replace(/\r?\n$/, "");
  if (!withoutTerminalNewline) return [];
  return withoutTerminalNewline.split(/\r?\n/);
}

function singleRemoteUrl(stdout, kind) {
  const lines = outputLines(stdout);
  if (lines.length !== 1 || !lines[0]) {
    fail(`origin ${kind} URL은 정확히 하나여야 합니다.`);
  }
  return lines[0];
}

function defaultGitRunner(repositoryRoot) {
  return (arguments_) =>
    spawnSync("git", arguments_, {
      cwd: resolve(repositoryRoot),
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
}

function runGit(git, arguments_, failureMessage) {
  let result;
  try {
    result = git(arguments_);
  } catch {
    fail(failureMessage);
  }
  if (
    !result ||
    result.status !== 0 ||
    result.error ||
    typeof result.stdout !== "string"
  ) {
    fail(failureMessage);
  }
  return result.stdout;
}

export function readOriginRemoteConfiguration(git) {
  const fetchUrl = singleRemoteUrl(
    runGit(
      git,
      ["remote", "get-url", "--all", "origin"],
      "origin fetch 설정을 안전하게 읽지 못했습니다.",
    ),
    "fetch",
  );
  const pushUrl = singleRemoteUrl(
    runGit(
      git,
      ["remote", "get-url", "--push", "--all", "origin"],
      "origin push 설정을 안전하게 읽지 못했습니다.",
    ),
    "push",
  );
  return {
    fetchUrl,
    pushUrl,
    fetchRepository: parseCanonicalGitHubRemoteUrl(fetchUrl),
    pushRepository: parseCanonicalGitHubRemoteUrl(pushUrl),
    fetchFingerprint: remoteUrlFingerprint(fetchUrl),
    pushFingerprint: remoteUrlFingerprint(pushUrl),
  };
}

export function createRemoteBranchPlanToken({
  repository,
  branch,
  head,
  fetchFingerprint,
  pushFingerprint,
}) {
  const payload = {
    version: PLAN_VERSION,
    remote: "origin",
    repository: canonicalRepository(repository),
    branch: canonicalBranch(branch),
    head: canonicalHead(head),
    fetchFingerprint: String(fetchFingerprint ?? ""),
    pushFingerprint: String(pushFingerprint ?? ""),
  };
  if (
    !PLAN_PATTERN.test(payload.fetchFingerprint) ||
    !PLAN_PATTERN.test(payload.pushFingerprint)
  ) {
    fail("원격 정리 계획에는 canonical origin URL fingerprint가 필요합니다.");
  }
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function inspectCanonicalOrigin(
  request,
  {
    repositoryRoot = process.cwd(),
    git = defaultGitRunner(repositoryRoot),
  } = {},
) {
  const repository = canonicalRepository(request?.repo);
  const origin = readOriginRemoteConfiguration(git);
  if (
    origin.fetchRepository !== repository ||
    origin.pushRepository !== repository
  ) {
    fail(
      "origin fetch와 push URL은 모두 요청한 same-repository 작업 저장소에 귀속되어야 합니다.",
    );
  }
  return {
    command: "inspect-origin",
    verified: true,
    repository,
    remote: "origin",
    fetchFingerprint: origin.fetchFingerprint,
    pushFingerprint: origin.pushFingerprint,
  };
}

export function parseRemoteBranchListing(stdout, branch) {
  const expectedRef = `refs/heads/${canonicalBranch(branch)}`;
  const lines = outputLines(stdout);
  if (lines.length === 0) {
    return { alreadyAbsent: true, oid: null };
  }
  if (lines.length !== 1) {
    fail("원격 branch 조회는 정확히 0개 또는 1개의 ref만 반환해야 합니다.");
  }
  const match = /^([0-9a-f]{40})\t(.+)$/.exec(lines[0]);
  if (!match || match[2] !== expectedRef) {
    fail("원격 branch 조회가 요청한 exact ref에 귀속되지 않습니다.");
  }
  return { alreadyAbsent: false, oid: match[1].toLowerCase() };
}

function inspectRemoteBranch(git, pushUrl, branch) {
  const ref = `refs/heads/${branch}`;
  const stdout = runGit(
    git,
    ["ls-remote", "--heads", pushUrl, ref],
    "원격 branch 상태를 안전하게 읽지 못했습니다.",
  );
  return parseRemoteBranchListing(stdout, branch);
}

function planTokensEqual(actual, expected) {
  if (!PLAN_PATTERN.test(String(actual ?? ""))) return false;
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function executeFinalizeRemoteBranch(
  request,
  {
    repositoryRoot = process.cwd(),
    git = defaultGitRunner(repositoryRoot),
  } = {},
) {
  const repository = canonicalRepository(request?.repo);
  const branch = canonicalBranch(request?.branch);
  const head = canonicalHead(request?.head);
  const dryRun = request?.dryRun === true;
  const confirmPlan = String(request?.confirmPlan ?? "");
  if (dryRun === Boolean(confirmPlan)) {
    fail(
      "`--dry-run` 또는 `--confirm-plan <token>` 중 정확히 하나가 필요합니다.",
      { usage: true },
    );
  }
  if (confirmPlan && !PLAN_PATTERN.test(confirmPlan)) {
    fail("`--confirm-plan`에는 64자리 계획 token이 필요합니다.", {
      usage: true,
    });
  }

  const origin = readOriginRemoteConfiguration(git);
  if (
    origin.fetchRepository !== repository ||
    origin.pushRepository !== repository
  ) {
    fail(
      "origin fetch와 push URL은 모두 요청한 same-repository PR source에 귀속되어야 합니다.",
    );
  }
  const planToken = createRemoteBranchPlanToken({
    repository,
    branch,
    head,
    fetchFingerprint: origin.fetchFingerprint,
    pushFingerprint: origin.pushFingerprint,
  });

  if (!dryRun && !planTokensEqual(confirmPlan, planToken)) {
    fail(
      "원격 정리 계획 token이 현재 origin 설정·저장소·branch·head와 일치하지 않습니다.",
    );
  }

  const before = inspectRemoteBranch(git, origin.pushUrl, branch);
  if (before.alreadyAbsent) {
    return {
      command: "finalize-remote-branch",
      dryRun,
      verified: true,
      repository,
      remote: "origin",
      branch,
      head,
      alreadyAbsent: true,
      ...(dryRun ? { planned: [] } : { completed: [] }),
    };
  }
  if (before.oid !== head) {
    fail("원격 branch OID가 검증한 exact head와 다릅니다.");
  }

  if (dryRun) {
    return {
      command: "finalize-remote-branch",
      dryRun: true,
      verified: true,
      repository,
      remote: "origin",
      branch,
      head,
      alreadyAbsent: false,
      planToken,
      planned: ["delete exact remote branch once with an explicit lease"],
    };
  }

  const ref = `refs/heads/${branch}`;
  runGit(
    git,
    [
      "push",
      `--force-with-lease=${ref}:${head}`,
      origin.pushUrl,
      `:${ref}`,
    ],
    "원격 branch lease 삭제가 실패했습니다.",
  );

  const after = inspectRemoteBranch(git, origin.pushUrl, branch);
  if (!after.alreadyAbsent) {
    fail("원격 branch 삭제 뒤 exact ref 부재를 확인하지 못했습니다.");
  }
  return {
    command: "finalize-remote-branch",
    dryRun: false,
    verified: true,
    repository,
    remote: "origin",
    branch,
    head,
    alreadyAbsent: false,
    completed: ["deleted exact remote branch once with an explicit lease"],
  };
}

export function parseArguments(argv) {
  const parsed = { dryRun: false };
  const valueOptions = new Map([
    ["--repo", "repo"],
    ["--branch", "branch"],
    ["--head", "head"],
    ["--confirm-plan", "confirmPlan"],
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--inspect-origin") {
      if (seen.has(argument)) {
        fail("`--inspect-origin`을 중복 지정할 수 없습니다.", { usage: true });
      }
      seen.add(argument);
      parsed.inspectOrigin = true;
      continue;
    }
    if (argument === "--dry-run") {
      if (seen.has(argument)) {
        fail("`--dry-run`을 중복 지정할 수 없습니다.", { usage: true });
      }
      seen.add(argument);
      parsed.dryRun = true;
      continue;
    }
    if (!valueOptions.has(argument) || seen.has(argument)) {
      fail("알 수 없거나 중복된 인자가 있습니다.", { usage: true });
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail("모든 값 인자에는 값이 필요합니다.", { usage: true });
    }
    seen.add(argument);
    parsed[valueOptions.get(argument)] = value;
    index += 1;
  }
  if (parsed.inspectOrigin) {
    if (
      !parsed.repo ||
      parsed.branch ||
      parsed.head ||
      parsed.confirmPlan ||
      parsed.dryRun
    ) {
      fail(
        "`--inspect-origin`에는 `--repo OWNER/REPO`만 함께 지정해야 합니다.",
        { usage: true },
      );
    }
    return { inspectOrigin: true, repo: parsed.repo };
  }
  for (const field of ["repo", "branch", "head"]) {
    if (!parsed[field]) {
      fail("`--repo`, `--branch`, `--head`는 모두 필수입니다.", {
        usage: true,
      });
    }
  }
  if (parsed.dryRun === Boolean(parsed.confirmPlan)) {
    fail(
      "`--dry-run` 또는 `--confirm-plan <token>` 중 정확히 하나가 필요합니다.",
      { usage: true },
    );
  }
  if (
    parsed.confirmPlan &&
    !PLAN_PATTERN.test(String(parsed.confirmPlan))
  ) {
    fail("`--confirm-plan`에는 64자리 계획 token이 필요합니다.", {
      usage: true,
    });
  }
  return parsed;
}

function main() {
  try {
    const request = parseArguments(process.argv.slice(2));
    const result = request.inspectOrigin
      ? inspectCanonicalOrigin(request)
      : executeFinalizeRemoteBranch(request);
    console.log(JSON.stringify(result));
  } catch (error) {
    const normalized =
      error instanceof FinalizeRemoteBranchError
        ? error
        : new FinalizeRemoteBranchError(
            "원격 branch 정리를 안전하게 완료하지 못했습니다.",
          );
    console.error(normalized.message);
    process.exitCode = normalized.exitCode;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
