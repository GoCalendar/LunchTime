#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MANIFEST_PATH = ".github/mvp-work-items.json";
const DEFAULT_CONFIG_PATH = ".github/work-management.json";
const SCHEMA_VERSION = 1;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const GITHUB_CALL_TIMEOUT_MS = 30_000;
const MIN_GITHUB_CALL_TIMEOUT_MS = 100;
const API_HEADERS = [
  "-H",
  "Accept: application/vnd.github+json",
  "-H",
  "X-GitHub-Api-Version: 2026-03-10",
];

export const REQUIRED_HEADINGS = [
  "개요",
  "맥락",
  "목표",
  "작업 범위",
  "완료 조건",
  "선행 작업",
  "추적성",
  "변경 허용 경로",
  "변경 금지 경로",
  "검증",
  "문서 영향",
];

export const ALLOWED_TYPES = [
  "type:feat",
  "type:fix",
  "type:refactor",
  "type:docs",
  "type:chore",
  "type:spike",
  "type:test",
];
export const ALLOWED_AREAS = [
  "area:app-shell",
  "area:p2p",
  "area:domain",
  "area:ui",
  "area:data",
  "area:security",
  "area:quality",
];
export const ALLOWED_PRIORITIES = ["P0", "P1", "P2", "P3"];
export const ALLOWED_PHASES = [
  "Discovery",
  "Foundation",
  "Domain",
  "Surface",
  "Verification",
];

const TOP_LEVEL_KEYS = [
  "schemaVersion",
  "repository",
  "project",
  "milestone",
  "items",
];
const PROJECT_KEYS = ["owner", "number"];
const ITEM_KEYS = [
  "key",
  "title",
  "type",
  "areas",
  "priority",
  "phase",
  "order",
  "dependsOn",
  "overview",
  "context",
  "goal",
  "scope",
  "acceptance",
  "traceability",
  "allowedPaths",
  "forbiddenPaths",
  "verification",
  "documentImpact",
];
const SCOPE_KEYS = ["include", "exclude"];
const SOURCE_TRACE_ID_PATTERN =
  /^(?:PRD-\d{2,}-(?:FR|AC|SP)-\d{2,}|POL-\d{2,}-R-\d{2,})$/;
const TRACE_ID_PATTERN =
  /^(?:(?:PRD-\d{2,}-(?:FR|AC|SP)-\d{2,}|POL-\d{2,}-R-\d{2,})|[DF]-\d{2,})$/;
const KEY_PATTERN = /^LT-\d{3}$/;
const MANAGED_LABEL_PATTERN = /^(?:status|dependency|type|area):/;
const MARKER_PREFIX = "<!-- lunchtime-mvp-work-item:key=";

export class BootstrapError extends Error {
  constructor(message, { completed = [], recovery = [] } = {}) {
    super(message);
    this.name = "BootstrapError";
    this.completed = completed;
    this.recovery = recovery;
  }
}

function usage() {
  return `사용법:
  bootstrap-mvp.mjs validate [--manifest PATH] [--json]
  bootstrap-mvp.mjs apply [--manifest PATH] [--config PATH] [--dry-run] [--json]

명령:
  validate  GitHub에 접근하지 않고 MVP 작업 manifest를 검증합니다.
  apply     GitHub 실제 상태를 읽고 등록을 생성하거나 안전하게 재개합니다.

옵션:
  --manifest PATH  Manifest 경로입니다. 기본값: ${DEFAULT_MANIFEST_PATH}
  --config PATH    작업 흐름 설정 경로입니다. 기본값: ${DEFAULT_CONFIG_PATH}
  --dry-run        모든 실제 조회와 계획 출력을 수행하되 쓰기는 하지 않습니다.
  --json           기계가 읽을 수 있는 JSON을 출력합니다.
  -h, --help       이 도움말을 표시합니다.

자동 재시도는 없습니다. 실패하거나 충돌한 단계가 있으면 실행을 중단합니다.`;
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0],
    options: {
      manifest: DEFAULT_MANIFEST_PATH,
      config: DEFAULT_CONFIG_PATH,
      dryRun: false,
      json: false,
    },
  };
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    parsed.command = "help";
    return parsed;
  }

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      parsed.options.dryRun = true;
    } else if (token === "--json") {
      parsed.options.json = true;
    } else if (token === "-h" || token === "--help") {
      parsed.command = "help";
    } else if (token === "--manifest" || token === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new BootstrapError(`${token} requires a path.`);
      }
      parsed.options[token.slice(2)] = value;
      index += 1;
    } else {
      throw new BootstrapError(`Unknown argument: ${token}`);
    }
  }
  if (!["help", "validate", "apply"].includes(parsed.command)) {
    throw new BootstrapError(`Unknown command: ${parsed.command}`);
  }
  if (parsed.command !== "apply" && parsed.options.dryRun) {
    throw new BootstrapError("--dry-run is only valid with apply.");
  }
  return parsed;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort();
}

function exactKeys(value, expected, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  const actual = sortedKeys(value);
  const wanted = [...expected].sort();
  const missing = wanted.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !wanted.includes(key));
  if (missing.length > 0) {
    errors.push(`${path} is missing field(s): ${missing.join(", ")}.`);
  }
  if (extra.length > 0) {
    errors.push(`${path} has unsupported field(s): ${extra.join(", ")}.`);
  }
  return missing.length === 0 && extra.length === 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function meaningful(value, minimum = 8) {
  if (!nonEmptyString(value)) return false;
  const visible = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[`*_>#\-[\](){}|]/g, "")
    .replace(/\s+/g, "");
  if (visible.length < minimum) return false;
  const normalized = visible.toLowerCase().replace(/[.,:;!?]/g, "");
  if (/^(?:x+|tbd|todo|na|none|없음|해당없음)$/.test(normalized)) {
    return false;
  }
  return new Set([...normalized]).size > 1;
}

function validateStringArray(
  value,
  path,
  errors,
  { minimum = 1, meaningfulMinimum = 4 } = {},
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return [];
  }
  if (value.length < minimum) {
    errors.push(`${path} must contain at least ${minimum} item(s).`);
  }
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!meaningful(entry, meaningfulMinimum)) {
      errors.push(`${path}[${index}] must contain meaningful text.`);
    } else {
      if (/[\r\n]/.test(entry) || entry.includes(MARKER_PREFIX)) {
        errors.push(
          `${path}[${index}] must be one line and must not contain a bootstrap marker.`,
        );
      }
      normalized.push(entry.trim());
    }
  }
  if (new Set(normalized).size !== normalized.length) {
    errors.push(`${path} must not contain duplicates.`);
  }
  return normalized;
}

function collectStrings(value, path = "$", output = []) {
  if (typeof value === "string") {
    output.push({ path, value });
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectStrings(entry, `${path}[${index}]`, output),
    );
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStrings(entry, `${path}.${key}`, output);
    }
  }
  return output;
}

function safetyProblem(value) {
  const patterns = [
    [
      /(?:^|[\s"'`])\/(?:Applications|Library|System|Users|Volumes|bin|dev|etc|home|opt|private|proc|sbin|tmp|usr|var)\//i,
      "local absolute path",
    ],
    [/[A-Za-z]:\\(?:[^\\\r\n]+\\)+/i, "Windows local path"],
    [/\bfile:\/\//i, "file URI"],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/, "GitHub token"],
    [
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i,
      "credential value",
    ],
    [/\b[A-F0-9]{2}(?::[A-F0-9]{2}){5}\b/i, "MAC address"],
    [
      /\b(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|169\.254(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b/,
      "private or local IPv4 address",
    ],
    [
      /\b172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}\b/,
      "private IPv4 address",
    ],
    [/\b(?:fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i, "private or local IPv6 address"],
    [/(?:^|[\s[(])::1(?:$|[\s)\]])/, "IPv6 loopback address"],
    [/\bSSID\s*[:=]\s*\S+/i, "SSID value"],
    [/\blocalhost\b|\b[A-Z0-9-]+\.local\b/i, "local hostname"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, "email address"],
    [/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/, "phone number"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) return label;
  }
  return null;
}

function validateRepositoryPath(value, path, errors) {
  if (!nonEmptyString(value)) return;
  const normalized = value.trim();
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.includes("\\") ||
    /(^|\/)\.\.(?:\/|$)/.test(normalized) ||
    normalized.includes("://") ||
    normalized.includes("\n") ||
    normalized.length > 240
  ) {
    errors.push(`${path} must be a narrow repository-relative path or glob.`);
  }
}

export function issueMarker(key) {
  return `${MARKER_PREFIX}${key} -->`;
}

export function labelsForItem(item, config, hasOpenBlocker) {
  return [
    config.labels.todo,
    item.type,
    ...item.areas,
    ...(hasOpenBlocker ? [config.labels.blocked] : []),
  ].sort();
}

function bullets(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

export function renderIssueBody(item, dependencyIssues = new Map()) {
  const dependencyLines =
    item.dependsOn.length === 0
      ? ["없음 — 이 작업은 선행 Issue 없이 시작할 수 있습니다."]
      : item.dependsOn.map((key) => {
          const issue = dependencyIssues.get(key);
          if (!issue?.number || !issue?.html_url) {
            throw new BootstrapError(
              `${item.key} body cannot be rendered before dependency ${key} has a GitHub Issue link.`,
            );
          }
          return `\`${key}\` — [GitHub Issue #${issue.number}](${issue.html_url})`;
        });

  const sections = new Map([
    ["개요", item.overview.trim()],
    ["맥락", item.context.trim()],
    ["목표", item.goal.trim()],
    [
      "작업 범위",
      [
        "**포함**",
        bullets(item.scope.include),
        "",
        "**제외**",
        bullets(item.scope.exclude),
      ].join("\n"),
    ],
    ["완료 조건", bullets(item.acceptance)],
    ["선행 작업", bullets(dependencyLines)],
    ["추적성", bullets(item.traceability.map((id) => `\`${id}\``))],
    ["변경 허용 경로", bullets(item.allowedPaths.map((path) => `\`${path}\``))],
    ["변경 금지 경로", bullets(item.forbiddenPaths.map((path) => `\`${path}\``))],
    ["검증", bullets(item.verification.map((value) => `\`${value}\``))],
    ["문서 영향", bullets(item.documentImpact)],
  ]);

  return [
    issueMarker(item.key),
    "",
    ...REQUIRED_HEADINGS.flatMap((heading, index) => [
      `## ${heading}`,
      sections.get(heading),
      ...(index === REQUIRED_HEADINGS.length - 1 ? [] : [""]),
    ]),
  ].join("\n");
}

function parseRenderedBody(body) {
  const headings = [];
  const sections = new Map();
  let active = null;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence === null ? marker : fence === marker ? null : fence;
      if (active) sections.set(active, `${sections.get(active)}${line}\n`);
      continue;
    }
    if (fence !== null) {
      if (active) sections.set(active, `${sections.get(active)}${line}\n`);
      continue;
    }
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      active = match[1].trim();
      headings.push(active);
      sections.set(active, "");
    } else if (active) {
      sections.set(active, `${sections.get(active)}${line}\n`);
    }
  }
  return { headings, sections };
}

function validateRenderedBody(item, dependencyIssues, errors) {
  let body;
  try {
    body = renderIssueBody(item, dependencyIssues);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  const parsed = parseRenderedBody(body);
  if (
    parsed.headings.length !== REQUIRED_HEADINGS.length ||
    parsed.headings.some((heading, index) => heading !== REQUIRED_HEADINGS[index])
  ) {
    errors.push(`${item.key} rendered body headings violate the Issue contract.`);
  }
  for (const heading of REQUIRED_HEADINGS) {
    if (!meaningful(parsed.sections.get(heading) || "", 8)) {
      errors.push(`${item.key} rendered section "${heading}" is not meaningful.`);
    }
  }
  if (!body.startsWith(`${issueMarker(item.key)}\n\n`)) {
    errors.push(`${item.key} rendered body does not start with its exact marker.`);
  }
  if (Buffer.byteLength(body, "utf8") > 65_536) {
    errors.push(`${item.key} rendered body exceeds GitHub's 65,536-byte limit.`);
  }
  if (markerKeys(body).length !== 1) {
    errors.push(`${item.key} rendered body must contain exactly one MVP marker.`);
  }
  const bareIds = findBareTraceabilityIds(body);
  if (bareIds.length > 0) {
    errors.push(
      `${item.key} rendered body contains bare traceability ID(s): ${bareIds.join(", ")}.`,
    );
  }
}

function findBareTraceabilityIds(body) {
  const matches = [];
  const pattern = /\b(FR|AC|SP|R)-(\d+)\b/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    const prefix = body.slice(Math.max(0, match.index - 20), match.index);
    const validPrefix =
      match[1] === "R"
        ? /POL-\d{2,}-$/.test(prefix)
        : /PRD-\d{2,}-$/.test(prefix);
    if (!(validPrefix && match[2].length >= 2)) matches.push(match[0]);
  }
  return [...new Set(matches)].sort();
}

export function validateManifest(value) {
  const errors = [];
  if (!exactKeys(value, TOP_LEVEL_KEYS, "$", errors)) {
    return { valid: false, errors, manifest: value };
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (
    !nonEmptyString(value.repository) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)
  ) {
    errors.push("repository must be OWNER/REPO.");
  }
  if (exactKeys(value.project, PROJECT_KEYS, "$.project", errors)) {
    if (
      !nonEmptyString(value.project.owner) ||
      !/^[A-Za-z0-9-]+$/.test(value.project.owner)
    ) {
      errors.push("$.project.owner must be a GitHub login.");
    }
    if (!Number.isInteger(value.project.number) || value.project.number < 1) {
      errors.push("$.project.number must be a positive integer.");
    }
  }
  if (!meaningful(value.milestone, 3) || value.milestone.length > 100) {
    errors.push("milestone must be a meaningful title of at most 100 characters.");
  }
  if (!Array.isArray(value.items) || value.items.length === 0) {
    errors.push("items must be a non-empty array.");
    return { valid: false, errors, manifest: value };
  }
  if (value.items.length > 200) {
    errors.push("items exceeds the bounded limit of 200.");
  }

  const keys = new Set();
  const orders = new Set();
  for (let index = 0; index < value.items.length; index += 1) {
    const item = value.items[index];
    const path = `$.items[${index}]`;
    exactKeys(item, ITEM_KEYS, path, errors);
    if (!isPlainObject(item)) continue;
    exactKeys(item.scope, SCOPE_KEYS, `${path}.scope`, errors);

    const expectedKey = `LT-${String(index + 1).padStart(3, "0")}`;
    if (!KEY_PATTERN.test(item.key || "")) {
      errors.push(`${path}.key must match LT-NNN.`);
    } else if (item.key !== expectedKey) {
      errors.push(
        `${path}.key must be ${expectedKey}; keys must be unique, continuous, and manifest-ordered.`,
      );
    }
    if (keys.has(item.key)) errors.push(`${path}.key duplicates ${item.key}.`);
    keys.add(item.key);

    if (!Number.isInteger(item.order) || item.order < 1) {
      errors.push(`${path}.order must be a positive integer.`);
    } else {
      if (item.order !== index + 1) {
        errors.push(
          `${path}.order must be ${index + 1}; order must be unique, continuous, and manifest-ordered.`,
        );
      }
      if (orders.has(item.order)) {
        errors.push(`${path}.order duplicates ${item.order}.`);
      }
      orders.add(item.order);
    }
    if (!meaningful(item.title, 4) || item.title.length > 160) {
      errors.push(`${path}.title must be meaningful and at most 160 characters.`);
    } else if (/[\r\n]/.test(item.title) || item.title.includes(MARKER_PREFIX)) {
      errors.push(`${path}.title must be one line without a bootstrap marker.`);
    }
    if (!ALLOWED_TYPES.includes(item.type)) {
      errors.push(
        `${path}.type must be one of: ${ALLOWED_TYPES.join(", ")}.`,
      );
    }
    if (!Array.isArray(item.areas) || item.areas.length === 0) {
      errors.push(`${path}.areas must be a non-empty array.`);
    } else {
      if (new Set(item.areas).size !== item.areas.length) {
        errors.push(`${path}.areas must not contain duplicates.`);
      }
      for (const area of item.areas) {
        if (!ALLOWED_AREAS.includes(area)) {
          errors.push(
            `${path}.areas contains unsupported area "${area}"; allowed: ${ALLOWED_AREAS.join(", ")}.`,
          );
        }
      }
    }
    if (!ALLOWED_PRIORITIES.includes(item.priority)) {
      errors.push(
        `${path}.priority must be one of: ${ALLOWED_PRIORITIES.join(", ")}.`,
      );
    }
    if (!ALLOWED_PHASES.includes(item.phase)) {
      errors.push(
        `${path}.phase must be one of: ${ALLOWED_PHASES.join(", ")}.`,
      );
    }
    if (!meaningful(item.overview)) {
      errors.push(`${path}.overview must contain meaningful text.`);
    }
    if (!meaningful(item.context)) {
      errors.push(`${path}.context must contain meaningful text.`);
    }
    if (!meaningful(item.goal)) {
      errors.push(`${path}.goal must contain one observable outcome.`);
    }
    validateStringArray(item.scope?.include, `${path}.scope.include`, errors);
    validateStringArray(item.scope?.exclude, `${path}.scope.exclude`, errors);
    validateStringArray(item.acceptance, `${path}.acceptance`, errors, {
      meaningfulMinimum: 8,
    });
    validateStringArray(item.allowedPaths, `${path}.allowedPaths`, errors);
    validateStringArray(item.forbiddenPaths, `${path}.forbiddenPaths`, errors);
    validateStringArray(item.verification, `${path}.verification`, errors);
    validateStringArray(item.documentImpact, `${path}.documentImpact`, errors, {
      meaningfulMinimum: 8,
    });
    if (!Array.isArray(item.dependsOn)) {
      errors.push(`${path}.dependsOn must be an array.`);
    } else {
      if (item.dependsOn.length > 50) {
        errors.push(`${path}.dependsOn exceeds GitHub's limit of 50 blockers.`);
      }
      if (new Set(item.dependsOn).size !== item.dependsOn.length) {
        errors.push(`${path}.dependsOn must not contain duplicates.`);
      }
      for (const dependency of item.dependsOn) {
        if (!KEY_PATTERN.test(dependency)) {
          errors.push(`${path}.dependsOn contains invalid key "${dependency}".`);
        }
        if (dependency === item.key) {
          errors.push(`${path}.dependsOn must not contain itself.`);
        }
      }
    }
    if (!Array.isArray(item.traceability) || item.traceability.length === 0) {
      errors.push(`${path}.traceability must be a non-empty array.`);
    } else {
      if (new Set(item.traceability).size !== item.traceability.length) {
        errors.push(`${path}.traceability must not contain duplicates.`);
      }
      for (const id of item.traceability) {
        if (!TRACE_ID_PATTERN.test(id || "")) {
          errors.push(
            `${path}.traceability contains non-namespaced ID "${id}".`,
          );
        }
      }
      if (!item.traceability.some((id) => SOURCE_TRACE_ID_PATTERN.test(id))) {
        errors.push(
          `${path}.traceability must contain at least one PRD or Policy source ID; D-NN and F-NN are supplemental only.`,
        );
      }
    }
    for (const [field, paths] of [
      ["allowedPaths", item.allowedPaths],
      ["forbiddenPaths", item.forbiddenPaths],
    ]) {
      if (Array.isArray(paths)) {
        paths.forEach((entry, pathIndex) =>
          validateRepositoryPath(entry, `${path}.${field}[${pathIndex}]`, errors),
        );
      }
    }
    if (
      Array.isArray(item.allowedPaths) &&
      Array.isArray(item.forbiddenPaths)
    ) {
      const overlap = item.allowedPaths.filter((entry) =>
        item.forbiddenPaths.includes(entry),
      );
      if (overlap.length > 0) {
        errors.push(
          `${path} has paths in both allowedPaths and forbiddenPaths: ${overlap.join(", ")}.`,
        );
      }
    }
  }

  const objectItems = value.items.filter((item) => isPlainObject(item));
  const byKey = new Map(objectItems.map((item) => [item.key, item]));
  for (const item of objectItems) {
    if (!Array.isArray(item.dependsOn)) continue;
    for (const dependency of item.dependsOn) {
      const blocker = byKey.get(dependency);
      if (!blocker) {
        errors.push(`${item.key} depends on missing item ${dependency}.`);
      } else if (blocker.order >= item.order) {
        errors.push(
          `${item.key} dependency ${dependency} must have a lower order.`,
        );
      }
    }
  }
  errors.push(...validateDag(objectItems));

  for (const { path, value: text } of collectStrings(value)) {
    if (text.includes(MARKER_PREFIX)) {
      errors.push(`${path} contains the reserved bootstrap marker prefix.`);
    }
    const problem = safetyProblem(text);
    if (problem) {
      errors.push(`${path} contains public-repository unsafe data (${problem}).`);
    }
  }

  if (errors.length === 0) {
    const fakeDependencies = new Map(
      value.items.map((item, index) => [
        item.key,
        {
          number: index + 1,
          html_url: `https://github.com/${value.repository}/issues/${index + 1}`,
        },
      ]),
    );
    for (const item of value.items) {
      validateRenderedBody(item, fakeDependencies, errors);
    }
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    manifest: value,
  };
}

export function validateDag(items) {
  if (!Array.isArray(items)) return ["items must be an array for DAG validation."];
  const byKey = new Map(items.map((item) => [item.key, item]));
  const state = new Map();
  const stack = [];
  const errors = [];

  function visit(key) {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      const start = stack.indexOf(key);
      errors.push(`Dependency cycle: ${[...stack.slice(start), key].join(" -> ")}.`);
      return;
    }
    state.set(key, "visiting");
    stack.push(key);
    const item = byKey.get(key);
    for (const dependency of item?.dependsOn || []) {
      if (byKey.has(dependency)) visit(dependency);
    }
    stack.pop();
    state.set(key, "done");
  }

  for (const key of byKey.keys()) visit(key);
  return [...new Set(errors)];
}

function readJson(path, label) {
  const absolute = resolve(process.cwd(), path);
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    throw new BootstrapError(`Cannot read ${label} ${absolute}: ${error.message}`);
  }
  try {
    return { path: absolute, value: JSON.parse(text) };
  } catch (error) {
    throw new BootstrapError(`Invalid JSON in ${label} ${absolute}: ${error.message}`);
  }
}

function validateWorkflowConfig(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    throw new BootstrapError("Workflow config root must be an object.");
  }
  if (
    !nonEmptyString(value.repository) ||
    !/^[^/\s]+\/[^/\s]+$/.test(value.repository)
  ) {
    errors.push("repository must be OWNER/REPO");
  }
  if (!isPlainObject(value.project)) {
    errors.push("project must be an object");
  } else {
    if (!nonEmptyString(value.project.owner)) errors.push("project.owner is required");
    if (!Number.isInteger(value.project.number) || value.project.number < 1) {
      errors.push("project.number must be a positive integer");
    }
    if (!nonEmptyString(value.project.statusField)) {
      errors.push("project.statusField is required");
    }
    for (const key of ["todo", "inProgress", "done"]) {
      if (!nonEmptyString(value.project.statusOptions?.[key])) {
        errors.push(`project.statusOptions.${key} is required`);
      }
    }
  }
  for (const key of ["todo", "inProgress", "done", "blocked"]) {
    if (!nonEmptyString(value.labels?.[key])) {
      errors.push(`labels.${key} is required`);
    }
  }
  if (!value.labels?.todo?.startsWith("status:")) {
    errors.push("labels.todo must be scoped under status:");
  }
  if (value.labels?.blocked !== "dependency:blocked") {
    errors.push("labels.blocked must be dependency:blocked");
  }
  if (errors.length > 0) {
    throw new BootstrapError(`Invalid workflow config: ${errors.join("; ")}.`);
  }
  return value;
}

function run(command, args, { input } = {}) {
  const timeoutOverride = process.env.LUNCHTIME_BOOTSTRAP_GH_TIMEOUT_MS;
  const timeoutMs =
    timeoutOverride === undefined
      ? GITHUB_CALL_TIMEOUT_MS
      : Number(timeoutOverride);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_GITHUB_CALL_TIMEOUT_MS ||
    timeoutMs > GITHUB_CALL_TIMEOUT_MS
  ) {
    throw new BootstrapError(
      `LUNCHTIME_BOOTSTRAP_GH_TIMEOUT_MS must be an integer from ${MIN_GITHUB_CALL_TIMEOUT_MS} to ${GITHUB_CALL_TIMEOUT_MS}.`,
    );
  }
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
  });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new BootstrapError(
        `${command} ${args.join(" ")} timed out after ${timeoutMs / 1000} seconds.`,
        {
          recovery: [
            "Inspect GitHub connectivity and the specific live object.",
            "Do not retry automatically; invoke one new dry-run after the cause is corrected.",
          ],
        },
      );
    }
    throw new BootstrapError(`Unable to execute ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new BootstrapError(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return result.stdout.trim();
}

function parseGhJson(text, context) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new BootstrapError(`GitHub returned invalid JSON while ${context}.`);
  }
}

class GitHubClient {
  api(endpoint, { method = "GET", body } = {}) {
    const args = ["api", ...API_HEADERS];
    if (method !== "GET") args.push("--method", method);
    args.push(endpoint);
    if (body !== undefined) args.push("--input", "-");
    return parseGhJson(
      run("gh", args, { input: body }),
      `${method} ${endpoint}`,
    );
  }

  graphql(query, variables = {}) {
    const result = this.api("graphql", {
      method: "POST",
      body: { query, variables },
    });
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      throw new BootstrapError(
        `GraphQL failed: ${result.errors.map((entry) => entry.message).join("; ")}.`,
      );
    }
    return result?.data;
  }

  repository() {
    const value = parseGhJson(
      run("gh", ["repo", "view", "--json", "nameWithOwner"]),
      "discovering the active repository",
    )?.nameWithOwner;
    if (!nonEmptyString(value)) {
      throw new BootstrapError("gh repo view did not return nameWithOwner.");
    }
    return value;
  }
}

function parseRepository(value) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value || "");
  if (!match) throw new BootstrapError(`Invalid repository: ${value}`);
  return { owner: match[1], name: match[2], nameWithOwner: value };
}

function readPaged(client, endpoint, label) {
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = endpoint.includes("?") ? "&" : "?";
    const result = client.api(
      `${endpoint}${separator}per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(result)) {
      throw new BootstrapError(`${label} endpoint did not return an array.`);
    }
    records.push(...result);
    if (result.length < PAGE_SIZE) return records;
  }
  throw new BootstrapError(
    `${label} pagination exceeded the bounded limit of ${MAX_PAGES} pages.`,
  );
}

const PROJECT_QUERY = `
  query BootstrapProject(
    $owner: String!,
    $number: Int!,
    $statusField: String!,
    $priorityField: String!,
    $phaseField: String!,
    $orderField: String!,
    $after: String
  ) {
    repositoryOwner(login: $owner) {
      ... on Organization {
        projectV2(number: $number) { ...BootstrapProjectData }
      }
      ... on User {
        projectV2(number: $number) { ...BootstrapProjectData }
      }
    }
  }

  fragment BootstrapProjectData on ProjectV2 {
    id
    title
    fields(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on ProjectV2Field { id name dataType }
        ... on ProjectV2SingleSelectField {
          id
          name
          dataType
          options { id name }
        }
      }
    }
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        content {
          ... on Issue {
            id
            number
            repository { nameWithOwner }
          }
        }
        status: fieldValueByName(name: $statusField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        priority: fieldValueByName(name: $priorityField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        phase: fieldValueByName(name: $phaseField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        order: fieldValueByName(name: $orderField) {
          ... on ProjectV2ItemFieldNumberValue { number }
        }
      }
    }
  }
`;

const PROJECT_ITEMS_QUERY = `
  query BootstrapProjectItems(
    $owner: String!,
    $number: Int!,
    $statusField: String!,
    $priorityField: String!,
    $phaseField: String!,
    $orderField: String!,
    $after: String
  ) {
    repositoryOwner(login: $owner) {
      ... on Organization {
        projectV2(number: $number) { ...BootstrapProjectItemsData }
      }
      ... on User {
        projectV2(number: $number) { ...BootstrapProjectItemsData }
      }
    }
  }

  fragment BootstrapProjectItemsData on ProjectV2 {
    id
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        content {
          ... on Issue {
            id
            number
            repository { nameWithOwner }
          }
        }
        status: fieldValueByName(name: $statusField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        priority: fieldValueByName(name: $priorityField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        phase: fieldValueByName(name: $phaseField) {
          ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
        }
        order: fieldValueByName(name: $orderField) {
          ... on ProjectV2ItemFieldNumberValue { number }
        }
      }
    }
  }
`;

function exactlyOneProject(data, owner, number) {
  const project = data?.repositoryOwner?.projectV2;
  if (!project) {
    throw new BootstrapError(
      `Expected one readable Project ${owner}#${number}, but none was returned.`,
    );
  }
  return project;
}

function exactField(project, name, expectedType) {
  const matches = (project.fields?.nodes || []).filter(
    (field) => field?.name === name,
  );
  if (matches.length !== 1) {
    throw new BootstrapError(
      `Expected exactly one Project field "${name}", found ${matches.length}.`,
    );
  }
  if (matches[0].dataType !== expectedType) {
    throw new BootstrapError(
      `Project field "${name}" must have type ${expectedType}, found ${matches[0].dataType}.`,
    );
  }
  return matches[0];
}

function exactOption(field, name) {
  const matches = (field.options || []).filter((option) => option.name === name);
  if (matches.length !== 1) {
    throw new BootstrapError(
      `Expected exactly one "${name}" option in Project field "${field.name}", found ${matches.length}.`,
    );
  }
  return matches[0];
}

function resolveProject(client, manifest, config, repository) {
  const variables = {
    owner: manifest.project.owner,
    number: manifest.project.number,
    statusField: config.project.statusField,
    priorityField: "Priority",
    phaseField: "Phase",
    orderField: "Order",
    after: null,
  };
  const first = exactlyOneProject(
    client.graphql(PROJECT_QUERY, variables),
    manifest.project.owner,
    manifest.project.number,
  );
  if (first.fields?.pageInfo?.hasNextPage) {
    throw new BootstrapError(
      "Project has more than 100 fields; field resolution stops at the safety bound.",
    );
  }
  const status = exactField(first, config.project.statusField, "SINGLE_SELECT");
  const priority = exactField(first, "Priority", "SINGLE_SELECT");
  const phase = exactField(first, "Phase", "SINGLE_SELECT");
  const order = exactField(first, "Order", "NUMBER");

  const optionIds = {
    status: {
      todo: exactOption(status, config.project.statusOptions.todo).id,
    },
    priority: Object.fromEntries(
      [...new Set(manifest.items.map((item) => item.priority))].map((name) => [
        name,
        exactOption(priority, name).id,
      ]),
    ),
    phase: Object.fromEntries(
      [...new Set(manifest.items.map((item) => item.phase))].map((name) => [
        name,
        exactOption(phase, name).id,
      ]),
    ),
  };

  const items = [...(first.items?.nodes || [])];
  let pageInfo = first.items?.pageInfo;
  let page = 1;
  while (pageInfo?.hasNextPage && page < MAX_PAGES) {
    const next = exactlyOneProject(
      client.graphql(PROJECT_ITEMS_QUERY, {
        ...variables,
        after: pageInfo.endCursor,
      }),
      manifest.project.owner,
      manifest.project.number,
    );
    if (next.id !== first.id) {
      throw new BootstrapError("Project identity changed during pagination.");
    }
    items.push(...(next.items?.nodes || []));
    pageInfo = next.items?.pageInfo;
    page += 1;
  }
  if (pageInfo?.hasNextPage) {
    throw new BootstrapError(
      `Project item pagination exceeded ${MAX_PAGES} pages.`,
    );
  }

  const itemsByIssueNumber = new Map();
  for (const projectItem of items) {
    const content = projectItem.content;
    if (
      content?.repository?.nameWithOwner?.toLowerCase() !==
      repository.nameWithOwner.toLowerCase()
    ) {
      continue;
    }
    if (itemsByIssueNumber.has(content.number)) {
      throw new BootstrapError(
        `Issue #${content.number} appears more than once in Project "${first.title}".`,
      );
    }
    itemsByIssueNumber.set(content.number, projectItem);
  }
  return {
    id: first.id,
    title: first.title,
    fields: {
      status,
      priority,
      phase,
      order,
    },
    optionIds,
    itemsByIssueNumber,
  };
}

function markerKeys(body) {
  const exact = [];
  const pattern = /^<!-- lunchtime-mvp-work-item:key=(LT-\d{3}) -->$/gm;
  let match;
  while ((match = pattern.exec(body || "")) !== null) exact.push(match[1]);
  return exact;
}

function discoverExistingIssues(issues, manifest) {
  const manifestKeys = new Set(manifest.items.map((item) => item.key));
  const byKey = new Map();
  for (const issue of issues) {
    if (issue.pull_request) continue;
    const body = issue.body || "";
    const keys = markerKeys(body);
    if (body.includes(MARKER_PREFIX) && keys.length === 0) {
      throw new BootstrapError(
        `Issue #${issue.number} has a malformed LunchTime MVP marker.`,
      );
    }
    if (keys.length > 1) {
      throw new BootstrapError(
        `Issue #${issue.number} contains multiple LunchTime MVP markers.`,
      );
    }
    if (keys.length === 0) continue;
    const key = keys[0];
    if (!manifestKeys.has(key)) {
      throw new BootstrapError(
        `Issue #${issue.number} uses marker ${key}, which is absent from the manifest.`,
      );
    }
    if (byKey.has(key)) {
      throw new BootstrapError(
        `Marker ${key} appears on both Issue #${byKey.get(key).number} and #${issue.number}.`,
      );
    }
    byKey.set(key, issue);
  }
  return byKey;
}

function issueLabelNames(issue) {
  return (issue.labels || []).map((label) =>
    typeof label === "string" ? label : label.name,
  );
}

export function evaluateExistingIssue({
  issue,
  item,
  expectedBody,
  desiredLabels,
  milestoneNumber,
}) {
  const conflicts = [];
  const recover = [];
  if (issue.state !== "open") conflicts.push(`state is ${issue.state}, expected open`);
  if ((issue.assignees || []).length > 0) {
    conflicts.push("Issue already has an assignee");
  }
  if (issue.title !== item.title) conflicts.push("title differs from the manifest");
  if (issue.body !== expectedBody) conflicts.push("body differs from the manifest");

  const labels = issueLabelNames(issue);
  const desired = new Set(desiredLabels);
  const conflictingManaged = labels.filter(
    (label) => MANAGED_LABEL_PATTERN.test(label) && !desired.has(label),
  );
  if (conflictingManaged.length > 0) {
    conflicts.push(
      `managed label(s) differ: ${conflictingManaged.join(", ")}`,
    );
  }
  const missingLabels = desiredLabels.filter((label) => !labels.includes(label));
  if (missingLabels.length > 0) {
    recover.push({ type: "add-labels", labels: missingLabels });
  }

  if (issue.milestone?.number === milestoneNumber) {
    // Exact.
  } else if (issue.milestone == null) {
    recover.push({ type: "set-milestone", milestone: milestoneNumber });
  } else {
    conflicts.push(
      `milestone is #${issue.milestone.number}, expected #${milestoneNumber}`,
    );
  }
  return { conflicts, recover };
}

function evaluateProjectItem(projectItem, item, project, config) {
  if (!projectItem) return { conflicts: [], missing: ["item"] };
  const conflicts = [];
  const missing = [];
  const checks = [
    [
      "status",
      projectItem.status?.name,
      config.project.statusOptions.todo,
    ],
    ["priority", projectItem.priority?.name, item.priority],
    ["phase", projectItem.phase?.name, item.phase],
    ["order", projectItem.order?.number, item.order],
  ];
  for (const [field, current, expected] of checks) {
    if (current === expected) continue;
    if (current === null || current === undefined) {
      missing.push(field);
    } else {
      conflicts.push(
        `Project ${field} is "${current}", expected "${expected}"`,
      );
    }
  }
  return { conflicts, missing };
}

function nativeBlockerNumbers(blockers) {
  return blockers.map((issue) => issue.number).sort((left, right) => left - right);
}

function sameNumbers(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function mutationFailure(error, completed) {
  const normalized =
    error instanceof BootstrapError
      ? error
      : new BootstrapError(error?.message || String(error));
  return new BootstrapError(normalized.message, {
    completed: [...completed, ...normalized.completed],
    recovery: [
      ...normalized.recovery,
      "Do not retry automatically.",
      "Inspect the listed completed steps and the live Issue/Project state.",
      "Run apply --dry-run once after reconciling the reported conflict, then invoke one new apply command.",
      "The bootstrap never overwrites human-modified content or managed state.",
    ],
  });
}

function setProjectSingleSelect(client, project, itemId, field, optionId) {
  return client.graphql(
    `
      mutation SetBootstrapSingleSelect(
        $projectId: ID!,
        $itemId: ID!,
        $fieldId: ID!,
        $optionId: String!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }
        ) { projectV2Item { id } }
      }
    `,
    {
      projectId: project.id,
      itemId,
      fieldId: field.id,
      optionId,
    },
  );
}

function setProjectNumber(client, project, itemId, field, number) {
  return client.graphql(
    `
      mutation SetBootstrapNumber(
        $projectId: ID!,
        $itemId: ID!,
        $fieldId: ID!,
        $number: Float!
      ) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { number: $number }
          }
        ) { projectV2Item { id } }
      }
    `,
    {
      projectId: project.id,
      itemId,
      fieldId: field.id,
      number,
    },
  );
}

function addProjectItem(client, project, issue) {
  const data = client.graphql(
    `
      mutation AddBootstrapProjectItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(
          input: { projectId: $projectId, contentId: $contentId }
        ) { item { id } }
      }
    `,
    { projectId: project.id, contentId: issue.node_id },
  );
  const id = data?.addProjectV2ItemById?.item?.id;
  if (!nonEmptyString(id)) {
    throw new BootstrapError("Project add mutation did not return an item ID.");
  }
  return id;
}

function projectFieldSteps(item, project, config) {
  return [
    {
      key: "status",
      label: `${config.project.statusField}=${config.project.statusOptions.todo}`,
      run: (client, itemId) =>
        setProjectSingleSelect(
          client,
          project,
          itemId,
          project.fields.status,
          project.optionIds.status.todo,
        ),
    },
    {
      key: "priority",
      label: `Priority=${item.priority}`,
      run: (client, itemId) =>
        setProjectSingleSelect(
          client,
          project,
          itemId,
          project.fields.priority,
          project.optionIds.priority[item.priority],
        ),
    },
    {
      key: "phase",
      label: `Phase=${item.phase}`,
      run: (client, itemId) =>
        setProjectSingleSelect(
          client,
          project,
          itemId,
          project.fields.phase,
          project.optionIds.phase[item.phase],
        ),
    },
    {
      key: "order",
      label: `Order=${item.order}`,
      run: (client, itemId) =>
        setProjectNumber(
          client,
          project,
          itemId,
          project.fields.order,
          item.order,
        ),
    },
  ];
}

function preflight({
  client,
  manifest,
  config,
  repository,
  milestone,
  project,
  existingByKey,
}) {
  const existingDependencies = new Map();
  const conflicts = [];
  for (const item of manifest.items) {
    const issue = existingByKey.get(item.key);
    if (!issue) continue;
    const dependencyIssues = new Map();
    let missingPredecessor = null;
    for (const key of item.dependsOn) {
      const dependency = existingByKey.get(key);
      if (!dependency) {
        missingPredecessor = key;
      } else {
        dependencyIssues.set(key, dependency);
      }
    }
    if (missingPredecessor) {
      conflicts.push(
        `${item.key}: existing Issue #${issue.number} precedes missing dependency ${missingPredecessor}`,
      );
      continue;
    }
    const expectedBody = renderIssueBody(item, dependencyIssues);
    const openBlocker = [...dependencyIssues.values()].some(
      (dependency) => dependency.state === "open",
    );
    const desiredLabels = labelsForItem(item, config, openBlocker);
    const issueEvaluation = evaluateExistingIssue({
      issue,
      item,
      expectedBody,
      desiredLabels,
      milestoneNumber: milestone.number,
    });
    conflicts.push(
      ...issueEvaluation.conflicts.map((entry) => `${item.key}: ${entry}`),
    );
    const projectEvaluation = evaluateProjectItem(
      project.itemsByIssueNumber.get(issue.number),
      item,
      project,
      config,
    );
    conflicts.push(
      ...projectEvaluation.conflicts.map((entry) => `${item.key}: ${entry}`),
    );

    const blockers = readPaged(
      client,
      `repos/${repository.owner}/${repository.name}/issues/${issue.number}/dependencies/blocked_by`,
      `${item.key} blocked-by`,
    );
    const actual = nativeBlockerNumbers(blockers);
    const expected = [...dependencyIssues.values()]
      .map((dependency) => dependency.number)
      .sort((left, right) => left - right);
    const extra = actual.filter((number) => !expected.includes(number));
    if (extra.length > 0) {
      conflicts.push(
        `${item.key}: native blocked-by contains unmanaged Issue(s) ${extra.map((number) => `#${number}`).join(", ")}`,
      );
    }
    existingDependencies.set(item.key, { blockers, actual, expected });
  }
  if (conflicts.length > 0) {
    throw new BootstrapError(
      `Preflight found human-modified or conflicting state:\n- ${conflicts.join("\n- ")}`,
      {
        recovery: [
          "Resolve each conflict manually; this command does not overwrite content or managed state.",
          "Rerun apply --dry-run once after reconciliation.",
        ],
      },
    );
  }
  return existingDependencies;
}

function resolveLiveState(client, manifest, config) {
  const repository = parseRepository(client.repository());
  if (
    repository.nameWithOwner.toLowerCase() !== manifest.repository.toLowerCase() ||
    repository.nameWithOwner.toLowerCase() !== config.repository.toLowerCase()
  ) {
    throw new BootstrapError(
      `Repository mismatch: active=${repository.nameWithOwner}, manifest=${manifest.repository}, config=${config.repository}.`,
    );
  }
  if (
    config.project.owner !== manifest.project.owner ||
    config.project.number !== manifest.project.number
  ) {
    throw new BootstrapError(
      "Manifest Project owner/number must exactly match work-management.json.",
    );
  }
  const login = client.api("user")?.login;
  if (!nonEmptyString(login)) {
    throw new BootstrapError("The active gh account has no login.");
  }

  const labels = readPaged(
    client,
    `repos/${repository.owner}/${repository.name}/labels`,
    "labels",
  );
  const labelNames = new Set(labels.map((label) => label.name));
  const requiredLabels = new Set([
    config.labels.todo,
    config.labels.blocked,
    ...manifest.items.map((item) => item.type),
    ...manifest.items.flatMap((item) => item.areas),
  ]);
  const missingLabels = [...requiredLabels].filter(
    (label) => !labelNames.has(label),
  );
  if (missingLabels.length > 0) {
    throw new BootstrapError(
      `Missing required scoped label(s): ${missingLabels.join(", ")}.`,
      {
        recovery: [
          "Create the labels once, then rerun apply --dry-run.",
          "The bootstrap does not create or guess label metadata.",
        ],
      },
    );
  }

  const milestones = readPaged(
    client,
    `repos/${repository.owner}/${repository.name}/milestones?state=open`,
    "open milestones",
  ).filter((entry) => entry.title === manifest.milestone);
  if (milestones.length !== 1) {
    throw new BootstrapError(
      `Expected exactly one open milestone "${manifest.milestone}", found ${milestones.length}.`,
    );
  }
  const project = resolveProject(client, manifest, config, repository);
  const issues = readPaged(
    client,
    `repos/${repository.owner}/${repository.name}/issues?state=all`,
    "repository Issues",
  );
  const existingByKey = discoverExistingIssues(issues, manifest);
  const existingDependencies = preflight({
    client,
    manifest,
    config,
    repository,
    milestone: milestones[0],
    project,
    existingByKey,
  });
  return {
    repository,
    login,
    milestone: milestones[0],
    project,
    existingByKey,
    existingDependencies,
  };
}

function planItem(item, state, manifest, config) {
  const issue = state.existingByKey.get(item.key);
  const dependencyIssues = new Map(
    item.dependsOn
      .map((key) => [key, state.existingByKey.get(key)])
      .filter(([, dependency]) => Boolean(dependency)),
  );
  const hasOpenBlocker =
    item.dependsOn.length > 0 &&
    (dependencyIssues.size < item.dependsOn.length ||
      [...dependencyIssues.values()].some(
        (dependency) => dependency.state === "open",
      ));
  const labels = labelsForItem(item, config, hasOpenBlocker);
  const actions = [];
  if (!issue) {
    actions.push(`create Issue ${item.key} with milestone and labels`);
    actions.push(`add ${item.key} to Project "${state.project.title}"`);
    actions.push(
      ...projectFieldSteps(item, state.project, config).map(
        (step) => `set ${item.key} Project ${step.label}`,
      ),
    );
    actions.push(
      ...item.dependsOn.map(
        (key) => `link ${item.key} blocked by ${key} after Issue creation`,
      ),
    );
    return actions;
  }

  const body = renderIssueBody(item, dependencyIssues);
  const issueEvaluation = evaluateExistingIssue({
    issue,
    item,
    expectedBody: body,
    desiredLabels: labels,
    milestoneNumber: state.milestone.number,
  });
  for (const recovery of issueEvaluation.recover) {
    if (recovery.type === "add-labels") {
      actions.push(`add missing labels to ${item.key}: ${recovery.labels.join(", ")}`);
    } else if (recovery.type === "set-milestone") {
      actions.push(`set ${item.key} milestone to "${manifest.milestone}"`);
    }
  }
  const projectItem = state.project.itemsByIssueNumber.get(issue.number);
  const projectEvaluation = evaluateProjectItem(
    projectItem,
    item,
    state.project,
    config,
  );
  if (!projectItem) {
    actions.push(`add ${item.key} to Project "${state.project.title}"`);
    actions.push(
      ...projectFieldSteps(item, state.project, config).map(
        (step) => `set ${item.key} Project ${step.label}`,
      ),
    );
  } else {
    actions.push(
      ...projectFieldSteps(item, state.project, config)
        .filter((step) => projectEvaluation.missing.includes(step.key))
        .map((step) => `set ${item.key} Project ${step.label}`),
    );
  }
  const dependencyState = state.existingDependencies.get(item.key);
  for (const number of dependencyState.expected.filter(
    (entry) => !dependencyState.actual.includes(entry),
  )) {
    const key = item.dependsOn.find(
      (dependencyKey) => state.existingByKey.get(dependencyKey)?.number === number,
    );
    actions.push(`link ${item.key} blocked by ${key}`);
  }
  if (actions.length === 0) actions.push(`skip ${item.key}; exact state already exists`);
  return actions;
}

function applyCommand(options) {
  const manifestInfo = readJson(options.manifest, "manifest");
  const validation = validateManifest(manifestInfo.value);
  if (!validation.valid) {
    throw new BootstrapError(
      `Manifest validation failed:\n- ${validation.errors.join("\n- ")}`,
    );
  }
  const manifest = validation.manifest;
  const config = validateWorkflowConfig(
    readJson(options.config, "workflow config").value,
  );
  const client = new GitHubClient();
  let state;
  try {
    state = resolveLiveState(client, manifest, config);
  } catch (error) {
    const normalized =
      error instanceof BootstrapError
        ? error
        : new BootstrapError(error?.message || String(error));
    throw new BootstrapError(normalized.message, {
      completed: normalized.completed,
      recovery:
        normalized.recovery.length > 0
          ? normalized.recovery
          : [
              "Correct authentication, configuration, or the reported live GitHub state.",
              "Do not retry automatically; run one new apply --dry-run after correction.",
            ],
    });
  }
  const planned = manifest.items.flatMap((item) =>
    planItem(item, state, manifest, config),
  );
  if (options.dryRun) {
    return {
      command: "apply",
      dryRun: true,
      repository: state.repository.nameWithOwner,
      actor: state.login,
      project: state.project.title,
      milestone: state.milestone.title,
      items: manifest.items.length,
      existing: state.existingByKey.size,
      planned,
      writes: 0,
    };
  }

  const completed = [];
  const issuesByKey = new Map(state.existingByKey);
  const projectItemsByIssueNumber = new Map(state.project.itemsByIssueNumber);
  try {
    for (const item of manifest.items) {
      const dependencyIssues = new Map(
        item.dependsOn.map((key) => [key, issuesByKey.get(key)]),
      );
      const hasOpenBlocker = [...dependencyIssues.values()].some(
        (dependency) => dependency.state === "open",
      );
      const desiredLabels = labelsForItem(item, config, hasOpenBlocker);
      const body = renderIssueBody(item, dependencyIssues);
      let issue = issuesByKey.get(item.key);
      if (!issue) {
        issue = client.api(
          `repos/${state.repository.owner}/${state.repository.name}/issues`,
          {
            method: "POST",
            body: {
              title: item.title,
              body,
              milestone: state.milestone.number,
              labels: desiredLabels,
            },
          },
        );
        if (
          !Number.isInteger(issue?.number) ||
          !Number.isInteger(issue?.id) ||
          !nonEmptyString(issue?.node_id) ||
          issue.body !== body
        ) {
          throw new BootstrapError(
            `${item.key} create response is missing the exact Issue identity or body.`,
          );
        }
        issuesByKey.set(item.key, issue);
        completed.push(`created ${item.key} as Issue #${issue.number}`);
      } else {
        const evaluation = evaluateExistingIssue({
          issue,
          item,
          expectedBody: body,
          desiredLabels,
          milestoneNumber: state.milestone.number,
        });
        for (const recovery of evaluation.recover) {
          if (recovery.type === "add-labels") {
            client.api(
              `repos/${state.repository.owner}/${state.repository.name}/issues/${issue.number}/labels`,
              { method: "POST", body: { labels: recovery.labels } },
            );
            completed.push(
              `added missing labels to ${item.key}: ${recovery.labels.join(", ")}`,
            );
          } else if (recovery.type === "set-milestone") {
            client.api(
              `repos/${state.repository.owner}/${state.repository.name}/issues/${issue.number}`,
              { method: "PATCH", body: { milestone: state.milestone.number } },
            );
            completed.push(`set ${item.key} milestone`);
          }
        }
      }

      let projectItem = projectItemsByIssueNumber.get(issue.number);
      let projectItemId = projectItem?.id;
      let missingFields;
      if (!projectItem) {
        projectItemId = addProjectItem(client, state.project, issue);
        projectItem = { id: projectItemId };
        projectItemsByIssueNumber.set(issue.number, projectItem);
        completed.push(`added ${item.key} to Project "${state.project.title}"`);
        missingFields = ["status", "priority", "phase", "order"];
      } else {
        missingFields = evaluateProjectItem(
          projectItem,
          item,
          state.project,
          config,
        ).missing;
      }
      for (const step of projectFieldSteps(item, state.project, config)) {
        if (!missingFields.includes(step.key)) continue;
        step.run(client, projectItemId);
        completed.push(`set ${item.key} Project ${step.label}`);
      }

      const existingDependencyState = state.existingDependencies.get(item.key);
      const existingNumbers = new Set(existingDependencyState?.actual || []);
      for (const dependencyKey of item.dependsOn) {
        const blocker = issuesByKey.get(dependencyKey);
        if (existingNumbers.has(blocker.number)) continue;
        client.api(
          `repos/${state.repository.owner}/${state.repository.name}/issues/${issue.number}/dependencies/blocked_by`,
          {
            method: "POST",
            body: { issue_id: blocker.id },
          },
        );
        existingNumbers.add(blocker.number);
        completed.push(`linked ${item.key} blocked by ${dependencyKey}`);
      }
      if (
        !sameNumbers(
          [...existingNumbers].sort((left, right) => left - right),
          item.dependsOn
            .map((key) => issuesByKey.get(key).number)
            .sort((left, right) => left - right),
        )
      ) {
        throw new BootstrapError(
          `${item.key} dependency reconciliation did not reach the expected local state.`,
        );
      }
      if (
        !completed.some(
          (entry) =>
            entry.startsWith(`created ${item.key} `) ||
            entry.includes(`${item.key}`),
        )
      ) {
        completed.push(`skipped ${item.key}; exact state already existed`);
      }
    }

    const verifiedState = resolveLiveState(client, manifest, config);
    const residualActions = manifest.items.flatMap((item) =>
      planItem(item, verifiedState, manifest, config).filter(
        (action) => !action.startsWith(`skip ${item.key};`),
      ),
    );
    if (residualActions.length > 0) {
      throw new BootstrapError(
        `Post-apply verification found incomplete state:\n- ${residualActions.join("\n- ")}`,
      );
    }
    completed.push(
      `verified ${manifest.items.length} exact Issue, Project, label, milestone, and dependency states`,
    );
  } catch (error) {
    throw mutationFailure(error, completed);
  }

  return {
    command: "apply",
    dryRun: false,
    repository: state.repository.nameWithOwner,
    actor: state.login,
    project: state.project.title,
    milestone: state.milestone.title,
    items: manifest.items.length,
    completed,
    recovery:
      "If a later run is needed, inspect live state and run one apply --dry-run before one bounded apply.",
  };
}

function validateCommand(options) {
  const info = readJson(options.manifest, "manifest");
  const validation = validateManifest(info.value);
  return {
    command: "validate",
    manifest: info.path,
    valid: validation.valid,
    itemCount: Array.isArray(info.value?.items) ? info.value.items.length : 0,
    errors: validation.errors,
    enums: {
      type: ALLOWED_TYPES,
      area: ALLOWED_AREAS,
      priority: ALLOWED_PRIORITIES,
      phase: ALLOWED_PHASES,
    },
  };
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.command === "validate") {
    console.log(
      result.valid
        ? `VALID MVP MANIFEST (${result.itemCount} items)`
        : "INVALID MVP MANIFEST",
    );
    result.errors.forEach((error) => console.log(`- ${error}`));
    return;
  }
  console.log(
    `${result.dryRun ? "DRY RUN" : "APPLIED"} ${result.repository} (${result.items} items)`,
  );
  console.log(`Project: ${result.project}`);
  console.log(`Milestone: ${result.milestone}`);
  const entries = result.dryRun ? result.planned : result.completed;
  entries.forEach((entry) => console.log(`- ${entry}`));
  if (!result.dryRun) console.log(`Recovery: ${result.recovery}`);
}

function printError(error, json) {
  const normalized =
    error instanceof BootstrapError
      ? error
      : new BootstrapError(error?.message || String(error));
  const payload = {
    ok: false,
    error: normalized.message,
    completed: normalized.completed,
    recovery: normalized.recovery,
  };
  if (json) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.error(`MVP BOOTSTRAP FAILED: ${normalized.message}`);
  if (normalized.completed.length > 0) {
    console.error("Completed before failure:");
    normalized.completed.forEach((entry) => console.error(`- ${entry}`));
  }
  if (normalized.recovery.length > 0) {
    console.error("Recovery:");
    normalized.recovery.forEach((entry) => console.error(`- ${entry}`));
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    if (parsed.command === "help") {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result =
      parsed.command === "validate"
        ? validateCommand(parsed.options)
        : applyCommand(parsed.options);
    printResult(result, parsed.options.json);
    if (result.command === "validate" && !result.valid) process.exitCode = 1;
  } catch (error) {
    printError(error, parsed?.options?.json || false);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
