#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  canonicalBranch,
  canonicalHead,
  canonicalRepository,
} from "./finalize-remote-branch.mjs";

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const PLAN_PATTERN = /^[0-9a-f]{64}$/;
const MAX_GH_OUTPUT_BYTES = 16 * 1024 * 1024;
const PLAN_VERSION = "lunchtime-finalize-merge:v1";
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const PR_VIEW_FIELDS = [
  "number",
  "updatedAt",
  "state",
  "isDraft",
  "baseRefName",
  "baseRefOid",
  "headRefName",
  "headRefOid",
  "headRepository",
  "headRepositoryOwner",
  "isCrossRepository",
  "title",
].join(",");

export class FinalizeMergeError extends Error {
  constructor(message, { usage = false, uncertainMutation = false } = {}) {
    super(message);
    this.name = "FinalizeMergeError";
    this.exitCode = usage ? 2 : 1;
    this.uncertainMutation = uncertainMutation;
  }
}

function fail(message, options) {
  throw new FinalizeMergeError(message, options);
}

function positiveInteger(value, label) {
  const normalized = String(value ?? "");
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) {
    fail(`${label}에는 양의 정수가 필요합니다.`);
  }
  return Number(normalized);
}

function canonicalTimestamp(value) {
  const timestamp = String(value ?? "");
  if (
    !RFC3339_PATTERN.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    fail("병합 snapshot에는 canonical RFC3339 `updatedAt`이 필요합니다.");
  }
  return timestamp;
}

function titleDigest(title) {
  return createHash("sha256").update(title, "utf8").digest("hex");
}

function canonicalTitle(value) {
  const title = String(value ?? "");
  if (
    !title ||
    title !== title.trim() ||
    /[\r\n\0]/.test(title) ||
    Buffer.byteLength(title, "utf8") > 1024
  ) {
    fail("병합 snapshot 제목이 비어 있거나 안전한 단일 제목이 아닙니다.");
  }
  return title;
}

function pullRequestHeadRepository(pr) {
  const nameWithOwner = String(pr?.headRepository?.nameWithOwner ?? "").trim();
  if (nameWithOwner) return canonicalRepository(nameWithOwner);
  const owner = String(pr?.headRepositoryOwner?.login ?? "").trim();
  const name = String(pr?.headRepository?.name ?? "").trim();
  return canonicalRepository(`${owner}/${name}`);
}

export function normalizeFinalizeMergeSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("validator가 출력한 finalize snapshot JSON object가 필요합니다.");
  }
  if (raw.verified !== true || raw.recovery === true) {
    fail("OPEN finalize validator가 승인한 snapshot만 병합할 수 있습니다.");
  }
  const repository = canonicalRepository(raw.repository);
  const sourceRepository = canonicalRepository(raw.sourceRepository);
  if (
    sourceRepository !== repository ||
    raw.remote !== "origin" ||
    raw.base === undefined
  ) {
    fail("병합 snapshot이 same-repository canonical origin에 귀속되지 않습니다.");
  }
  const issue = positiveInteger(raw.issue, "병합 snapshot issue");
  const pr = positiveInteger(raw.pr, "병합 snapshot PR");
  const base = canonicalHead(raw.base);
  const head = canonicalHead(raw.head);
  const headTree = canonicalHead(raw.headTree);
  const branch = canonicalBranch(raw.branch);
  const title = canonicalTitle(raw.title);
  const updatedAt = canonicalTimestamp(raw.updatedAt);
  return {
    verified: true,
    repository,
    issue,
    pr,
    base,
    head,
    headTree,
    branch,
    title,
    updatedAt,
    sourceRepository,
    remote: "origin",
  };
}

function defaultGhRunner(arguments_) {
  return spawnSync("gh", arguments_, {
    encoding: "utf8",
    maxBuffer: MAX_GH_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGh(gh, arguments_, failureMessage, options = {}) {
  let result;
  try {
    result = gh(arguments_);
  } catch {
    fail(failureMessage, options);
  }
  if (
    !result ||
    result.status !== 0 ||
    result.error ||
    typeof result.stdout !== "string"
  ) {
    fail(failureMessage, options);
  }
  return result.stdout;
}

function readCurrentPullRequest(gh, snapshot) {
  const stdout = runGh(
    gh,
    [
      "pr",
      "view",
      String(snapshot.pr),
      "-R",
      snapshot.repository,
      "--json",
      PR_VIEW_FIELDS,
    ],
    "병합 직전 PR identity를 안전하게 다시 읽지 못했습니다.",
  );
  let current;
  try {
    current = JSON.parse(stdout);
  } catch {
    fail("병합 직전 PR identity 응답이 JSON이 아닙니다.");
  }
  return current;
}

function assertCurrentPullRequest(snapshot, current) {
  const currentRepository = pullRequestHeadRepository(current);
  const errors = [];
  if (Number(current?.number) !== snapshot.pr) errors.push("PR 번호");
  if (current?.state !== "OPEN") errors.push("OPEN 상태");
  if (current?.isDraft !== false) errors.push("Ready 상태");
  if (current?.baseRefName !== "main") errors.push("base branch");
  if (String(current?.baseRefOid ?? "").toLowerCase() !== snapshot.base) {
    errors.push("base OID");
  }
  if (current?.headRefName !== snapshot.branch) errors.push("head branch");
  if (String(current?.headRefOid ?? "").toLowerCase() !== snapshot.head) {
    errors.push("head OID");
  }
  if (currentRepository !== snapshot.repository) {
    errors.push("head repository");
  }
  if (current?.isCrossRepository !== false) {
    errors.push("same-repository 상태");
  }
  if (current?.title !== snapshot.title) errors.push("제목");
  if (current?.updatedAt !== snapshot.updatedAt) errors.push("updatedAt");
  if (errors.length > 0) {
    fail(
      `validator 이후 PR snapshot이 변경되었거나 불완전합니다: ${errors.join(", ")}`,
    );
  }
}

export function createFinalizeMergePlanToken(snapshot) {
  const normalized = normalizeFinalizeMergeSnapshot(snapshot);
  const payload = {
    version: PLAN_VERSION,
    repository: normalized.repository,
    issue: normalized.issue,
    pr: normalized.pr,
    base: normalized.base,
    head: normalized.head,
    headTree: normalized.headTree,
    branch: normalized.branch,
    updatedAt: normalized.updatedAt,
    titleDigest: titleDigest(normalized.title),
  };
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
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

export function executeFinalizeMerge(
  rawSnapshot,
  request,
  { gh = defaultGhRunner } = {},
) {
  const snapshot = normalizeFinalizeMergeSnapshot(rawSnapshot);
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

  const current = readCurrentPullRequest(gh, snapshot);
  assertCurrentPullRequest(snapshot, current);
  const planToken = createFinalizeMergePlanToken(snapshot);
  const publicResult = {
    repository: snapshot.repository,
    pr: snapshot.pr,
    head: snapshot.head,
    branch: snapshot.branch,
    updatedAt: snapshot.updatedAt,
    titleFingerprint: titleDigest(snapshot.title),
    planToken,
  };
  if (dryRun) {
    return { status: "planned", ...publicResult };
  }
  if (!planTokensEqual(confirmPlan, planToken)) {
    fail(
      "병합 계획 token이 현재 repository·PR·head·제목·updatedAt snapshot과 일치하지 않습니다.",
    );
  }

  runGh(
    gh,
    [
      "pr",
      "merge",
      String(snapshot.pr),
      "-R",
      snapshot.repository,
      "--squash",
      "--match-head-commit",
      snapshot.head,
      "--subject",
      snapshot.title,
    ],
    "병합 명령의 성공 여부가 확정되지 않았습니다. 같은 mutation을 반복하지 말고 PR을 재조회하세요.",
    { uncertainMutation: true },
  );
  return {
    status: "merge-command-finished",
    requiresMergedRecovery: true,
    ...publicResult,
  };
}

function usage() {
  return [
    "사용법:",
    "  finalize-merge.mjs --snapshot <validated-snapshot.json> --dry-run",
    "  finalize-merge.mjs --snapshot <validated-snapshot.json> --confirm-plan <64-sha>",
  ].join("\n");
}

export function parseArguments(argv) {
  const values = new Map();
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      if (dryRun) fail("`--dry-run`을 중복 지정할 수 없습니다.", { usage: true });
      dryRun = true;
      continue;
    }
    if (!["--snapshot", "--confirm-plan"].includes(argument)) {
      fail(`알 수 없는 인자입니다: ${argument}`, { usage: true });
    }
    if (values.has(argument) || index + 1 >= argv.length) {
      fail(`${argument} 값이 없거나 중복됐습니다.`, { usage: true });
    }
    values.set(argument, argv[index + 1]);
    index += 1;
  }
  const snapshot = values.get("--snapshot");
  const confirmPlan = values.get("--confirm-plan");
  if (!snapshot || dryRun === Boolean(confirmPlan)) {
    fail(usage(), { usage: true });
  }
  return {
    snapshot,
    ...(dryRun ? { dryRun: true } : { confirmPlan }),
  };
}

function main() {
  try {
    const parsed = parseArguments(process.argv.slice(2));
    let snapshot;
    try {
      snapshot = JSON.parse(readFileSync(parsed.snapshot, "utf8"));
    } catch {
      fail("validated finalize snapshot 파일을 JSON으로 읽지 못했습니다.", {
        usage: true,
      });
    }
    const result = executeFinalizeMerge(snapshot, parsed);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode =
      error instanceof FinalizeMergeError ? error.exitCode : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
