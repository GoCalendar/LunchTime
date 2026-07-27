#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  definedProductContractIds,
  visibleContractMarkdown,
} from "../../update-product-docs/scripts/product-contract-ids.mjs";

const DEFAULT_CONFIG_PATH = ".github/work-management.json";
const MAX_PAGES = 20;
const PAGE_SIZE = 100;
const STATUS_PREFIX = "status:";
const CHILD_PROCESS_TIMEOUT_MS = 30_000;
const WRITE_OR_HIGHER_PERMISSIONS = new Set(["write", "admin"]);
const CREATE_MARKER_PREFIX = "<!-- lunchtime-work-item:create";
const CREATE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const CREATE_PLAN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ISSUE_BODY_BYTES = 65_536;
const TOOLING_TRACE_PREFIX =
  "해당 없음 — 제품 동작·PRD·Policy 추적 대상이 아닌 도구 작업:";
const TOOLING_CREATE_MARKER_LINE_PATTERN =
  /^<!-- lunchtime-work-item:create key=[a-z0-9][a-z0-9-]{2,79} project=(?:required|none) -->$/;
const TOOLING_DEFAULT_IGNORABLE_PATTERN =
  /\p{Default_Ignorable_Code_Point}/u;
const RENDERED_CONTRACT_ID_PATTERN =
  /(?<![A-Za-z0-9_-])(?:PRD-\d{2,}-(?:FR|AC|SP)-\d{2,}|POL-\d{2,}-R-\d{2,})(?![A-Za-z0-9_-])/g;
const COLLECT_REFERENCE_PROJECTION_DIAGNOSTICS =
  process.env.NODE_ENV === "test" &&
  process.env.WORK_ITEM_TEST_PROJECTION_DIAGNOSTICS === "1";
let referenceProjectionOperations = 0;
const collaboratorPermissionCache = new Map();
const API_HEADERS = [
  "-H",
  "Accept: application/vnd.github+json",
  "-H",
  "X-GitHub-Api-Version: 2026-03-10",
];

class WorkItemError extends Error {
  constructor(message, { repair = [], completed = [] } = {}) {
    super(message);
    this.name = "WorkItemError";
    this.repair = repair;
    this.completed = completed;
  }
}

function usage() {
  return `사용법:
  work-item.mjs check <issue-number-or-url> [--repo OWNER/REPO] [--config PATH] [--json]
  work-item.mjs create --idempotency-key KEY --title TITLE --body FILE --milestone TITLE --label LABEL [--label LABEL...] [--blocked-by ISSUE...] [--project] [--repo OWNER/REPO] [--config PATH] --dry-run [--json]
  work-item.mjs create --idempotency-key KEY --title TITLE --body FILE --milestone TITLE --label LABEL [--label LABEL...] [--blocked-by ISSUE...] [--project] [--repo OWNER/REPO] [--config PATH] --confirm-plan TOKEN [--json]
  work-item.mjs start <issue-number-or-url> --branch NAME --agent MARKER [--repo OWNER/REPO] [--config PATH] [--dry-run] [--json]
  work-item.mjs complete <issue-number-or-url> --pr <pr-number-or-url> --head SHA [--repo OWNER/REPO] [--config PATH] [--dry-run] [--json]
  work-item.mjs release <issue-number-or-url> --branch NAME --agent MARKER --reason TEXT [--repo OWNER/REPO] [--config PATH] [--dry-run] [--json]
  work-item.mjs reconcile <issue-number-or-url> [--repo OWNER/REPO] [--config PATH] [--dry-run] [--json]
  work-item.mjs validate-body <file-or-> [--label LABEL...] [--json]

명령:
  check          준비 상태를 읽기 전용으로 확인합니다.
  create         검증된 개별 이슈를 미할당 Todo로 생성하거나 안전하게 재개합니다.
  start          준비된 이슈를 선점하고 In Progress로 옮깁니다.
  complete       풀 리퀘스트가 병합된 이슈를 완료 처리합니다.
  release        소유 중이며 병합되지 않은 선점을 Todo로 돌립니다.
  reconcile      안전한 Todo 이슈의 dependency:blocked를 열린 기본 선행 작업과 맞춥니다.
  validate-body  LunchTime 이슈 본문과 실제 type label의 결정적 계약을 검증합니다.

옵션:
  --branch NAME  시작 댓글에 기록할 작업 브랜치입니다.
  --agent VALUE  댓글에 기록할 안정적인 Codex/Claude 작업자 표식입니다.
  --pr VALUE     병합된 풀 리퀘스트 번호 또는 URL입니다.
  --head SHA     finalize가 검증한 정확한 40자리 PR head commit입니다.
  --reason TEXT  한 줄로 작성하는 필수 선점 해제 사유입니다.
  --idempotency-key KEY  개별 생성과 부분 실패 복구를 식별할 안정적인 키입니다.
  --title TEXT    생성할 이슈 제목입니다.
  --body PATH     생성 전 검증할 이슈 본문 파일입니다.
  --milestone TITLE  정확히 일치해야 하는 열린 milestone 제목입니다.
  --label NAME    create가 추가하거나 validate-body가 판정할 실제 type·area 등 비-workflow label입니다. 반복할 수 있습니다.
  --blocked-by ISSUE  연결할 GitHub 기본 선행 이슈입니다. 반복할 수 있습니다.
  --project       설정된 Project에 추가하고 Status를 Todo로 맞춥니다.
  --confirm-plan TOKEN  직전 dry-run이 출력한 create plan token입니다.
  --repo VALUE   저장소 탐색 결과 대신 사용할 OWNER/REPO입니다.
  --config PATH  설정 경로입니다. 기본값: ${DEFAULT_CONFIG_PATH}
  --dry-run      변경하지 않고 읽기와 예정된 쓰기만 출력합니다.
  --json         기계가 읽을 수 있는 JSON을 출력합니다.
  -h, --help     이 도움말을 표시합니다.

어떤 명령도 실패한 API 호출을 자동 재시도하지 않습니다. create 실제 쓰기에는 같은 입력의 dry-run token이 필요합니다. Project가 필요한 이슈의 start, complete, release에는 유효한 프로젝트 설정이 필요합니다.`;
}

function parseArgs(argv) {
  const result = {
    command: argv[0],
    positionals: [],
    options: {
      config: DEFAULT_CONFIG_PATH,
      dryRun: false,
      json: false,
      labels: [],
      blockedBy: [],
      project: false,
    },
  };

  if (argv[0] === "--help" || argv[0] === "-h") {
    result.command = "help";
    result.options.help = true;
    return result;
  }

  const valueOptions = new Map([
    ["--branch", "branch"],
    ["--agent", "agent"],
    ["--pr", "pr"],
    ["--head", "head"],
    ["--reason", "reason"],
    ["--idempotency-key", "idempotencyKey"],
    ["--title", "title"],
    ["--body", "body"],
    ["--milestone", "milestone"],
    ["--confirm-plan", "confirmPlan"],
    ["--repo", "repo"],
    ["--config", "config"],
  ]);
  const repeatedValueOptions = new Map([
    ["--label", "labels"],
    ["--blocked-by", "blockedBy"],
  ]);

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      result.options.dryRun = true;
    } else if (token === "--project") {
      result.options.project = true;
    } else if (token === "--json") {
      result.options.json = true;
    } else if (token === "--help" || token === "-h") {
      result.options.help = true;
    } else if (valueOptions.has(token) || repeatedValueOptions.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new WorkItemError(`${token} requires a value.`);
      }
      if (repeatedValueOptions.has(token)) {
        result.options[repeatedValueOptions.get(token)].push(value);
      } else {
        result.options[valueOptions.get(token)] = value;
      }
      index += 1;
    } else if (token.startsWith("--")) {
      throw new WorkItemError(`Unknown option: ${token}`);
    } else {
      result.positionals.push(token);
    }
  }

  return result;
}

function childProcessTimeoutMs() {
  if (process.env.NODE_ENV !== "test") return CHILD_PROCESS_TIMEOUT_MS;
  const requested = Number(process.env.WORK_ITEM_TEST_TIMEOUT_MS);
  return Number.isInteger(requested) && requested > 0
    ? requested
    : CHILD_PROCESS_TIMEOUT_MS;
}

function run(command, args, { input, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 10 * 1024 * 1024,
    timeout: childProcessTimeoutMs(),
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new WorkItemError(
        `${command} timed out after ${childProcessTimeoutMs()}ms.`,
        {
          repair: [
            "Inspect gh connectivity and GitHub availability before running one new bounded command.",
            "Do not retry in a loop.",
          ],
        },
      );
    }
    throw new WorkItemError(`Unable to execute ${command}: ${result.error.message}`, {
      repair: [`Install ${command} and ensure it is available on PATH.`],
    });
  }

  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new WorkItemError(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`,
      {
        repair: [
          "Inspect authentication, repository access, and the live GitHub object.",
          "Do not loop or retry until the reported cause is corrected.",
        ],
      },
    );
  }

  return result;
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkItemError(`Invalid JSON returned while ${context}.`, {
      repair: ["Run the corresponding gh api command manually and inspect its response."],
    });
  }
}

function ghApi(endpoint, { method = "GET", body } = {}) {
  const args = ["api", ...API_HEADERS];
  if (method !== "GET") {
    args.push("--method", method);
  }
  args.push(endpoint);
  if (body !== undefined) {
    args.push("--input", "-");
  }
  const result = run("gh", args, { input: body });
  if (!result.stdout.trim()) {
    return null;
  }
  return parseJson(result.stdout, `${method} ${endpoint}`);
}

function ghGraphql(query, variables = {}) {
  const response = ghApi("graphql", {
    method: "POST",
    body: { query, variables },
  });
  if (Array.isArray(response?.errors) && response.errors.length > 0) {
    throw new WorkItemError(
      `GraphQL failed: ${response.errors
        .map((error) => error.message)
        .join("; ")}`,
      {
        repair: [
          "Inspect gh authentication, Project authorization, and the configured owner and number.",
        ],
      },
    );
  }
  return response;
}

function loadConfig(path) {
  const absolute = resolve(process.cwd(), path);
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: absolute, exists: false, value: null };
    }
    throw new WorkItemError(`Cannot read config ${absolute}: ${error.message}`);
  }

  const value = parseJson(text, `reading ${absolute}`);
  return { path: absolute, exists: true, value };
}

function validateConfig(configInfo, { requireProject }) {
  if (!configInfo.exists) {
    if (requireProject) {
      throw new WorkItemError(`Missing workflow config: ${configInfo.path}`, {
        repair: [
          `Create ${DEFAULT_CONFIG_PATH} using references/work-item-lifecycle.md.`,
          "Run the command again with --dry-run before allowing mutations.",
        ],
      });
    }
    return null;
  }

  const config = configInfo.value;
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("root must be an object");
  }

  const repository = config?.repository;
  if (
    repository !== undefined &&
    (typeof repository !== "string" ||
      !/^[^/\s]+\/[^/\s]+$/.test(repository))
  ) {
    errors.push("repository must be OWNER/REPO");
  }

  const branch = config?.branch;
  if (!branch || typeof branch !== "object" || Array.isArray(branch)) {
    errors.push("branch must be an object");
  } else {
    if (!nonEmpty(branch.base) || !/^[A-Za-z0-9._/-]+$/.test(branch.base)) {
      errors.push("branch.base must be a valid branch name");
    }
    if (
      !nonEmpty(branch.prefix) ||
      !/^[a-z0-9][a-z0-9._/-]*\/$/.test(branch.prefix) ||
      branch.prefix.includes("..")
    ) {
      errors.push("branch.prefix must be a safe lowercase prefix ending in /");
    }
  }

  const project = config?.project;
  if (requireProject || project !== undefined) {
    if (!project || typeof project !== "object") {
      errors.push("project must be an object");
    } else {
      if (!nonEmpty(project.owner)) errors.push("project.owner is required");
      if (!Number.isInteger(project.number) || project.number < 1) {
        errors.push("project.number must be a positive integer");
      }
      if (!nonEmpty(project.statusField)) {
        errors.push("project.statusField is required");
      }
      for (const key of ["todo", "inProgress", "done"]) {
        if (!nonEmpty(project.statusOptions?.[key])) {
          errors.push(`project.statusOptions.${key} is required`);
        }
      }
    }
  }

  for (const key of ["todo", "inProgress", "done", "blocked"]) {
    if (!nonEmpty(config?.labels?.[key])) {
      errors.push(`labels.${key} is required`);
    }
  }
  const workflowLabels = [
    config?.labels?.todo,
    config?.labels?.inProgress,
    config?.labels?.done,
  ];
  if (
    workflowLabels.some(
      (label) => nonEmpty(label) && !label.startsWith(STATUS_PREFIX),
    )
  ) {
    errors.push("todo, inProgress, and done labels must start with status:");
  }
  if (
    workflowLabels.every(nonEmpty) &&
    new Set(workflowLabels).size !== workflowLabels.length
  ) {
    errors.push("todo, inProgress, and done labels must be distinct");
  }
  if (
    nonEmpty(config?.labels?.blocked) &&
    workflowLabels.includes(config.labels.blocked)
  ) {
    errors.push("labels.blocked must differ from workflow labels");
  }
  if (
    nonEmpty(config?.labels?.blocked) &&
    config.labels.blocked.startsWith(STATUS_PREFIX)
  ) {
    errors.push("labels.blocked must not start with status:");
  }
  const projectStatusNames = [
    project?.statusOptions?.todo,
    project?.statusOptions?.inProgress,
    project?.statusOptions?.done,
  ];
  if (
    projectStatusNames.every(nonEmpty) &&
    new Set(projectStatusNames).size !== projectStatusNames.length
  ) {
    errors.push("Project Todo, In Progress, and Done option names must be distinct");
  }
  if (
    !Number.isInteger(config?.maxInProgress) ||
    config.maxInProgress < 1 ||
    config.maxInProgress > 100
  ) {
    errors.push("maxInProgress must be an integer from 1 to 100");
  }

  if (errors.length > 0) {
    throw new WorkItemError(
      `Invalid workflow config ${configInfo.path}: ${errors.join("; ")}`,
      {
        repair: ["Correct the config schema documented in references/work-item-lifecycle.md."],
      },
    );
  }
  return config;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateWorkBranch(branch, issueNumber, config) {
  const expected = `${config.branch.prefix}issue-${issueNumber}-<short-slug>`;
  const pattern = new RegExp(
    `^${escapeRegex(config.branch.prefix)}issue-${issueNumber}-[a-z0-9]+(?:-[a-z0-9]+)*$`,
  );
  if (branch.length > 120 || !pattern.test(branch)) {
    throw new WorkItemError(
      `작업 브랜치는 ${expected} 형식이어야 합니다: ${branch}`,
      {
        repair: [
          `Trunk-Based Development 규칙에 맞는 짧은 브랜치명을 사용합니다. 예: ${config.branch.prefix}issue-${issueNumber}-menu-ack`,
          "브랜치명에 도구명, 작업자명, 대문자 또는 임시 상태를 넣지 않습니다.",
        ],
      },
    );
  }
}

function discoverRepository(override, config) {
  const candidate = override || config?.repository;
  if (candidate) {
    return parseRepository(candidate);
  }
  const result = run("gh", ["repo", "view", "--json", "nameWithOwner"]);
  const data = parseJson(result.stdout, "discovering the repository");
  return parseRepository(data.nameWithOwner);
}

function parseRepository(value) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value || "");
  if (!match) {
    throw new WorkItemError(`Repository must be OWNER/REPO, received: ${value}`);
  }
  return { owner: match[1], name: match[2], nameWithOwner: value };
}

function parseNumberOrUrl(value, kind, repository) {
  if (/^[1-9]\d*$/.test(value || "")) {
    return Number(value);
  }
  const pattern = new RegExp(
    `^https://github\\.com/${escapeRegex(repository.owner)}/${escapeRegex(
      repository.name,
    )}/${kind === "issue" ? "issues" : "pull"}/([1-9]\\d*)/?(?:[?#].*)?$`,
    "i",
  );
  const match = pattern.exec(value || "");
  if (!match) {
    throw new WorkItemError(
      `${kind} must be a positive number or a URL in ${repository.nameWithOwner}.`,
    );
  }
  return Number(match[1]);
}

function createMarker(key, projectRequired) {
  return `${CREATE_MARKER_PREFIX} key=${key} project=${projectRequired ? "required" : "none"} -->`;
}

function inspectCreateMarkers(body) {
  const source = body || "";
  const records = [];
  const pattern =
    /^<!-- lunchtime-work-item:create key=([a-z0-9][a-z0-9-]{2,79}) project=(required|none) -->$/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    records.push({
      key: match[1],
      projectRequired: match[2] === "required",
      marker: match[0],
    });
  }
  const reservedCount = source.split(CREATE_MARKER_PREFIX).length - 1;
  return {
    records,
    reservedCount,
    malformed: reservedCount !== records.length,
  };
}

function createMarkerRecords(body) {
  const inspected = inspectCreateMarkers(body);
  if (inspected.malformed) {
    throw new WorkItemError("Issue body contains a malformed create marker.", {
      repair: [
        "Do not edit or infer a malformed idempotency marker automatically.",
        "Inspect the Issue body and resolve the marker conflict manually.",
      ],
    });
  }
  if (inspected.records.length > 1) {
    throw new WorkItemError("Issue body contains multiple create markers.", {
      repair: [
        "Keep exactly one trusted create marker only after confirming Issue identity.",
      ],
    });
  }
  return inspected.records;
}

function creationMetadata(issue) {
  return createMarkerRecords(issue?.body || "")[0] || null;
}

function markerMentionsKey(body, key) {
  const markerPrefix = escapeRegex(CREATE_MARKER_PREFIX);
  const targetKey = escapeRegex(key);
  return new RegExp(
    `${markerPrefix}[^\\r\\n]*\\bkey=${targetKey}(?=\\s|-->)`,
  ).test(body || "");
}

function creationMetadataForKey(issue, key) {
  const body = issue?.body || "";
  const inspected = inspectCreateMarkers(body);
  const targetRecords = inspected.records.filter(
    (record) => record.key === key,
  );
  const targetMentioned =
    targetRecords.length > 0 || markerMentionsKey(body, key);

  if (!targetMentioned) return null;
  if (
    inspected.malformed ||
    inspected.records.length !== 1 ||
    targetRecords.length !== 1
  ) {
    throw createConflict(
      `idempotency key "${key}" has malformed or multiple create markers on #${issue.number}`,
    );
  }
  return targetRecords[0];
}

function trustedProjectOptOut(repository, issue, metadata) {
  if (metadata?.projectRequired !== false) return false;
  const creator = issue?.user?.login;
  return (
    nonEmpty(creator) &&
    collaboratorPermission(repository, creator).writeOrHigher
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentLogin() {
  const data = ghApi("user");
  if (!nonEmpty(data?.login)) {
    throw new WorkItemError("The active gh account has no login.");
  }
  return data.login;
}

function collaboratorPermission(repository, login) {
  const normalizedLogin = String(login || "").toLowerCase();
  if (!nonEmpty(normalizedLogin)) {
    throw new WorkItemError("Cannot verify an empty GitHub login.");
  }
  const cacheKey = `${repository.nameWithOwner.toLowerCase()}#${normalizedLogin}`;
  if (collaboratorPermissionCache.has(cacheKey)) {
    return collaboratorPermissionCache.get(cacheKey);
  }
  const data = ghApi(
    `repos/${repository.owner}/${repository.name}/collaborators/${encodeURIComponent(login)}/permission`,
  );
  const permission = data?.permission;
  if (!nonEmpty(permission)) {
    throw new WorkItemError(
      `Could not verify repository permission for @${login}.`,
      {
        repair: [
          "Confirm the active gh account can read repository collaborator permissions.",
          "Do not trust claim or release markers until permission verification succeeds.",
        ],
      },
    );
  }
  const result = {
    permission,
    writeOrHigher: WRITE_OR_HIGHER_PERMISSIONS.has(permission),
  };
  collaboratorPermissionCache.set(cacheKey, result);
  return result;
}

function ensureWriteOrHigher(repository, login, purpose) {
  const permission = collaboratorPermission(repository, login);
  if (!permission.writeOrHigher) {
    throw new WorkItemError(
      `@${login} has repository permission "${permission.permission}"; ${purpose} requires write-or-higher permission.`,
      {
        repair: [
          "Use a gh account with write or admin repository permission.",
        ],
      },
    );
  }
}

function issueEndpoint(repository, issueNumber, suffix = "") {
  return `repos/${repository.owner}/${repository.name}/issues/${issueNumber}${suffix}`;
}

function pullEndpoint(repository, prNumber) {
  return `repos/${repository.owner}/${repository.name}/pulls/${prNumber}`;
}

function getIssue(repository, issueNumber) {
  const issue = ghApi(issueEndpoint(repository, issueNumber));
  if (issue?.pull_request) {
    throw new WorkItemError(`#${issueNumber} is a pull request, not an Issue.`);
  }
  return issue;
}

function getPaged(repository, issueNumber, suffix) {
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = suffix.includes("?") ? "&" : "?";
    const response = ghApi(
      issueEndpoint(
        repository,
        issueNumber,
        `${suffix}${separator}per_page=${PAGE_SIZE}&page=${page}`,
      ),
    );
    if (!Array.isArray(response)) {
      throw new WorkItemError(`Expected a list from Issue ${suffix} endpoint.`, {
        repair: [
          "Confirm native Issue dependencies are enabled and gh can read them.",
        ],
      });
    }
    records.push(...response);
    if (response.length < PAGE_SIZE) return records;
  }
  throw new WorkItemError(
    `Pagination exceeded the safety limit of ${MAX_PAGES} pages for ${suffix}.`,
    {
      repair: [
        "Reduce or inspect the unusually large GitHub collection before rerunning.",
      ],
    },
  );
}

function getRepositoryPaged(repository, suffix, label) {
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = suffix.includes("?") ? "&" : "?";
    const response = ghApi(
      `repos/${repository.owner}/${repository.name}/${suffix}${separator}per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(response)) {
      throw new WorkItemError(`Expected a list while reading ${label}.`);
    }
    records.push(...response);
    if (response.length < PAGE_SIZE) return records;
  }
  throw new WorkItemError(
    `${label} pagination exceeded the safety limit of ${MAX_PAGES} pages.`,
  );
}

function getBlockers(repository, issueNumber) {
  return getPaged(repository, issueNumber, "/dependencies/blocked_by");
}

function getDependents(repository, issueNumber) {
  return getPaged(repository, issueNumber, "/dependencies/blocking");
}

function getComments(repository, issueNumber) {
  return getPaged(repository, issueNumber, "/comments");
}

const PROJECT_QUERY = `
  query WorkItemProject(
    $projectOwner: String!,
    $projectNumber: Int!,
    $repositoryOwner: String!,
    $repositoryName: String!,
    $issueNumber: Int!,
    $statusField: String!,
    $after: String
  ) {
    repositoryOwner(login: $projectOwner) {
      ... on Organization {
        projectV2(number: $projectNumber) {
          ...ProjectData
        }
      }
      ... on User {
        projectV2(number: $projectNumber) {
          ...ProjectData
        }
      }
    }
    repository(owner: $repositoryOwner, name: $repositoryName) {
      issue(number: $issueNumber) {
        id
        projectItems(first: 100) {
          nodes {
            id
            project { id }
            fieldValueByName(name: $statusField) {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
              }
            }
          }
        }
      }
    }
  }

  fragment ProjectData on ProjectV2 {
    id
    title
    fields(first: 100) {
      nodes {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        fieldValueByName(name: $statusField) {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            optionId
          }
        }
      }
    }
  }
`;

const PROJECT_ITEMS_QUERY = `
  query ProjectItems(
    $projectOwner: String!,
    $projectNumber: Int!,
    $statusField: String!,
    $after: String
  ) {
    repositoryOwner(login: $projectOwner) {
      ... on Organization {
        projectV2(number: $projectNumber) {
          ...ProjectItems
        }
      }
      ... on User {
        projectV2(number: $projectNumber) {
          ...ProjectItems
        }
      }
    }
  }

  fragment ProjectItems on ProjectV2 {
    id
    items(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        fieldValueByName(name: $statusField) {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            optionId
          }
        }
      }
    }
  }
`;

const CREATE_PROJECT_QUERY = `
  query WorkItemCreateProject(
    $projectOwner: String!,
    $projectNumber: Int!
  ) {
    repositoryOwner(login: $projectOwner) {
      ... on Organization {
        projectV2(number: $projectNumber) { ...CreateProjectData }
      }
      ... on User {
        projectV2(number: $projectNumber) { ...CreateProjectData }
      }
    }
  }

  fragment CreateProjectData on ProjectV2 {
    id
    title
    fields(first: 100) {
      nodes {
        ... on ProjectV2SingleSelectField {
          id
          name
          options { id name }
        }
      }
    }
  }
`;

function projectDefinition(project, config) {
  if (!project) {
    throw new WorkItemError(
      `Expected one Project ${config.project.owner}#${config.project.number}, found 0.`,
    );
  }
  const statusFields = project.fields.nodes.filter(
    (field) => field?.name === config.project.statusField,
  );
  if (statusFields.length !== 1) {
    throw new WorkItemError(
      `Expected one single-select field named "${config.project.statusField}", found ${statusFields.length}.`,
    );
  }
  const statusField = statusFields[0];
  const optionIds = {};
  for (const key of ["todo", "inProgress", "done"]) {
    const expectedName = config.project.statusOptions[key];
    const matches = statusField.options.filter(
      (option) => option.name === expectedName,
    );
    if (matches.length !== 1) {
      throw new WorkItemError(
        `Expected one Project status option "${expectedName}", found ${matches.length}.`,
      );
    }
    optionIds[key] = matches[0].id;
  }
  return {
    id: project.id,
    title: project.title,
    statusFieldId: statusField.id,
    optionIds,
  };
}

function resolveCreateProject(config, repository, issueNumber = null) {
  if (issueNumber === null) {
    const data = ghGraphql(CREATE_PROJECT_QUERY, {
      projectOwner: config.project.owner,
      projectNumber: config.project.number,
    })?.data;
    return {
      ...projectDefinition(data?.repositoryOwner?.projectV2, config),
      itemId: null,
      itemStatus: null,
    };
  }

  const data = ghGraphql(PROJECT_QUERY, {
    projectOwner: config.project.owner,
    projectNumber: config.project.number,
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    issueNumber,
    statusField: config.project.statusField,
    after: null,
  })?.data;
  const definition = projectDefinition(
    data?.repositoryOwner?.projectV2,
    config,
  );
  const issueItems = data?.repository?.issue?.projectItems?.nodes || [];
  const matchingItems = issueItems.filter(
    (item) => item.project?.id === definition.id,
  );
  if (matchingItems.length > 1) {
    throw new WorkItemError(
      `Issue #${issueNumber} appears more than once in Project "${definition.title}".`,
    );
  }
  return {
    ...definition,
    itemId: matchingItems[0]?.id || null,
    itemStatus: matchingItems[0]?.fieldValueByName?.name || null,
  };
}

function resolveProject(config, repository, issueNumber) {
  const variables = {
    projectOwner: config.project.owner,
    projectNumber: config.project.number,
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    issueNumber,
    statusField: config.project.statusField,
    after: null,
  };
  const first = ghGraphql(PROJECT_QUERY, variables)?.data;
  const projects = [first?.repositoryOwner?.projectV2].filter(Boolean);
  if (projects.length !== 1) {
    throw new WorkItemError(
      `Expected one Project ${config.project.owner}#${config.project.number}, found ${projects.length}.`,
      {
        repair: [
          "Check project.owner, project.number, visibility, and gh project authorization.",
        ],
      },
    );
  }

  const project = projects[0];
  const statusFields = project.fields.nodes.filter(
    (field) => field?.name === config.project.statusField,
  );
  if (statusFields.length !== 1) {
    throw new WorkItemError(
      `Expected one single-select field named "${config.project.statusField}", found ${statusFields.length}.`,
    );
  }
  const statusField = statusFields[0];
  const optionIds = {};
  for (const key of ["todo", "inProgress", "done"]) {
    const expectedName = config.project.statusOptions[key];
    const matches = statusField.options.filter(
      (option) => option.name === expectedName,
    );
    if (matches.length !== 1) {
      throw new WorkItemError(
        `Expected one Project status option "${expectedName}", found ${matches.length}.`,
      );
    }
    optionIds[key] = matches[0].id;
  }

  const issueItems = first?.repository?.issue?.projectItems?.nodes || [];
  const matchingItems = issueItems.filter((item) => item.project?.id === project.id);
  if (matchingItems.length !== 1) {
    throw new WorkItemError(
      `Issue #${issueNumber} must appear exactly once in Project "${project.title}", found ${matchingItems.length}.`,
      {
        repair: [
          "Add the Issue to the configured Project once and set its Status to Todo.",
        ],
      },
    );
  }

  const allItems = [...project.items.nodes];
  let pageInfo = project.items.pageInfo;
  let page = 1;
  while (pageInfo.hasNextPage && page < MAX_PAGES) {
    const next = ghGraphql(PROJECT_ITEMS_QUERY, {
      projectOwner: config.project.owner,
      projectNumber: config.project.number,
      statusField: config.project.statusField,
      after: pageInfo.endCursor,
    })?.data;
    const nextProjects = [next?.repositoryOwner?.projectV2].filter(Boolean);
    if (nextProjects.length !== 1 || nextProjects[0].id !== project.id) {
      throw new WorkItemError("Project changed while reading paginated items.");
    }
    allItems.push(...nextProjects[0].items.nodes);
    pageInfo = nextProjects[0].items.pageInfo;
    page += 1;
  }
  if (pageInfo.hasNextPage) {
    throw new WorkItemError(
      `Project pagination exceeded the safety limit of ${MAX_PAGES} pages.`,
    );
  }

  return {
    id: project.id,
    title: project.title,
    statusFieldId: statusField.id,
    optionIds,
    itemId: matchingItems[0].id,
    itemStatus: matchingItems[0].fieldValueByName?.name || null,
    inProgressCount: allItems.filter(
      (item) =>
        item.fieldValueByName?.name ===
        config.project.statusOptions.inProgress,
    ).length,
  };
}

function issueLabels(issue) {
  return issue.labels.map((label) =>
    typeof label === "string" ? label : label.name,
  );
}

function statusLabels(issue) {
  return issueLabels(issue).filter((label) => label.startsWith(STATUS_PREFIX));
}

function assigneeLogins(issue) {
  return (issue.assignees || []).map((assignee) => assignee.login);
}

function openIssueNumbers(issues) {
  return issues
    .filter((issue) => issue.state === "open")
    .map((issue) => issue.number)
    .sort((a, b) => a - b);
}

function collectReadiness({
  issue,
  blockers,
  project,
  config,
}) {
  const failures = [];
  const bodyValidation = validateIssueBody(
    issue.body || "",
    `Issue #${issue.number}`,
    { labels: issueLabels(issue) },
  );
  for (const error of bodyValidation.errors) {
    failures.push(`Issue body: ${error}`);
  }
  if (issue.state !== "open") {
    failures.push(`Issue is ${issue.state}, expected open.`);
  }

  const statuses = statusLabels(issue);
  if (
    statuses.length !== 1 ||
    statuses[0] !== config.labels.todo
  ) {
    failures.push(
      `Workflow labels are [${statuses.join(", ")}], expected exactly [${config.labels.todo}].`,
    );
  }

  const assignees = assigneeLogins(issue);
  if (assignees.length !== 0) {
    failures.push(`Issue already has assignee(s): ${assignees.join(", ")}.`);
  }

  const openBlockers = openIssueNumbers(blockers);
  if (openBlockers.length > 0) {
    failures.push(`Open native blockers: ${openBlockers.map((n) => `#${n}`).join(", ")}.`);
  }

  if (issueLabels(issue).includes(config.labels.blocked)) {
    failures.push(
      `Derived blocked label ${config.labels.blocked} is present; the Issue is not claimable.`,
    );
  }

  if (project && project.itemStatus !== config.project.statusOptions.todo) {
    failures.push(
      `Project Status is "${project.itemStatus}", expected "${config.project.statusOptions.todo}".`,
    );
  }
  if (project && project.inProgressCount >= config.maxInProgress) {
    failures.push(
      `Project has ${project.inProgressCount} In Progress item(s); limit is ${config.maxInProgress}.`,
    );
  }

  return {
    ready: failures.length === 0,
    failures,
    openBlockers,
    bodyErrors: bodyValidation.errors,
  };
}

function readContext(options, issueValue, { requireProject = true } = {}) {
  const configInfo = loadConfig(options.config);
  const baseConfig = validateConfig(configInfo, { requireProject: false });
  if (!baseConfig) {
    throw new WorkItemError(`Missing workflow config: ${configInfo.path}`);
  }
  const repository = discoverRepository(options.repo, baseConfig);
  const issueNumber = parseNumberOrUrl(issueValue, "issue", repository);
  const issue = getIssue(repository, issueNumber);
  const metadata = creationMetadata(issue);
  const projectOptOutTrusted = trustedProjectOptOut(
    repository,
    issue,
    metadata,
  );
  const projectRequired =
    requireProject && !projectOptOutTrusted;
  const config = projectRequired
    ? validateConfig(configInfo, { requireProject: true })
    : baseConfig;
  const blockers = getBlockers(repository, issueNumber);
  const project = projectRequired
    ? resolveProject(config, repository, issueNumber)
    : null;
  return {
    configInfo,
    config,
    repository,
    issueNumber,
    issue,
    blockers,
    project,
    projectRequired,
    creation: metadata
      ? { ...metadata, projectOptOutTrusted }
      : null,
  };
}

function readinessOutput(context) {
  const readiness = collectReadiness(context);
  const claimState = readClaimState(
    context.repository,
    context.issueNumber,
  );
  if (claimState.winner) {
    readiness.failures.push(
      `Active claim: branch=${claimState.winner.branch}, agent=${claimState.winner.agent}, login=@${claimState.winner.login}.`,
    );
    readiness.ready = false;
  }
  return {
    command: "check",
    repository: context.repository.nameWithOwner,
    issue: context.issueNumber,
    url: context.issue.html_url,
    title: context.issue.title,
    ready: readiness.ready,
    failures: readiness.failures,
    state: context.issue.state,
    workflowLabels: statusLabels(context.issue),
    assignees: assigneeLogins(context.issue),
    openBlockers: readiness.openBlockers,
    bodyErrors: readiness.bodyErrors,
    activeClaim: claimState.winner
      ? {
          branch: claimState.winner.branch,
          agent: claimState.winner.agent,
          login: claimState.winner.login,
          token: claimState.winner.token,
        }
      : null,
    project: context.project
      ? {
          required: true,
          title: context.project.title,
          status: context.project.itemStatus,
          inProgress: context.project.inProgressCount,
          maxInProgress: context.config.maxInProgress,
        }
      : {
          required: false,
          title: null,
          status: null,
          inProgress: null,
          maxInProgress: context.config.maxInProgress,
        },
  };
}

function ensureReady(context) {
  const result = readinessOutput(context);
  if (!result.ready) {
    throw new WorkItemError(
      `Issue #${context.issueNumber} is not claimable: ${result.failures.join(" ")}`,
      {
        repair: [
          "Run check and correct every listed precondition.",
          "Do not begin implementation until start completes and re-verifies.",
        ],
      },
    );
  }
  return result;
}

function ensureStartable(context, login, token, branch, agent) {
  const pristine = collectReadiness(context);
  const failures = [];
  const bodyValidation = validateIssueBody(
    context.issue.body || "",
    `Issue #${context.issueNumber}`,
    { labels: issueLabels(context.issue) },
  );
  for (const error of bodyValidation.errors) {
    failures.push(`Issue body: ${error}`);
  }
  const claimState = readClaimState(
    context.repository,
    context.issueNumber,
  );
  const winner = claimState.winner;
  const ownsWinner =
    winner?.token === token &&
    winner.branch === branch &&
    winner.agent === agent &&
    winner.login === login;
  if (winner && !ownsWinner) {
    failures.push(
      `Active claim belongs to branch=${winner.branch}, agent=${winner.agent}, login=@${winner.login}.`,
    );
  }
  if (!winner && pristine.ready && failures.length === 0) {
    return { claimState, ownsWinner: false };
  }

  const statuses = statusLabels(context.issue);
  const assignees = assigneeLogins(context.issue);
  const allowedStatuses = new Set([
    context.config.labels.todo,
    context.config.labels.inProgress,
  ]);
  const allowedProjectStatuses = context.project
    ? new Set([
        context.config.project.statusOptions.todo,
        context.config.project.statusOptions.inProgress,
      ])
    : null;

  if (context.issue.state !== "open") {
    failures.push(`Issue is ${context.issue.state}, expected open.`);
  }
  if (
    statuses.length < 1 ||
    statuses.some((status) => !allowedStatuses.has(status))
  ) {
    failures.push(
      `Workflow labels are [${statuses.join(", ")}], expected Todo or In Progress recovery state.`,
    );
  }
  if (
    assignees.length > 1 ||
    (assignees.length === 1 && assignees[0] !== login)
  ) {
    failures.push(
      `Issue is assigned to [${assignees.join(", ")}], not exclusively @${login}.`,
    );
  }
  const openBlockers = openIssueNumbers(context.blockers);
  if (openBlockers.length > 0) {
    failures.push(
      `Open native blockers: ${openBlockers.map((number) => `#${number}`).join(", ")}.`,
    );
  }
  if (issueLabels(context.issue).includes(context.config.labels.blocked)) {
    failures.push(`Derived blocked label ${context.config.labels.blocked} is present.`);
  }
  if (
    context.project &&
    !allowedProjectStatuses.has(context.project.itemStatus)
  ) {
    failures.push(
      `Project Status is "${context.project.itemStatus}", expected Todo or In Progress recovery state.`,
    );
  }
  const itemAlreadyInProgress =
    context.project?.itemStatus ===
    context.config.project?.statusOptions?.inProgress;
  const wouldExceedLimit =
    context.project &&
    (itemAlreadyInProgress
      ? context.project.inProgressCount > context.config.maxInProgress
      : context.project.inProgressCount >= context.config.maxInProgress);
  if (wouldExceedLimit) {
    failures.push(
      `Project has ${context.project.inProgressCount} In Progress item(s); limit is ${context.config.maxInProgress}.`,
    );
  }
  if (!ownsWinner) {
    failures.push("The requested claim token is not the active winning claim.");
  }

  if (failures.length > 0) {
    throw new WorkItemError(
      `Issue #${context.issueNumber} is not claimable: ${failures.join(" ")}`,
      {
        repair: [
          "Run check and inspect any partial start state.",
          "Only resume a partial transition owned by the active gh account.",
          "Do not begin implementation until start completes and re-verifies.",
        ],
      },
    );
  }
  return { claimState, ownsWinner };
}

function assertStartMutationBoundary(
  options,
  issueValue,
  login,
  token,
  branch,
  agent,
  epoch,
  stage,
) {
  const context = readContext(options, issueValue);
  const issue = context.issue;
  const validation = validateIssueBody(
    issue.body || "",
    `Issue #${context.issueNumber}`,
    { labels: issueLabels(issue) },
  );
  if (validation.errors.length > 0) {
    throw new WorkItemError(
      `Live Issue body/type label contract changed during start: ${validation.errors.join(" ")}`,
      {
        repair: [
          "Inspect the live Issue body and actual type labels before resuming start.",
          "Do not continue later start mutations while the live body contract is invalid.",
        ],
      },
    );
  }
  const { claimState, ownsWinner } = ensureStartable(
    context,
    login,
    token,
    branch,
    agent,
  );
  const failures = [];
  if (stage === "claim") {
    if (
      !ownsWinner &&
      (claimState.winner ||
        claimState.barrier !== epoch ||
        deriveClaimToken(
          context.repository,
          context.issueNumber,
          login,
          branch,
          agent,
          claimState.barrier,
        ) !== token)
    ) {
      failures.push(
        "The unclaimed Issue no longer has the exact claim generation used by this start command.",
      );
    }
  } else if (!ownsWinner) {
    failures.push("The requested claim token is not the exact active winning claim.");
  }

  const assignees = assigneeLogins(issue);
  if (
    ["add-in-progress", "remove-todo", "project"].includes(stage) &&
    (assignees.length !== 1 || assignees[0] !== login)
  ) {
    failures.push(
      `Assignee recovery has not reached exclusive ownership by @${login}: [${assignees.join(", ")}].`,
    );
  }

  const statuses = statusLabels(issue);
  if (
    ["remove-todo", "project"].includes(stage) &&
    !statuses.includes(context.config.labels.inProgress)
  ) {
    failures.push(
      `Workflow-label recovery has not added ${context.config.labels.inProgress}: [${statuses.join(", ")}].`,
    );
  }
  if (
    stage === "project" &&
    (statuses.length !== 1 ||
      statuses[0] !== context.config.labels.inProgress)
  ) {
    failures.push(
      `Workflow-label recovery has not reached exactly [${context.config.labels.inProgress}]: [${statuses.join(", ")}].`,
    );
  }

  if (failures.length > 0) {
    throw new WorkItemError(
      `Start mutation boundary changed before ${stage}: ${failures.join(" ")}`,
      {
        repair: [
          "Run check and inspect the exact winning claim and partial start state.",
          "Do not continue later start mutations until the live state is reconciled.",
        ],
      },
    );
  }
  return context;
}

function updateIssue(repository, issueNumber, body) {
  return ghApi(issueEndpoint(repository, issueNumber), {
    method: "PATCH",
    body,
  });
}

function addLabel(repository, issueNumber, label) {
  ghApi(issueEndpoint(repository, issueNumber, "/labels"), {
    method: "POST",
    body: { labels: [label] },
  });
}

function removeLabel(repository, issueNumber, label) {
  ghApi(
    issueEndpoint(
      repository,
      issueNumber,
      `/labels/${encodeURIComponent(label)}`,
    ),
    { method: "DELETE" },
  );
}

function transitionWorkflowLabel(repository, issueNumber, targetLabel) {
  let issue = getIssue(repository, issueNumber);
  let labels = issueLabels(issue);
  if (!labels.includes(targetLabel)) {
    addLabel(repository, issueNumber, targetLabel);
    issue = getIssue(repository, issueNumber);
    labels = issueLabels(issue);
  }
  for (const label of labels) {
    if (label.startsWith(STATUS_PREFIX) && label !== targetLabel) {
      removeLabel(repository, issueNumber, label);
    }
  }
}

function setLabelPresence(repository, issueNumber, label, present) {
  const issue = getIssue(repository, issueNumber);
  const hasLabel = issueLabels(issue).includes(label);
  if (present && !hasLabel) {
    addLabel(repository, issueNumber, label);
  } else if (!present && hasLabel) {
    removeLabel(repository, issueNumber, label);
  }
}

function updateProjectStatus(project, optionId) {
  const mutation = `
    mutation UpdateStatus(
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
      ) {
        projectV2Item { id }
      }
    }
  `;
  ghGraphql(mutation, {
    projectId: project.id,
    itemId: project.itemId,
    fieldId: project.statusFieldId,
    optionId,
  });
}

function addIssueToProject(project, issueNodeId) {
  const mutation = `
    mutation AddWorkItemToProject($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(
        input: { projectId: $projectId, contentId: $contentId }
      ) {
        item { id }
      }
    }
  `;
  const response = ghGraphql(mutation, {
    projectId: project.id,
    contentId: issueNodeId,
  });
  const itemId = response?.data?.addProjectV2ItemById?.item?.id;
  if (!nonEmpty(itemId)) {
    throw new WorkItemError("Project add mutation did not return an item ID.");
  }
  return itemId;
}

function addNativeBlocker(repository, issueNumber, blockerId) {
  ghApi(issueEndpoint(repository, issueNumber, "/dependencies/blocked_by"), {
    method: "POST",
    body: { issue_id: blockerId },
  });
}

function firstCommentLine(comment) {
  return (comment.body || "").split(/\r?\n/, 1)[0].trim();
}

function exactCommentExists(repository, issueNumber, body, login) {
  return getComments(repository, issueNumber).some(
    (comment) =>
      comment.body === body &&
      (!login || comment.user?.login === login),
  );
}

function trustedMarkerComments(repository, comments, markerPattern) {
  return comments.filter((comment) => {
    if (!markerPattern.test(firstCommentLine(comment))) return false;
    const login = comment.user?.login;
    return nonEmpty(login) && collaboratorPermission(repository, login).writeOrHigher;
  });
}

function addCommentOnceExact(repository, issueNumber, body, login) {
  if (exactCommentExists(repository, issueNumber, body, login)) {
    return false;
  }
  ghApi(issueEndpoint(repository, issueNumber, "/comments"), {
    method: "POST",
    body: { body },
  });
  return true;
}

function deriveClaimToken(repository, issueNumber, login, branch, agent, epoch) {
  return createHash("sha256")
    .update(
      [
        repository.nameWithOwner.toLowerCase(),
        String(issueNumber),
        login.toLowerCase(),
        branch,
        agent,
        String(epoch),
      ].join("\n"),
    )
    .digest("hex");
}

function startCommentBody(issueNumber, epoch, token, branch, agent, login) {
  return [
    `<!-- lunchtime-work-item:start issue=${issueNumber} epoch=${epoch} token=${token} -->`,
    "작업을 시작합니다.",
    "",
    `- Branch: \`${branch}\``,
    `- Agent: \`${agent}\``,
    `- Assignee: @${login}`,
  ].join("\n");
}

function releaseCommentBody(issueNumber, epoch, token, branch, agent, login, reason) {
  return [
    `<!-- lunchtime-work-item:release issue=${issueNumber} epoch=${epoch} token=${token} -->`,
    "작업 선점을 해제합니다.",
    "",
    `- Branch: \`${branch}\``,
    `- Agent: \`${agent}\``,
    `- Released by: @${login}`,
    `- Reason: ${reason}`,
  ].join("\n");
}

function parseStartClaim(comment, issueNumber) {
  const body = comment.body || "";
  const pattern = new RegExp(
    `^<!-- lunchtime-work-item:start issue=${issueNumber} epoch=([1-9]\\d*|0) token=([a-f0-9]{64}) -->\\n` +
      "작업을 시작합니다\\.\\n\\n" +
      "- Branch: `([^`\\r\\n]+)`\\n" +
      "- Agent: `([^`\\r\\n]+)`\\n" +
      "- Assignee: @([A-Za-z0-9-]+)$",
  );
  const match = pattern.exec(body);
  if (!match || comment.user?.login !== match[5]) return null;
  return {
    id: Number(comment.id),
    epoch: Number(match[1]),
    token: match[2],
    branch: match[3],
    agent: match[4],
    login: match[5],
    comment,
  };
}

function parseReleaseMarker(comment, issueNumber) {
  const body = comment.body || "";
  const pattern = new RegExp(
    `^<!-- lunchtime-work-item:release issue=${issueNumber} epoch=([1-9]\\d*|0) token=([a-f0-9]{64}) -->\\n` +
      "작업 선점을 해제합니다\\.\\n\\n" +
      "- Branch: `([^`\\r\\n]+)`\\n" +
      "- Agent: `([^`\\r\\n]+)`\\n" +
      "- Released by: @([A-Za-z0-9-]+)\\n" +
      "- Reason: ([^\\r\\n]{1,500})$",
  );
  const match = pattern.exec(body);
  if (!match || comment.user?.login !== match[5]) return null;
  return {
    id: Number(comment.id),
    epoch: Number(match[1]),
    token: match[2],
    branch: match[3],
    agent: match[4],
    login: match[5],
    reason: match[6],
    comment,
  };
}

function claimStateFromComments(comments, issueNumber, isTrustedMarkerAuthor) {
  const ordered = [...comments].sort(
    (left, right) => Number(left.id) - Number(right.id),
  );
  const claims = [];
  const releases = [];
  let winner = null;
  let barrier = 0;
  for (const comment of ordered) {
    const claim = parseStartClaim(comment, issueNumber);
    if (claim && isTrustedMarkerAuthor(claim.login)) {
      claims.push(claim);
      if (!winner && claim.epoch === barrier) winner = claim;
      continue;
    }
    const release = parseReleaseMarker(comment, issueNumber);
    if (
      release &&
      isTrustedMarkerAuthor(release.login) &&
      winner &&
      release.epoch === barrier &&
      release.epoch === winner.epoch &&
      release.token === winner.token &&
      release.branch === winner.branch &&
      release.agent === winner.agent &&
      release.login === winner.login
    ) {
      releases.push(release);
      barrier = release.id;
      winner = null;
    }
  }
  return {
    barrier,
    claims,
    winner,
    releases,
  };
}

function readClaimState(repository, issueNumber) {
  const trustedLogins = new Map();
  const isTrustedMarkerAuthor = (login) => {
    const normalized = login.toLowerCase();
    if (!trustedLogins.has(normalized)) {
      trustedLogins.set(
        normalized,
        collaboratorPermission(repository, login).writeOrHigher,
      );
    }
    return trustedLogins.get(normalized);
  };
  return claimStateFromComments(
    getComments(repository, issueNumber),
    issueNumber,
    isTrustedMarkerAuthor,
  );
}

function assertWinningClaim(
  repository,
  issueNumber,
  { token, branch, agent, login },
) {
  const state = readClaimState(repository, issueNumber);
  const winner = state.winner;
  if (
    !winner ||
    winner.token !== token ||
    winner.branch !== branch ||
    winner.agent !== agent ||
    winner.login !== login
  ) {
    const owner = winner
      ? `branch=${winner.branch}, agent=${winner.agent}, login=@${winner.login}`
      : "no active claim";
    throw new WorkItemError(`Claim lost; current winner is ${owner}.`, {
      repair: [
        "Stop this worker. Do not edit files or create a competing branch.",
        "Use check to inspect the active owner.",
      ],
    });
  }
  return winner;
}

function mutateOrPlan({
  dryRun,
  planned,
  completed,
  description,
  alreadyDone,
  action,
}) {
  if (alreadyDone) {
    completed.push(`${description} (already satisfied)`);
    return;
  }
  if (dryRun) {
    planned.push(description);
    return;
  }
  action();
  completed.push(description);
}

function requireCreateOption(options, name) {
  const value = options[name];
  if (!nonEmpty(value)) {
    const flag = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    throw new WorkItemError(`create requires --${flag} VALUE.`);
  }
  return value.trim();
}

function normalizeIssueTitle(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function readCreateInput(parsed) {
  if (parsed.positionals.length > 0) {
    throw new WorkItemError(
      `create does not accept positional arguments: ${parsed.positionals[0]}`,
    );
  }
  const key = requireCreateOption(parsed.options, "idempotencyKey");
  if (!CREATE_KEY_PATTERN.test(key)) {
    throw new WorkItemError(
      "--idempotency-key must be 3-80 lowercase letters, numbers, or hyphens and start with a letter or number.",
    );
  }
  const title = requireCreateOption(parsed.options, "title");
  if (
    title.length < 4 ||
    title.length > 160 ||
    /[\r\n]/.test(title) ||
    title.includes(CREATE_MARKER_PREFIX)
  ) {
    throw new WorkItemError(
      "--title must be one meaningful line of 4-160 characters without a create marker.",
    );
  }
  const labels = parsed.options.labels.map((label) => label.trim());
  if (labels.length === 0) {
    throw new WorkItemError("create requires at least one --label NAME.");
  }
  if (labels.length > 50 || new Set(labels).size !== labels.length) {
    throw new WorkItemError(
      "--label values must be unique and no more than 50.",
    );
  }
  for (const label of labels) {
    if (
      !nonEmpty(label) ||
      label.length > 100 ||
      /[\r\n]/.test(label) ||
      label.startsWith(STATUS_PREFIX) ||
      label === "dependency:blocked"
    ) {
      throw new WorkItemError(
        `Invalid --label "${label}". Workflow and dependency labels are derived by create.`,
      );
    }
  }
  const source = requireCreateOption(parsed.options, "body");
  let rawBody;
  try {
    rawBody = readFileSync(resolve(process.cwd(), source), "utf8");
  } catch (error) {
    throw new WorkItemError(`Cannot read Issue body ${source}: ${error.message}`);
  }
  if (rawBody.includes(CREATE_MARKER_PREFIX)) {
    throw new WorkItemError(
      "The input body must not contain a reserved create marker.",
    );
  }
  const validation = validateIssueBody(rawBody, source, { labels });
  if (validation.errors.length > 0) {
    throw new WorkItemError(
      `Issue body validation failed:\n- ${validation.errors.join("\n- ")}`,
    );
  }
  const milestone = requireCreateOption(parsed.options, "milestone");
  if (milestone.length > 100 || /[\r\n]/.test(milestone)) {
    throw new WorkItemError(
      "--milestone must be one exact title no longer than 100 characters.",
    );
  }
  const blockedBy = parsed.options.blockedBy.map((value) => value.trim());
  if (
    blockedBy.length > 50 ||
    new Set(blockedBy).size !== blockedBy.length
  ) {
    throw new WorkItemError(
      "--blocked-by values must be unique and no more than 50.",
    );
  }
  if (parsed.options.dryRun && parsed.options.confirmPlan) {
    throw new WorkItemError(
      "--confirm-plan is not valid with --dry-run; use the token printed by dry-run in a new create command.",
    );
  }
  if (
    !parsed.options.dryRun &&
    !CREATE_PLAN_PATTERN.test(parsed.options.confirmPlan || "")
  ) {
    throw new WorkItemError(
      "create mutation requires --confirm-plan TOKEN from a fresh create --dry-run.",
      {
        repair: [
          "Run the same create command with --dry-run and inspect every planned write.",
          "Invoke one new create command with the returned plan token.",
        ],
      },
    );
  }
  const marker = createMarker(key, parsed.options.project);
  const body = `${marker}\n\n${rawBody.trim()}`;
  if (Buffer.byteLength(body, "utf8") > MAX_ISSUE_BODY_BYTES) {
    throw new WorkItemError(
      `Rendered Issue body exceeds GitHub's ${MAX_ISSUE_BODY_BYTES}-byte limit.`,
    );
  }
  return {
    key,
    title,
    source,
    rawBody,
    body,
    bodyHash: createHash("sha256").update(body).digest("hex"),
    milestone,
    labels,
    blockedBy,
    projectRequested: parsed.options.project,
  };
}

function createConflict(message) {
  return new WorkItemError(`Create preflight conflict: ${message}`, {
    repair: [
      "Do not overwrite or delete the existing Issue or managed state automatically.",
      "Inspect the exact Issue, marker, labels, milestone, dependencies, and Project state.",
      "After resolving the conflict, run one new create --dry-run.",
    ],
  });
}

function resolveCreateState(parsed, input) {
  const configInfo = loadConfig(parsed.options.config);
  const config = validateConfig(configInfo, {
    requireProject: input.projectRequested,
  });
  if (!config) {
    throw new WorkItemError(`Missing workflow config: ${configInfo.path}`);
  }
  const repository = discoverRepository(parsed.options.repo, config);
  const login = currentLogin();
  ensureWriteOrHigher(repository, login, "create");

  const repositoryLabels = new Set(
    getRepositoryPaged(repository, "labels", "repository labels").map(
      (label) => label.name,
    ),
  );
  const blockerIssues = input.blockedBy.map((value) => {
    const number = parseNumberOrUrl(value, "issue", repository);
    const issue = getIssue(repository, number);
    if (!Number.isInteger(issue?.id)) {
      throw createConflict(`blocker #${number} lacks a stable REST Issue id`);
    }
    return issue;
  });
  const blockerNumbers = blockerIssues.map((issue) => issue.number);
  if (new Set(blockerNumbers).size !== blockerNumbers.length) {
    throw new WorkItemError(
      "--blocked-by values resolve to duplicate Issue numbers.",
    );
  }
  const hasOpenBlocker = blockerIssues.some((issue) => issue.state === "open");
  const desiredLabels = [
    config.labels.todo,
    ...input.labels,
    ...(hasOpenBlocker ? [config.labels.blocked] : []),
  ].sort();
  const missingRepositoryLabels = desiredLabels.filter(
    (label) => !repositoryLabels.has(label),
  );
  if (missingRepositoryLabels.length > 0) {
    throw new WorkItemError(
      `Missing repository label(s): ${missingRepositoryLabels.join(", ")}.`,
      {
        repair: [
          "Create or correct label metadata separately; create does not guess labels.",
        ],
      },
    );
  }

  const milestones = getRepositoryPaged(
    repository,
    "milestones?state=open",
    "open milestones",
  ).filter((milestone) => milestone.title === input.milestone);
  if (milestones.length !== 1) {
    throw new WorkItemError(
      `Expected exactly one open milestone "${input.milestone}", found ${milestones.length}.`,
    );
  }
  const milestone = milestones[0];

  const issues = getRepositoryPaged(
    repository,
    "issues?state=all",
    "repository Issues",
  ).filter((issue) => !issue.pull_request);
  const matches = [];
  for (const issue of issues) {
    const metadata = creationMetadataForKey(issue, input.key);
    if (metadata?.key === input.key) matches.push(issue);
  }
  if (matches.length > 1) {
    throw createConflict(
      `idempotency key "${input.key}" appears on ${matches
        .map((issue) => `#${issue.number}`)
        .join(", ")}`,
    );
  }
  let issue = matches[0] || null;
  if (!issue) {
    const titleMatches = issues.filter(
      (candidate) =>
        normalizeIssueTitle(candidate.title || "") ===
        normalizeIssueTitle(input.title),
    );
    if (titleMatches.length > 0) {
      throw createConflict(
        `the same normalized title already exists on ${titleMatches
          .map((candidate) => `#${candidate.number}`)
          .join(", ")} without this idempotency key`,
      );
    }
  }

  const missingLabels = [];
  const staleDerivedLabels = [];
  let missingMilestone = false;
  let existingBlockerNumbers = [];
  const missingBlockers = [];
  let project = null;
  let projectMissing = false;
  let projectStatusMissing = false;

  if (issue) {
    const metadata = creationMetadata(issue);
    const conflicts = [];
    const creator = issue.user?.login;
    if (
      !nonEmpty(creator) ||
      !collaboratorPermission(repository, creator).writeOrHigher
    ) {
      conflicts.push(
        "Issue create marker author does not have repository write permission",
      );
    }
    if (metadata?.projectRequired !== input.projectRequested) {
      conflicts.push("create marker Project mode differs");
    }
    if (issue.state !== "open") conflicts.push(`state is ${issue.state}`);
    if (issue.title !== input.title) conflicts.push("title differs");
    if (issue.body !== input.body) conflicts.push("body differs");
    if (assigneeLogins(issue).length !== 0) {
      conflicts.push(
        `assignees are [${assigneeLogins(issue).join(", ")}], expected none`,
      );
    }
    if (issue.milestone?.number === milestone.number) {
      // Exact.
    } else if (issue.milestone == null) {
      missingMilestone = true;
    } else {
      conflicts.push(
        `milestone is #${issue.milestone.number}, expected #${milestone.number}`,
      );
    }
    const existingLabels = issueLabels(issue);
    const desired = new Set(desiredLabels);
    const unexpectedLabels = existingLabels.filter(
      (label) => !desired.has(label),
    );
    const staleBlocked = unexpectedLabels.includes(config.labels.blocked)
      ? [config.labels.blocked]
      : [];
    staleDerivedLabels.push(...staleBlocked);
    const conflictingLabels = unexpectedLabels.filter(
      (label) => !staleBlocked.includes(label),
    );
    if (conflictingLabels.length > 0) {
      conflicts.push(
        `unexpected label(s) differ from the exact request: ${conflictingLabels.join(", ")}`,
      );
    }
    missingLabels.push(
      ...desiredLabels.filter((label) => !existingLabels.includes(label)),
    );

    const currentBlockers = getBlockers(repository, issue.number);
    existingBlockerNumbers = currentBlockers
      .map((blocker) => blocker.number)
      .sort((left, right) => left - right);
    const expectedBlockerNumbers = [...blockerNumbers].sort(
      (left, right) => left - right,
    );
    const extraBlockers = existingBlockerNumbers.filter(
      (number) => !expectedBlockerNumbers.includes(number),
    );
    if (extraBlockers.length > 0) {
      conflicts.push(
        `native blocked-by contains unexpected Issue(s) ${extraBlockers
          .map((number) => `#${number}`)
          .join(", ")}`,
      );
    }
    missingBlockers.push(
      ...expectedBlockerNumbers.filter(
        (number) => !existingBlockerNumbers.includes(number),
      ),
    );
    if (input.projectRequested) {
      project = resolveCreateProject(config, repository, issue.number);
      if (!project.itemId) {
        projectMissing = true;
        projectStatusMissing = true;
      } else if (project.itemStatus == null) {
        projectStatusMissing = true;
      } else if (
        project.itemStatus !== config.project.statusOptions.todo
      ) {
        conflicts.push(
          `Project Status is "${project.itemStatus}", expected "${config.project.statusOptions.todo}"`,
        );
      }
    }
    if (conflicts.length > 0) {
      throw createConflict(
        `Issue #${issue.number} differs from the requested target: ${conflicts.join("; ")}`,
      );
    }
  } else if (input.projectRequested) {
    project = resolveCreateProject(config, repository);
    projectMissing = true;
    projectStatusMissing = true;
    missingBlockers.push(...blockerNumbers);
  } else {
    missingBlockers.push(...blockerNumbers);
  }

  const planned = [];
  if (!issue) {
    planned.push(
      `create unassigned Issue with milestone "${milestone.title}" and labels [${desiredLabels.join(", ")}]`,
    );
  } else {
    if (missingLabels.length > 0) {
      planned.push(
        `add missing labels to Issue #${issue.number}: ${missingLabels.join(", ")}`,
      );
    }
    if (missingMilestone) {
      planned.push(
        `set Issue #${issue.number} milestone to "${milestone.title}"`,
      );
    }
    if (staleDerivedLabels.length > 0) {
      planned.push(
        `remove stale derived labels from Issue #${issue.number}: ${staleDerivedLabels.join(", ")}`,
      );
    }
  }
  if (input.projectRequested && projectMissing) {
    planned.push(`add Issue to Project "${project.title}"`);
  }
  if (input.projectRequested && projectStatusMissing) {
    planned.push(
      `set Project "${project.title}" Status to ${config.project.statusOptions.todo}`,
    );
  }
  for (const number of missingBlockers) {
    planned.push(`link Issue blocked by #${number}`);
  }
  if (planned.length === 0) {
    planned.push(`skip Issue #${issue.number}; exact create state already exists`);
  }

  const planToken = createHash("sha256")
    .update(
      JSON.stringify({
        repository: repository.nameWithOwner.toLowerCase(),
        key: input.key,
        title: input.title,
        bodyHash: input.bodyHash,
        milestone: milestone.number,
        labels: desiredLabels,
        blockerNumbers: [...blockerNumbers].sort(
          (left, right) => left - right,
        ),
        projectRequested: input.projectRequested,
        issueNumber: issue?.number || null,
        planned,
      }),
    )
    .digest("hex");

  return {
    config,
    repository,
    login,
    input,
    milestone,
    desiredLabels,
    blockerIssues,
    blockerNumbers,
    issue,
    missingLabels,
    staleDerivedLabels,
    missingMilestone,
    missingBlockers,
    project,
    projectMissing,
    projectStatusMissing,
    planned,
    planToken,
  };
}

function createMutationError(error, completed, state) {
  const normalized =
    error instanceof WorkItemError
      ? error
      : new WorkItemError(error?.message || String(error));
  const issueReference = state.issue?.number
    ? `Issue #${state.issue.number}`
    : `create key "${state.input.key}"`;
  return new WorkItemError(normalized.message, {
    completed: [...completed, ...normalized.completed],
    repair: [
      ...normalized.repair,
      `Inspect ${issueReference} and live label, milestone, dependency, assignee, and Project state.`,
      "Do not retry automatically and do not delete or overwrite a partially created Issue.",
      "After correcting the cause, run one new create --dry-run with the same idempotency key.",
    ],
  });
}

function createCommand(parsed) {
  const input = readCreateInput(parsed);
  const state = resolveCreateState(parsed, input);
  if (parsed.options.dryRun) {
    return {
      command: "create",
      dryRun: true,
      repository: state.repository.nameWithOwner,
      actor: state.login,
      idempotencyKey: input.key,
      bodyHash: input.bodyHash,
      milestone: state.milestone.title,
      labels: state.desiredLabels,
      blockedBy: state.blockerNumbers,
      project: input.projectRequested ? state.project.title : null,
      existingIssue: state.issue?.number || null,
      planToken: state.planToken,
      planned: state.planned,
      writes: 0,
    };
  }
  if (parsed.options.confirmPlan !== state.planToken) {
    throw new WorkItemError(
      "Create plan changed after dry-run or --confirm-plan does not match.",
      {
        repair: [
          "Do not use a stale token.",
          "Run one new create --dry-run, inspect the live plan, and use its token once.",
        ],
      },
    );
  }

  const completed = [];
  let issue = state.issue;
  try {
    if (!issue) {
      issue = ghApi(
        `repos/${state.repository.owner}/${state.repository.name}/issues`,
        {
          method: "POST",
          body: {
            title: input.title,
            body: input.body,
            milestone: state.milestone.number,
            labels: state.desiredLabels,
          },
        },
      );
      if (
        !Number.isInteger(issue?.number) ||
        !Number.isInteger(issue?.id) ||
        !nonEmpty(issue?.node_id) ||
        issue.title !== input.title ||
        issue.body !== input.body ||
        assigneeLogins(issue).length !== 0
      ) {
        throw new WorkItemError(
          "Create response lacks the exact unassigned Issue identity, title, or body.",
        );
      }
      state.issue = issue;
      completed.push(`created Issue #${issue.number} without assignees`);
    } else {
      if (state.staleDerivedLabels.length > 0) {
        const liveBlockers = getBlockers(state.repository, issue.number);
        if (liveBlockers.some((blocker) => blocker.state === "open")) {
          throw new WorkItemError(
            "Native blocker state changed after create dry-run; stale derived labels were not removed.",
          );
        }
        for (const label of state.staleDerivedLabels) {
          removeLabel(state.repository, issue.number, label);
        }
        completed.push(
          `removed stale derived labels: ${state.staleDerivedLabels.join(", ")}`,
        );
      }
      if (state.missingLabels.length > 0) {
        ghApi(issueEndpoint(state.repository, issue.number, "/labels"), {
          method: "POST",
          body: { labels: state.missingLabels },
        });
        completed.push(
          `added missing labels: ${state.missingLabels.join(", ")}`,
        );
      }
      if (state.missingMilestone) {
        updateIssue(state.repository, issue.number, {
          milestone: state.milestone.number,
        });
        completed.push(`set milestone to "${state.milestone.title}"`);
      }
    }

    let project = state.project;
    if (input.projectRequested) {
      if (state.projectMissing) {
        const itemId = addIssueToProject(project, issue.node_id);
        project = { ...project, itemId, itemStatus: null };
        completed.push(`added Issue #${issue.number} to Project "${project.title}"`);
      }
      if (state.projectStatusMissing) {
        updateProjectStatus(project, project.optionIds.todo);
        completed.push(
          `set Project "${project.title}" Status to ${state.config.project.statusOptions.todo}`,
        );
      }
    }
    for (const blockerNumber of state.missingBlockers) {
      const blocker = state.blockerIssues.find(
        (candidate) => candidate.number === blockerNumber,
      );
      addNativeBlocker(state.repository, issue.number, blocker.id);
      completed.push(`linked Issue #${issue.number} blocked by #${blockerNumber}`);
    }
  } catch (error) {
    throw createMutationError(error, completed, state);
  }

  let verified;
  try {
    verified = resolveCreateState(parsed, input);
  } catch (error) {
    throw createMutationError(error, completed, state);
  }
  const residual = verified.planned.filter(
    (entry) => !entry.startsWith(`skip Issue #${issue.number};`),
  );
  if (
    verified.issue?.number !== issue.number ||
    residual.length > 0 ||
    assigneeLogins(verified.issue).length !== 0
  ) {
    throw new WorkItemError(
      `Create post-verification found incomplete state${
        residual.length > 0 ? `: ${residual.join("; ")}` : "."
      }`,
      {
        completed,
        repair: [
          "Inspect the exact Issue and every managed state before one new dry-run.",
          "Do not automatically retry, delete, assign, or overwrite the Issue.",
        ],
      },
    );
  }
  completed.push(
    `re-read and verified exact Issue, assignee, label, milestone, dependency${
      input.projectRequested ? ", and Project" : ""
    } state`,
  );
  return {
    command: "create",
    dryRun: false,
    repository: state.repository.nameWithOwner,
    issue: issue.number,
    url: issue.html_url,
    actor: state.login,
    idempotencyKey: input.key,
    project: input.projectRequested ? verified.project.title : null,
    completed,
    verified: true,
  };
}

function startCommand(parsed) {
  const issueValue = requirePositional(parsed, 0, "start requires an Issue.");
  if (!nonEmpty(parsed.options.branch)) {
    throw new WorkItemError("start requires --branch NAME.");
  }
  if (!nonEmpty(parsed.options.agent)) {
    throw new WorkItemError("start requires --agent MARKER.");
  }
  ensureSingleLineMarker(parsed.options.branch, "--branch");
  ensureSingleLineMarker(parsed.options.agent, "--agent");

  const context = readContext(parsed.options, issueValue);
  validateWorkBranch(
    parsed.options.branch,
    context.issueNumber,
    context.config,
  );
  const login = currentLogin();
  ensureWriteOrHigher(context.repository, login, "start");
  const claimState = readClaimState(context.repository, context.issueNumber);
  const epoch = claimState.barrier;
  const token = deriveClaimToken(
    context.repository,
    context.issueNumber,
    login,
    parsed.options.branch,
    parsed.options.agent,
    epoch,
  );
  const planned = [];
  const completed = [];
  const commentBody = startCommentBody(
    context.issueNumber,
    epoch,
    token,
    parsed.options.branch,
    parsed.options.agent,
    login,
  );
  ensureStartable(
    context,
    login,
    token,
    parsed.options.branch,
    parsed.options.agent,
  );
  const verifyMutationBoundary = (stage) =>
    assertStartMutationBoundary(
      parsed.options,
      issueValue,
      login,
      token,
      parsed.options.branch,
      parsed.options.agent,
      epoch,
      stage,
    );

  try {
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `publish claim token for branch=${parsed.options.branch} agent=${parsed.options.agent}`,
      alreadyDone: exactCommentExists(
        context.repository,
        context.issueNumber,
        commentBody,
        login,
      ),
      action: () => {
        verifyMutationBoundary("claim");
        addCommentOnceExact(
          context.repository,
          context.issueNumber,
          commentBody,
          login,
        );
        assertWinningClaim(context.repository, context.issueNumber, {
          token,
          branch: parsed.options.branch,
          agent: parsed.options.agent,
          login,
        });
      },
    });
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `assign @${login}`,
      alreadyDone:
        assigneeLogins(context.issue).length === 1 &&
        assigneeLogins(context.issue)[0] === login,
      action: () => {
        const live = verifyMutationBoundary("assign");
        const assignees = assigneeLogins(live.issue);
        if (
          assignees.length > 1 ||
          (assignees.length === 1 && assignees[0] !== login)
        ) {
          throw new WorkItemError(
            `Assignee changed before claim: [${assignees.join(", ")}].`,
          );
        }
        if (assignees.length === 0) {
          updateIssue(context.repository, context.issueNumber, {
            assignees: [login],
          });
        }
      },
    });
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `add workflow label ${context.config.labels.inProgress}`,
      alreadyDone: issueLabels(context.issue).includes(
        context.config.labels.inProgress,
      ),
      action: () => {
        const live = verifyMutationBoundary("add-in-progress");
        if (
          !issueLabels(live.issue).includes(context.config.labels.inProgress)
        ) {
          addLabel(
            context.repository,
            context.issueNumber,
            context.config.labels.inProgress,
          );
        }
      },
    });
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `remove workflow label ${context.config.labels.todo}`,
      alreadyDone: !issueLabels(context.issue).includes(
        context.config.labels.todo,
      ),
      action: () => {
        const live = verifyMutationBoundary("remove-todo");
        if (issueLabels(live.issue).includes(context.config.labels.todo)) {
          removeLabel(
            context.repository,
            context.issueNumber,
            context.config.labels.todo,
          );
        }
      },
    });
    if (context.project) {
      mutateOrPlan({
        dryRun: parsed.options.dryRun,
        planned,
        completed,
        description: `set Project Status to ${context.config.project.statusOptions.inProgress}`,
        alreadyDone:
          context.project.itemStatus ===
          context.config.project.statusOptions.inProgress,
        action: () => {
          const live = verifyMutationBoundary("project");
          if (
            live.project.itemStatus !==
            live.config.project.statusOptions.inProgress
          ) {
            updateProjectStatus(
              live.project,
              live.project.optionIds.inProgress,
            );
          }
        },
      });
    }
  } catch (error) {
    throw enrichMutationError(error, completed, context, "start");
  }

  if (parsed.options.dryRun) {
    return {
      command: "start",
      dryRun: true,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      actor: login,
      epoch,
      claimToken: token,
      planned,
    };
  }

  const verified = readContext(parsed.options, issueValue);
  const verificationFailures = [];
  const verifiedBodyValidation = validateIssueBody(
    verified.issue.body || "",
    `Issue #${verified.issueNumber}`,
    { labels: issueLabels(verified.issue) },
  );
  for (const error of verifiedBodyValidation.errors) {
    verificationFailures.push(`Issue body: ${error}`);
  }
  if (verified.issue.state !== "open") {
    verificationFailures.push(`Issue state is ${verified.issue.state}.`);
  }
  const verifiedStatuses = statusLabels(verified.issue);
  if (
    verifiedStatuses.length !== 1 ||
    verifiedStatuses[0] !== context.config.labels.inProgress
  ) {
    verificationFailures.push(
      `Workflow labels are [${verifiedStatuses.join(", ")}].`,
    );
  }
  const verifiedAssignees = assigneeLogins(verified.issue);
  if (
    verifiedAssignees.length !== 1 ||
    verifiedAssignees[0] !== login
  ) {
    verificationFailures.push(
      `Assignees are [${verifiedAssignees.join(", ")}].`,
    );
  }
  if (
    verified.project &&
    verified.project.itemStatus !==
      context.config.project.statusOptions.inProgress
  ) {
    verificationFailures.push(
      `Project Status is "${verified.project.itemStatus}".`,
    );
  }
  if (
    verified.project &&
    verified.project.inProgressCount > context.config.maxInProgress
  ) {
    verificationFailures.push(
      `Project In Progress count is ${verified.project.inProgressCount}; limit is ${context.config.maxInProgress}.`,
    );
  }
  try {
    assertWinningClaim(context.repository, context.issueNumber, {
      token,
      branch: parsed.options.branch,
      agent: parsed.options.agent,
      login,
    });
  } catch (error) {
    verificationFailures.push(error.message);
  }
  const verifiedOpenBlockers = openIssueNumbers(verified.blockers);
  if (verifiedOpenBlockers.length > 0) {
    verificationFailures.push(
      `Open blockers appeared: ${verifiedOpenBlockers.map((n) => `#${n}`).join(", ")}.`,
    );
  }
  if (issueLabels(verified.issue).includes(verified.config.labels.blocked)) {
    verificationFailures.push(
      `Derived blocked label ${verified.config.labels.blocked} appeared.`,
    );
  }

  if (verificationFailures.length > 0) {
    throw new WorkItemError(
      `Start transition did not verify: ${verificationFailures.join(" ")}`,
      {
        completed,
        repair: mutationRepair(context, "start"),
      },
    );
  }

  return {
    command: "start",
    dryRun: false,
    repository: context.repository.nameWithOwner,
    issue: context.issueNumber,
    actor: login,
    epoch,
    branch: parsed.options.branch,
    agent: parsed.options.agent,
    claimToken: token,
    completed,
    verified: true,
  };
}

function ensureSingleLineMarker(value, option, maxLength = 200) {
  if (value.length > maxLength || /[\r\n`]/.test(value)) {
    throw new WorkItemError(
      `${option} must be a single-line value without backticks and no longer than ${maxLength} characters.`,
    );
  }
}

const CLOSING_ISSUES_QUERY = `
  query PullRequestClosingIssues(
    $owner: String!,
    $name: String!,
    $number: Int!
  ) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closingIssuesReferences(first: 100) {
          nodes {
            number
            repository { nameWithOwner }
          }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`;

function verifyPullClosesIssue(repository, prNumber, issueNumber) {
  const response = ghGraphql(CLOSING_ISSUES_QUERY, {
    owner: repository.owner,
    name: repository.name,
    number: prNumber,
  });
  const connection =
    response?.data?.repository?.pullRequest?.closingIssuesReferences;
  const references = connection?.nodes;
  const exactMatch =
    Array.isArray(references) &&
    references.length === 1 &&
    references[0]?.number === issueNumber &&
    references[0]?.repository?.nameWithOwner?.toLowerCase() ===
      repository.nameWithOwner.toLowerCase() &&
    connection?.pageInfo?.hasNextPage === false;
  if (!exactMatch) {
    throw new WorkItemError(
      `Pull request #${prNumber} must natively close exactly Issue #${issueNumber} in ${repository.nameWithOwner}.`,
      {
        repair: [
          `Keep exactly one GitHub closing reference such as "Closes #${issueNumber}" and confirm GitHub recognizes it.`,
        ],
      },
    );
  }
}

function validateCompletionPreconditions(context, login) {
  const statuses = statusLabels(context.issue);
  const assignees = assigneeLogins(context.issue);
  const ownedByLogin =
    assignees.length === 1 && assignees[0] === login;
  const allowedStatuses = new Set([
    context.config.labels.inProgress,
    context.config.labels.done,
  ]);
  const recoverableState =
    context.issue.state === "open" ||
    (context.issue.state === "closed" &&
      context.issue.state_reason === "completed");
  const projectRecoverable =
    !context.project ||
    [
      context.config.project.statusOptions.inProgress,
      context.config.project.statusOptions.done,
    ].includes(context.project.itemStatus);
  const recoverable =
    recoverableState &&
    statuses.length === 1 &&
    allowedStatuses.has(statuses[0]) &&
    ownedByLogin &&
    projectRecoverable;

  if (!recoverable) {
    throw new WorkItemError(
      [
        `Issue #${context.issueNumber} is neither active for @${login} nor already complete.`,
        `state=${context.issue.state}`,
        `state_reason=${context.issue.state_reason}`,
        `labels=[${statuses.join(", ")}]`,
        `assignees=[${assignees.join(", ")}]`,
        `project=${context.project?.itemStatus ?? "not-managed"}`,
      ].join(" "),
      {
        repair: [
          "Inspect the Issue and Project before attempting completion.",
          "Do not use complete to claim or repair an unrelated work item.",
        ],
      },
    );
  }
}

function verifyPullBodyClosesIssue(pull, issueNumber) {
  const escaped = String(issueNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+(?:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)?#${escaped}\\b`,
    "i",
  );
  if (!pattern.test(pull.body || "")) {
    throw new WorkItemError(
      `Pull request #${pull.number} body lacks a closing reference for Issue #${issueNumber}.`,
      {
        repair: [
          `Add "Closes #${issueNumber}" to the PR body and confirm GitHub recognizes it.`,
        ],
      },
    );
  }
}

function completeCommand(parsed) {
  const issueValue = requirePositional(parsed, 0, "complete requires an Issue.");
  if (!nonEmpty(parsed.options.pr)) {
    throw new WorkItemError("complete requires --pr <merged-pr>.");
  }
  if (!/^[0-9a-f]{40}$/i.test(parsed.options.head ?? "")) {
    throw new WorkItemError(
      "complete requires --head <40-character-finalized-head>.",
    );
  }
  const expectedHead = parsed.options.head.toLowerCase();

  const context = readContext(parsed.options, issueValue);
  const login = currentLogin();
  ensureWriteOrHigher(context.repository, login, "complete");
  validateCompletionPreconditions(context, login);
  const claimState = readClaimState(
    context.repository,
    context.issueNumber,
  );
  const winningClaim = claimState.winner;
  if (!winningClaim || winningClaim.login !== login) {
    throw new WorkItemError(
      `Cannot complete without an active winning claim owned by @${login}.`,
      {
        repair: ["Inspect the exact start marker and active assignee."],
      },
    );
  }
  const prNumber = parseNumberOrUrl(
    parsed.options.pr,
    "pull",
    context.repository,
  );
  const pull = ghApi(pullEndpoint(context.repository, prNumber));
  if (!pull?.merged_at) {
    throw new WorkItemError(`Pull request #${prNumber} is not merged.`, {
      repair: ["Merge the PR successfully before completing the work item."],
    });
  }
  const expectedRepository = context.repository.nameWithOwner.toLowerCase();
  for (const side of ["base", "head"]) {
    const actualRepository = String(
      pull?.[side]?.repo?.full_name ?? "",
    ).toLowerCase();
    if (actualRepository !== expectedRepository) {
      throw new WorkItemError(
        `Pull request #${prNumber} ${side} repository is not the current work repository.`,
        {
          repair: [
            "Use a same-repository merged PR verified by the finalize snapshot.",
          ],
        },
      );
    }
  }
  if (pull.base?.ref !== context.config.branch.base) {
    throw new WorkItemError(
      `Pull request #${prNumber} base branch is "${pull.base?.ref}", expected trunk "${context.config.branch.base}".`,
      {
        repair: [
          `Use the merged PR that targeted "${context.config.branch.base}".`,
        ],
      },
    );
  }
  if (pull.head?.ref !== winningClaim.branch) {
    throw new WorkItemError(
      `Pull request #${prNumber} head branch is "${pull.head?.ref}", expected recorded branch "${winningClaim.branch}".`,
      {
        repair: ["Pass the merged PR created from the recorded work branch."],
      },
    );
  }
  if (
    !/^[0-9a-f]{40}$/i.test(String(pull.head?.sha ?? "")) ||
    pull.head.sha.toLowerCase() !== expectedHead
  ) {
    throw new WorkItemError(
      `Pull request #${prNumber} head commit is "${pull.head?.sha ?? "missing"}", expected finalized head "${expectedHead}".`,
      {
        repair: [
          "Use the exact head emitted by the successful finalize snapshot.",
        ],
      },
    );
  }
  verifyPullBodyClosesIssue(pull, context.issueNumber);
  verifyPullClosesIssue(context.repository, prNumber, context.issueNumber);

  const dependents = getDependents(context.repository, context.issueNumber).filter(
    (issue) => issue.state === "open",
  );
  const dependentPlans = dependents.map((dependent) => {
    const blockers = getBlockers(context.repository, dependent.number);
    const otherOpenBlockers = blockers.filter(
      (blocker) =>
        blocker.state === "open" && blocker.number !== context.issueNumber,
    );
    return { dependent, otherOpenBlockers };
  });

  const planned = [];
  const completed = [];
  const dependentResults = [];
  const completionMarker = `<!-- lunchtime-work-item:complete issue=${context.issueNumber} pr=${prNumber} -->`;
  const completionBody = [
    completionMarker,
    `PR #${prNumber} 병합으로 작업을 완료했습니다.`,
    "",
    `- Branch: \`${winningClaim.branch}\``,
    `- Merged commit: \`${pull.merge_commit_sha}\``,
    `- Completed by: @${login}`,
  ].join("\n");
  const completionMarkerPattern = new RegExp(
    `^<!-- lunchtime-work-item:complete issue=${context.issueNumber} pr=\\d+ -->$`,
  );
  const existingCompletions = trustedMarkerComments(
    context.repository,
    getComments(context.repository, context.issueNumber),
    completionMarkerPattern,
  );
  const conflictingCompletion = existingCompletions.find(
    (comment) =>
      firstCommentLine(comment) !== completionMarker ||
      comment.body !== completionBody ||
      comment.user?.login !== login,
  );
  if (conflictingCompletion || existingCompletions.length > 1) {
    throw new WorkItemError(
      `Issue #${context.issueNumber} already records a conflicting trusted completion marker.`,
      {
        repair: [
          "Inspect trusted completion markers and pass the original merged PR.",
        ],
      },
    );
  }

  try {
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `set workflow label to ${context.config.labels.done}`,
      alreadyDone:
        statusLabels(context.issue).length === 1 &&
        statusLabels(context.issue)[0] === context.config.labels.done,
      action: () => {
        assertWinningClaim(
          context.repository,
          context.issueNumber,
          winningClaim,
        );
        transitionWorkflowLabel(
          context.repository,
          context.issueNumber,
          context.config.labels.done,
        );
      },
    });
    if (context.project) {
      mutateOrPlan({
        dryRun: parsed.options.dryRun,
        planned,
        completed,
        description: `set Project Status to ${context.config.project.statusOptions.done}`,
        alreadyDone:
          context.project.itemStatus === context.config.project.statusOptions.done,
        action: () => {
          assertWinningClaim(
            context.repository,
            context.issueNumber,
            winningClaim,
          );
          updateProjectStatus(context.project, context.project.optionIds.done);
        },
      });
    }
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: "close Issue as completed",
      alreadyDone:
        context.issue.state === "closed" &&
        context.issue.state_reason === "completed",
      action: () => {
        assertWinningClaim(
          context.repository,
          context.issueNumber,
          winningClaim,
        );
        updateIssue(context.repository, context.issueNumber, {
          state: "closed",
          state_reason: "completed",
        });
      },
    });

    const hasCompletionMarker = exactCommentExists(
      context.repository,
      context.issueNumber,
      completionBody,
      login,
    );
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `comment merged PR #${prNumber}`,
      alreadyDone: hasCompletionMarker,
      action: () => {
        assertWinningClaim(
          context.repository,
          context.issueNumber,
          winningClaim,
        );
        addCommentOnceExact(
          context.repository,
          context.issueNumber,
          completionBody,
          login,
        );
      },
    });

    for (const { dependent, otherOpenBlockers } of dependentPlans) {
      const marker = `<!-- lunchtime-work-item:dependency source=${context.issueNumber} target=${dependent.number} -->`;
      const currentDependent = parsed.options.dryRun
        ? dependent
        : getIssue(context.repository, dependent.number);
      if (currentDependent.state !== "open") {
        throw new WorkItemError(
          `Dependent #${dependent.number} changed to ${currentDependent.state} during completion.`,
        );
      }
      const liveOpenBlockers = parsed.options.dryRun
        ? otherOpenBlockers
        : getBlockers(context.repository, dependent.number).filter(
            (blocker) => blocker.state === "open",
          );
      const dependentLabels = issueLabels(currentDependent);
      const becomesReady = liveOpenBlockers.length === 0;
      const hasBlockedLabel = dependentLabels.includes(
        context.config.labels.blocked,
      );

      if (becomesReady && hasBlockedLabel) {
        mutateOrPlan({
          dryRun: parsed.options.dryRun,
          planned,
          completed,
          description: `remove ${context.config.labels.blocked} from dependent #${dependent.number}`,
          alreadyDone: false,
          action: () => {
            const blockersImmediatelyBefore = getBlockers(
              context.repository,
              dependent.number,
            ).filter((blocker) => blocker.state === "open");
            if (blockersImmediatelyBefore.length > 0) {
              throw new WorkItemError(
                `Dependent #${dependent.number} gained blocker(s) before label removal.`,
              );
            }
            setLabelPresence(
              context.repository,
              dependent.number,
              context.config.labels.blocked,
              false,
            );
          },
        });
      } else if (!becomesReady && !hasBlockedLabel) {
        mutateOrPlan({
          dryRun: parsed.options.dryRun,
          planned,
          completed,
          description: `add ${context.config.labels.blocked} to dependent #${dependent.number}`,
          alreadyDone: false,
          action: () => {
            const blockersImmediatelyBefore = getBlockers(
              context.repository,
              dependent.number,
            ).filter((blocker) => blocker.state === "open");
            if (blockersImmediatelyBefore.length === 0) {
              throw new WorkItemError(
                `Dependent #${dependent.number} lost all blockers before blocked-label repair.`,
              );
            }
            setLabelPresence(
              context.repository,
              dependent.number,
              context.config.labels.blocked,
              true,
            );
          },
        });
      }

      const blockerText = becomesReady
        ? "모든 선행 작업이 완료되어 작업 가능 상태가 되었습니다."
        : `이 선행 작업은 완료되었지만, 열린 선행 작업 ${liveOpenBlockers
            .map((blocker) => `#${blocker.number}`)
            .join(", ")}이 남아 있습니다.`;
      const dependencyBody = [
        marker,
        `선행 작업 #${context.issueNumber}이 PR #${prNumber}으로 완료되었습니다.`,
        "",
        blockerText,
      ].join("\n");
      const dependencyMarkerPattern = new RegExp(
        `^${escapeRegex(marker)}$`,
      );
      const existingDependencyMarkers = trustedMarkerComments(
        context.repository,
        getComments(context.repository, dependent.number),
        dependencyMarkerPattern,
      );
      const conflictingDependencyMarker = existingDependencyMarkers.find(
        (comment) => comment.user?.login !== login,
      );
      if (
        conflictingDependencyMarker ||
        existingDependencyMarkers.length > 1
      ) {
        throw new WorkItemError(
          `Dependent #${dependent.number} has a conflicting trusted dependency marker for source #${context.issueNumber}.`,
          {
            repair: [
              "Inspect trusted dependency marker comments before rerunning completion.",
            ],
          },
        );
      }
      const existingDependencyMarker = existingDependencyMarkers[0] || null;
      const recordedDependencyBody =
        existingDependencyMarker?.body || dependencyBody;
      mutateOrPlan({
        dryRun: parsed.options.dryRun,
        planned,
        completed,
        description: `comment dependency update on #${dependent.number}`,
        alreadyDone: Boolean(existingDependencyMarker),
        action: () =>
          addCommentOnceExact(
            context.repository,
            dependent.number,
            dependencyBody,
            login,
          ),
      });
      dependentResults.push({
        issue: dependent.number,
        remainingOpenBlockers: liveOpenBlockers.map(
          (blocker) => blocker.number,
        ),
        wouldUnblock: becomesReady,
        marker,
        commentBody: recordedDependencyBody,
      });
    }
  } catch (error) {
    throw enrichMutationError(error, completed, context, "complete");
  }

  if (parsed.options.dryRun) {
    return {
      command: "complete",
      dryRun: true,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      pullRequest: prNumber,
      actor: login,
      planned,
      dependents: dependentResults,
    };
  }

  const verified = readContext(parsed.options, issueValue);
  const failures = [];
  const statuses = statusLabels(verified.issue);
  if (verified.issue.state !== "closed") {
    failures.push(`Issue state is ${verified.issue.state}.`);
  }
  if (verified.issue.state_reason !== "completed") {
    failures.push(
      `Issue state_reason is "${verified.issue.state_reason}", expected "completed".`,
    );
  }
  if (
    statuses.length !== 1 ||
    statuses[0] !== context.config.labels.done
  ) {
    failures.push(`Workflow labels are [${statuses.join(", ")}].`);
  }
  if (
    verified.project &&
    verified.project.itemStatus !== context.config.project.statusOptions.done
  ) {
    failures.push(`Project Status is "${verified.project.itemStatus}".`);
  }
  if (
    !exactCommentExists(
      context.repository,
      context.issueNumber,
      completionBody,
      login,
    )
  ) {
    failures.push("Completion marker comment is missing.");
  }
  for (const dependentResult of dependentResults) {
    const refreshed = getIssue(
      context.repository,
      dependentResult.issue,
    );
    const refreshedOpenBlockers = getBlockers(
      context.repository,
      dependentResult.issue,
    ).filter((blocker) => blocker.state === "open");
    const hasBlockedLabel = issueLabels(refreshed).includes(
      context.config.labels.blocked,
    );
    if (refreshedOpenBlockers.length === 0 && hasBlockedLabel) {
      failures.push(
        `Dependent #${dependentResult.issue} still has ${context.config.labels.blocked}.`,
      );
    } else if (refreshedOpenBlockers.length > 0 && !hasBlockedLabel) {
      failures.push(
        `Dependent #${dependentResult.issue} lacks ${context.config.labels.blocked} while blockers remain.`,
      );
    }
    if (
      !exactCommentExists(
        context.repository,
        dependentResult.issue,
        dependentResult.commentBody,
        login,
      )
    ) {
      failures.push(
        `Dependent #${dependentResult.issue} dependency marker comment is missing.`,
      );
    }
  }
  if (failures.length > 0) {
    throw new WorkItemError(
      `Completion transition did not verify: ${failures.join(" ")}`,
      {
        completed,
        repair: mutationRepair(context, "complete"),
      },
    );
  }

  return {
    command: "complete",
    dryRun: false,
    repository: context.repository.nameWithOwner,
    issue: context.issueNumber,
    pullRequest: prNumber,
    actor: login,
    completed,
    dependentsUpdated: dependentResults.map(({ issue }) => issue),
    verified: true,
  };
}

function getPullsForBranch(repository, branch) {
  const pulls = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = ghApi(
      `repos/${repository.owner}/${repository.name}/pulls?state=all&per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(response)) {
      throw new WorkItemError("Expected a list while reading pull requests.");
    }
    pulls.push(...response.filter((pull) => pull.head?.ref === branch));
    if (response.length < PAGE_SIZE) return pulls;
  }
  throw new WorkItemError(
    `Pull request pagination exceeded the safety limit of ${MAX_PAGES} pages.`,
  );
}

function releaseCommand(parsed) {
  const issueValue = requirePositional(parsed, 0, "release requires an Issue.");
  for (const option of ["branch", "agent", "reason"]) {
    if (!nonEmpty(parsed.options[option])) {
      throw new WorkItemError(`release requires --${option} VALUE.`);
    }
  }
  ensureSingleLineMarker(parsed.options.branch, "--branch");
  ensureSingleLineMarker(parsed.options.agent, "--agent");
  ensureSingleLineMarker(parsed.options.reason, "--reason", 500);

  const context = readContext(parsed.options, issueValue);
  const login = currentLogin();
  ensureWriteOrHigher(context.repository, login, "release");
  const claimState = readClaimState(context.repository, context.issueNumber);
  const releaseStateSatisfied =
    context.issue.state === "open" &&
    statusLabels(context.issue).length === 1 &&
    statusLabels(context.issue)[0] === context.config.labels.todo &&
    assigneeLogins(context.issue).length === 0 &&
    (!context.project ||
      context.project.itemStatus === context.config.project.statusOptions.todo);
  const matchingPriorRelease = [...claimState.releases]
    .reverse()
    .find(
      (release) =>
        release.branch === parsed.options.branch &&
        release.agent === parsed.options.agent &&
        release.login === login &&
        release.reason === parsed.options.reason,
    );
  if (!claimState.winner && matchingPriorRelease && releaseStateSatisfied) {
    return {
      command: "release",
      dryRun: parsed.options.dryRun,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      actor: login,
      epoch: matchingPriorRelease.epoch,
      branch: parsed.options.branch,
      agent: parsed.options.agent,
      completed: ["release already satisfied"],
      planned: [],
      verified: true,
    };
  }

  const epoch = claimState.barrier;
  const token = deriveClaimToken(
    context.repository,
    context.issueNumber,
    login,
    parsed.options.branch,
    parsed.options.agent,
    epoch,
  );
  const releaseBody = releaseCommentBody(
    context.issueNumber,
    epoch,
    token,
    parsed.options.branch,
    parsed.options.agent,
    login,
    parsed.options.reason,
  );
  const alreadyReleased = exactCommentExists(
    context.repository,
    context.issueNumber,
    releaseBody,
    login,
  );
  if (alreadyReleased && releaseStateSatisfied) {
    return {
      command: "release",
      dryRun: parsed.options.dryRun,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      actor: login,
      branch: parsed.options.branch,
      agent: parsed.options.agent,
      completed: ["release already satisfied"],
      planned: [],
      verified: true,
    };
  }

  const claim = assertWinningClaim(
    context.repository,
    context.issueNumber,
    {
      token,
      branch: parsed.options.branch,
      agent: parsed.options.agent,
      login,
    },
  );
  const statuses = statusLabels(context.issue);
  const allowedStatuses = new Set([
    context.config.labels.inProgress,
    context.config.labels.todo,
  ]);
  const assignees = assigneeLogins(context.issue);
  const failures = [];
  if (context.issue.state !== "open") {
    failures.push(`Issue is ${context.issue.state}, expected open.`);
  }
  if (
    statuses.length < 1 ||
    statuses.some((status) => !allowedStatuses.has(status))
  ) {
    failures.push(
      `Workflow labels are [${statuses.join(", ")}], expected a recoverable In Progress to Todo state.`,
    );
  }
  if (
    assignees.length > 1 ||
    (assignees.length === 1 && assignees[0] !== login)
  ) {
    failures.push(`Assignees are [${assignees.join(", ")}], expected @${login} or none.`);
  }
  if (
    context.project &&
    ![
      context.config.project.statusOptions.inProgress,
      context.config.project.statusOptions.todo,
    ].includes(context.project.itemStatus)
  ) {
    failures.push(
      `Project Status is "${context.project.itemStatus}", expected In Progress or Todo.`,
    );
  }
  if (failures.length > 0) {
    throw new WorkItemError(
      `Issue #${context.issueNumber} cannot be released: ${failures.join(" ")}`,
    );
  }

  const conflictingPulls = getPullsForBranch(
    context.repository,
    claim.branch,
  ).filter((pull) => pull.state === "open" || pull.merged_at);
  if (conflictingPulls.length > 0) {
    throw new WorkItemError(
      `Recorded branch has open or merged PR(s): ${conflictingPulls
        .map((pull) => `#${pull.number}`)
        .join(", ")}.`,
      {
        repair: [
          "Close an unmerged open PR before release.",
          "Use complete instead when the PR is merged.",
        ],
      },
    );
  }

  const planned = [];
  const completed = [];
  try {
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `set workflow label to ${context.config.labels.todo}`,
      alreadyDone:
        statuses.length === 1 && statuses[0] === context.config.labels.todo,
      action: () => {
        assertWinningClaim(context.repository, context.issueNumber, claim);
        transitionWorkflowLabel(
          context.repository,
          context.issueNumber,
          context.config.labels.todo,
        );
      },
    });
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `unassign @${login}`,
      alreadyDone: assignees.length === 0,
      action: () => {
        assertWinningClaim(context.repository, context.issueNumber, claim);
        const currentAssignees = assigneeLogins(
          getIssue(context.repository, context.issueNumber),
        );
        if (
          currentAssignees.length !== 1 ||
          currentAssignees[0] !== login
        ) {
          throw new WorkItemError(
            `Assignee changed before release: [${currentAssignees.join(", ")}].`,
          );
        }
        updateIssue(context.repository, context.issueNumber, {
          assignees: [],
        });
      },
    });
    if (context.project) {
      mutateOrPlan({
        dryRun: parsed.options.dryRun,
        planned,
        completed,
        description: `set Project Status to ${context.config.project.statusOptions.todo}`,
        alreadyDone:
          context.project.itemStatus === context.config.project.statusOptions.todo,
        action: () => {
          assertWinningClaim(context.repository, context.issueNumber, claim);
          updateProjectStatus(context.project, context.project.optionIds.todo);
        },
      });
    }
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description: `publish release marker: ${parsed.options.reason}`,
      alreadyDone: alreadyReleased,
      action: () =>
        addCommentOnceExact(
          context.repository,
          context.issueNumber,
          releaseBody,
          login,
        ),
    });
  } catch (error) {
    throw enrichMutationError(error, completed, context, "release");
  }

  if (parsed.options.dryRun) {
    return {
      command: "release",
      dryRun: true,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      actor: login,
      branch: parsed.options.branch,
      agent: parsed.options.agent,
      planned,
    };
  }

  const verified = readContext(parsed.options, issueValue);
  const verificationFailures = [];
  const verifiedStatuses = statusLabels(verified.issue);
  if (
    verified.issue.state !== "open" ||
    verifiedStatuses.length !== 1 ||
    verifiedStatuses[0] !== context.config.labels.todo ||
    assigneeLogins(verified.issue).length !== 0 ||
    (verified.project &&
      verified.project.itemStatus !== context.config.project.statusOptions.todo)
  ) {
    verificationFailures.push(
      "Issue, assignee, workflow label, and Project did not return to the Todo state.",
    );
  }
  if (
    !exactCommentExists(
      context.repository,
      context.issueNumber,
      releaseBody,
      login,
    )
  ) {
    verificationFailures.push("Exact release marker comment is missing.");
  }
  if (verificationFailures.length > 0) {
    throw new WorkItemError(
      `Release transition did not verify: ${verificationFailures.join(" ")}`,
      {
        completed,
        repair: mutationRepair(context, "release"),
      },
    );
  }

  return {
    command: "release",
    dryRun: false,
    repository: context.repository.nameWithOwner,
    issue: context.issueNumber,
    actor: login,
    branch: parsed.options.branch,
    agent: parsed.options.agent,
    completed,
    verified: true,
  };
}

function reconcileCommand(parsed) {
  const issueValue = requirePositional(
    parsed,
    0,
    "reconcile requires an Issue.",
  );
  const context = readContext(parsed.options, issueValue);
  const login = currentLogin();
  ensureWriteOrHigher(context.repository, login, "reconcile");
  const claimState = readClaimState(context.repository, context.issueNumber);
  const statuses = statusLabels(context.issue);
  const failures = [];
  if (context.issue.state !== "open") {
    failures.push(`Issue is ${context.issue.state}, expected open.`);
  }
  if (statuses.length !== 1 || statuses[0] !== context.config.labels.todo) {
    failures.push(
      `Workflow labels are [${statuses.join(", ")}], expected exactly [${context.config.labels.todo}].`,
    );
  }
  if (assigneeLogins(context.issue).length !== 0) {
    failures.push("Issue must be unassigned before dependency reconciliation.");
  }
  if (
    context.project &&
    context.project.itemStatus !== context.config.project.statusOptions.todo
  ) {
    failures.push(
      `Project Status is "${context.project.itemStatus}", expected "${context.config.project.statusOptions.todo}".`,
    );
  }
  if (claimState.winner) {
    failures.push(
      `Issue has an active claim from @${claimState.winner.login}; dependency reconciliation only permits unclaimed Todo Issues.`,
    );
  }
  if (failures.length > 0) {
    throw new WorkItemError(
      `Issue #${context.issueNumber} is not safe to reconcile: ${failures.join(" ")}`,
      {
        repair: [
          "Only reconcile an open, unassigned, unclaimed Todo Issue whose Project Status is Todo.",
          "Inspect live dependency state before running one new bounded command.",
        ],
      },
    );
  }

  const shouldBeBlocked = openIssueNumbers(context.blockers).length > 0;
  const hasBlockedLabel = issueLabels(context.issue).includes(
    context.config.labels.blocked,
  );
  const description = shouldBeBlocked
    ? `add ${context.config.labels.blocked}`
    : `remove ${context.config.labels.blocked}`;
  const planned = [];
  const completed = [];
  try {
    mutateOrPlan({
      dryRun: parsed.options.dryRun,
      planned,
      completed,
      description,
      alreadyDone: hasBlockedLabel === shouldBeBlocked,
      action: () => {
        const live = readContext(parsed.options, issueValue);
        const current = live.issue;
        const currentBlockers = live.blockers;
        const liveClaim = readClaimState(live.repository, live.issueNumber);
        if (
          current.state !== "open" ||
          statusLabels(current).length !== 1 ||
          statusLabels(current)[0] !== context.config.labels.todo ||
          assigneeLogins(current).length !== 0 ||
          (live.project &&
            live.project.itemStatus !== context.config.project.statusOptions.todo) ||
          liveClaim.winner
        ) {
          throw new WorkItemError(
            "Issue changed and is no longer a safe Todo target for dependency reconciliation.",
          );
        }
        const desired = openIssueNumbers(currentBlockers).length > 0;
        setLabelPresence(
          context.repository,
          context.issueNumber,
          context.config.labels.blocked,
          desired,
        );
      },
    });
  } catch (error) {
    throw enrichMutationError(error, completed, context, "reconcile");
  }

  if (parsed.options.dryRun) {
    return {
      command: "reconcile",
      dryRun: true,
      repository: context.repository.nameWithOwner,
      issue: context.issueNumber,
      actor: login,
      openBlockers: openIssueNumbers(context.blockers),
      planned,
    };
  }

  const verified = readContext(parsed.options, issueValue);
  const verificationFailures = [];
  const verifiedShouldBeBlocked = openIssueNumbers(verified.blockers).length > 0;
  const verifiedHasBlockedLabel = issueLabels(verified.issue).includes(
    verified.config.labels.blocked,
  );
  if (verifiedHasBlockedLabel !== verifiedShouldBeBlocked) {
    verificationFailures.push(
      `Derived blocked label ${verified.config.labels.blocked} does not match open native blockers.`,
    );
  }
  if (
    verified.issue.state !== "open" ||
    statusLabels(verified.issue).length !== 1 ||
    statusLabels(verified.issue)[0] !== verified.config.labels.todo ||
    assigneeLogins(verified.issue).length !== 0 ||
    (verified.project &&
      verified.project.itemStatus !== verified.config.project.statusOptions.todo)
  ) {
    verificationFailures.push(
      "Issue, assignee, workflow label, or Project changed during dependency reconciliation.",
    );
  }
  if (verificationFailures.length > 0) {
    throw new WorkItemError(
      `Reconcile transition did not verify: ${verificationFailures.join(" ")}`,
      {
        completed,
        repair: mutationRepair(context, "reconcile"),
      },
    );
  }
  return {
    command: "reconcile",
    dryRun: false,
    repository: context.repository.nameWithOwner,
    issue: context.issueNumber,
    actor: login,
    openBlockers: openIssueNumbers(verified.blockers),
    completed,
    verified: true,
  };
}

function enrichMutationError(error, completed, context, operation) {
  if (error instanceof WorkItemError) {
    return new WorkItemError(error.message, {
      completed,
      repair: [...error.repair, ...mutationRepair(context, operation)],
    });
  }
  return new WorkItemError(String(error), {
    completed,
    repair: mutationRepair(context, operation),
  });
}

function mutationRepair(context, operation) {
  return [
    `Inspect https://github.com/${context.repository.nameWithOwner}/issues/${context.issueNumber}${
      context.project ? " and the configured Project" : ""
    }.`,
    `Run check, reconcile the partial ${operation} state, then rerun one ${operation} command.`,
    "Do not add an automatic retry loop.",
  ];
}

const REQUIRED_BODY_HEADINGS = [
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

function validateBodyCommand(parsed) {
  const source = requirePositional(
    parsed,
    0,
    "validate-body requires a file path or -.",
  );
  let body;
  try {
    body =
      source === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(resolve(process.cwd(), source), "utf8");
  } catch (error) {
    throw new WorkItemError(`Cannot read Issue body ${source}: ${error.message}`);
  }

  if (COLLECT_REFERENCE_PROJECTION_DIAGNOSTICS) {
    referenceProjectionOperations = 0;
  }
  const validation = validateIssueBody(body, source, {
    labels: parsed.options.labels,
  });
  return {
    command: "validate-body",
    source,
    labels: parsed.options.labels,
    valid: validation.errors.length === 0,
    errors: validation.errors,
    requiredHeadings: REQUIRED_BODY_HEADINGS,
    ...(COLLECT_REFERENCE_PROJECTION_DIAGNOSTICS
      ? { referenceProjectionOperations }
      : {}),
  };
}

function validateIssueBody(body, source, { labels = [] } = {}) {
  if (String(body ?? "").includes(TOOLING_TRACE_PREFIX)) {
    const sourceGrammarViolation = toolingSourceGrammarViolation(body);
    if (sourceGrammarViolation) {
      return {
        source,
        errors: [
          `tooling-only 비적용 본문은 제한된 fail-closed Markdown 소스 문법만 허용합니다(줄 ${sourceGrammarViolation.line}): ${sourceGrammarViolation.reason} 일반 텍스트·제목·목록·표·inline code 또는 같은 줄에서 완결된 "[label](destination)" 링크로 고치고 숨김·참조 문법을 제거하세요.`,
        ],
      };
    }
  }

  const visibleBody = visibleContractMarkdownPreservingInlineCode(
    maskMarkdownImages(body, referenceResolutionVisibleMarkdown(body)),
  );
  const renderedEvidenceBody = renderedVisibleContractMarkdown(body);
  const parsed = parseIssueBody(visibleBody);
  const renderedParsed = parseIssueBody(renderedEvidenceBody);
  const headings = parsed.headings.map(({ name }) => name);
  const errors = [];
  for (const heading of REQUIRED_BODY_HEADINGS) {
    const count = headings.filter((value) => value === heading).length;
    if (count !== 1) {
      errors.push(
        `"## ${heading}" 또는 "### ${heading}" 제목이 하나여야 하지만 ${count}개입니다.`,
      );
    }
  }
  const requiredInOrder = headings.filter((heading) =>
    REQUIRED_BODY_HEADINGS.includes(heading),
  );
  if (
    requiredInOrder.length === REQUIRED_BODY_HEADINGS.length &&
    requiredInOrder.some(
      (heading, index) => heading !== REQUIRED_BODY_HEADINGS[index],
    )
  ) {
    errors.push("필수 제목의 순서가 올바르지 않습니다.");
  }

  const requiredLevels = parsed.headings
    .filter(({ name }) => REQUIRED_BODY_HEADINGS.includes(name))
    .map(({ level }) => level);
  if (
    requiredLevels.length === REQUIRED_BODY_HEADINGS.length &&
    new Set(requiredLevels).size !== 1
  ) {
    errors.push("필수 제목은 모두 ## 또는 모두 ###로 같은 단계여야 합니다.");
  }

  for (const heading of REQUIRED_BODY_HEADINGS) {
    const content = parsed.sections.get(heading) || "";
    const renderedContent = renderedParsed.sections.get(heading) || "";
    if (
      !isMeaningfulSection(content) &&
      !isMeaningfulSection(renderedContent)
    ) {
      errors.push(
        `"${heading}" 섹션에는 의미 있는 내용이 필요하며 자리표시자와 한 글자 값은 허용하지 않습니다.`,
      );
    }
  }
  const bareTraceIds = findBareTraceabilityIds(renderedEvidenceBody);
  if (bareTraceIds.length > 0) {
    errors.push(
      `추적성 ID에는 전역 네임스페이스가 필요합니다. 발견된 값: ${bareTraceIds.join(
        ", ",
      )}. PRD-NN-FR-NN, PRD-NN-AC-NN, PRD-NN-SP-NN 또는 POL-NN-R-NN 형식을 사용해야 합니다.`,
    );
  }
  const traceability = parsed.sections.get("추적성") || "";
  const renderedTraceability =
    renderedParsed.sections.get("추적성") || "";
  const contractIds = renderedContractIds(renderedTraceability);
  const toolingTrace = parseToolingTraceability(traceability);
  const bodyContractIds = renderedContractIds(renderedEvidenceBody);
  const bodyHasToolingDeclaration =
    renderedEvidenceBody.includes(TOOLING_TRACE_PREFIX) ||
    renderedEvidenceBody.includes(
      TOOLING_TRACE_PREFIX.replaceAll("—", "-"),
    );
  if (bodyHasToolingDeclaration && bodyContractIds.size > 0) {
    errors.push(
      `이슈 본문 전체에서 제품 계약 ID와 "${TOOLING_TRACE_PREFIX}" 비적용 선언을 함께 사용할 수 없습니다.`,
    );
  }
  if (contractIds.size === 0) {
    validateToolingTraceability(
      parsed,
      renderedParsed,
      labels,
      toolingTrace,
      errors,
    );
  } else {
    if (toolingTrace.present) {
      errors.push(
        `"추적성" 섹션은 제품 계약 ID와 "${TOOLING_TRACE_PREFIX}" 비적용 선언을 함께 사용할 수 없습니다.`,
      );
    }
    validatePlannedTraceability(parsed, renderedParsed, errors);
  }
  return {
    source,
    errors,
  };
}

function toolingSourceGrammarViolation(markdown) {
  const source = String(markdown ?? "");
  let index = 0;
  let line = 1;
  let atLineStart = true;
  let createMarkerCount = 0;
  let backslashRun = 0;
  let linkState = "text";
  let destinationDepth = 0;

  while (index < source.length) {
    if (atLineStart) {
      const newline = source.indexOf("\n", index);
      const lineEnd = newline < 0 ? source.length : newline;
      const sourceLine = source.slice(index, lineEnd);
      const hasCrlf =
        newline >= 0 && sourceLine.endsWith("\r");
      const rawLine = hasCrlf
        ? sourceLine.slice(0, -1)
        : sourceLine;
      countReferenceProjectionOperation(rawLine.length + 1);
      if (rawLine.includes("\r")) {
        return {
          line,
          reason:
            "CRLF가 아닌 bare CR 줄바꿈은 소스 경계와 inline link 완결성을 우회할 수 있어 허용되지 않습니다.",
        };
      }
      if (TOOLING_CREATE_MARKER_LINE_PATTERN.test(rawLine)) {
        createMarkerCount += 1;
        if (createMarkerCount > 1) {
          return {
            line,
            reason:
              "정확한 create marker HTML comment도 본문 전체에서 한 줄만 허용됩니다.",
          };
        }
        index = newline < 0 ? source.length : newline + 1;
        line += newline < 0 ? 0 : 1;
        atLineStart = true;
        backslashRun = 0;
        continue;
      }
      const leadingIndentColumns =
        toolingSourceLeadingIndentColumns(rawLine);
      if (
        rawLine.trim() &&
        leadingIndentColumns >= 4
      ) {
        return {
          line,
          reason:
            "4열 이상의 소스 들여쓰기는 top-level·list-contained indented code와 구별하지 않고 거부합니다.",
        };
      }
      if (toolingSourceHasUnsafeListPadding(rawLine)) {
        return {
          line,
          reason:
            "각 nested list marker 뒤의 tab 또는 5칸 이상 padding은 list-contained indented code와 구별하지 않고 거부합니다.",
        };
      }
      if (/^ {0,3}(?:`{3,}|~{3,})/.test(rawLine)) {
        return {
          line,
          reason: "fenced code block은 허용되지 않습니다.",
        };
      }
      atLineStart = false;
    }

    countReferenceProjectionOperation();
    const codePoint = source.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    const width = character.length;

    if (character === "\n") {
      if (linkState !== "text") {
        return {
          line,
          reason:
            "inline Markdown 링크의 label과 destination은 같은 줄에서 모두 닫혀야 합니다.",
        };
      }
      index += width;
      line += 1;
      atLineStart = true;
      backslashRun = 0;
      continue;
    }
    if (character === "\\") {
      backslashRun += 1;
      index += width;
      continue;
    }

    const escaped = backslashRun % 2 === 1;
    backslashRun = 0;

    if (character === "`") {
      let delimiterLength = 1;
      while (
        source[index + delimiterLength] === "`"
      ) {
        countReferenceProjectionOperation();
        delimiterLength += 1;
      }
      if (delimiterLength >= 3) {
        return {
          line,
          reason:
            "세 개 이상의 backtick delimiter는 fenced code와 구별하지 않고 거부합니다.",
        };
      }
      if (escaped) {
        index += delimiterLength;
        continue;
      }
      if (linkState === "destination") {
        return {
          line,
          reason:
            "inline code는 링크 destination 안에서 사용할 수 없습니다.",
        };
      }
      const closing = closingToolingInlineCode(
        source,
        index + delimiterLength,
        delimiterLength,
      );
      if (closing < 0) {
        return {
          line,
          reason:
            "inline code delimiter는 같은 줄에서 같은 길이로 닫혀야 합니다.",
        };
      }
      index = closing + delimiterLength;
      continue;
    }
    if (character === "~") {
      let delimiterLength = 1;
      while (
        source[index + delimiterLength] === "~"
      ) {
        countReferenceProjectionOperation();
        delimiterLength += 1;
      }
      if (delimiterLength >= 3) {
        return {
          line,
          reason:
            "세 개 이상의 tilde delimiter는 list·blockquote container 안에서도 fenced code로 보고 거부합니다.",
        };
      }
      index += delimiterLength;
      continue;
    }

    if (character === "<" || character === ">") {
      return {
        line,
        reason:
          "`<`와 `>`는 create marker 또는 inline code 밖에서 허용되지 않으므로 HTML comment·tag·autolink·blockquote를 사용할 수 없습니다.",
      };
    }
    if (TOOLING_DEFAULT_IGNORABLE_PATTERN.test(character)) {
      return {
        line,
        reason:
          "default-ignorable Unicode 문자는 inline code 밖에서 허용되지 않습니다.",
      };
    }
    if (
      character === "&" &&
      toolingHtmlEntityLength(source, index) > 0
    ) {
      return {
        line,
        reason:
          "HTML entity 문법은 inline code 밖에서 허용되지 않습니다.",
      };
    }
    if (character === "!" && source[index + 1] === "[") {
      return {
        line,
        reason:
          "escape 여부와 관계없이 Markdown image 문법은 허용되지 않습니다.",
      };
    }

    if (character === "[") {
      if (escaped) {
        index += width;
        continue;
      }
      if (linkState !== "text") {
        return {
          line,
          reason:
            "중첩·reference Markdown link bracket은 허용되지 않습니다.",
        };
      }
      linkState = "label";
      index += width;
      continue;
    }
    if (character === "]") {
      if (escaped) {
        index += width;
        continue;
      }
      if (linkState !== "label") {
        return {
          line,
          reason:
            "짝이 없는 Markdown link closing bracket은 허용되지 않습니다.",
        };
      }
      if (source[index + width] !== "(") {
        return {
          line,
          reason:
            "reference definition과 full·collapsed·shortcut reference link는 허용되지 않으며 inline link는 `](`가 바로 이어져야 합니다.",
        };
      }
      linkState = "destination";
      destinationDepth = 1;
      index += width + 1;
      continue;
    }
    if (linkState === "destination") {
      if (/\s/u.test(character)) {
        return {
          line,
          reason:
            "inline link destination은 공백·title 없이 같은 줄에서 완결되어야 합니다.",
        };
      }
      if (!escaped && (character === "[" || character === "]")) {
        return {
          line,
          reason:
            "inline link destination 안의 Markdown bracket은 허용되지 않습니다.",
        };
      }
      if (!escaped && character === "(") {
        destinationDepth += 1;
      } else if (!escaped && character === ")") {
        destinationDepth -= 1;
        if (destinationDepth === 0) {
          linkState = "text";
        }
      }
    }

    index += width;
  }

  if (linkState === "label") {
    return {
      line,
      reason:
        "inline Markdown link label의 closing bracket과 destination이 없습니다.",
    };
  }
  if (linkState === "destination") {
    return {
      line,
      reason:
        "inline Markdown link destination의 closing parenthesis가 없습니다.",
    };
  }
  return null;
}

function toolingSourceLeadingIndentColumns(line) {
  let columns = 0;
  for (const character of line) {
    if (character === " ") {
      columns += 1;
      continue;
    }
    if (character === "\t") {
      columns += 4 - (columns % 4);
      continue;
    }
    break;
  }
  return columns;
}

function toolingSourceHasUnsafeListPadding(line) {
  let cursor = 0;
  while (cursor < 3 && line[cursor] === " ") {
    cursor += 1;
  }
  while (cursor < line.length) {
    const marker = line
      .slice(cursor)
      .match(/^(?:[-+*]|\d{1,9}[.)])([ \t]+)/);
    if (!marker) return false;
    const padding = marker[1];
    if (
      padding.includes("\t") ||
      padding.length >= 5
    ) {
      return true;
    }
    cursor += marker[0].length;
  }
  return false;
}

function closingToolingInlineCode(source, start, delimiterLength) {
  let cursor = start;
  while (cursor < source.length && source[cursor] !== "\n") {
    countReferenceProjectionOperation();
    if (source[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let runLength = 1;
    while (source[cursor + runLength] === "`") {
      countReferenceProjectionOperation();
      runLength += 1;
    }
    if (runLength === delimiterLength) return cursor;
    cursor += runLength;
  }
  return -1;
}

function toolingHtmlEntityLength(source, opening) {
  let cursor = opening + 1;
  const first = source[cursor];
  if (first === "#") {
    cursor += 1;
    const hexadecimal =
      source[cursor] === "x" || source[cursor] === "X";
    if (hexadecimal) cursor += 1;
    const digitStart = cursor;
    const maximumDigits = hexadecimal ? 6 : 7;
    while (
      cursor - digitStart < maximumDigits &&
      (hexadecimal
        ? /[0-9A-Fa-f]/.test(source[cursor] || "")
        : /[0-9]/.test(source[cursor] || ""))
    ) {
      countReferenceProjectionOperation();
      cursor += 1;
    }
    return cursor > digitStart && source[cursor] === ";"
      ? cursor - opening + 1
      : 0;
  }
  if (!/[A-Za-z]/.test(first || "")) return 0;
  const nameStart = cursor;
  while (
    cursor - nameStart < 32 &&
    /[A-Za-z0-9]/.test(source[cursor] || "")
  ) {
    countReferenceProjectionOperation();
    cursor += 1;
  }
  return source[cursor] === ";" ? cursor - opening + 1 : 0;
}

function maskMarkdownImages(markdown, visibility = markdown) {
  const source = String(markdown ?? "");
  const visible = String(visibility ?? "");
  const bracketPairs = markdownDelimiterPairs(visible, "[", "]");
  const ranges = [];
  let cursor = 0;
  while (cursor < visible.length - 1) {
    countReferenceProjectionOperation();
    const opening = visible.indexOf("![", cursor);
    if (opening < 0) break;
    let backslashes = 0;
    for (
      let index = opening - 1;
      index >= 0 && source[index] === "\\";
      index -= 1
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) {
      cursor = opening + 2;
      continue;
    }

    const labelEnd = bracketPairs[opening + 1] ?? -1;
    if (labelEnd < 0) {
      cursor = opening + 2;
      continue;
    }
    const destinationOpening = labelEnd + 1;
    if (visible[destinationOpening] !== "(") {
      cursor = destinationOpening;
      continue;
    }
    const destinationEnd = closingMarkdownLinkDestination(
      visible,
      destinationOpening,
    );
    if (destinationEnd < 0) {
      cursor = destinationOpening + 1;
      continue;
    }
    ranges.push({ start: opening, end: destinationEnd + 1 });
    cursor = destinationEnd + 1;
  }

  return maskMarkdownRanges(source, ranges);
}

function closingMarkdownDelimiter(source, opening, open, close) {
  let depth = 1;
  for (let index = opening + 1; index < source.length; index += 1) {
    countReferenceProjectionOperation();
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === open) depth += 1;
    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function countReferenceProjectionOperation(count = 1) {
  if (COLLECT_REFERENCE_PROJECTION_DIAGNOSTICS) {
    referenceProjectionOperations += count;
  }
}

function markdownDelimiterPairs(source, open, close) {
  const text = String(source ?? "");
  const pairs = new Int32Array(text.length);
  pairs.fill(-1);
  const openings = [];
  for (let index = 0; index < text.length; index += 1) {
    countReferenceProjectionOperation();
    if (text[index] === "\\") {
      if (index + 1 < text.length) {
        countReferenceProjectionOperation();
        index += 1;
      }
      continue;
    }
    if (text[index] === open) {
      openings.push(index);
      continue;
    }
    if (text[index] === close && openings.length > 0) {
      pairs[openings.pop()] = index;
    }
  }
  return pairs;
}

function closingMarkdownLinkDestination(source, opening) {
  let depth = 1;
  let quote = "";
  let angleDestination = false;
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (angleDestination) {
      if (character === ">") angleDestination = false;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "<") {
      angleDestination = true;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function renderedVisibleContractMarkdown(markdown) {
  const protectedRawHtml = protectRenderedRawHtmlBlocks(markdown);
  const prepared = prepareRenderedEvidenceMarkdown(
    protectedRawHtml.markdown,
  );
  const protectedDefinitions =
    protectRenderedLiteralReferenceDefinitions(prepared);
  const protectedCode = protectRenderedInlineCode(
    protectedDefinitions.markdown,
  );
  const visible = visibleContractMarkdown(protectedCode.markdown);
  const labelsOnly = preserveRenderedLinkLabels(visible);
  const entitiesDecoded = stripRenderedDefaultIgnorables(
    decodeRenderedHtmlEntities(labelsOnly, {
      collapseUnknownNamedEntities: true,
    }),
  );
  const escapesDecoded = preserveRenderedLinkLabels(
    decodeRenderedMarkdownEscapes(entitiesDecoded),
  );
  const punctuationNormalized =
    normalizeRenderedPunctuation(escapesDecoded);
  return protectedRawHtml.restore(
    protectedDefinitions.restore(
      protectedCode.restore(
        stripRenderedMarkdownEmphasis(punctuationNormalized),
      ),
    ),
  );
}

function renderedContractIds(markdown) {
  const normalized = String(markdown ?? "").replace(
    /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g,
    "-",
  );
  return new Set(
    normalized.match(RENDERED_CONTRACT_ID_PATTERN) ?? [],
  );
}

function preserveRenderedLinkLabels(markdown) {
  return String(markdown ?? "").replace(
    /\[([^\]\n]+)]\([^\n)]*\)/g,
    "$1",
  );
}

const RENDERED_HIDDEN_HTML_ELEMENTS = new Set([
  "code",
  "pre",
  "script",
  "style",
  "template",
  "textarea",
]);

const RENDERED_RAW_HTML_BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

function protectRenderedRawHtmlBlocks(markdown) {
  const source = String(markdown ?? "");
  const visibility = maskRenderedHiddenHtmlContainers(
    maskMarkdownFencedBlocks(maskMarkdownHtmlComments(source)),
  );
  const ranges = renderedRawHtmlBlockRanges(source, visibility);
  if (ranges.length === 0) {
    return {
      markdown: source,
      restore: (value) => String(value ?? ""),
    };
  }

  let marker = "\uE000LTHTML";
  while (source.includes(marker)) marker = `\uE000${marker}`;
  const replacements = [];
  let protectedMarkdown = "";
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    const token = `${marker}${index}\uE001`;
    protectedMarkdown += source.slice(cursor, range.start);
    protectedMarkdown += token;
    replacements.push({
      token,
      literal: renderedLiteralHtmlBlockText(
        source.slice(range.start, range.end),
      ),
    });
    cursor = range.end;
  }
  protectedMarkdown += source.slice(cursor);

  return {
    markdown: protectedMarkdown,
    restore(value) {
      let restored = String(value ?? "");
      for (const replacement of replacements) {
        restored = restored
          .split(replacement.token)
          .join(replacement.literal);
      }
      return restored;
    },
  };
}

function renderedRawHtmlBlockRanges(source, visibility) {
  const lines = [...String(source ?? "").matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0]);
  const ranges = [];
  let previousLineBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const rawLine = line[0].replace(/\n$/, "");
    const visibleLine = visibility.slice(
      line.index,
      line.index + rawLine.length,
    );
    const typeSix = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\t\f\r />]|$)/
      .exec(visibleLine);
    const typeSeven =
      previousLineBlank && isCompleteRawHtmlTagLine(visibleLine);
    if (
      !(
        (typeSix &&
          RENDERED_RAW_HTML_BLOCK_ELEMENTS.has(
            typeSix[1].toLowerCase(),
          )) ||
        typeSeven
      )
    ) {
      previousLineBlank = isCommonMarkBlankLine(rawLine);
      continue;
    }

    let end = line.index + line[0].length;
    let finalIndex = index;
    while (finalIndex + 1 < lines.length) {
      const next = lines[finalIndex + 1];
      const nextRaw = next[0].replace(/\n$/, "");
      if (isCommonMarkBlankLine(nextRaw)) break;
      finalIndex += 1;
      end = next.index + next[0].length;
    }
    ranges.push({ start: line.index, end });
    index = finalIndex;
    previousLineBlank = true;
  }
  return ranges;
}

function isCommonMarkBlankLine(line) {
  return /^[ \t]*$/.test(String(line ?? ""));
}

function isCompleteRawHtmlTagLine(line) {
  const source = String(line ?? "");
  const leading = /^ {0,3}/.exec(source)?.[0].length ?? 0;
  if (source[leading] !== "<") return false;
  const tags = scanRenderedHtmlTags(source);
  if (tags.length !== 1 || tags[0].start !== leading) return false;
  return source.slice(tags[0].end).trim() === "";
}

function renderedLiteralHtmlBlockText(markdown) {
  const withoutComments = maskMarkdownHtmlComments(markdown);
  const withoutHidden =
    maskRenderedHiddenHtmlContainers(withoutComments);
  const withoutTags = removeMarkdownRanges(
    withoutHidden,
    scanRenderedHtmlTags(withoutHidden)
      .map(({ start, end }) => ({ start, end })),
  );
  const normalized = normalizeRenderedPunctuation(
    stripRenderedDefaultIgnorables(
      decodeRenderedHtmlEntities(withoutTags, {
        collapseUnknownNamedEntities: true,
      }),
    ),
  );
  return normalized.replace(/^/gm, "\u00A0");
}

function prepareRenderedEvidenceMarkdown(markdown) {
  const source = String(markdown ?? "");
  const resolutionVisibility =
    referenceResolutionVisibleMarkdown(source);
  const definitions = collectVisibleReferenceDefinitions(
    source,
    resolutionVisibility,
  );
  const withoutDefinitions = maskMarkdownRanges(
    source,
    definitions.ranges,
  );
  const withoutDefinitionsVisibility = maskMarkdownRanges(
    resolutionVisibility,
    definitions.ranges,
  );
  const resolvedLinks = collapseResolvedReferenceLinks(
    withoutDefinitions,
    withoutDefinitionsVisibility,
    definitions.labels,
  );
  const withoutInlineHtml = stripRenderedInlineHtmlTags(resolvedLinks);
  const imageVisibility =
    referenceResolutionVisibleMarkdown(withoutInlineHtml);
  const withoutInlineImages = maskMarkdownImages(
    withoutInlineHtml,
    imageVisibility,
  );
  return preserveRenderedReferenceImageLabels(
    withoutInlineImages,
    referenceResolutionVisibleMarkdown(withoutInlineImages),
    definitions.labels,
  );
}

function protectRenderedLiteralReferenceDefinitions(markdown) {
  const source = String(markdown ?? "");
  const colonOffsets = [];
  for (const match of source.matchAll(/^ {0,3}\[[^\]\n]+](:)/gm)) {
    colonOffsets.push(match.index + match[0].length - 1);
  }
  if (colonOffsets.length === 0) {
    return {
      markdown: source,
      restore: (value) => String(value ?? ""),
    };
  }

  let marker = "\uE000LTREFCOLON";
  while (source.includes(marker)) marker = `\uE000${marker}`;
  let protectedMarkdown = "";
  let cursor = 0;
  for (const [index, offset] of colonOffsets.entries()) {
    const token = `${marker}${index}\uE001`;
    protectedMarkdown += source.slice(cursor, offset);
    protectedMarkdown += token;
    cursor = offset + 1;
  }
  protectedMarkdown += source.slice(cursor);
  return {
    markdown: protectedMarkdown,
    restore(value) {
      let restored = String(value ?? "");
      for (let index = 0; index < colonOffsets.length; index += 1) {
        restored = restored
          .split(`${marker}${index}\uE001`)
          .join(":");
      }
      return restored;
    },
  };
}

function referenceResolutionVisibleMarkdown(markdown) {
  const withoutComments = maskMarkdownHtmlComments(markdown);
  const withoutFences = maskMarkdownFencedBlocks(withoutComments);
  const withoutInlineCode = maskMarkdownInlineCode(withoutFences);
  return maskRenderedHiddenHtmlContainers(withoutInlineCode);
}

function maskMarkdownRanges(markdown, ranges) {
  const source = String(markdown ?? "");
  if (ranges.length === 0) return source;
  let result = "";
  let cursor = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.end <= cursor) continue;
    const start = Math.max(cursor, range.start);
    result += source.slice(cursor, start);
    result += source.slice(start, range.end).replace(/[^\n]/g, " ");
    cursor = range.end;
  }
  return result + source.slice(cursor);
}

function removeMarkdownRanges(markdown, ranges) {
  const source = String(markdown ?? "");
  if (ranges.length === 0) return source;
  let result = "";
  let cursor = 0;
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.end <= cursor) continue;
    result += source.slice(cursor, Math.max(cursor, range.start));
    cursor = Math.max(cursor, range.end);
  }
  return result + source.slice(cursor);
}

function maskMarkdownHtmlComments(markdown) {
  const source = String(markdown ?? "");
  const ranges = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<!--", cursor);
    if (start < 0) break;
    const closing = source.indexOf("-->", start + 4);
    const end = closing < 0 ? source.length : closing + 3;
    ranges.push({ start, end });
    cursor = end;
  }
  return maskMarkdownRanges(source, ranges);
}

function maskMarkdownFencedBlocks(markdown) {
  const source = String(markdown ?? "");
  const ranges = [];
  let open;
  let offset = 0;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    const rawLine = match[0];
    if (!rawLine) break;
    const line = rawLine.replace(/\n$/, "");
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!open) {
        open = {
          character: marker[0],
          length: marker.length,
          start: offset,
        };
      } else if (
        marker[0] === open.character &&
        marker.length >= open.length &&
        fence[2].trim() === ""
      ) {
        ranges.push({ start: open.start, end: offset + rawLine.length });
        open = undefined;
      }
    }
    offset += rawLine.length;
  }
  if (open) ranges.push({ start: open.start, end: source.length });
  return maskMarkdownRanges(source, ranges);
}

function markdownInlineCodeRanges(markdown, visibility = markdown) {
  const source = String(markdown ?? "");
  const visible = String(visibility ?? "");
  const ranges = [];
  let cursor = 0;
  while (cursor < visible.length) {
    const opening = visible.indexOf("`", cursor);
    if (opening < 0) break;
    if (isEscapedMarkdownCharacter(source, opening)) {
      cursor = opening + 1;
      continue;
    }
    let openingEnd = opening;
    while (visible[openingEnd] === "`") openingEnd += 1;
    const delimiterLength = openingEnd - opening;
    let candidate = openingEnd;
    let closing = -1;
    while (candidate < visible.length) {
      candidate = visible.indexOf("`", candidate);
      if (candidate < 0) break;
      let candidateEnd = candidate;
      while (visible[candidateEnd] === "`") candidateEnd += 1;
      if (
        candidateEnd - candidate === delimiterLength &&
        !isEscapedMarkdownCharacter(source, candidate)
      ) {
        closing = candidate;
        break;
      }
      candidate = candidateEnd;
    }
    if (closing < 0) {
      cursor = openingEnd;
      continue;
    }
    const end = closing + delimiterLength;
    ranges.push({ start: opening, end });
    cursor = end;
  }
  return ranges;
}

function maskMarkdownInlineCode(markdown) {
  const source = String(markdown ?? "");
  const ranges = markdownInlineCodeRanges(source);
  return maskMarkdownRanges(source, ranges);
}

function protectRenderedInlineCode(markdown) {
  const source = String(markdown ?? "");
  const withoutComments = maskMarkdownHtmlComments(source);
  const visibility = maskRenderedHiddenHtmlContainers(
    maskMarkdownFencedBlocks(withoutComments),
  );
  const ranges = markdownInlineCodeRanges(source, visibility);
  if (ranges.length === 0) {
    return {
      markdown: source,
      restore: (value) => String(value ?? ""),
    };
  }

  let marker = "\uE000LTCODE";
  while (source.includes(marker)) marker = `\uE000${marker}`;
  const replacements = [];
  let protectedMarkdown = "";
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    const token = `${marker}${index}\uE001`;
    protectedMarkdown += source.slice(cursor, range.start);
    protectedMarkdown += token;
    replacements.push({
      token,
      raw: source.slice(range.start, range.end),
    });
    cursor = range.end;
  }
  protectedMarkdown += source.slice(cursor);

  return {
    markdown: protectedMarkdown,
    restore(value) {
      let restored = String(value ?? "");
      for (const replacement of replacements) {
        restored = restored.split(replacement.token).join(replacement.raw);
      }
      return restored;
    },
  };
}

function visibleContractMarkdownPreservingInlineCode(markdown) {
  const protectedCode = protectRenderedInlineCode(markdown);
  return protectedCode.restore(
    visibleContractMarkdown(protectedCode.markdown),
  );
}

function isEscapedMarkdownCharacter(source, index) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function scanRenderedHtmlTags(markdown) {
  const source = String(markdown ?? "");
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;
    if (isEscapedMarkdownCharacter(source, start)) {
      cursor = start + 1;
      continue;
    }
    let index = start + 1;
    if (source[index] === "/") index += 1;
    if (!/[A-Za-z]/.test(source[index] ?? "")) {
      cursor = start + 1;
      continue;
    }
    let quote = "";
    while (index < source.length) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      index += 1;
    }
    if (index >= source.length) {
      cursor = start + 1;
      continue;
    }
    const raw = source.slice(start, index + 1);
    const parsed =
      /^<\/?\s*([A-Za-z][A-Za-z0-9-]*)(?=[\t\n\f\r />])/.exec(raw);
    if (parsed) {
      tags.push({
        start,
        end: index + 1,
        name: parsed[1].toLowerCase(),
        closing: /^<\//.test(raw),
        selfClosing: /\/\s*>$/.test(raw),
      });
    }
    cursor = index + 1;
  }
  return tags;
}

function maskRenderedHiddenHtmlContainers(markdown) {
  const source = String(markdown ?? "");
  const ranges = [];
  const stack = [];
  for (const tag of scanRenderedHtmlTags(source)) {
    if (!RENDERED_HIDDEN_HTML_ELEMENTS.has(tag.name)) continue;
    if (!tag.closing && !tag.selfClosing) {
      stack.push(tag);
      continue;
    }
    if (!tag.closing) continue;
    const openingIndex = stack
      .map((opening) => opening.name)
      .lastIndexOf(tag.name);
    if (openingIndex < 0) continue;
    const [opening] = stack.splice(openingIndex, 1);
    ranges.push({ start: opening.start, end: tag.end });
  }
  for (const opening of stack) {
    ranges.push({ start: opening.start, end: source.length });
  }
  return maskMarkdownRanges(source, ranges);
}

function collectVisibleReferenceDefinitions(source, visibility) {
  const lines = [...String(source ?? "").matchAll(/[^\n]*(?:\n|$)/g)].filter(
    (match) => match[0],
  );
  const labels = new Set();
  const ranges = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const rawLine = line[0].replace(/\n$/, "");
    const visibleLine = visibility
      .slice(line.index, line.index + rawLine.length);
    const opening = /^ {0,3}\[/.exec(visibleLine);
    if (!opening) continue;
    const labelOpening = opening[0].length - 1;
    const labelEnd = closingMarkdownDelimiter(
      visibleLine,
      labelOpening,
      "[",
      "]",
    );
    if (labelEnd < 0 || visibleLine[labelEnd + 1] !== ":") continue;

    const rawLabel = rawLine.slice(labelOpening + 1, labelEnd);
    const normalized = normalizeReferenceLabel(
      rawLabel,
    );
    if (
      !normalized ||
      [...rawLabel].length > 999 ||
      containsUnescapedMarkdownDelimiter(rawLabel, "[", "]")
    ) {
      continue;
    }

    let destinationLineIndex = index;
    let destinationText = visibleLine.slice(labelEnd + 2);
    if (/^[ \t]*$/.test(destinationText)) {
      destinationLineIndex += 1;
      if (!lines[destinationLineIndex]) continue;
      const continuation = visibleLineAt(
        visibility,
        lines[destinationLineIndex],
      );
      if (!/^ {0,3}\S/.test(continuation)) continue;
      destinationText = continuation;
    }
    const parsedDestination =
      parseCommonMarkReferenceDestinationAndTitle(destinationText);
    if (!parsedDestination.valid) continue;

    let finalLineIndex = destinationLineIndex;
    if (
      !parsedDestination.hasTitle &&
      lines[finalLineIndex + 1]
    ) {
      const possibleTitle = visibleLineAt(
        visibility,
        lines[finalLineIndex + 1],
      );
      if (
        /^ {0,3}\S/.test(possibleTitle) &&
        parseCommonMarkReferenceTitle(possibleTitle.trim()).valid
      ) {
        finalLineIndex += 1;
      }
    }

    const definitionEnd =
      lines[finalLineIndex].index + lines[finalLineIndex][0].length;
    labels.add(normalized);
    ranges.push({ start: line.index, end: definitionEnd });
    index = finalLineIndex;
  }
  return { labels, ranges };
}

function visibleLineAt(visibility, line) {
  const rawLine = line[0].replace(/\n$/, "");
  return visibility.slice(line.index, line.index + rawLine.length);
}

function containsUnescapedMarkdownDelimiter(source, ...delimiters) {
  const values = new Set(delimiters);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (values.has(source[index])) return true;
  }
  return false;
}

function parseCommonMarkReferenceDestinationAndTitle(value) {
  const source = String(value ?? "");
  let cursor = 0;
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  if (cursor >= source.length) return { valid: false, hasTitle: false };

  if (source[cursor] === "<") {
    cursor += 1;
    let closed = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += Math.min(2, source.length - cursor);
        continue;
      }
      if (character === "<") {
        return { valid: false, hasTitle: false };
      }
      if (character === ">") {
        cursor += 1;
        closed = true;
        break;
      }
      cursor += 1;
    }
    if (!closed) return { valid: false, hasTitle: false };
  } else {
    const destinationStart = cursor;
    let depth = 0;
    while (
      cursor < source.length &&
      source[cursor] !== " " &&
      source[cursor] !== "\t"
    ) {
      const character = source[cursor];
      if (/[\u0000-\u001F\u007F]/.test(character)) {
        return { valid: false, hasTitle: false };
      }
      if (character === "\\") {
        cursor += Math.min(2, source.length - cursor);
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        if (depth === 0) return { valid: false, hasTitle: false };
        depth -= 1;
      }
      cursor += 1;
    }
    if (cursor === destinationStart || depth !== 0) {
      return { valid: false, hasTitle: false };
    }
  }

  if (cursor >= source.length) return { valid: true, hasTitle: false };
  if (source[cursor] !== " " && source[cursor] !== "\t") {
    return { valid: false, hasTitle: false };
  }
  while (source[cursor] === " " || source[cursor] === "\t") cursor += 1;
  if (cursor >= source.length) return { valid: true, hasTitle: false };
  const title = parseCommonMarkReferenceTitle(source.slice(cursor));
  return {
    valid: title.valid,
    hasTitle: title.valid,
  };
}

function parseCommonMarkReferenceTitle(value) {
  const source = String(value ?? "");
  const opening = source[0];
  const closing =
    opening === "(" ? ")" : opening === '"' || opening === "'" ? opening : "";
  if (!closing) return { valid: false };
  for (let cursor = 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (opening === "(" && source[cursor] === "(") {
      return { valid: false };
    }
    if (source[cursor] !== closing) continue;
    return {
      valid: /^[ \t]*$/.test(source.slice(cursor + 1)),
    };
  }
  return { valid: false };
}

function normalizeReferenceLabel(label) {
  const normalized = decodeRenderedMarkdownEscapes(
    decodeRenderedHtmlEntities(String(label ?? "")),
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized && [...normalized].length <= 999 ? normalized : "";
}

function collapseResolvedReferenceLinks(source, visibility, definitions) {
  if (definitions.size === 0) return source;
  const bracketPairs = markdownDelimiterPairs(visibility, "[", "]");
  let result = "";
  let copiedThrough = 0;
  let cursor = 0;
  while (cursor < source.length) {
    countReferenceProjectionOperation();
    const labelOpening = visibility.indexOf("[", cursor);
    if (labelOpening < 0) break;
    if (
      isEscapedMarkdownCharacter(source, labelOpening) ||
      (source[labelOpening - 1] === "!" &&
        !isEscapedMarkdownCharacter(source, labelOpening - 1))
    ) {
      cursor = labelOpening + 1;
      continue;
    }
    const labelEnd = bracketPairs[labelOpening] ?? -1;
    if (labelEnd < 0 || visibility[labelEnd + 1] !== "[") {
      cursor = labelOpening + 1;
      continue;
    }
    const keyOpening = labelEnd + 1;
    const keyEnd = bracketPairs[keyOpening] ?? -1;
    if (keyEnd < 0) {
      cursor = labelOpening + 1;
      continue;
    }
    const rawLabel = source.slice(labelOpening + 1, labelEnd);
    const rawKey = source.slice(keyOpening + 1, keyEnd);
    const key = normalizeReferenceLabel(rawKey || rawLabel);
    if (!definitions.has(key)) {
      cursor = keyEnd + 1;
      continue;
    }
    result += source.slice(copiedThrough, labelOpening);
    result += rawLabel;
    copiedThrough = keyEnd + 1;
    cursor = copiedThrough;
  }
  return result + source.slice(copiedThrough);
}

function stripRenderedInlineHtmlTags(markdown) {
  const source = String(markdown ?? "");
  const visibility = referenceResolutionVisibleMarkdown(source);
  const ranges = scanRenderedHtmlTags(visibility)
    .map(({ start, end }) => ({ start, end }));
  return removeMarkdownRanges(source, ranges);
}

function preserveRenderedReferenceImageLabels(
  markdown,
  visibility = markdown,
  definitions = new Set(),
) {
  const source = String(markdown ?? "");
  const visible = String(visibility ?? "");
  const bracketPairs = markdownDelimiterPairs(visible, "[", "]");
  let result = "";
  let copiedThrough = 0;
  let cursor = 0;
  while (cursor < visible.length - 1) {
    countReferenceProjectionOperation();
    const opening = visible.indexOf("![", cursor);
    if (opening < 0) break;
    const labelOpening = opening + 1;
    const labelEnd = bracketPairs[labelOpening] ?? -1;
    if (labelEnd < 0) {
      cursor = opening + 2;
      continue;
    }
    const rawLabel = source.slice(labelOpening + 1, labelEnd);
    let rawKey = rawLabel;
    let end = labelEnd + 1;
    if (visible[end] === "[") {
      const keyEnd = bracketPairs[end] ?? -1;
      if (keyEnd >= 0) {
        rawKey = source.slice(end + 1, keyEnd) || rawLabel;
        end = keyEnd + 1;
      }
    }
    result += source.slice(copiedThrough, opening);
    if (definitions.has(normalizeReferenceLabel(rawKey))) {
      result += source.slice(opening, end).replace(/[^\n]/g, " ");
    } else {
      result += rawLabel;
    }
    copiedThrough = end;
    cursor = end;
  }
  return result + source.slice(copiedThrough);
}

const RENDERED_NAMED_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["ast", "*"],
  ["bsol", "\\"],
  ["colon", ":"],
  ["dash", "-"],
  ["frasl", "/"],
  ["gt", ">"],
  ["horbar", "―"],
  ["hyphen", "-"],
  ["lowbar", "_"],
  ["lt", "<"],
  ["mdash", "—"],
  ["minus", "-"],
  ["nbsp", " "],
  ["ndash", "-"],
  ["period", "."],
  ["quot", '"'],
  ["sol", "/"],
]);

function decodeRenderedHtmlEntities(
  markdown,
  { collapseUnknownNamedEntities = false } = {},
) {
  return String(markdown ?? "").replace(
    /&(?:#([0-9]{1,7})|#x([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g,
    (entity, decimal, hexadecimal, named) => {
      if (named) {
        return (
          RENDERED_NAMED_ENTITIES.get(named.toLowerCase()) ??
          (collapseUnknownNamedEntities ? "" : entity)
        );
      }
      const codePoint = Number.parseInt(decimal ?? hexadecimal, decimal ? 10 : 16);
      if (
        !Number.isInteger(codePoint) ||
        codePoint <= 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return "\uFFFD";
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function stripRenderedDefaultIgnorables(markdown) {
  return String(markdown ?? "")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "");
}

function normalizeRenderedPunctuation(markdown) {
  return String(markdown ?? "")
    .replace(/[\u2010-\u2013\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2044\u2215\u29F8\uFF0F]/g, "/");
}

function decodeRenderedMarkdownEscapes(markdown) {
  const source = String(markdown ?? "");
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    const codePoint = next?.codePointAt(0) ?? 0;
    const escapable =
      (codePoint >= 33 && codePoint <= 47) ||
      (codePoint >= 58 && codePoint <= 64) ||
      (codePoint >= 91 && codePoint <= 96) ||
      (codePoint >= 123 && codePoint <= 126);
    if (character === "\\" && escapable) {
      result += next;
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

function stripRenderedMarkdownEmphasis(markdown) {
  let result = String(markdown ?? "");
  for (let pass = 0; pass < 4; pass += 1) {
    const stripped = result
      .replace(
        /(?<![A-Za-z0-9_])(_{1,2})(?=\S)([^\n]*?\S)\1(?![A-Za-z0-9_])/g,
        "$2",
      )
      .replace(
        /(?<![A-Za-z0-9*])(\*{1,3})(?=\S)([^\n]*?\S)\1(?![A-Za-z0-9*])/g,
        "$2",
      )
      .replace(
        /(?<!~)~~(?=\S)([^\n]*?\S)~~(?!~)/g,
        "$1",
      );
    if (stripped === result) break;
    result = stripped;
  }
  return result;
}

function parseToolingTraceability(traceability) {
  const lines = traceability.split(/\r?\n/);
  const matching = lines.filter((line) =>
    line.trimStart().startsWith(`- ${TOOLING_TRACE_PREFIX}`),
  );
  if (matching.length !== 1) {
    return {
      present: matching.length > 0 || traceability.includes(TOOLING_TRACE_PREFIX),
      valid: false,
      reason: "",
    };
  }
  const line = matching[0];
  const canonicalPrefix = `- ${TOOLING_TRACE_PREFIX} `;
  const reason = line.startsWith(canonicalPrefix)
    ? line.slice(canonicalPrefix.length).trim()
    : "";
  return {
    present: true,
    valid:
      line === `${canonicalPrefix}${reason}` &&
      isMeaningfulSection(reason),
    reason,
  };
}

function validateToolingTraceability(
  parsed,
  renderedParsed,
  labels,
  toolingTrace,
  errors,
) {
  if (!toolingTrace.valid) {
    errors.push(
      `"추적성" 섹션에는 전역 네임스페이스가 있는 PRD 또는 정책 ID가 하나 이상 필요합니다. 제품 계약 비적용은 실제 type:chore 레이블과 "- ${TOOLING_TRACE_PREFIX} <구체적 사유>" 한 줄을 사용해야 합니다.`,
    );
    return;
  }

  const rawLabels = labels.map((label) => String(label));
  const typeLabels = rawLabels
    .filter((label) => label.startsWith("type:"));
  const nonCanonicalTypeLabels = rawLabels.filter(
    (label) =>
      label !== label.trim() &&
      label.trim().startsWith("type:"),
  );
  if (
    nonCanonicalTypeLabels.length > 0 ||
    typeLabels.length !== 1 ||
    typeLabels[0] !== "type:chore"
  ) {
    errors.push(
      `"${TOOLING_TRACE_PREFIX}" 비적용 선언은 실제 type label이 type:chore 하나일 때만 사용할 수 있으며 raw 문자열이 정확히 type:chore여야 합니다. 현재 canonical-prefix labels: ${JSON.stringify(typeLabels)}, whitespace 변형 type-like labels: ${nonCanonicalTypeLabels.length}.`,
    );
  }

  const acceptance = parsed.sections.get("완료 조건") || "";
  const renderedAcceptance =
    renderedParsed.sections.get("완료 조건") || "";
  const acceptanceTraceLines = acceptance
    .split(/\r?\n/)
    .filter((line) => /^- 추적 ID:\s*/.test(line));
  if (
    acceptanceTraceLines.length === 0 ||
    acceptanceTraceLines.some((line) => {
      const prefix = `- 추적 ID: ${TOOLING_TRACE_PREFIX} `;
      const reason = line.startsWith(prefix)
        ? line.slice(prefix.length).trim()
        : "";
      return line !== `${prefix}${reason}` || !isMeaningfulSection(reason);
    })
  ) {
    errors.push(
      `"완료 조건"의 각 "- 추적 ID:" 행은 "${TOOLING_TRACE_PREFIX} <구체적 사유>" 형식이어야 합니다.`,
    );
  }
  if (
    renderedContractIds(renderedAcceptance).size > 0
  ) {
    errors.push(
      `"완료 조건"은 제품 계약 ID와 "${TOOLING_TRACE_PREFIX}" 비적용 선언을 함께 사용할 수 없습니다.`,
    );
  }

  const documentImpact = parsed.sections.get("문서 영향") || "";
  const documentImpactLines = documentImpact
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- 제품 문서: 변경 없음 — "));
  if (
    documentImpactLines.length !== 1 ||
    !isMeaningfulSection(
      documentImpactLines[0]?.slice(
        "- 제품 문서: 변경 없음 — ".length,
      ) || "",
    )
  ) {
    errors.push(
      `"문서 영향"에는 "- 제품 문서: 변경 없음 — <구체적 근거>" 한 줄이 필요합니다.`,
    );
  }

  const allowedPaths =
    renderedParsed.sections.get("변경 허용 경로") || "";
  if (allowedPathScopesIntersectProductContracts(allowedPaths)) {
    errors.push(
      `"${TOOLING_TRACE_PREFIX}" 비적용 이슈는 "변경 허용 경로"에 docs/prd 또는 docs/policies 정본과 교차하는 상위·glob·정규화 경로 범위를 포함할 수 없습니다.`,
    );
  }
}

function validatePlannedTraceability(parsed, renderedParsed, errors) {
  const traceability = renderedParsed.sections.get("추적성") || "";
  const allowedPaths =
    renderedParsed.sections.get("변경 허용 경로") || "";
  const forbiddenPaths =
    renderedParsed.sections.get("변경 금지 경로") || "";
  const documentImpact =
    renderedParsed.sections.get("문서 영향") || "";
  const allowedPathScopes = productPathScopes(allowedPaths);
  const forbiddenPathScopes = productPathScopes(forbiddenPaths);
  const documentImpactScopes = productPathScopes(documentImpact);

  let definedIds;
  try {
    definedIds = definedProductContractIds(process.cwd());
  } catch (error) {
    errors.push(`제품 정본 ID를 확인할 수 없습니다: ${error.message}`);
    return;
  }

  for (const id of renderedContractIds(traceability)) {
    const line =
      traceability
        .split(/\r?\n/)
        .find((candidate) => renderedContractIds(candidate).has(id)) ?? "";
    const planned = new RegExp(
      `${escapeRegex(id)} planned — 이 PR에서 정의(?![A-Za-z0-9가-힣_-])`,
    ).test(line);
    const directory = id.startsWith("PRD-")
      ? "docs/prd"
      : "docs/policies";
    const ownedScopes = allowedPathScopes.filter((scope) =>
      isCanonicalContractDefinitionScope(scope, id, directory),
    );
    const impactOwnsDefinition = documentImpact
      .split(/\r?\n/)
      .some((impactLine) => {
        if (!renderedContractIds(impactLine).has(id)) return false;
        return productPathScopes(impactLine).some((scope) =>
          isCanonicalContractDefinitionScope(scope, id, directory),
        );
      });

    if (definedIds.has(id)) {
      if (planned) {
        errors.push(
          `이미 정본에 정의된 ${id}에는 planned 표식을 사용할 수 없습니다.`,
        );
      }
      continue;
    }

    if (!planned) {
      errors.push(
        `정본에 아직 없는 ${id}는 "planned — 이 PR에서 정의"로 선언해야 합니다.`,
      );
    }
    if (ownedScopes.length === 0) {
      errors.push(
        `${id} planned 정의에는 "변경 허용 경로"의 namespace가 일치하는 구체적 ${directory}/NN_*.md 정본 파일이 필요합니다.`,
      );
    }
    if (
      ownedScopes.some((owned) =>
        forbiddenPathScopes.some((forbidden) =>
          pathScopesOverlap(owned, forbidden),
        ),
      )
    ) {
      errors.push(
        `${id} planned 정의의 ${directory}/ 정본 경로가 "변경 금지 경로"의 상위·동일·하위 범위와 충돌합니다.`,
      );
    }
    if (
      !impactOwnsDefinition
    ) {
      errors.push(
        `${id} planned 정의는 "문서 영향"의 같은 항목에서 ID와 namespace가 일치하는 구체적 ${directory}/NN_*.md 정본 파일을 함께 소유해야 합니다.`,
      );
    }
  }
}

function isCanonicalContractDefinitionScope(scope, id, directory) {
  if (
    scope.recursive ||
    !scope.path.startsWith(`${directory}/`) ||
    !scope.path.endsWith(".md")
  ) {
    return false;
  }
  const namespace = id.match(/^(?:PRD|POL)-(\d{2,})-/)?.[1];
  const filename = scope.path.split("/").at(-1) ?? "";
  return Boolean(namespace) && new RegExp(`^${namespace}_.+\\.md$`).test(filename);
}

function productPathScopes(markdown) {
  const scopes = [];
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    if (!/^ {0,3}[-+*][ \t]+\S/.test(line)) continue;
    for (const match of line.matchAll(
      /(?<![A-Za-z0-9._/-])((?:\.\/)?docs(?:\/(?:[A-Za-z0-9._-]+|\*\*))+\/?)(?![A-Za-z0-9._/-])/g,
    )) {
      const token = match[1].replace(/^\.\//, "");
      if (token.includes("*") && !token.endsWith("/**")) continue;
      const recursiveSuffix =
        token.endsWith("/**") || token.endsWith("/");
      const path = token
        .replace(/\/\*\*$/, "")
        .replace(/\/$/, "");
      if (!path || path.split("/").includes("..")) continue;
      scopes.push({
        path,
        recursive:
          recursiveSuffix ||
          ["docs", "docs/prd", "docs/policies"].includes(path),
      });
    }
  }
  return scopes;
}

const PRODUCT_CONTRACT_PATH_SCOPES = [
  { path: "docs/prd", recursive: true },
  { path: "docs/policies", recursive: true },
];

function allowedPathScopesIntersectProductContracts(markdown) {
  for (const token of renderedScopeTokens(markdown)) {
    const scope = normalizeAllowedPathScope(token);
    if (!scope) continue;
    if (scope.invalid || scope.escapedRoot) return true;
    if (scope.globPatterns) {
      if (
        scope.globPatterns.some((globPattern) =>
          PRODUCT_CONTRACT_PATH_SCOPES.some((productScope) =>
            globScopeIntersectsPath(
              globPattern,
              productScope.path.split("/"),
            ),
          ),
        )
      ) {
        return true;
      }
      continue;
    }
    if (
      PRODUCT_CONTRACT_PATH_SCOPES.some((productScope) =>
        pathScopesOverlap(scope, productScope),
      )
    ) {
      return true;
    }
  }
  return false;
}

function renderedScopeTokens(markdown) {
  const tokens = [];
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    for (const match of line.matchAll(/`[^`\n]+`|[^\s|]+/g)) {
      const inlineCode =
        match[0].startsWith("`") && match[0].endsWith("`");
      if (!inlineCode) {
        for (const fragment of match[0].matchAll(
          /(?<![A-Za-z0-9._/-])((?:\.\/)?docs(?:\/(?:[A-Za-z0-9._-]+|\*\*))+\/?)(?![A-Za-z0-9._/-])/g,
        )) {
          tokens.push(fragment[1]);
        }
      }
      const token = match[0]
        .replace(/^`+|`+$/g, "")
        .replace(/^[("'“‘]+/, "")
        .replace(/[)"'”’、,;:]+$/, "")
        .replace(/^\[+|\]+$/g, "");
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

function normalizeAllowedPathScope(token) {
  let value = String(token ?? "").trim();
  if (
    !value ||
    value.includes("://")
  ) {
    return null;
  }
  if (
    value.length > 512 ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    /[@+?!*]\(/.test(value) ||
    (value.includes("|") && /[()]/.test(value))
  ) {
    return { invalid: true };
  }

  const recursive = value.endsWith("/");
  const segments = [];
  let escapedRoot = false;
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else {
        escapedRoot = true;
      }
      continue;
    }
    segments.push(segment);
  }
  if (segments.length > 64) return { invalid: true };

  const path = segments.join("/");
  const hasGlob = segments.some((segment) => /[*?[\]{}]/.test(segment));
  const expandedGlob = hasGlob
    ? expandConservativeGlobPatterns(segments)
    : null;
  if (expandedGlob && !expandedGlob.valid) {
    return { invalid: true };
  }
  return {
    path,
    recursive: recursive || path === "" || !hasGlob,
    escapedRoot,
    globPatterns: expandedGlob?.patterns ?? null,
  };
}

const MAX_GLOB_ALTERNATIVES = 32;

function expandConservativeGlobPatterns(segments) {
  let patterns = [[]];
  for (const segment of segments) {
    const expansion = expandConservativeBraceSegment(segment);
    if (!expansion.valid) return { valid: false, patterns: [] };
    const next = [];
    for (const prefix of patterns) {
      for (const alternative of expansion.alternatives) {
        if (!isSupportedGlobSegment(alternative)) {
          return { valid: false, patterns: [] };
        }
        next.push([...prefix, alternative]);
        if (next.length > MAX_GLOB_ALTERNATIVES) {
          return { valid: false, patterns: [] };
        }
      }
    }
    patterns = next;
  }
  return { valid: true, patterns };
}

function expandConservativeBraceSegment(segment) {
  let alternatives = [segment];
  while (alternatives.some((value) => /[{}]/.test(value))) {
    const next = [];
    for (const value of alternatives) {
      const opening = value.indexOf("{");
      const strayClosing = value.indexOf("}");
      if (opening < 0 || (strayClosing >= 0 && strayClosing < opening)) {
        return { valid: false, alternatives: [] };
      }
      const closing = value.indexOf("}", opening + 1);
      if (
        closing < 0 ||
        value.slice(opening + 1, closing).includes("{")
      ) {
        return { valid: false, alternatives: [] };
      }
      const choices = value.slice(opening + 1, closing).split(",");
      if (
        choices.length < 2 ||
        choices.some((choice) => choice.length === 0)
      ) {
        return { valid: false, alternatives: [] };
      }
      for (const choice of choices) {
        next.push(
          `${value.slice(0, opening)}${choice}${value.slice(closing + 1)}`,
        );
        if (next.length > MAX_GLOB_ALTERNATIVES) {
          return { valid: false, alternatives: [] };
        }
      }
    }
    alternatives = next;
  }
  return { valid: true, alternatives };
}

function isSupportedGlobSegment(segment) {
  for (let index = 0; index < segment.length; index += 1) {
    if (segment[index] === "]") return false;
    if (segment[index] !== "[") continue;
    const closing = segment.indexOf("]", index + 1);
    if (closing < 0) return false;
    let content = segment.slice(index + 1, closing);
    if (content.startsWith("!") || content.startsWith("^")) {
      content = content.slice(1);
    }
    if (!content || content.includes("[")) return false;
    index = closing;
  }
  return true;
}

function globScopeIntersectsPath(patternSegments, targetSegments) {
  const memo = new Map();
  function visit(patternIndex, targetIndex) {
    const key = `${patternIndex}:${targetIndex}`;
    if (memo.has(key)) return memo.get(key);
    if (patternIndex === patternSegments.length) {
      memo.set(key, true);
      return true;
    }

    const pattern = patternSegments[patternIndex];
    let result;
    if (pattern === "**") {
      result =
        visit(patternIndex + 1, targetIndex) ||
        (targetIndex < targetSegments.length &&
          visit(patternIndex, targetIndex + 1));
    } else if (targetIndex < targetSegments.length) {
      result =
        globSegmentMatches(pattern, targetSegments[targetIndex]) &&
        visit(patternIndex + 1, targetIndex + 1);
    } else {
      result =
        globSegmentCanMatch(pattern) &&
        visit(patternIndex + 1, targetIndex);
    }
    memo.set(key, result);
    return result;
  }
  return visit(0, 0);
}

function globSegmentMatches(pattern, value) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      expression += ".*";
    } else if (character === "?") {
      expression += ".";
    } else if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      let content = pattern.slice(index + 1, close);
      if (content.startsWith("!")) {
        content = `^${content.slice(1)}`;
      } else if (content.startsWith("^")) {
        content = `\\${content}`;
      } else {
        content = content.replace(/\\/g, "\\\\");
      }
      expression += `[${content}]`;
      index = close;
    } else {
      expression += escapeRegex(character);
    }
  }
  try {
    return new RegExp(`${expression}$`).test(value);
  } catch {
    return true;
  }
}

function globSegmentCanMatch(pattern) {
  return pattern.length > 0;
}

function pathScopeContains(scope, candidate) {
  return (
    scope.path === candidate.path ||
    (scope.recursive && scope.path === "") ||
    (scope.recursive &&
      candidate.path.startsWith(`${scope.path}/`))
  );
}

function pathScopesOverlap(left, right) {
  return pathScopeContains(left, right) || pathScopeContains(right, left);
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
    const valid = validPrefix && match[2].length >= 2;
    if (!valid) matches.push(match[0]);
  }
  return [...new Set(matches)].sort();
}

function parseIssueBody(body) {
  const sections = new Map();
  const headings = [];
  let active = null;
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      if (active !== null) {
        sections.set(active, `${sections.get(active)}${line}\n`);
      }
      continue;
    }
    if (fence !== null) {
      if (active !== null) {
        sections.set(active, `${sections.get(active)}${line}\n`);
      }
      continue;
    }

    const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
    if (match) {
      const name = match[2].replace(/\s+#+\s*$/, "").trim();
      headings.push({ name, level: match[1].length });
      active = name;
      if (!sections.has(active)) sections.set(active, "");
    } else if (active !== null) {
      sections.set(active, `${sections.get(active)}${line}\n`);
    }
  }
  return { headings, sections };
}

function isMeaningfulSection(content) {
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, "");
  const visible = withoutComments
    .replace(/[`*_>#\-[\](){}|]/g, "")
    .replace(/\s+/g, "");
  if (visible.length < 8) return false;
  const normalized = visible.toLowerCase().replace(/[.,:;!?]/g, "");
  if (
    /^(?:x+|tbd|todo|na|none|noresponse|없음|응답없음|해당없음)$/.test(
      normalized,
    )
  ) {
    return false;
  }
  return new Set([...normalized]).size > 1;
}

function requirePositional(parsed, index, message) {
  const value = parsed.positionals[index];
  if (!value) throw new WorkItemError(message);
  if (parsed.positionals.length > index + 1) {
    throw new WorkItemError(
      `Unexpected positional argument: ${parsed.positionals[index + 1]}`,
    );
  }
  return value;
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.command === "check") {
    console.log(
      result.ready
        ? `READY ${result.repository}#${result.issue}`
        : `NOT READY ${result.repository}#${result.issue}`,
    );
    console.log(`Project: ${result.project.status}`);
    console.log(
      `In Progress: ${result.project.inProgress}/${result.project.maxInProgress}`,
    );
    for (const failure of result.failures) console.log(`- ${failure}`);
    return;
  }

  if (result.command === "validate-body") {
    console.log(result.valid ? "VALID ISSUE BODY" : "INVALID ISSUE BODY");
    for (const error of result.errors) console.log(`- ${error}`);
    return;
  }

  if (result.command === "create" && result.dryRun) {
    console.log(
      `DRY RUN CREATE ${result.repository} key=${result.idempotencyKey}`,
    );
    console.log(`Plan token: ${result.planToken}`);
    for (const entry of result.planned) console.log(`- ${entry}`);
    return;
  }

  console.log(
    `${result.dryRun ? "DRY RUN" : "VERIFIED"} ${result.command.toUpperCase()} ${result.repository}#${result.issue}`,
  );
  const entries = result.dryRun ? result.planned : result.completed;
  for (const entry of entries) console.log(`- ${entry}`);
}

function printError(error, json) {
  const normalized =
    error instanceof WorkItemError
      ? error
      : new WorkItemError(error?.message || String(error));
  const payload = {
    ok: false,
    error: normalized.message,
    completed: normalized.completed,
    repair: normalized.repair,
  };
  if (json) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  console.error(`WORK ITEM FAILED: ${normalized.message}`);
  if (normalized.completed.length > 0) {
    console.error("Completed before failure:");
    for (const item of normalized.completed) console.error(`- ${item}`);
  }
  if (normalized.repair.length > 0) {
    console.error("Repair:");
    for (const item of normalized.repair) console.error(`- ${item}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    if (
      parsed.options.help ||
      parsed.command === undefined ||
      parsed.command === "help"
    ) {
      console.log(usage());
      return;
    }

    let result;
    if (parsed.command === "check") {
      const issueValue = requirePositional(
        parsed,
        0,
        "check requires an Issue.",
      );
      result = readinessOutput(readContext(parsed.options, issueValue));
    } else if (parsed.command === "create") {
      result = createCommand(parsed);
    } else if (parsed.command === "start") {
      result = startCommand(parsed);
    } else if (parsed.command === "complete") {
      result = completeCommand(parsed);
    } else if (parsed.command === "release") {
      result = releaseCommand(parsed);
    } else if (parsed.command === "reconcile") {
      result = reconcileCommand(parsed);
    } else if (parsed.command === "validate-body") {
      result = validateBodyCommand(parsed);
    } else {
      throw new WorkItemError(`Unknown command: ${parsed.command}`);
    }

    printResult(result, parsed.options.json);
    if (result.ready === false || result.valid === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    printError(error, parsed?.options?.json || false);
    process.exitCode = 1;
  }
}

await main();
