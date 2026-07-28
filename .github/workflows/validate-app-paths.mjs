#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const OID_PATTERN = /^[0-9a-f]{40}$/i;
const ZERO_OID_PATTERN = /^0{40}$/;
const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const FULL_EVENTS = new Set(["schedule", "workflow_dispatch"]);
const DIFF_EVENTS = new Set(["pull_request", "push"]);
const DIFF_OPERATORS = new Set(["..", "..."]);

const FULL_PATHS = new Set([
  ".github/workflows/app-ci.yml",
  ".github/workflows/validate-app-paths.mjs",
  ".github/workflows/validate-app-paths.test.mjs",
]);

const APP_PREFIXES = Object.freeze([
  "LunchTime/",
  "LunchTimeTests/",
  "LunchTimeUITests/",
  "LunchTime.xcodeproj/",
]);

const NON_APP_PATHS = new Set([
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "README.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/mvp-work-items.json",
  ".github/work-management.json",
  ".github/workflows/validate-harness-paths.mjs",
  ".github/workflows/validate-harness-paths.test.mjs",
  ".github/workflows/validate-harness.yml",
  ".github/workflows/validate-pr-metadata.yml",
]);

const NON_APP_PREFIXES = Object.freeze([
  ".agents/",
  ".claude/",
  ".github/ISSUE_TEMPLATE/",
  "docs/",
  "Experiments/",
]);

export class AppPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppPathError";
  }
}

export function fullClassification(reason, changedPaths = []) {
  return {
    app: true,
    full: true,
    reason: String(reason || "full"),
    changedPaths: [...changedPaths],
  };
}

function isCanonicalRepositoryPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("//")
  ) {
    return false;
  }

  return !path
    .split("/")
    .some((segment) => segment === "." || segment === "..");
}

function isAppPath(path) {
  return APP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isKnownNonAppPath(path) {
  return (
    NON_APP_PATHS.has(path) ||
    NON_APP_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function classifyChangedPaths(changedPaths, options = {}) {
  if (!Array.isArray(changedPaths)) {
    return fullClassification("invalid-path-list");
  }

  const paths = [...changedPaths];
  if (!paths.every(isCanonicalRepositoryPath)) {
    return fullClassification("invalid-repository-path", paths);
  }
  if (paths.length === 0) {
    return fullClassification("empty-diff");
  }
  if (options.full) {
    return fullClassification(options.reason || "explicit-full", paths);
  }
  if (paths.some((path) => FULL_PATHS.has(path))) {
    return fullClassification("app-ci-contract", paths);
  }

  let app = false;
  for (const path of paths) {
    if (isAppPath(path)) {
      app = true;
      continue;
    }
    if (!isKnownNonAppPath(path)) {
      return fullClassification("unclassified-path", paths);
    }
  }

  return {
    app,
    full: false,
    reason: app ? "app-path" : "known-non-app-path",
    changedPaths: paths,
  };
}

function canonicalOid(value, kind) {
  const oid = String(value ?? "");
  if (
    oid !== oid.trim() ||
    !OID_PATTERN.test(oid) ||
    ZERO_OID_PATTERN.test(oid)
  ) {
    throw new AppPathError(
      `${kind}는 0이 아닌 정확한 40자리 Git commit OID여야 합니다.`,
    );
  }
  return oid.toLowerCase();
}

export function parseNulDelimitedPaths(output) {
  const buffer = Buffer.isBuffer(output)
    ? output
    : Buffer.from(output ?? "");
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) {
    throw new AppPathError(
      "Git 변경 경로 출력이 NUL로 끝나지 않습니다.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index === start) {
      throw new AppPathError("Git 변경 경로 출력에 빈 경로가 있습니다.");
    }
    try {
      paths.push(decoder.decode(buffer.subarray(start, index)));
    } catch {
      throw new AppPathError(
        "Git 변경 경로를 UTF-8 저장소 상대 경로로 해석할 수 없습니다.",
      );
    }
    start = index + 1;
  }
  return paths;
}

function defaultGitRunner(arguments_, options = {}) {
  return spawnSync("git", arguments_, {
    cwd: resolve(options.cwd ?? process.cwd()),
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function readChangedPaths({
  base,
  head,
  operator = "...",
  cwd,
  gitRunner = defaultGitRunner,
}) {
  const baseOid = canonicalOid(base, "base");
  const headOid = canonicalOid(head, "head");
  if (!DIFF_OPERATORS.has(operator)) {
    throw new AppPathError(
      "Git diff operator는 `..` 또는 `...`여야 합니다.",
    );
  }

  const arguments_ = [
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-renames",
    `${baseOid}${operator}${headOid}`,
    "--",
  ];

  let result;
  try {
    result = gitRunner(arguments_, { cwd });
  } catch {
    throw new AppPathError("Git 변경 경로 명령을 실행하지 못했습니다.");
  }
  if (
    !result ||
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout === undefined
  ) {
    throw new AppPathError("base/head 변경 경로를 확정하지 못했습니다.");
  }

  return parseNulDelimitedPaths(result.stdout);
}

export function classifyEvent({
  eventName,
  base,
  head,
  cwd,
  forceFull = false,
  gitRunner,
}) {
  const event = String(eventName ?? "");
  if (forceFull) {
    return fullClassification("explicit-full");
  }
  if (FULL_EVENTS.has(event)) {
    return fullClassification(`${event}-full`);
  }
  if (!DIFF_EVENTS.has(event)) {
    return fullClassification("unsupported-or-missing-event");
  }

  try {
    const changedPaths = readChangedPaths({
      base,
      head,
      operator: event === "push" ? ".." : "...",
      cwd,
      gitRunner,
    });
    return classifyChangedPaths(changedPaths);
  } catch {
    return fullClassification("ambiguous-or-unavailable-diff");
  }
}

export function validateAggregateResults(input = {}) {
  const errors = [];
  const selected = {};

  for (const [key, label] of [
    ["app", "app"],
    ["full", "full"],
  ]) {
    const value = input[key];
    if (value !== "true" && value !== "false") {
      errors.push(`${label} 선택값은 정확히 true 또는 false여야 합니다.`);
      continue;
    }
    selected[key] = value === "true";
  }

  if (input.classifyResult !== "success") {
    errors.push("classify job 결과는 정확히 success여야 합니다.");
  }

  const buildResult = input.appBuildResult;
  if (buildResult !== "success" && buildResult !== "skipped") {
    errors.push(
      "app-build job 결과는 정확히 success 또는 skipped여야 합니다.",
    );
  } else {
    if (selected.app === true && buildResult !== "success") {
      errors.push(
        "앱 검증이 선택됐으므로 app-build job 결과가 success여야 합니다.",
      );
    }
    if (selected.app === false && buildResult !== "skipped") {
      errors.push(
        "앱 검증이 선택되지 않았으므로 app-build job 결과가 skipped여야 합니다.",
      );
    }
  }

  if (selected.full === true && selected.app !== true) {
    errors.push("full=true이면 app 선택값도 true여야 합니다.");
  }

  return errors;
}

export function aggregateInputFromEnvironment(environment) {
  return {
    app: environment.APP_SELECTED,
    full: environment.FULL_SELECTED,
    classifyResult: environment.CLASSIFY_RESULT,
    appBuildResult: environment.APP_BUILD_RESULT,
  };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function renderGitHubOutputs(classification) {
  return [
    `app=${classification.app}`,
    `full=${classification.full}`,
    `reason=${classification.reason}`,
    `changed_paths_json=${safeJson(classification.changedPaths)}`,
    "",
  ].join("\n");
}

function usage() {
  return [
    "사용법:",
    "  validate-app-paths.mjs --event <name> [--base <40-sha>] [--head <40-sha>] [--output <GITHUB_OUTPUT>] [--full]",
    "  validate-app-paths.mjs --verify-results",
    "",
    "`schedule`, `workflow_dispatch`, `--full`은 base/head 없이 앱 검증을 선택합니다.",
  ].join("\n");
}

export function parseArguments(argv) {
  const parsed = { full: false };
  const valueOptions = new Map([
    ["--event", "eventName"],
    ["--base", "base"],
    ["--head", "head"],
    ["--output", "output"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--verify-results") {
      if (parsed.verifyResults) {
        throw new AppPathError(
          "`--verify-results`를 중복 지정할 수 없습니다.",
        );
      }
      parsed.verifyResults = true;
      continue;
    }
    if (argument === "--full") {
      if (parsed.full) {
        throw new AppPathError("`--full`을 중복 지정할 수 없습니다.");
      }
      parsed.full = true;
      continue;
    }

    const key = valueOptions.get(argument);
    if (!key) {
      throw new AppPathError(`알 수 없는 인자입니다: ${argument}`);
    }
    if (parsed[key] !== undefined) {
      throw new AppPathError(`${argument}을 중복 지정할 수 없습니다.`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new AppPathError(`${argument} 값이 필요합니다.`);
    }
    parsed[key] = value;
    index += 1;
  }

  if (
    parsed.verifyResults &&
    (parsed.full ||
      parsed.eventName !== undefined ||
      parsed.base !== undefined ||
      parsed.head !== undefined ||
      parsed.output !== undefined)
  ) {
    throw new AppPathError(
      "`--verify-results`는 경로 분류 인자와 함께 사용할 수 없습니다.",
    );
  }
  return parsed;
}

async function main() {
  let arguments_;
  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (arguments_.verifyResults) {
    const errors = validateAggregateResults(
      aggregateInputFromEnvironment(process.env),
    );
    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("앱 경로 선택값과 app-build job 결과가 일치합니다.");
    return;
  }

  const classification = classifyEvent({
    eventName: arguments_.eventName || process.env.GITHUB_EVENT_NAME,
    base: arguments_.base || process.env.BASE_SHA,
    head: arguments_.head || process.env.HEAD_SHA || process.env.GITHUB_SHA,
    cwd: process.cwd(),
    forceFull: arguments_.full,
  });
  const outputPath = arguments_.output || process.env.GITHUB_OUTPUT;
  if (outputPath) {
    await appendFile(outputPath, renderGitHubOutputs(classification), "utf8");
  }

  console.log(
    safeJson({
      app: classification.app,
      full: classification.full,
      reason: classification.reason,
      changedPaths: classification.changedPaths,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
