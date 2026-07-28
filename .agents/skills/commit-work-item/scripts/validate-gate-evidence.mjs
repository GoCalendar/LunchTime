#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import {
  LOCAL_EVIDENCE_CONTROL_PATHS,
  REGRESSION_GROUPS,
  classifyChangedPaths,
  parseNulDelimitedPaths,
  regressionGroupsForPath,
} from "../../../../.github/workflows/validate-harness-paths.mjs";

export const EVIDENCE_SCHEMA = "lunchtime-gate-evidence";
export const EVIDENCE_VERSION = 2;
export const GROUP_COMMAND_MANIFESTS = Object.freeze({
  productDocsRegression: Object.freeze([
    "node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
    "node --test .agents/skills/update-product-docs/scripts/validate-product-docs.test.mjs",
  ]),
  workItemRegression: Object.freeze([
    "node --test .agents/skills/run-github-work-item/scripts/work-item.test.mjs",
    "node --test .agents/skills/run-github-work-item/scripts/bootstrap-mvp.test.mjs",
  ]),
  commitPrRegression: Object.freeze([
    "node --test .agents/skills/commit-work-item/scripts/validate-commit-message.test.mjs",
    "node --test .agents/skills/commit-work-item/scripts/validate-commit-paths.test.mjs",
    "node --test .agents/skills/commit-work-item/scripts/validate-gate-evidence.test.mjs",
    "node --test .agents/skills/open-pull-request/scripts/validate-pr-body.test.mjs",
  ]),
  finalizeRegression: Object.freeze([
    "node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
    "node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
    "node --test .agents/skills/open-pull-request/scripts/finalize-remote-branch.test.mjs",
    "node --test .agents/skills/open-pull-request/scripts/finalize-local-cleanup.test.mjs",
  ]),
});

const OID = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO_OID = /^0{40}$/;
const TREE_MODE = /^[0-7]{6}$/;
const MODES = new Set(["initial", "delta"]);
const DECISIONS = new Set(["rerun", "retain", "not-required"]);
const LOCAL_CONTROL = new Set(LOCAL_EVIDENCE_CONTROL_PATHS);
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;
const MAX_EVIDENCE = 1024 * 1024;
const DIGEST_NAMESPACE = "lunchtime-gate-input-v2";
const INITIAL_RE_ROOT_RECOVERY = [
  "복구: 같은 delta를 반복하지 말고 initial re-root를 수행하세요.",
  "replace-disabled current HEAD commit을 --candidate-base로 확인한 뒤",
  "--mode initial evidence를 새로 만들고 이전 heavy PASS는 모두 폐기하세요.",
  "새 evidence에는 current base→candidate deterministic selection만 사용합니다.",
].join(" ");
const INITIAL_RE_ROOT_ERROR_CODES = new Set([
  "invalid-evidence-schema",
  "invalid-evidence-version",
  "invalid-evidence-partition",
  "stale-previous-evidence",
]);
const TOP_LEVEL_KEYS = [
  "schema", "version", "mode", "base", "previous", "candidate",
  "full", "failClosed", "reason", "diagnostic", "selectionPaths",
  "invalidationPaths", "selectedGroups", "invalidatedGroups",
  "rerunGroups", "retainGroups", "dropGroups", "groups",
];
const GROUP_KEYS = [
  "decision", "required", "invalidated", "commandManifestDigest",
  "baseInputDigest", "previousInputDigest", "candidateInputDigest",
  "baseEntryCount", "previousEntryCount", "candidateEntryCount",
];

export class GateEvidenceError extends Error {
  constructor(code, message, { usage = false } = {}) {
    super(
      INITIAL_RE_ROOT_ERROR_CODES.has(code)
        ? `${message}\n${INITIAL_RE_ROOT_RECOVERY}`
        : message,
    );
    this.name = "GateEvidenceError";
    this.code = code;
    this.exitCode = usage ? 2 : 1;
  }
}

export function canonicalOid(value, label) {
  const oid = String(value ?? "");
  if (oid !== oid.trim() || !OID.test(oid) || ZERO_OID.test(oid)) {
    throw new GateEvidenceError(
      "invalid-oid",
      `${label}는 0이 아닌 정확한 40자리 Git OID여야 합니다.`,
      { usage: true },
    );
  }
  return oid.toLowerCase();
}

function isObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function isRepositoryPath(path) {
  return typeof path === "string" && path.length > 0 &&
    !path.includes("\0") && !path.includes("\\") &&
    !path.startsWith("/") && !path.endsWith("/") &&
    !path.includes("//") &&
    !path.split("/").some((part) => part === "." || part === "..");
}

function hashParts(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.from(String(part), "utf8");
    const size = Buffer.allocUnsafe(8);
    size.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(size);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export function commandManifestDigest(group) {
  const commands = GROUP_COMMAND_MANIFESTS[group];
  if (!commands) {
    throw new GateEvidenceError(
      "unknown-regression-group",
      `알 수 없는 회귀군입니다: ${group}`,
    );
  }
  return hashParts([
    `${DIGEST_NAMESPACE}:command-manifest`,
    group,
    ...commands,
  ]);
}

function defaultGitRunner(arguments_, options = {}) {
  return spawnSync("git", arguments_, {
    cwd: resolve(options.cwd ?? process.cwd()),
    encoding: "buffer",
    maxBuffer: MAX_GIT_OUTPUT,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(
  arguments_,
  { cwd, gitRunner = defaultGitRunner, operation, statuses = [0] },
) {
  let result;
  try {
    result = gitRunner(["--no-replace-objects", ...arguments_], { cwd });
  } catch {
    throw new GateEvidenceError(
      "git-execution-failed",
      `${operation} Git 명령을 실행하지 못했습니다.`,
    );
  }
  if (
    !result || result.error || result.signal ||
    !statuses.includes(result.status) || result.stdout === undefined
  ) {
    throw new GateEvidenceError(
      "git-inspection-failed",
      `${operation} Git 결과를 확정하지 못했습니다.`,
    );
  }
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.from(result.stdout),
  };
}

function requireObjectType(oid, type, label, cwd, gitRunner) {
  const actual = git(["cat-file", "-t", oid], {
    cwd,
    gitRunner,
    operation: `${label} object type`,
  }).stdout.toString("utf8").trim();
  if (actual !== type) {
    throw new GateEvidenceError(
      "invalid-object-type",
      `${label}는 Git ${type} object여야 합니다.`,
    );
  }
}

function readCommitTree(commit, cwd, gitRunner) {
  const oid = canonicalOid(commit, "candidate base");
  requireObjectType(oid, "commit", "candidate base", cwd, gitRunner);
  const tree = canonicalOid(
    git(["rev-parse", "--verify", `${oid}^{tree}`], {
      cwd,
      gitRunner,
      operation: "candidate base tree",
    }).stdout.toString("utf8").trim(),
    "candidate base tree",
  );
  requireObjectType(tree, "tree", "candidate base tree", cwd, gitRunner);
  return tree;
}

export function parseLsTreeOutput(output) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output ?? "");
  if (bytes.length === 0) return [];
  if (bytes.at(-1) !== 0) {
    throw new GateEvidenceError(
      "malformed-ls-tree",
      "git ls-tree 출력이 NUL로 끝나지 않습니다.",
    );
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = [];
  const paths = new Set();
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    const record = bytes.subarray(start, index);
    const tab = record.indexOf(9);
    let metadata;
    let path;
    try {
      metadata = decoder.decode(record.subarray(0, tab));
      path = decoder.decode(record.subarray(tab + 1));
    } catch {
      throw new GateEvidenceError(
        "invalid-tree-path-encoding",
        "Git tree 경로를 UTF-8로 해석할 수 없습니다.",
      );
    }
    const [mode, type, oid, ...extra] = metadata.split(" ");
    if (
      tab <= 0 || tab === record.length - 1 || extra.length > 0 ||
      !TREE_MODE.test(mode ?? "") || type !== "blob" ||
      !OID.test(oid ?? "") || ZERO_OID.test(oid) ||
      !isRepositoryPath(path) || paths.has(path)
    ) {
      throw new GateEvidenceError(
        "malformed-ls-tree",
        "Git tree의 mode·path·blob OID를 해석할 수 없습니다.",
      );
    }
    paths.add(path);
    entries.push({ mode, path, oid: oid.toLowerCase() });
    start = index + 1;
  }
  return entries;
}

function readTreeEntries(tree, cwd, gitRunner) {
  const oid = canonicalOid(tree, "candidate tree");
  requireObjectType(oid, "tree", "candidate tree", cwd, gitRunner);
  return parseLsTreeOutput(
    git(["ls-tree", "-r", "-z", "--full-tree", oid, "--"], {
      cwd,
      gitRunner,
      operation: "candidate tree",
    }).stdout,
  );
}

export function readChangedTreePaths({
  previousTree,
  candidateTree,
  cwd,
  gitRunner = defaultGitRunner,
}) {
  const previous = canonicalOid(previousTree, "previous candidate tree");
  const candidate = canonicalOid(candidateTree, "candidate tree");
  const output = git([
    "diff-tree", "--no-commit-id", "--name-only", "-r", "-z",
    "--no-renames", "--no-ext-diff", previous, candidate, "--",
  ], {
    cwd,
    gitRunner,
    operation: "candidate tree diff",
  }).stdout;
  try {
    return parseNulDelimitedPaths(output);
  } catch {
    throw new GateEvidenceError(
      "malformed-tree-diff",
      "candidate tree 변경 경로를 해석할 수 없습니다.",
    );
  }
}

export function projectGroupInput(entries, group) {
  if (!REGRESSION_GROUPS.includes(group) || !Array.isArray(entries)) {
    throw new GateEvidenceError(
      "invalid-projection-input",
      "회귀군 input projection을 만들 수 없습니다.",
    );
  }
  const selected = entries
    .filter((entry) => regressionGroupsForPath(entry.path).includes(group))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.path, "utf8"),
        Buffer.from(right.path, "utf8"),
      ));
  const manifest = commandManifestDigest(group);
  return {
    commandManifestDigest: manifest,
    inputDigest: hashParts([
      `${DIGEST_NAMESPACE}:group-input`,
      group,
      manifest,
      ...selected.flatMap((entry) => [
        entry.mode,
        entry.path,
        entry.oid,
      ]),
    ]),
    entryCount: selected.length,
  };
}

function projectGroups(entries) {
  return Object.fromEntries(
    REGRESSION_GROUPS.map((group) => [
      group,
      projectGroupInput(entries, group),
    ]),
  );
}

function ordered(groups) {
  const set = new Set(groups);
  return REGRESSION_GROUPS.filter((group) => set.has(group));
}

function sameGroups(left, right) {
  return left.length === right.length &&
    left.every((group, index) => group === right[index]);
}

function classifiedGroups(result) {
  return result.full ? [...REGRESSION_GROUPS] : ordered(result.groups);
}

function changedProjectionGroups(left, right) {
  return REGRESSION_GROUPS.filter(
    (group) => left[group].inputDigest !== right[group].inputDigest,
  );
}

function buildEvidence({
  mode,
  candidateBase,
  baseTree,
  previousTree,
  candidateTree,
  selectionPaths = [],
  invalidationPaths = [],
  selectedGroups,
  invalidatedGroups,
  projections,
  full,
  failClosed,
  reason,
  diagnostic = null,
}) {
  const selected = new Set(selectedGroups);
  const invalidated = new Set(invalidatedGroups);
  const rerunGroups = REGRESSION_GROUPS.filter(
    (group) => selected.has(group) && invalidated.has(group),
  );
  const retainGroups = REGRESSION_GROUPS.filter(
    (group) => selected.has(group) && !invalidated.has(group),
  );
  const dropGroups = REGRESSION_GROUPS.filter(
    (group) => !selected.has(group),
  );
  const groups = Object.fromEntries(REGRESSION_GROUPS.map((group) => {
    const decision = !selected.has(group)
      ? "not-required"
      : invalidated.has(group) ? "rerun" : "retain";
    return [group, {
      decision,
      required: selected.has(group),
      invalidated: invalidated.has(group),
      commandManifestDigest: commandManifestDigest(group),
      baseInputDigest: projections?.base[group].inputDigest ?? null,
      previousInputDigest: projections?.previous[group].inputDigest ?? null,
      candidateInputDigest: projections?.candidate[group].inputDigest ?? null,
      baseEntryCount: projections?.base[group].entryCount ?? null,
      previousEntryCount: projections?.previous[group].entryCount ?? null,
      candidateEntryCount: projections?.candidate[group].entryCount ?? null,
    }];
  }));
  return {
    schema: EVIDENCE_SCHEMA,
    version: EVIDENCE_VERSION,
    mode,
    base: { commit: candidateBase, tree: baseTree },
    previous: { base: candidateBase, tree: previousTree },
    candidate: { base: candidateBase, tree: candidateTree },
    full,
    failClosed,
    reason,
    diagnostic,
    selectionPaths,
    invalidationPaths,
    selectedGroups: ordered(selectedGroups),
    invalidatedGroups: ordered(invalidatedGroups),
    rerunGroups,
    retainGroups,
    dropGroups,
    groups,
  };
}

function failClosedEvidence(identity, reason, diagnostic, baseTree = null) {
  return buildEvidence({
    ...identity,
    baseTree,
    selectedGroups: REGRESSION_GROUPS,
    invalidatedGroups: REGRESSION_GROUPS,
    full: true,
    failClosed: true,
    reason,
    diagnostic,
  });
}

export function evaluateGateEvidence({
  mode,
  previousBase,
  previousTree,
  candidateBase,
  candidateTree,
  cwd,
  gitRunner = defaultGitRunner,
}) {
  if (!MODES.has(mode)) {
    throw new GateEvidenceError(
      "invalid-mode",
      "mode는 initial 또는 delta여야 합니다.",
      { usage: true },
    );
  }
  const identity = {
    mode,
    previousTree: canonicalOid(previousTree, "previous candidate tree"),
    candidateBase: canonicalOid(candidateBase, "candidate base"),
    candidateTree: canonicalOid(candidateTree, "candidate tree"),
  };
  const previousBaseOid = canonicalOid(previousBase, "previous base");
  if (previousBaseOid !== identity.candidateBase) {
    throw new GateEvidenceError(
      "stale-previous-evidence",
      "previous base와 candidate base identity가 다릅니다.",
    );
  }

  try {
    const baseTree = readCommitTree(
      identity.candidateBase,
      cwd,
      gitRunner,
    );
    if (mode === "initial" && identity.previousTree !== baseTree) {
      return failClosedEvidence(
        identity,
        "initial-previous-tree-mismatch",
        "initial-must-start-at-base-tree",
        baseTree,
      );
    }
    const cache = new Map();
    const entries = (tree) => {
      if (!cache.has(tree)) {
        cache.set(tree, readTreeEntries(tree, cwd, gitRunner));
      }
      return cache.get(tree);
    };
    const projections = {
      base: projectGroups(entries(baseTree)),
      previous: projectGroups(entries(identity.previousTree)),
      candidate: projectGroups(entries(identity.candidateTree)),
    };
    const selectionPaths = readChangedTreePaths({
      previousTree: baseTree,
      candidateTree: identity.candidateTree,
      cwd,
      gitRunner,
    });
    const invalidationPaths = readChangedTreePaths({
      previousTree: identity.previousTree,
      candidateTree: identity.candidateTree,
      cwd,
      gitRunner,
    });
    const selection = classifyChangedPaths(selectionPaths);
    const invalidation = classifyChangedPaths(invalidationPaths);
    let selectedGroups = classifiedGroups(selection);
    let invalidatedGroups = classifiedGroups(invalidation);
    const controlChanged = invalidationPaths.some((path) =>
      LOCAL_CONTROL.has(path));
    if (controlChanged) invalidatedGroups = [...REGRESSION_GROUPS];

    const selectionMismatch = !sameGroups(
      selectedGroups,
      changedProjectionGroups(projections.base, projections.candidate),
    );
    const invalidationMismatch = !controlChanged && !sameGroups(
      invalidatedGroups,
      changedProjectionGroups(projections.previous, projections.candidate),
    );
    if (selectionMismatch || invalidationMismatch) {
      selectedGroups = [...REGRESSION_GROUPS];
      invalidatedGroups = [...REGRESSION_GROUPS];
      return buildEvidence({
        ...identity,
        baseTree,
        selectionPaths,
        invalidationPaths,
        selectedGroups,
        invalidatedGroups,
        projections,
        full: true,
        failClosed: true,
        reason: "classification-projection-mismatch",
        diagnostic: selectionMismatch ? "selection" : "invalidation",
      });
    }

    const full =
      selection.full || invalidation.full || controlChanged;
    return buildEvidence({
      ...identity,
      baseTree,
      selectionPaths,
      invalidationPaths,
      selectedGroups,
      invalidatedGroups,
      projections,
      full,
      failClosed: false,
      reason: controlChanged
        ? "local-evidence-control-changed"
        : selection.full
          ? `selection:${selection.reason}`
          : invalidation.full
            ? `invalidation:${invalidation.reason}`
            : "scoped-evidence",
    });
  } catch (error) {
    return failClosedEvidence(
      identity,
      "git-inspection-failed",
      error instanceof GateEvidenceError
        ? error.code
        : "unexpected-inspection-error",
    );
  }
}

function exactKeys(value, keys, label) {
  const actual = isObject(value) ? Object.keys(value).sort() : [];
  const expected = [...keys].sort();
  if (
    !isObject(value) || actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new GateEvidenceError(
      "invalid-evidence-schema",
      `${label}의 field 집합이 schema와 다릅니다.`,
    );
  }
}

function parseIdentity(value, keys, label) {
  exactKeys(value, keys, label);
  return Object.fromEntries(keys.map((key) => [
    key,
    canonicalOid(value[key], `${label}.${key}`),
  ]));
}

function parseGroupArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((group) => !REGRESSION_GROUPS.includes(group)) ||
    new Set(value).size !== value.length ||
    !sameGroups(value, ordered(value))
  ) {
    throw new GateEvidenceError(
      "invalid-evidence-schema",
      `${label}는 canonical 순서의 회귀군 배열이어야 합니다.`,
    );
  }
  return value;
}

function requireSchema(condition, message) {
  if (!condition) {
    throw new GateEvidenceError("invalid-evidence-schema", message);
  }
}

export function parseEvidenceJson(source) {
  let evidence;
  try {
    evidence = JSON.parse(String(source));
  } catch {
    throw new GateEvidenceError(
      "invalid-evidence-json",
      "previous evidence를 JSON으로 해석할 수 없습니다.",
    );
  }
  exactKeys(evidence, TOP_LEVEL_KEYS, "previous evidence");
  if (
    evidence.schema !== EVIDENCE_SCHEMA ||
    evidence.version !== EVIDENCE_VERSION ||
    !MODES.has(evidence.mode)
  ) {
    throw new GateEvidenceError(
      "invalid-evidence-version",
      "previous evidence의 schema, version 또는 mode가 다릅니다.",
    );
  }
  evidence.base = parseIdentity(evidence.base, ["commit", "tree"], "base");
  evidence.previous = parseIdentity(
    evidence.previous,
    ["base", "tree"],
    "previous",
  );
  evidence.candidate = parseIdentity(
    evidence.candidate,
    ["base", "tree"],
    "candidate",
  );
  requireSchema(
    evidence.previous.base === evidence.base.commit &&
      evidence.candidate.base === evidence.base.commit,
    "previous evidence의 base identity가 연속되지 않습니다.",
  );
  requireSchema(
    typeof evidence.full === "boolean" &&
      typeof evidence.failClosed === "boolean" &&
      typeof evidence.reason === "string" &&
      evidence.reason.length > 0 &&
      (evidence.diagnostic === null ||
        typeof evidence.diagnostic === "string"),
    "previous evidence의 상태 field가 잘못됐습니다.",
  );
  for (const field of ["selectionPaths", "invalidationPaths"]) {
    const paths = evidence[field];
    requireSchema(
      Array.isArray(paths) &&
        paths.every(isRepositoryPath) &&
        new Set(paths).size === paths.length,
      `${field}는 중복 없는 저장소 상대 경로 배열이어야 합니다.`,
    );
  }
  for (const field of [
    "selectedGroups",
    "invalidatedGroups",
    "rerunGroups",
    "retainGroups",
    "dropGroups",
  ]) {
    evidence[field] = parseGroupArray(evidence[field], field);
  }

  const selected = new Set(evidence.selectedGroups);
  const invalidated = new Set(evidence.invalidatedGroups);
  const expectedRerun = REGRESSION_GROUPS.filter(
    (group) => selected.has(group) && invalidated.has(group),
  );
  const expectedRetain = REGRESSION_GROUPS.filter(
    (group) => selected.has(group) && !invalidated.has(group),
  );
  const expectedDrop = REGRESSION_GROUPS.filter(
    (group) => !selected.has(group),
  );
  if (
    !sameGroups(evidence.rerunGroups, expectedRerun) ||
    !sameGroups(evidence.retainGroups, expectedRetain) ||
    !sameGroups(evidence.dropGroups, expectedDrop)
  ) {
    throw new GateEvidenceError(
      "invalid-evidence-partition",
      "previous evidence의 rerun·retain·drop partition이 잘못됐습니다.",
    );
  }

  exactKeys(evidence.groups, REGRESSION_GROUPS, "groups");
  for (const group of REGRESSION_GROUPS) {
    const item = evidence.groups[group];
    exactKeys(item, GROUP_KEYS, `groups.${group}`);
    const decision = !selected.has(group)
      ? "not-required"
      : invalidated.has(group) ? "rerun" : "retain";
    if (
      !DECISIONS.has(item.decision) ||
      item.decision !== decision ||
      item.required !== selected.has(group) ||
      item.invalidated !== invalidated.has(group)
    ) {
      throw new GateEvidenceError(
        "invalid-evidence-partition",
        `groups.${group}의 decision이 partition과 다릅니다.`,
      );
    }
    for (const field of [
      "commandManifestDigest",
      "baseInputDigest",
      "previousInputDigest",
      "candidateInputDigest",
    ]) {
      requireSchema(
        DIGEST.test(String(item[field] ?? "")),
        `groups.${group}.${field}가 SHA-256 digest가 아닙니다.`,
      );
    }
    for (const field of [
      "baseEntryCount",
      "previousEntryCount",
      "candidateEntryCount",
    ]) {
      requireSchema(
        Number.isSafeInteger(item[field]) && item[field] >= 0,
        `groups.${group}.${field}가 0 이상의 정수가 아닙니다.`,
      );
    }
  }
  return evidence;
}

function readEvidenceFile(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_EVIDENCE) {
      throw new GateEvidenceError(
        "invalid-evidence-file",
        "previous evidence는 1MiB 이하의 일반 파일이어야 합니다.",
      );
    }
    return parseEvidenceJson(readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error instanceof GateEvidenceError) throw error;
    throw new GateEvidenceError(
      "invalid-evidence-file",
      "previous evidence 파일을 읽지 못했습니다.",
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validatePreviousEvidence(
  evidence,
  { candidateBase, cwd, gitRunner = defaultGitRunner },
) {
  const base = canonicalOid(candidateBase, "candidate base");
  if (
    evidence.base.commit !== base ||
    evidence.previous.base !== base ||
    evidence.candidate.base !== base
  ) {
    throw new GateEvidenceError(
      "stale-previous-evidence",
      "previous evidence의 candidate base가 현재 base와 다릅니다.",
    );
  }
  const expected = evaluateGateEvidence({
    mode: evidence.mode,
    previousBase: evidence.previous.base,
    previousTree: evidence.previous.tree,
    candidateBase: evidence.candidate.base,
    candidateTree: evidence.candidate.tree,
    cwd,
    gitRunner,
  });
  if (stableJson(evidence) !== stableJson(expected)) {
    throw new GateEvidenceError(
      "stale-previous-evidence",
      "previous evidence의 identity·manifest·projection·판정이 다릅니다.",
    );
  }
  return {
    previousBase: evidence.candidate.base,
    previousTree: evidence.candidate.tree,
  };
}

export function readCurrentCandidateTree({
  cwd,
  gitRunner = defaultGitRunner,
}) {
  if (git(["ls-files", "-u", "-z"], {
    cwd,
    gitRunner,
    operation: "unmerged index",
  }).stdout.length > 0) {
    throw new GateEvidenceError(
      "unmerged-index",
      "Git index에 해결되지 않은 항목이 있습니다.",
    );
  }
  if (git([
    "diff", "--quiet", "--no-ext-diff", "--ignore-submodules=none", "--",
  ], {
    cwd,
    gitRunner,
    operation: "unstaged tracked state",
    statuses: [0, 1],
  }).status === 1) {
    throw new GateEvidenceError(
      "unstaged-tracked-input",
      "candidate 밖의 unstaged tracked 변경이 있습니다.",
    );
  }
  if (git([
    "ls-files", "--others", "--exclude-standard", "-z", "--",
  ], {
    cwd,
    gitRunner,
    operation: "untracked state",
  }).stdout.length > 0) {
    throw new GateEvidenceError(
      "unexpected-untracked-input",
      "candidate 밖의 예상하지 않은 untracked 입력이 있습니다.",
    );
  }
  const tree = canonicalOid(
    git(["write-tree"], {
      cwd,
      gitRunner,
      operation: "current candidate tree",
    }).stdout.toString("utf8").trim(),
    "current candidate tree",
  );
  requireObjectType(tree, "tree", "current candidate tree", cwd, gitRunner);
  return tree;
}

function requireCandidateBaseAtHead(base, cwd, gitRunner) {
  const head = canonicalOid(
    git(["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd,
      gitRunner,
      operation: "current HEAD commit",
    }).stdout.toString("utf8").trim(),
    "current HEAD commit",
  );
  if (head !== base) {
    throw new GateEvidenceError(
      "stale-candidate-base",
      "--candidate-base가 replace-disabled current HEAD commit과 다릅니다.",
    );
  }
}

export function evaluateCurrentWorkspace({
  mode,
  candidateBase,
  previousEvidencePath,
  cwd,
  gitRunner = defaultGitRunner,
}) {
  if (!MODES.has(mode)) {
    throw new GateEvidenceError(
      "invalid-mode",
      "mode는 initial 또는 delta여야 합니다.",
      { usage: true },
    );
  }
  const base = canonicalOid(candidateBase, "candidate base");
  requireCandidateBaseAtHead(base, cwd, gitRunner);
  const candidateTree = readCurrentCandidateTree({ cwd, gitRunner });
  let previous;
  if (mode === "initial") {
    if (previousEvidencePath !== undefined) {
      throw new GateEvidenceError(
        "invalid-arguments",
        "initial mode에는 --previous-evidence를 사용할 수 없습니다.",
        { usage: true },
      );
    }
    previous = {
      previousBase: base,
      previousTree: readCommitTree(base, cwd, gitRunner),
    };
  } else {
    if (!previousEvidencePath) {
      throw new GateEvidenceError(
        "invalid-arguments",
        "delta mode에는 --previous-evidence가 필요합니다.",
        { usage: true },
      );
    }
    previous = validatePreviousEvidence(
      readEvidenceFile(previousEvidencePath),
      { candidateBase: base, cwd, gitRunner },
    );
  }
  const evidence = evaluateGateEvidence({
    mode,
    ...previous,
    candidateBase: base,
    candidateTree,
    cwd,
    gitRunner,
  });
  if (
    readCurrentCandidateTree({ cwd, gitRunner }) !== candidateTree
  ) {
    throw new GateEvidenceError(
      "candidate-changed-during-evaluation",
      "검증 중 current candidate tree가 바뀌었습니다.",
    );
  }
  requireCandidateBaseAtHead(base, cwd, gitRunner);
  return evidence;
}

function usage() {
  return [
    "사용법:",
    "  validate-gate-evidence.mjs --mode initial --candidate-base <40-oid>",
    "  validate-gate-evidence.mjs --mode delta --candidate-base <40-oid> --previous-evidence <json-file>",
  ].join("\n");
}

export function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const names = new Map([
    ["--mode", "mode"],
    ["--candidate-base", "candidateBase"],
    ["--previous-evidence", "previousEvidencePath"],
  ]);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const key = names.get(name);
    const value = argv[index + 1];
    if (!key) {
      throw new GateEvidenceError(
        "invalid-arguments",
        `알 수 없는 인자입니다: ${name}`,
        { usage: true },
      );
    }
    if (parsed[key] !== undefined || value === undefined) {
      throw new GateEvidenceError(
        "invalid-arguments",
        `${name} 값은 정확히 한 번 필요합니다.`,
        { usage: true },
      );
    }
    parsed[key] = value;
  }
  if (
    !MODES.has(parsed.mode) ||
    parsed.candidateBase === undefined ||
    (parsed.mode === "initial" &&
      parsed.previousEvidencePath !== undefined) ||
    (parsed.mode === "delta" &&
      parsed.previousEvidencePath === undefined)
  ) {
    throw new GateEvidenceError(
      "invalid-arguments",
      "initial/delta mode의 필수 인자가 올바르지 않습니다.",
      { usage: true },
    );
  }
  return parsed;
}

async function main() {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help) {
      console.log(usage());
      return;
    }
    console.log(JSON.stringify(evaluateCurrentWorkspace({
      ...arguments_,
      cwd: process.cwd(),
    })));
  } catch (error) {
    console.error(error.message);
    if (error?.exitCode === 2) console.error(usage());
    process.exitCode = error?.exitCode ?? 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
