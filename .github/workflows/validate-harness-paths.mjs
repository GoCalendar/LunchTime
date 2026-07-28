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

export const REGRESSION_GROUPS = Object.freeze([
  "productDocsRegression",
  "workItemRegression",
  "commitPrRegression",
  "finalizeRegression",
]);

const FULL_PATHS = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "docs/development/01_harness_guide.md",
]);

const PRODUCT_DOCS_SCRIPTS =
  ".agents/skills/update-product-docs/scripts/";
const WORK_ITEM_SCRIPTS = ".agents/skills/run-github-work-item/scripts/";
const COMMIT_SCRIPTS = ".agents/skills/commit-work-item/scripts/";
const PULL_REQUEST_SCRIPTS =
  ".agents/skills/open-pull-request/scripts/";

const WORK_ITEM_INPUTS = new Set([
  ".github/ISSUE_TEMPLATE/work-item.yml",
  ".github/mvp-work-items.json",
  ".github/work-management.json",
]);

const COMMIT_INPUTS = new Set([
  ".gitignore",
]);

const COMMIT_PR_INPUTS = new Set([
  ".github/PULL_REQUEST_TEMPLATE.md",
]);

export class HarnessPathError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessPathError";
  }
}

function emptyGroups() {
  return {
    productDocsRegression: false,
    workItemRegression: false,
    commitPrRegression: false,
    finalizeRegression: false,
  };
}

function allGroups() {
  return {
    productDocsRegression: true,
    workItemRegression: true,
    commitPrRegression: true,
    finalizeRegression: true,
  };
}

function selectedGroups(classification) {
  return REGRESSION_GROUPS.filter((group) => classification[group]);
}

export function fullClassification(reason, changedPaths = []) {
  const classification = {
    full: true,
    ...allGroups(),
    reason: String(reason || "full"),
    changedPaths: [...changedPaths],
  };
  return {
    ...classification,
    groups: selectedGroups(classification),
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

  const segments = path.split("/");
  return !segments.some((segment) => segment === "." || segment === "..");
}

function isFullPath(path) {
  return (
    FULL_PATHS.has(path) ||
    path.startsWith(".github/workflows/")
  );
}

function selectProductDocsPath(path, groups) {
  if (!path.startsWith(PRODUCT_DOCS_SCRIPTS)) return false;

  groups.productDocsRegression = true;
  const script = path.slice(PRODUCT_DOCS_SCRIPTS.length);
  if (
    script === "product-contract-ids.mjs" ||
    script === "product-contract-ids.test.mjs"
  ) {
    groups.workItemRegression = true;
    groups.commitPrRegression = true;
    groups.finalizeRegression = true;
  }
  return true;
}

function selectPullRequestPath(path, groups) {
  if (!path.startsWith(PULL_REQUEST_SCRIPTS)) return false;

  const script = path.slice(PULL_REQUEST_SCRIPTS.length);
  if (
    script === "validate-finalize.mjs" ||
    script === "validate-finalize.test.mjs" ||
    script.startsWith("finalize-")
  ) {
    groups.finalizeRegression = true;
    return true;
  }

  if (
    script === "validate-pr-body.mjs" ||
    script === "validate-pr-body.test.mjs"
  ) {
    groups.commitPrRegression = true;
    groups.finalizeRegression = true;
    return true;
  }

  // A new or renamed script under this owner has no proven narrower boundary.
  groups.commitPrRegression = true;
  groups.finalizeRegression = true;
  return true;
}

export function classifyChangedPaths(changedPaths, options = {}) {
  if (!Array.isArray(changedPaths)) {
    return fullClassification("invalid-path-list");
  }

  const paths = [...changedPaths];
  if (!paths.every(isCanonicalRepositoryPath)) {
    return fullClassification("invalid-repository-path", paths);
  }

  if (options.full) {
    return fullClassification(options.reason || "explicit-full", paths);
  }

  if (paths.some(isFullPath)) {
    return fullClassification("shared-harness-contract", paths);
  }

  const groups = emptyGroups();
  for (const path of paths) {
    if (selectProductDocsPath(path, groups)) continue;

    if (
      path.startsWith(WORK_ITEM_SCRIPTS) ||
      WORK_ITEM_INPUTS.has(path)
    ) {
      groups.workItemRegression = true;
      continue;
    }

    if (
      path.startsWith(COMMIT_SCRIPTS) ||
      COMMIT_INPUTS.has(path)
    ) {
      groups.commitPrRegression = true;
      continue;
    }

    if (selectPullRequestPath(path, groups)) continue;

    if (COMMIT_PR_INPUTS.has(path)) {
      groups.commitPrRegression = true;
      groups.finalizeRegression = true;
    }
  }

  const classification = {
    full: false,
    ...groups,
    reason: "path-scoped",
    changedPaths: paths,
  };
  return {
    ...classification,
    groups: selectedGroups(classification),
  };
}

function canonicalOid(value, kind) {
  const oid = String(value ?? "");
  if (
    oid !== oid.trim() ||
    !OID_PATTERN.test(oid) ||
    ZERO_OID_PATTERN.test(oid)
  ) {
    throw new HarnessPathError(
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
    throw new HarnessPathError(
      "Git 변경 경로 출력이 NUL로 끝나지 않습니다.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index === start) {
      throw new HarnessPathError("Git 변경 경로 출력에 빈 경로가 있습니다.");
    }
    try {
      paths.push(decoder.decode(buffer.subarray(start, index)));
    } catch {
      throw new HarnessPathError(
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
    throw new HarnessPathError("Git diff operator는 `..` 또는 `...`여야 합니다.");
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
    throw new HarnessPathError("Git 변경 경로 명령을 실행하지 못했습니다.");
  }
  if (
    !result ||
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stdout === undefined
  ) {
    throw new HarnessPathError("base/head 변경 경로를 확정하지 못했습니다.");
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

const ALWAYS_ON_RESULTS = Object.freeze([
  ["classifyResult", "classify"],
  ["harnessResult", "harness"],
  ["productDocsResult", "product-docs"],
  ["patchWhitespaceResult", "patch-whitespace"],
]);

const REGRESSION_RESULTS = Object.freeze([
  [
    "productDocs",
    "productDocsRegressionResult",
    "product-docs-regression",
  ],
  ["workItem", "workItemRegressionResult", "work-item-regression"],
  ["commitPr", "commitPrRegressionResult", "commit-pr-regression"],
  ["finalize", "finalizeRegressionResult", "finalize-regression"],
]);

export function validateAggregateResults(input = {}) {
  const errors = [];
  const selectionNames = [
    ["full", "full"],
    ["productDocs", "product_docs"],
    ["workItem", "work_item"],
    ["commitPr", "commit_pr"],
    ["finalize", "finalize"],
  ];
  const selections = {};

  for (const [key, label] of selectionNames) {
    const value = input[key];
    if (value !== "true" && value !== "false") {
      errors.push(`${label} 선택값은 정확히 true 또는 false여야 합니다.`);
      continue;
    }
    selections[key] = value === "true";
  }

  for (const [key, label] of ALWAYS_ON_RESULTS) {
    if (input[key] !== "success") {
      errors.push(`${label} job 결과는 정확히 success여야 합니다.`);
    }
  }

  for (const [selectionKey, resultKey, label] of REGRESSION_RESULTS) {
    const result = input[resultKey];
    if (result !== "success" && result !== "skipped") {
      errors.push(
        `${label} job 결과는 정확히 success 또는 skipped여야 합니다.`,
      );
      continue;
    }
    if (selections[selectionKey] === true && result !== "success") {
      errors.push(
        `${label}은 선택됐으므로 job 결과가 success여야 합니다.`,
      );
    }
    if (selections[selectionKey] === false && result !== "skipped") {
      errors.push(
        `${label}은 선택되지 않았으므로 job 결과가 skipped여야 합니다.`,
      );
    }
  }

  if (selections.full === true) {
    for (const [selectionKey, , label] of REGRESSION_RESULTS) {
      if (selections[selectionKey] !== true) {
        errors.push(
          `full=true이면 ${label} 선택값도 true여야 합니다.`,
        );
      }
    }
  }

  return errors;
}

export function aggregateInputFromEnvironment(environment) {
  return {
    full: environment.FULL_SELECTED,
    productDocs: environment.PRODUCT_DOCS_SELECTED,
    workItem: environment.WORK_ITEM_SELECTED,
    commitPr: environment.COMMIT_PR_SELECTED,
    finalize: environment.FINALIZE_SELECTED,
    classifyResult: environment.CLASSIFY_RESULT,
    harnessResult: environment.HARNESS_RESULT,
    productDocsResult: environment.PRODUCT_DOCS_RESULT,
    patchWhitespaceResult: environment.PATCH_WHITESPACE_RESULT,
    productDocsRegressionResult:
      environment.PRODUCT_DOCS_REGRESSION_RESULT,
    workItemRegressionResult: environment.WORK_ITEM_REGRESSION_RESULT,
    commitPrRegressionResult: environment.COMMIT_PR_REGRESSION_RESULT,
    finalizeRegressionResult: environment.FINALIZE_REGRESSION_RESULT,
  };
}

function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function renderGitHubOutputs(classification) {
  return [
    `full=${classification.full}`,
    `product_docs=${classification.productDocsRegression}`,
    `work_item=${classification.workItemRegression}`,
    `commit_pr=${classification.commitPrRegression}`,
    `finalize=${classification.finalizeRegression}`,
    `reason=${classification.reason}`,
    `changed_paths_json=${safeJson(classification.changedPaths)}`,
    "",
  ].join("\n");
}

function usage() {
  return [
    "사용법:",
    "  validate-harness-paths.mjs --event <name> [--base <40-sha>] [--head <40-sha>] [--output <GITHUB_OUTPUT>] [--full]",
    "  validate-harness-paths.mjs --verify-results",
    "",
    "`schedule`, `workflow_dispatch`, `--full`은 base/head 없이 전체 회귀를 선택합니다.",
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
        throw new HarnessPathError(
          "`--verify-results`를 중복 지정할 수 없습니다.",
        );
      }
      parsed.verifyResults = true;
      continue;
    }
    if (argument === "--full") {
      if (parsed.full) {
        throw new HarnessPathError("`--full`을 중복 지정할 수 없습니다.");
      }
      parsed.full = true;
      continue;
    }

    const key = valueOptions.get(argument);
    if (!key) {
      throw new HarnessPathError(`알 수 없는 인자입니다: ${argument}`);
    }
    if (parsed[key] !== undefined) {
      throw new HarnessPathError(`${argument}을 중복 지정할 수 없습니다.`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new HarnessPathError(`${argument} 값이 필요합니다.`);
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
    throw new HarnessPathError(
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
    console.log("선택된 하네스 회귀군과 job 결과가 일치합니다.");
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
      full: classification.full,
      groups: classification.groups,
      reason: classification.reason,
      changedPaths: classification.changedPaths,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
