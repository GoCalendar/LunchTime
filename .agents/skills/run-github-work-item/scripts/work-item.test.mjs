import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workItemScript = resolve(scriptDirectory, "work-item.mjs");
let fixtureDirectory;
let mockGhPath;
let mutationLog;
let reconcileStatePath;
let lifecycleGhPath;
let lifecycleStatePath;
let lifecycleLogPath;
let createGhPath;
let createStatePath;
let createLogPath;
let createBodyPath;
const mergedHead = "1234567890abcdef1234567890abcdef12345678";
const toolingTracePrefix =
  "해당 없음 — 제품 동작·PRD·Policy 추적 대상이 아닌 도구 작업:";
const toolingSourceGrammarPattern =
  /tooling-only 비적용 본문은 제한된 fail-closed Markdown 소스 문법만 허용합니다/;

before(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "lunchtime-work-item-"));
  mockGhPath = join(fixtureDirectory, "gh");
  mutationLog = join(fixtureDirectory, "mutations.log");
  reconcileStatePath = join(fixtureDirectory, "reconcile-state.json");
  const lifecycleBinDirectory = join(fixtureDirectory, "lifecycle-bin");
  mkdirSync(lifecycleBinDirectory);
  lifecycleGhPath = join(lifecycleBinDirectory, "gh");
  lifecycleStatePath = join(fixtureDirectory, "lifecycle-state.json");
  lifecycleLogPath = join(fixtureDirectory, "lifecycle-calls.log");
  const createBinDirectory = join(fixtureDirectory, "create-bin");
  mkdirSync(createBinDirectory);
  createGhPath = join(createBinDirectory, "gh");
  createStatePath = join(fixtureDirectory, "create-state.json");
  createLogPath = join(fixtureDirectory, "create-calls.log");
  createBodyPath = join(fixtureDirectory, "create-body.md");

  mkdirSync(join(fixtureDirectory, "docs/prd"), { recursive: true });
  mkdirSync(join(fixtureDirectory, "docs/policies"), { recursive: true });
  writeFileSync(
    join(fixtureDirectory, "docs/prd/01_fixture.md"),
    [
      "# PRD-01. Fixture",
      "",
      "### PRD-01-FR-01. Fixture requirement",
      "",
      "### PRD-01-AC-02. Fixture acceptance",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(fixtureDirectory, "docs/policies/02_fixture.md"),
    [
      "# POL-02. Fixture",
      "",
      "## POL-02-R-04. Fixture rule",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(fixtureDirectory, "work-management.json"),
    `${JSON.stringify(
      {
        repository: "Example/LunchTime",
        branch: {
          base: "main",
          prefix: "work/",
        },
        project: {
          owner: "Example",
          number: 7,
          statusField: "Status",
          statusOptions: {
            todo: "Todo",
            inProgress: "In Progress",
            done: "Done",
          },
        },
        labels: {
          todo: "status:todo",
          inProgress: "status:in-progress",
          done: "status:done",
          blocked: "dependency:blocked",
        },
        maxInProgress: 2,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(fixtureDirectory, "invalid-work-management.json"),
    `${JSON.stringify(
      {
        repository: "Example/LunchTime",
        branch: {
          base: "main",
          prefix: "work/",
        },
        project: {
          owner: "Example",
          number: 7,
          statusField: "Status",
          statusOptions: {
            todo: "Same",
            inProgress: "Same",
            done: "Same",
          },
        },
        labels: {
          todo: "workflow:same",
          inProgress: "workflow:same",
          done: "workflow:same",
          blocked: "status:blocked",
        },
        maxInProgress: 2,
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    mockGhPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const endpoint = args.find(
  (arg) => arg === "user" || arg === "graphql" || arg.startsWith("repos/"),
);
const mode = process.env.MOCK_WORK_ITEM_MODE || "todo";
const mutationLog = process.env.MOCK_MUTATION_LOG;
const reconcileStatePath = process.env.MOCK_RECONCILE_STATE;
const reconcileState = reconcileStatePath
  ? JSON.parse(readFileSync(reconcileStatePath, "utf8"))
  : null;
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const input = args.includes("--input")
  ? JSON.parse(readFileSync(0, "utf8"))
  : null;

if (mode === "timeout") {
  setTimeout(() => {}, 60_000);
}

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

function failMutation(kind) {
  appendFileSync(mutationLog, kind + "\\n");
  process.stderr.write("unexpected mutation: " + kind + "\\n");
  process.exit(88);
}

if (args[0] !== "api") {
  process.stderr.write("unexpected gh command\\n");
  process.exit(2);
}
const reconcileMutation =
  (mode === "reconcile-remove" || mode === "reconcile-add") &&
  endpoint?.includes("/issues/1/labels");
if (endpoint === "graphql" && /\\bmutation\\b/.test(input?.query || "")) {
  failMutation("graphql");
}
if (endpoint !== "graphql" && method !== "GET" && !reconcileMutation) {
  failMutation(method + " " + endpoint);
}

const active = [
  "active",
  "wrong-base",
  "head-mismatch",
  "multiple-closing",
  "duplicate-status",
  "wrong-base-repository",
  "wrong-head-repository",
  "missing-base-repository",
  "missing-head-repository",
].includes(mode);
const closedNotPlanned = mode === "closed-not-planned";
const staleBlocked = reconcileState?.blocked ?? (mode === "blocked-stale" || mode === "reconcile-remove");
const missingBlocked = mode === "blocked-missing" || mode === "reconcile-add";
const bodySections = [
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
const issueBody = bodySections
  .map(
    (section) =>
      "### " +
      section +
      "\\n" +
      (section === "추적성"
        ? "PRD-01-FR-01 및 POL-02-R-04를 구현합니다."
        : "충분히 구체적인 작업 설명을 작성합니다."),
  )
  .join("\\n\\n");
const issue = {
  number: 1,
  state: closedNotPlanned ? "closed" : "open",
  title: "Fixture work item",
  html_url: "https://github.com/Example/LunchTime/issues/1",
  labels: [
    {
      name: closedNotPlanned
        ? "status:done"
        : active
          ? "status:in-progress"
          : "status:todo",
    },
    ...(mode === "duplicate-status" ? [{ name: "status:done" }] : []),
    ...(staleBlocked ? [{ name: "dependency:blocked" }] : []),
  ],
  assignees:
    active || closedNotPlanned ? [{ login: "fixture-user" }] : [],
  user: { login: "fixture-user" },
  body: issueBody,
  state_reason: closedNotPlanned ? "not_planned" : null,
};
const dependent = {
  number: 2,
  state: "open",
  title: "Dependent",
  html_url: "https://github.com/Example/LunchTime/issues/2",
  labels: [{ name: "status:todo" }, { name: "dependency:blocked" }],
  assignees: [],
  user: { login: "fixture-user" },
};
const statusName = closedNotPlanned
  ? "Done"
  : active
    ? "In Progress"
    : "Todo";
const statusOption = closedNotPlanned
  ? "OPTION_DONE"
  : active
    ? "OPTION_IN_PROGRESS"
    : "OPTION_TODO";
const project = {
  id: "PROJECT",
  title: "LunchTime MVP",
  fields: {
    nodes: [
      {
        id: "STATUS_FIELD",
        name: "Status",
        options: [
          { id: "OPTION_TODO", name: "Todo" },
          { id: "OPTION_IN_PROGRESS", name: "In Progress" },
          { id: "OPTION_DONE", name: "Done" },
        ],
      },
    ],
  },
  items: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      {
        id: "ITEM",
        fieldValueByName: { name: statusName, optionId: statusOption },
      },
    ],
  },
};
const branch = "work/issue-1-fixture";
const agent = "codex:test";
const token = createHash("sha256")
  .update(
    ["example/lunchtime", "1", "fixture-user", branch, agent, "0"].join("\\n"),
  )
  .digest("hex");
const startComment = {
  id: 100,
  user: { login: "fixture-user" },
  body: [
    "<!-- lunchtime-work-item:start issue=1 epoch=0 token=" + token + " -->",
    "작업을 시작합니다.",
    "",
    "- Branch: \`" + branch + "\`",
    "- Agent: \`" + agent + "\`",
    "- Assignee: @fixture-user",
  ].join("\\n"),
};
const otherBranch = "work/issue-1-other";
const otherAgent = "claude:other";
const otherToken = createHash("sha256")
  .update(
    [
      "example/lunchtime",
      "1",
      "fixture-user",
      otherBranch,
      otherAgent,
      "0",
    ].join("\\n"),
  )
  .digest("hex");
const otherStartComment = {
  id: 99,
  user: { login: "fixture-user" },
  body: [
    "<!-- lunchtime-work-item:start issue=1 epoch=0 token=" + otherToken + " -->",
    "작업을 시작합니다.",
    "",
    "- Branch: \`" + otherBranch + "\`",
    "- Agent: \`" + otherAgent + "\`",
    "- Assignee: @fixture-user",
  ].join("\\n"),
};
const releaseComment = {
  id: 101,
  user: { login: "fixture-user" },
  body: [
    "<!-- lunchtime-work-item:release issue=1 epoch=0 token=" + token + " -->",
    "작업 선점을 해제합니다.",
    "",
    "- Branch: \`" + branch + "\`",
    "- Agent: \`" + agent + "\`",
    "- Released by: @fixture-user",
    "- Reason: abandoned",
  ].join("\\n"),
};
const intruder = "untrusted-user";
const intruderToken = createHash("sha256")
  .update(["example/lunchtime", "1", intruder, "evil", "evil", "0"].join("\\n"))
  .digest("hex");
const untrustedStartComment = {
  id: 99,
  user: { login: intruder },
  body: [
    "<!-- lunchtime-work-item:start issue=1 epoch=0 token=" + intruderToken + " -->",
    "작업을 시작합니다.",
    "",
    "- Branch: \`evil\`",
    "- Agent: \`evil\`",
    "- Assignee: @" + intruder,
  ].join("\\n"),
};

if (endpoint === "user") {
  output({ login: "fixture-user" });
} else if (endpoint?.includes("/collaborators/") && endpoint.endsWith("/permission")) {
  const login = decodeURIComponent(endpoint.split("/").at(-2));
  output({
    permission:
      mode === "actor-readonly" || login === intruder ? "read" : "write",
  });
} else if (endpoint === "repos/Example/LunchTime/issues/1") {
  output(issue);
} else if (endpoint === "repos/Example/LunchTime/pulls/9") {
  output({
    number: 9,
    merged_at: "2026-07-24T00:00:00Z",
    merge_commit_sha: "abc123",
    body: "Closes #1",
    base: {
      ref: mode === "wrong-base" ? "work/issue-99-integration" : "main",
      repo: {
        full_name:
          mode === "missing-base-repository"
            ? undefined
            : mode === "wrong-base-repository"
            ? "Other/LunchTime"
            : "Example/LunchTime",
      },
    },
    head: {
      ref: branch,
      repo: {
        full_name:
          mode === "missing-head-repository"
            ? undefined
            : mode === "wrong-head-repository"
            ? "ForkOwner/LunchTime"
            : "Example/LunchTime",
      },
      sha:
        mode === "head-mismatch"
          ? "abcdefabcdefabcdefabcdefabcdefabcdefabcd"
          : "1234567890abcdef1234567890abcdef12345678",
    },
  });
} else if (endpoint?.startsWith("repos/Example/LunchTime/pulls?")) {
  output([]);
} else if (endpoint?.includes("/issues/1/dependencies/blocked_by")) {
  output(missingBlocked ? [{ number: 77, state: "open" }] : []);
} else if (endpoint?.includes("/issues/1/labels/") && method === "DELETE") {
  const label = decodeURIComponent(endpoint.split("/").at(-1));
  issue.labels = issue.labels.filter((entry) => entry.name !== label);
  if (reconcileState) writeFileSync(reconcileStatePath, JSON.stringify({ blocked: false }));
  appendFileSync(mutationLog, "DELETE " + endpoint + "\\n");
  output({});
} else if (endpoint?.includes("/issues/1/labels") && method === "POST") {
  for (const label of input.labels) {
    if (!issue.labels.some((entry) => entry.name === label)) {
      issue.labels.push({ name: label });
    }
  }
  if (reconcileState) writeFileSync(reconcileStatePath, JSON.stringify({ blocked: true }));
  appendFileSync(mutationLog, "POST " + endpoint + "\\n");
  output({});
} else if (endpoint?.includes("/issues/1/dependencies/blocking")) {
  output(active ? [dependent] : []);
} else if (endpoint?.includes("/issues/2/dependencies/blocked_by")) {
  output([issue]);
} else if (endpoint?.includes("/issues/1/comments")) {
  output(
    active || closedNotPlanned
      ? [startComment]
      : mode === "released"
        ? [startComment, releaseComment]
      : mode === "competing"
        ? [otherStartComment]
        : mode === "untrusted-marker"
          ? [untrustedStartComment]
        : [],
  );
} else if (endpoint?.includes("/comments")) {
  output([]);
} else if (endpoint === "graphql") {
  if (/PullRequestClosingIssues/.test(input.query)) {
    output({
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: [
                {
                  number: 1,
                  repository: { nameWithOwner: "Example/LunchTime" },
                },
                ...(mode === "multiple-closing"
                  ? [
                      {
                        number: 2,
                        repository: {
                          nameWithOwner: "Example/LunchTime",
                        },
                      },
                    ]
                  : []),
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    });
  } else {
    if (
      !/repositoryOwner\\(login: \\$projectOwner\\)/.test(input.query) ||
      /(?:organization|user)\\(login: \\$projectOwner\\)/.test(input.query)
    ) {
      process.stderr.write("project queries must use repositoryOwner only\\n");
      process.exit(3);
    }
    output({
      data: {
        repositoryOwner: { projectV2: project },
        repository: {
          issue: {
            id: "ISSUE",
            projectItems: {
              nodes: [
                {
                  id: "ITEM",
                  project: { id: "PROJECT" },
                  fieldValueByName: {
                    name: statusName,
                    optionId: statusOption,
                  },
                },
              ],
            },
          },
        },
      },
    });
  }
} else {
  process.stderr.write("unhandled endpoint: " + endpoint + "\\n");
  process.exit(3);
}
`,
  );
  chmodSync(mockGhPath, 0o755);

  writeFileSync(
    lifecycleGhPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.MOCK_LIFECYCLE_STATE;
const callLog = process.env.MOCK_LIFECYCLE_LOG;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const endpoint = args.find(
  (arg) => arg === "user" || arg === "graphql" || arg.startsWith("repos/"),
);
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const input = args.includes("--input")
  ? JSON.parse(readFileSync(0, "utf8"))
  : null;
const query = input?.query || "";
const operation = /mutation UpdateStatus/.test(query)
  ? "UpdateStatus"
  : /PullRequestClosingIssues/.test(query)
    ? "PullRequestClosingIssues"
    : /query WorkItemProject/.test(query)
      ? "WorkItemProject"
      : /query ProjectItems/.test(query)
        ? "ProjectItems"
        : null;

appendFileSync(
  callLog,
  JSON.stringify({
    method,
    endpoint,
    operation,
    body: endpoint === "graphql" ? input?.variables || null : input,
  }) + "\\n",
);

function save() {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
}

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

function labelObjects(labels) {
  return labels.map((name) => ({ name }));
}

function issue(number) {
  if (number === 1) {
    return {
      number: 1,
      state: state.source.state,
      state_reason: state.source.stateReason,
      title: "Stateful source",
      html_url: "https://github.com/Example/LunchTime/issues/1",
      body: state.issueBody,
      labels: labelObjects(state.source.labels),
      assignees: state.source.assignees.map((login) => ({ login })),
    };
  }
  if (number === 2 || number === 3) {
    const dependent = state["dependent" + number];
    return {
      number,
      state: dependent.state,
      state_reason: null,
      title: "Stateful dependent " + number,
      html_url: "https://github.com/Example/LunchTime/issues/" + number,
      body: "",
      labels: labelObjects(dependent.labels),
      assignees: [],
    };
  }
  if (number === 4) {
    return {
      number: 4,
      state: state.blocker4.state,
      state_reason: state.blocker4.state === "closed" ? "completed" : null,
      title: "Second blocker",
      html_url: "https://github.com/Example/LunchTime/issues/4",
      body: "",
      labels: [{ name: "status:done" }],
      assignees: [],
    };
  }
  process.stderr.write("unknown issue " + number + "\\n");
  process.exit(3);
}

function projectPayload() {
  const optionId =
    state.projectStatus === "Todo"
      ? "OPTION_TODO"
      : state.projectStatus === "In Progress"
        ? "OPTION_IN_PROGRESS"
        : "OPTION_DONE";
  return {
    id: "PROJECT",
    title: "LunchTime MVP",
    fields: {
      nodes: [
        {
          id: "STATUS_FIELD",
          name: "Status",
          options: [
            { id: "OPTION_TODO", name: "Todo" },
            { id: "OPTION_IN_PROGRESS", name: "In Progress" },
            { id: "OPTION_DONE", name: "Done" },
          ],
        },
      ],
    },
    items: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: "ITEM_1",
          fieldValueByName: {
            name: state.projectStatus,
            optionId,
          },
        },
        ...Array.from(
          { length: state.projectOtherInProgress || 0 },
          (_, index) => ({
            id: "ITEM_OTHER_" + index,
            fieldValueByName: {
              name: "In Progress",
              optionId: "OPTION_IN_PROGRESS",
            },
          }),
        ),
      ],
    },
  };
}

function addLabels(number, labels) {
  const target = number === 1 ? state.source : state["dependent" + number];
  for (const label of labels) {
    if (!target.labels.includes(label)) target.labels.push(label);
  }
}

function removeLabel(number, label) {
  const target = number === 1 ? state.source : state["dependent" + number];
  target.labels = target.labels.filter((current) => current !== label);
}

function recordStartMutationBoundary() {
  if (!state.driftAfterStartMutation) return;
  state.startMutationCount = (state.startMutationCount || 0) + 1;
  if (state.startMutationCount !== state.driftAfterStartMutation) return;
  if (state.driftTypeAfterStartMutation) {
    state.source.labels = state.source.labels.map((current) =>
      current === "type:chore" ? "type:feat" : current,
    );
  }
  if (state.bodyAfterStartMutation) {
    state.issueBody = state.bodyAfterStartMutation;
  }
  if (state.startBoundaryDrift === "assignee") {
    state.source.assignees = ["other-user"];
  } else if (state.startBoundaryDrift === "issue-state") {
    state.source.state = "closed";
    state.source.stateReason = "not_planned";
  } else if (state.startBoundaryDrift === "workflow-label") {
    state.source.labels = state.source.labels.filter(
      (label) => !label.startsWith("status:"),
    );
    state.source.labels.push("status:done");
  } else if (state.startBoundaryDrift === "native-blocker") {
    state.sourceBlockers = [4];
  } else if (state.startBoundaryDrift === "derived-blocked") {
    if (!state.source.labels.includes("dependency:blocked")) {
      state.source.labels.push("dependency:blocked");
    }
  } else if (state.startBoundaryDrift === "project-status") {
    state.projectStatus = "Done";
  } else if (state.startBoundaryDrift === "project-capacity") {
    state.projectOtherInProgress = 2;
  } else if (state.startBoundaryDrift === "claim") {
    const claim = (state.comments["1"] || []).find((comment) =>
      comment.body.startsWith("<!-- lunchtime-work-item:start issue=1 "),
    );
    if (claim) {
      const epoch = /epoch=(\\d+)/.exec(claim.body)?.[1];
      const token = /token=([a-f0-9]{64})/.exec(claim.body)?.[1];
      const branch = /- Branch: \`([^\`]+)\`/.exec(claim.body)?.[1];
      const agent = /- Agent: \`([^\`]+)\`/.exec(claim.body)?.[1];
      state.comments["1"].push({
        id: state.nextCommentId,
        user: { login: "fixture-user" },
        body: [
          "<!-- lunchtime-work-item:release issue=1 epoch=" +
            epoch +
            " token=" +
            token +
            " -->",
          "작업 선점을 해제합니다.",
          "",
          "- Branch: \`" + branch + "\`",
          "- Agent: \`" + agent + "\`",
          "- Released by: @fixture-user",
          "- Reason: adversarial drift",
        ].join("\\n"),
      });
      state.nextCommentId += 1;
    }
  }
}

if (args[0] !== "api") {
  process.stderr.write("unexpected gh command\\n");
  process.exit(2);
}

if (endpoint === "user") {
  output({ login: "fixture-user" });
} else if (
  endpoint?.includes("/collaborators/") &&
  endpoint.endsWith("/permission")
) {
  const login = decodeURIComponent(endpoint.split("/").at(-2));
  output({ permission: login === "untrusted-user" ? "read" : "write" });
} else if (endpoint === "repos/Example/LunchTime/pulls/9") {
  output({
    number: 9,
    merged_at: "2026-07-24T00:00:00Z",
    merge_commit_sha: "abc123",
    body: "Closes #1",
    base: { ref: "main", repo: { full_name: "Example/LunchTime" } },
    head: {
      ref: "work/issue-1-stateful",
      repo: { full_name: "Example/LunchTime" },
      sha: "1234567890abcdef1234567890abcdef12345678",
    },
  });
} else if (endpoint?.startsWith("repos/Example/LunchTime/pulls?")) {
  output([]);
} else if (endpoint === "graphql") {
  if (operation === "UpdateStatus") {
    state.projectStatus =
      input.variables.optionId === "OPTION_IN_PROGRESS"
        ? "In Progress"
        : input.variables.optionId === "OPTION_DONE"
          ? "Done"
          : "Todo";
    recordStartMutationBoundary();
    save();
    output({
      data: {
        updateProjectV2ItemFieldValue: {
          projectV2Item: { id: "ITEM_1" },
        },
      },
    });
  } else if (operation === "PullRequestClosingIssues") {
    output({
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              nodes: [
                {
                  number: 1,
                  repository: { nameWithOwner: "Example/LunchTime" },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    });
  } else {
    const project = projectPayload();
    output({
      data: {
        repositoryOwner: { projectV2: project },
        repository: {
          issue: {
            id: "ISSUE_1",
            projectItems: {
              nodes: [
                {
                  id: "ITEM_1",
                  project: { id: "PROJECT" },
                  fieldValueByName: {
                    name: state.projectStatus,
                  },
                },
              ],
            },
          },
        },
      },
    });
  }
} else {
  const issueMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)$/.exec(endpoint || "");
  const blockersMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(endpoint || "");
  const dependentsMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/dependencies\\/blocking/.exec(endpoint || "");
  const commentsMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/comments/.exec(endpoint || "");
  const labelsMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/labels$/.exec(endpoint || "");
  const removeLabelMatch = /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/labels\\/(.+)$/.exec(endpoint || "");

  if (issueMatch && method === "GET") {
    output(issue(Number(issueMatch[1])));
  } else if (issueMatch && method === "PATCH") {
    if (input.assignees) state.source.assignees = [...input.assignees];
    if (input.state) state.source.state = input.state;
    if (input.state_reason) state.source.stateReason = input.state_reason;
    recordStartMutationBoundary();
    save();
    output(issue(1));
  } else if (blockersMatch) {
    const number = Number(blockersMatch[1]);
    output(
      number === 1
        ? (state.sourceBlockers || []).map((blocker) => issue(blocker))
        : number === 2
          ? [issue(1)]
          : number === 3
            ? [issue(1), issue(4)]
            : [],
    );
  } else if (dependentsMatch) {
    output(Number(dependentsMatch[1]) === 1 ? [issue(2), issue(3)] : []);
  } else if (commentsMatch && method === "GET") {
    output(state.comments[commentsMatch[1]] || []);
  } else if (commentsMatch && method === "POST") {
    const number = commentsMatch[1];
    state.comments[number] ||= [];
    const comment = {
      id: state.nextCommentId,
      user: { login: "fixture-user" },
      body: input.body,
    };
    state.nextCommentId += 1;
    state.comments[number].push(comment);
    recordStartMutationBoundary();
    save();
    output(comment);
  } else if (labelsMatch && method === "POST") {
    addLabels(Number(labelsMatch[1]), input.labels);
    recordStartMutationBoundary();
    save();
    output(labelObjects(input.labels));
  } else if (removeLabelMatch && method === "DELETE") {
    removeLabel(
      Number(removeLabelMatch[1]),
      decodeURIComponent(removeLabelMatch[2]),
    );
    recordStartMutationBoundary();
    save();
    output({});
  } else {
    process.stderr.write("unhandled " + method + " " + endpoint + "\\n");
    process.exit(3);
  }
}
`,
  );
  chmodSync(lifecycleGhPath, 0o755);

  writeFileSync(
    createGhPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.MOCK_CREATE_STATE;
const logPath = process.env.MOCK_CREATE_LOG;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const endpoint = args.find(
  (arg) => arg === "user" || arg === "graphql" || arg.startsWith("repos/"),
);
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const input = args.includes("--input")
  ? JSON.parse(readFileSync(0, "utf8"))
  : null;
const query = input?.query || "";

function save() {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
}
function output(value) {
  process.stdout.write(JSON.stringify(value));
}
function record(kind, body = input) {
  state.writes.push({ kind, body });
  save();
}
function issue(number) {
  const found = state.issues.find((candidate) => candidate.number === number);
  if (!found) {
    process.stderr.write("unknown issue " + number + "\\n");
    process.exit(3);
  }
  return found;
}
function projectDefinition() {
  return {
    id: "PROJECT",
    title: "LunchTime MVP",
    fields: {
      nodes: [
        {
          id: "STATUS_FIELD",
          name: "Status",
          options: [
            { id: "TODO", name: "Todo" },
            { id: "IN_PROGRESS", name: "In Progress" },
            { id: "DONE", name: "Done" },
          ],
        },
      ],
    },
    items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };
}

appendFileSync(
  logPath,
  JSON.stringify({
    method,
    endpoint,
    operation:
      /AddWorkItemToProject/.test(query)
        ? "AddWorkItemToProject"
        : /mutation UpdateStatus/.test(query)
          ? "UpdateStatus"
          : /WorkItemCreateProject/.test(query)
            ? "WorkItemCreateProject"
            : /WorkItemProject/.test(query)
              ? "WorkItemProject"
              : null,
    body: endpoint === "graphql" ? input?.variables || null : input,
  }) + "\\n",
);

if (args[0] !== "api") {
  process.stderr.write("unexpected gh command\\n");
  process.exit(2);
}

if (endpoint === "user") {
  output({ login: "fixture-user" });
} else if (
  endpoint?.includes("/collaborators/") &&
  endpoint.endsWith("/permission")
) {
  output({ permission: state.permission || "write" });
} else if (endpoint === "repos/Example/LunchTime/labels") {
  output(state.labels.map((name) => ({ name })));
} else if (endpoint?.startsWith("repos/Example/LunchTime/labels?")) {
  output(state.labels.map((name) => ({ name })));
} else if (
  endpoint?.startsWith("repos/Example/LunchTime/milestones?state=open")
) {
  output(state.milestones);
} else if (
  endpoint?.startsWith("repos/Example/LunchTime/issues?state=all")
) {
  output(state.issues);
} else if (
  endpoint === "repos/Example/LunchTime/issues" &&
  method === "POST"
) {
  if (Object.prototype.hasOwnProperty.call(input, "assignees")) {
    process.stderr.write("create payload must omit assignees\\n");
    process.exit(4);
  }
  const created = {
    number: state.nextIssueNumber,
    id: 1000 + state.nextIssueNumber,
    node_id: "ISSUE_" + state.nextIssueNumber,
    html_url:
      "https://github.com/Example/LunchTime/issues/" + state.nextIssueNumber,
    state: "open",
    state_reason: null,
    title: input.title,
    body: input.body,
    labels: input.labels.map((name) => ({ name })),
    assignees: [],
    user: { login: "fixture-user" },
    milestone: {
      number: input.milestone,
      title: state.milestones.find(
        (milestone) => milestone.number === input.milestone,
      ).title,
    },
  };
  state.nextIssueNumber += 1;
  state.issues.push(created);
  record("issue-create");
  output(created);
} else if (endpoint === "graphql") {
  const project = projectDefinition();
  if (/AddWorkItemToProject/.test(query)) {
    if (state.failProjectAdds > 0) {
      state.failProjectAdds -= 1;
      save();
      process.stderr.write("planned Project add failure\\n");
      process.exit(42);
    }
    const target = state.issues.find(
      (candidate) => candidate.node_id === input.variables.contentId,
    );
    const item = {
      id: "ITEM_" + target.number,
      issueNumber: target.number,
      status: null,
    };
    state.projectItems.push(item);
    record("project-add", input.variables);
    output({ data: { addProjectV2ItemById: { item: { id: item.id } } } });
  } else if (/mutation UpdateStatus/.test(query)) {
    const item = state.projectItems.find(
      (candidate) => candidate.id === input.variables.itemId,
    );
    item.status = "Todo";
    record("project-status", input.variables);
    output({
      data: {
        updateProjectV2ItemFieldValue: {
          projectV2Item: { id: item.id },
        },
      },
    });
  } else if (/WorkItemProject/.test(query)) {
    const item = state.projectItems.find(
      (candidate) => candidate.issueNumber === input.variables.issueNumber,
    );
    output({
      data: {
        repositoryOwner: { projectV2: project },
        repository: {
          issue: {
            id: "ISSUE_" + input.variables.issueNumber,
            projectItems: {
              nodes: item
                ? [
                    {
                      id: item.id,
                      project: { id: "PROJECT" },
                      fieldValueByName: item.status
                        ? { name: item.status, optionId: "TODO" }
                        : null,
                    },
                  ]
                : [],
            },
          },
        },
      },
    });
  } else if (/WorkItemCreateProject/.test(query)) {
    output({ data: { repositoryOwner: { projectV2: project } } });
  } else {
    process.stderr.write("unhandled graphql\\n");
    process.exit(3);
  }
} else {
  const issueMatch =
    /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)$/.exec(endpoint || "");
  const labelsMatch =
    /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/labels$/.exec(
      endpoint || "",
    );
  const labelItemMatch =
    /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/labels\\/(.+)$/.exec(
      endpoint || "",
    );
  const blockersMatch =
    /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(
      endpoint || "",
    );
  const commentsMatch =
    /^repos\\/Example\\/LunchTime\\/issues\\/(\\d+)\\/comments/.exec(
      endpoint || "",
    );

  if (issueMatch && method === "GET") {
    output(issue(Number(issueMatch[1])));
  } else if (issueMatch && method === "PATCH") {
    const target = issue(Number(issueMatch[1]));
    if (input.milestone) {
      target.milestone = {
        number: input.milestone,
        title: state.milestones.find(
          (milestone) => milestone.number === input.milestone,
        ).title,
      };
    }
    if (input.assignees) target.assignees = input.assignees.map((login) => ({ login }));
    record("issue-patch");
    output(target);
  } else if (labelsMatch && method === "POST") {
    const target = issue(Number(labelsMatch[1]));
    for (const label of input.labels) {
      if (!target.labels.some((entry) => entry.name === label)) {
        target.labels.push({ name: label });
      }
    }
    record("labels");
    output(target.labels);
  } else if (labelItemMatch && method === "DELETE") {
    const target = issue(Number(labelItemMatch[1]));
    const label = decodeURIComponent(labelItemMatch[2]);
    target.labels = target.labels.filter((entry) => entry.name !== label);
    record("label-delete", { label });
    output({});
  } else if (blockersMatch && method === "GET") {
    const numbers = state.dependencies[blockersMatch[1]] || [];
    output(numbers.map((number) => issue(number)));
  } else if (blockersMatch && method === "POST") {
    const blocker = state.issues.find(
      (candidate) => candidate.id === input.issue_id,
    );
    state.dependencies[blockersMatch[1]] ||= [];
    if (!state.dependencies[blockersMatch[1]].includes(blocker.number)) {
      state.dependencies[blockersMatch[1]].push(blocker.number);
    }
    record("dependency");
    output({});
  } else if (commentsMatch && method === "GET") {
    output([]);
  } else {
    process.stderr.write("unhandled " + method + " " + endpoint + "\\n");
    process.exit(3);
  }
}
`,
  );
  chmodSync(createGhPath, 0o755);
});

after(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

function runCli(
  args,
  { mode = "todo", input, extraEnv = {} } = {},
) {
  writeFileSync(mutationLog, "");
  const useReconcileState =
    mode === "reconcile-remove" || mode === "reconcile-add";
  writeFileSync(
    reconcileStatePath,
    JSON.stringify({ blocked: mode === "reconcile-remove" }),
  );
  const result = spawnSync(process.execPath, [workItemScript, ...args], {
    cwd: fixtureDirectory,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      PATH: `${fixtureDirectory}:${process.env.PATH}`,
      NODE_ENV: "test",
      MOCK_WORK_ITEM_MODE: mode,
      MOCK_MUTATION_LOG: mutationLog,
      ...(useReconcileState
        ? { MOCK_RECONCILE_STATE: reconcileStatePath }
        : {}),
      ...(mode === "timeout" ? { WORK_ITEM_TEST_TIMEOUT_MS: "50" } : {}),
      ...extraEnv,
    },
  });
  return {
    ...result,
    mutations: readFileSync(mutationLog, "utf8"),
  };
}

function resetLifecycleState() {
  const state = {
    issueBody: validBody(undefined, "###"),
    source: {
      state: "open",
      stateReason: null,
      labels: ["status:todo", "type:feat", "custom:keep"],
      assignees: [],
    },
    dependent2: {
      state: "open",
      labels: ["status:todo", "dependency:blocked", "area:ui"],
    },
    dependent3: {
      state: "open",
      labels: ["status:todo", "dependency:blocked", "custom:dependent"],
    },
    blocker4: { state: "open" },
    sourceBlockers: [],
    projectStatus: "Todo",
    projectOtherInProgress: 0,
    comments: { 1: [], 2: [], 3: [] },
    nextCommentId: 100,
  };
  writeFileSync(lifecycleStatePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(lifecycleLogPath, "");
  return state;
}

function readLifecycleState() {
  return JSON.parse(readFileSync(lifecycleStatePath, "utf8"));
}

function writeLifecycleState(state) {
  writeFileSync(lifecycleStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function readLifecycleCalls() {
  const text = readFileSync(lifecycleLogPath, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

function lifecycleWrites(calls = readLifecycleCalls()) {
  return calls.filter(
    (call) =>
      call.operation === "UpdateStatus" ||
      (call.endpoint !== "graphql" && call.method !== "GET"),
  );
}

function runLifecycleCli(args) {
  return spawnSync(process.execPath, [workItemScript, ...args], {
    cwd: fixtureDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dirname(lifecycleGhPath)}:${process.env.PATH}`,
      NODE_ENV: "test",
      MOCK_LIFECYCLE_STATE: lifecycleStatePath,
      MOCK_LIFECYCLE_LOG: lifecycleLogPath,
    },
  });
}

function resetCreateState(overrides = {}) {
  const state = {
    permission: "write",
    labels: [
      "status:todo",
      "status:in-progress",
      "status:done",
      "dependency:blocked",
      "type:docs",
      "type:chore",
      "area:quality",
    ],
    milestones: [{ number: 3, title: "MVP" }],
    issues: [
      {
        number: 7,
        id: 1007,
        node_id: "ISSUE_7",
        html_url: "https://github.com/Example/LunchTime/issues/7",
        state: "open",
        state_reason: null,
        title: "Existing blocker",
        body: "",
        labels: [{ name: "status:todo" }],
        assignees: [],
        milestone: { number: 3, title: "MVP" },
        user: { login: "fixture-user" },
      },
    ],
    nextIssueNumber: 8,
    projectItems: [],
    dependencies: {},
    writes: [],
    failProjectAdds: 0,
    ...overrides,
  };
  writeFileSync(createStatePath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(createLogPath, "");
  writeFileSync(createBodyPath, `${validBody()}\n`);
  return state;
}

function readCreateState() {
  return JSON.parse(readFileSync(createStatePath, "utf8"));
}

function writeCreateState(state) {
  writeFileSync(createStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function readCreateCalls() {
  const text = readFileSync(createLogPath, "utf8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

function runCreateCli(args) {
  return spawnSync(process.execPath, [workItemScript, ...args], {
    cwd: fixtureDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dirname(createGhPath)}:${process.env.PATH}`,
      NODE_ENV: "test",
      MOCK_CREATE_STATE: createStatePath,
      MOCK_CREATE_LOG: createLogPath,
    },
  });
}

function createArgs({
  key = "docs-harness-create",
  type = "type:docs",
  project = false,
  blockedBy = false,
} = {}) {
  return [
    "create",
    "--idempotency-key",
    key,
    "--title",
    "개별 작업 이슈 생성 계약을 검증한다",
    "--body",
    createBodyPath,
    "--milestone",
    "MVP",
    "--label",
    type,
    "--label",
    "area:quality",
    ...(blockedBy ? ["--blocked-by", "7"] : []),
    ...(project ? ["--project"] : []),
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ];
}

function validBody(
  traceability = "PRD-01-FR-01 POL-02-R-04",
  headingLevel = "##",
) {
  const sections = [
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
  return sections
    .map(
      (section) =>
        `${headingLevel} ${section}\n${
          section === "추적성"
            ? `${traceability} 요구사항을 구현합니다.`
            : "충분히 구체적인 작업 설명을 작성합니다."
        }`,
    )
    .join("\n\n");
}

function plannedBody(
  traceability = [
    "PRD-123-FR-456 planned — 이 PR에서 정의",
    "POL-123-R-456 planned — 이 PR에서 정의",
  ].join("\n"),
) {
  return validBody(traceability)
    .replace(
      "## 변경 허용 경로\n충분히 구체적인 작업 설명을 작성합니다.",
      [
        "## 변경 허용 경로",
        "- docs/prd/123_fixture.md",
        "- docs/policies/123_fixture.md",
      ].join("\n"),
    )
    .replace(
      "## 변경 금지 경로\n충분히 구체적인 작업 설명을 작성합니다.",
      "## 변경 금지 경로\n- 애플리케이션 범위 밖 경로",
    )
    .replace(
      "## 문서 영향\n충분히 구체적인 작업 설명을 작성합니다.",
      [
        "## 문서 영향",
        "- PRD-123-FR-456: docs/prd/123_fixture.md에서 정의",
        "- POL-123-R-456: docs/policies/123_fixture.md에서 정의",
      ].join("\n"),
    );
}

function toolingBody({
  traceReason = "개발 하네스의 검증과 이슈 생명주기 계약만 변경한다.",
  impactReason = "제품 동작과 PRD·Policy 정본을 변경하지 않는다.",
  allowedPath = ".agents/skills/run-github-work-item/SKILL.md",
} = {}) {
  return validBody()
    .replace(
      "## 완료 조건\n충분히 구체적인 작업 설명을 작성합니다.",
      [
        "## 완료 조건",
        "Happy path",
        "- 조건(Given): 제품 동작과 무관한 도구 작업이다.",
        "- 행동(When): type:chore로 이슈 본문을 검증한다.",
        "- 결과(Then): 제품 계약 ID 없이 구체적 비적용 근거를 검증한다.",
        `- 추적 ID: ${toolingTracePrefix} ${traceReason}`,
        "- 검증 계획: validate-body와 create dry-run을 실행한다.",
      ].join("\n"),
    )
    .replace(
      "## 추적성\nPRD-01-FR-01 POL-02-R-04 요구사항을 구현합니다.",
      `## 추적성\n- ${toolingTracePrefix} ${traceReason}`,
    )
    .replace(
      "## 변경 허용 경로\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 변경 허용 경로\n- ${allowedPath}`,
    )
    .replace(
      "## 문서 영향\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 문서 영향\n- 제품 문서: 변경 없음 — ${impactReason}`,
    );
}

test("help does not require gh or configuration", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check <issue-number-or-url>/);
  assert.match(result.stdout, /create --idempotency-key/);
  assert.match(
    result.stdout,
    /validate-body <file-or-> \[--label LABEL\.\.\.\]/,
  );
  assert.equal(result.mutations, "");
});

test("tooling-only contract stays discoverable from Skill, interface, Issue Form, and owner reference", () => {
  const skillRoot = resolve(scriptDirectory, "..");
  const repositoryRoot = resolve(skillRoot, "../../..");
  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const issueContract = readFileSync(
    join(skillRoot, "references/issue-contract.md"),
    "utf8",
  );
  const interfaceYaml = readFileSync(
    join(skillRoot, "agents/openai.yaml"),
    "utf8",
  );
  const issueForm = readFileSync(
    join(repositoryRoot, ".github/ISSUE_TEMPLATE/work-item.yml"),
    "utf8",
  );

  for (const content of [issueContract, issueForm]) {
    assert.ok(content.includes(toolingTracePrefix), content);
    assert.match(content, /type:chore/);
  }
  assert.match(skill, /tooling-only 비적용 근거/);
  assert.match(skill, /validate-body <body-file> \[--label <actual-label>\.\.\.\]/);
  assert.match(skill, /MVP 일괄[\s\S]*계속 제품 정본 ID/);
  assert.match(skill, /rendered ID·경로 판정보다 먼저 fail-closed 소스 문법/);
  assert.match(skill, /CommonMark 전체를 해석하려는 계약이 아니다/);
  assert.match(interfaceYaml, /type:chore 전용 비적용 근거/);
  assert.match(interfaceYaml, /실제 label/);
  assert.match(issueContract, /제품 계약 ID와 혼용하지 않는다/);
  assert.match(issueContract, /일괄 등록은 계속 제품 정본 ID/);
  assert.match(issueContract, /선형 fail-closed 소스 scanner/);
  assert.match(issueContract, /full·collapsed·shortcut reference link/);
  assert.match(issueContract, /CommonMark 전체를 재해석하는 규칙이 아니라/);
});

test("create rejects invalid local input and does not expose an assignee option", () => {
  resetCreateState();
  const missingLabel = runCreateCli(
    createArgs().filter(
      (value, index, values) =>
        value !== "--label" && values[index - 1] !== "--label",
    ),
  );
  assert.equal(missingLabel.status, 1);
  assert.match(missingLabel.stderr, /at least one --label/);
  assert.equal(readCreateState().writes.length, 0);

  const assignee = runCreateCli([
    ...createArgs(),
    "--assignee",
    "fixture-user",
    "--dry-run",
  ]);
  assert.equal(assignee.status, 1);
  assert.match(assignee.stderr, /Unknown option: --assignee/);
  assert.equal(readCreateState().writes.length, 0);
});

test("create dry-run performs live reads, plans exact state, and writes nothing", () => {
  resetCreateState();
  const result = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.writes, 0);
  assert.match(payload.planToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.labels, [
    "area:quality",
    "status:todo",
    "type:docs",
  ]);
  assert.equal(payload.project, null);
  assert.match(payload.planned.join("\n"), /create unassigned Issue/);
  assert.equal(readCreateState().writes.length, 0);
  assert.equal(
    readCreateCalls().some(
      (call) => call.method !== "GET" || call.operation?.startsWith("Add"),
    ),
    false,
  );
});

test("tooling-only create stays unassigned and remains checkable and startable", () => {
  resetCreateState();
  writeFileSync(createBodyPath, `${toolingBody()}\n`);
  const args = createArgs({
    key: "tooling-harness-create",
    type: "type:chore",
    project: true,
  });

  const dryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.writes, 0);
  assert.deepEqual(dryPayload.labels, [
    "area:quality",
    "status:todo",
    "type:chore",
  ]);
  assert.equal(dryPayload.project, "LunchTime MVP");

  const created = runCreateCli([
    ...args,
    "--confirm-plan",
    dryPayload.planToken,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const state = readCreateState();
  assert.deepEqual(state.issues[1].assignees, []);
  assert.deepEqual(
    state.issues[1].labels.map((label) => label.name).sort(),
    ["area:quality", "status:todo", "type:chore"],
  );

  const writesBeforeReadOnlyLifecycle = state.writes.length;
  writeFileSync(createLogPath, "");
  const checked = runCreateCli([
    "check",
    "8",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).ready, true);

  const start = runCreateCli([
    "start",
    "8",
    "--branch",
    "work/issue-8-tooling-trace",
    "--agent",
    "codex:tooling-test",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--dry-run",
    "--json",
  ]);
  assert.equal(start.status, 0, start.stderr);
  assert.equal(
    readCreateState().writes.length,
    writesBeforeReadOnlyLifecycle,
  );
});

test("tooling-only create rejects non-chore and mixed type labels before GitHub writes", () => {
  for (const args of [
    createArgs({ type: "type:feat" }),
    [...createArgs({ type: "type:chore" }), "--label", "type:feat"],
  ]) {
    resetCreateState();
    writeFileSync(createBodyPath, `${toolingBody()}\n`);
    const result = runCreateCli([...args, "--dry-run"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /실제 type label이 type:chore 하나/);
    assert.equal(readCreateState().writes.length, 0);
    assert.equal(readCreateCalls().length, 0);
  }
});

test("tooling-only check and start reject live type label drift without mutation", () => {
  resetCreateState();
  writeFileSync(createBodyPath, `${toolingBody()}\n`);
  const args = createArgs({
    key: "tooling-label-drift",
    type: "type:chore",
  });
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const created = runCreateCli([
    ...args,
    "--confirm-plan",
    JSON.parse(dryRun.stdout).planToken,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const state = readCreateState();
  const writesBeforeDriftChecks = state.writes.length;
  state.issues[1].labels = state.issues[1].labels.map((label) =>
    label.name === "type:chore" ? { name: "type:feat" } : label,
  );
  writeCreateState(state);
  writeFileSync(createLogPath, "");

  const checked = runCreateCli([
    "check",
    "8",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ]);
  assert.equal(checked.status, 1, checked.stderr);
  const checkPayload = JSON.parse(checked.stdout);
  assert.equal(checkPayload.ready, false);
  assert.match(
    checkPayload.failures.join("\n"),
    /실제 type label이 type:chore 하나/,
  );

  const start = runCreateCli([
    "start",
    "8",
    "--branch",
    "work/issue-8-tooling-drift",
    "--agent",
    "codex:tooling-drift",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--dry-run",
    "--json",
  ]);
  assert.equal(start.status, 1);
  assert.match(start.stderr, /실제 type label이 type:chore 하나/);
  assert.equal(
    readCreateState().writes.length,
    writesBeforeDriftChecks,
  );
  assert.equal(
    readCreateCalls().some((call) => call.method !== "GET"),
    false,
  );
});

test("tooling-only check and start reject whitespace-wrapped live type labels without mutation", () => {
  resetCreateState();
  writeFileSync(createBodyPath, `${toolingBody()}\n`);
  const args = createArgs({
    key: "tooling-whitespace-label-drift",
    type: "type:chore",
  });
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const created = runCreateCli([
    ...args,
    "--confirm-plan",
    JSON.parse(dryRun.stdout).planToken,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const state = readCreateState();
  const writesBeforeDriftChecks = state.writes.length;
  state.issues[1].labels = state.issues[1].labels.map((label) =>
    label.name === "type:chore"
      ? { name: "\ttype:chore " }
      : label,
  );
  writeCreateState(state);
  writeFileSync(createLogPath, "");

  const checked = runCreateCli([
    "check",
    "8",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ]);
  assert.equal(checked.status, 1, checked.stderr);
  assert.match(
    JSON.parse(checked.stdout).failures.join("\n"),
    /raw 문자열이 정확히 type:chore/,
  );

  const start = runCreateCli([
    "start",
    "8",
    "--branch",
    "work/issue-8-tooling-whitespace-drift",
    "--agent",
    "codex:tooling-whitespace-drift",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--dry-run",
    "--json",
  ]);
  assert.equal(start.status, 1);
  assert.match(start.stderr, /raw 문자열이 정확히 type:chore/);
  assert.equal(
    readCreateState().writes.length,
    writesBeforeDriftChecks,
  );
  assert.equal(
    readCreateCalls().some((call) => call.method !== "GET"),
    false,
  );
});

test("create fails closed on missing labels and ambiguous milestones", () => {
  const missingLabelState = resetCreateState();
  missingLabelState.labels = missingLabelState.labels.filter(
    (label) => label !== "area:quality",
  );
  writeCreateState(missingLabelState);
  const missingLabel = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(missingLabel.status, 1);
  assert.match(missingLabel.stderr, /Missing repository label/);
  assert.equal(readCreateState().writes.length, 0);

  const milestoneState = resetCreateState();
  milestoneState.milestones.push({ number: 4, title: "MVP" });
  writeCreateState(milestoneState);
  const ambiguous = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(ambiguous.status, 1);
  assert.match(
    JSON.parse(ambiguous.stderr).error,
    /exactly one open milestone "MVP", found 2/,
  );
  assert.equal(readCreateState().writes.length, 0);
});

test("create requires a fresh plan token, creates without assignee, and is idempotent", () => {
  resetCreateState();
  const args = createArgs();
  const dryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const token = JSON.parse(dryRun.stdout).planToken;

  const stale = runCreateCli([
    ...args,
    "--confirm-plan",
    "0".repeat(64),
  ]);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /plan changed/);
  assert.equal(readCreateState().writes.length, 0);

  const created = runCreateCli([...args, "--confirm-plan", token]);
  assert.equal(created.status, 0, created.stderr);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.issue, 8);
  const state = readCreateState();
  assert.equal(state.issues.length, 2);
  assert.deepEqual(state.issues[1].assignees, []);
  assert.match(
    state.issues[1].body,
    /^<!-- lunchtime-work-item:create key=docs-harness-create project=none -->/,
  );
  const createWrite = state.writes.find(
    (write) => write.kind === "issue-create",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(createWrite.body, "assignees"),
    false,
  );

  const secondDryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(secondDryRun.status, 0, secondDryRun.stderr);
  assert.match(
    JSON.parse(secondDryRun.stdout).planned.join("\n"),
    /skip Issue #8; exact create state already exists/,
  );
  assert.equal(
    readCreateState().writes.filter((write) => write.kind === "issue-create")
      .length,
    1,
  );
});

test("create exact state rejects every unrequested label without overwriting it", () => {
  resetCreateState();
  const args = createArgs();
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const token = JSON.parse(dryRun.stdout).planToken;
  const created = runCreateCli([...args, "--confirm-plan", token]);
  assert.equal(created.status, 0, created.stderr);

  const state = readCreateState();
  state.issues[1].labels.push({ name: "priority:p0" });
  writeCreateState(state);
  const conflict = runCreateCli([...args, "--dry-run"]);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /unexpected label.*priority:p0/);
  assert.ok(
    readCreateState().issues[1].labels.some(
      (label) => label.name === "priority:p0",
    ),
  );
});

test("a non-Project create marker remains checkable and startable without Project reads", () => {
  resetCreateState();
  const args = createArgs();
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const token = JSON.parse(dryRun.stdout).planToken;
  const created = runCreateCli([...args, "--confirm-plan", token]);
  assert.equal(created.status, 0, created.stderr);
  writeFileSync(createLogPath, "");

  const checked = runCreateCli([
    "check",
    "8",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ]);
  assert.equal(checked.status, 0, checked.stderr);
  const checkPayload = JSON.parse(checked.stdout);
  assert.equal(checkPayload.ready, true);
  assert.equal(checkPayload.project.required, false);

  const start = runCreateCli([
    "start",
    "8",
    "--branch",
    "work/issue-8-general-docs",
    "--agent",
    "codex:create-test",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--dry-run",
    "--json",
  ]);
  assert.equal(start.status, 0, start.stderr);
  assert.equal(
    readCreateCalls().some((call) => call.endpoint === "graphql"),
    false,
  );
});

test("a project-none marker from a non-write Issue author cannot bypass Project", () => {
  const state = resetCreateState({ permission: "read" });
  state.issues.push({
    ...state.issues[0],
    number: 8,
    id: 1008,
    node_id: "ISSUE_8",
    title: "Untrusted Project opt-out",
    body: [
      "<!-- lunchtime-work-item:create key=public-opt-out project=none -->",
      "",
      validBody(),
    ].join("\n"),
    user: { login: "public-user" },
  });
  writeCreateState(state);

  const checked = runCreateCli([
    "check",
    "8",
    "--config",
    join(fixtureDirectory, "work-management.json"),
    "--repo",
    "Example/LunchTime",
    "--json",
  ]);
  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /must appear exactly once in Project/);
});

test("create opt-in Project and native blocker reach exact Todo state", () => {
  resetCreateState();
  const args = createArgs({ project: true, blockedBy: true });
  const dryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPayload = JSON.parse(dryRun.stdout);
  assert.equal(dryPayload.project, "LunchTime MVP");
  assert.deepEqual(dryPayload.blockedBy, [7]);
  assert.ok(dryPayload.labels.includes("dependency:blocked"));

  const created = runCreateCli([
    ...args,
    "--confirm-plan",
    dryPayload.planToken,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const state = readCreateState();
  assert.deepEqual(state.projectItems, [
    { id: "ITEM_8", issueNumber: 8, status: "Todo" },
  ]);
  assert.deepEqual(state.dependencies, { 8: [7] });
  assert.ok(
    state.issues[1].labels.some(
      (label) => label.name === "dependency:blocked",
    ),
  );
});

test("create recovery removes only a stale derived blocked label after blockers close", () => {
  resetCreateState();
  const args = createArgs({ blockedBy: true });
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const created = runCreateCli([
    ...args,
    "--confirm-plan",
    JSON.parse(dryRun.stdout).planToken,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const state = readCreateState();
  state.issues[0].state = "closed";
  state.issues[0].state_reason = "completed";
  writeCreateState(state);

  const recoveryDryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(recoveryDryRun.status, 0, recoveryDryRun.stderr);
  const recoveryPlan = JSON.parse(recoveryDryRun.stdout);
  assert.deepEqual(recoveryPlan.planned, [
    "remove stale derived labels from Issue #8: dependency:blocked",
  ]);

  const recovered = runCreateCli([
    ...args,
    "--confirm-plan",
    recoveryPlan.planToken,
  ]);
  assert.equal(recovered.status, 0, recovered.stderr);
  const recoveredState = readCreateState();
  assert.equal(
    recoveredState.issues[1].labels.some(
      (label) => label.name === "dependency:blocked",
    ),
    false,
  );
  assert.deepEqual(recoveredState.dependencies, { 8: [7] });
});

test("create reports partial Project failure and resumes only after a new dry-run", () => {
  resetCreateState({ failProjectAdds: 1 });
  const args = createArgs({ project: true });
  const firstDryRun = runCreateCli([...args, "--dry-run"]);
  const firstToken = JSON.parse(firstDryRun.stdout).planToken;
  const failed = runCreateCli([
    ...args,
    "--confirm-plan",
    firstToken,
  ]);
  assert.equal(failed.status, 1);
  const failure = JSON.parse(failed.stderr);
  assert.match(failure.completed.join("\n"), /created Issue #8/);
  assert.match(failure.repair.join("\n"), /Do not retry automatically/);
  assert.equal(
    readCreateState().writes.filter((write) => write.kind === "issue-create")
      .length,
    1,
  );

  const recoveryDryRun = runCreateCli([...args, "--dry-run"]);
  assert.equal(recoveryDryRun.status, 0, recoveryDryRun.stderr);
  const recoveryPlan = JSON.parse(recoveryDryRun.stdout);
  assert.match(recoveryPlan.planned.join("\n"), /add Issue to Project/);
  assert.equal(
    recoveryPlan.planned.some((entry) => entry.includes("create unassigned")),
    false,
  );
  const recovered = runCreateCli([
    ...args,
    "--confirm-plan",
    recoveryPlan.planToken,
  ]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(
    readCreateState().writes.filter((write) => write.kind === "issue-create")
      .length,
    1,
  );
});

test("create refuses title duplicates and existing assignees without overwriting", () => {
  const base = resetCreateState();
  base.issues.push({
    number: 8,
    id: 1008,
    node_id: "ISSUE_8",
    html_url: "https://github.com/Example/LunchTime/issues/8",
    state: "open",
    state_reason: null,
    title: "개별 작업 이슈 생성 계약을 검증한다",
    body: validBody(),
    labels: [{ name: "status:todo" }],
    assignees: [],
    milestone: { number: 3, title: "MVP" },
  });
  base.nextIssueNumber = 9;
  writeCreateState(base);
  const duplicate = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /same normalized title/);
  assert.equal(readCreateState().writes.length, 0);

  resetCreateState();
  const args = createArgs();
  const dryRun = runCreateCli([...args, "--dry-run"]);
  const token = JSON.parse(dryRun.stdout).planToken;
  const created = runCreateCli([...args, "--confirm-plan", token]);
  assert.equal(created.status, 0, created.stderr);
  const assigned = readCreateState();
  assigned.issues[1].assignees = [{ login: "someone-else" }];
  writeCreateState(assigned);
  const conflict = runCreateCli([...args, "--dry-run"]);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /assignees are/);
  assert.deepEqual(readCreateState().issues[1].assignees, [
    { login: "someone-else" },
  ]);
});

test("create rejects duplicate markers but ignores unrelated malformed markers", () => {
  const duplicateMarkers = resetCreateState();
  const marker =
    "<!-- lunchtime-work-item:create key=docs-harness-create project=none -->";
  duplicateMarkers.issues.push(
    {
      ...duplicateMarkers.issues[0],
      number: 8,
      id: 1008,
      node_id: "ISSUE_8",
      title: "First marker",
      body: `${marker}\n\n${validBody()}`,
    },
    {
      ...duplicateMarkers.issues[0],
      number: 9,
      id: 1009,
      node_id: "ISSUE_9",
      title: "Second marker",
      body: `${marker}\n\n${validBody()}`,
    },
  );
  writeCreateState(duplicateMarkers);
  const duplicate = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /appears on #8, #9/);

  for (const body of [
    `${marker}\n${marker}\n\n${validBody()}`,
    `${marker}\n<!-- lunchtime-work-item:create broken -->\n\n${validBody()}`,
    [
      "<!-- lunchtime-work-item:create key=docs-harness-create broken -->",
      validBody(),
    ].join("\n\n"),
  ]) {
    const conflicted = resetCreateState();
    conflicted.issues.push({
      ...conflicted.issues[0],
      number: 8,
      id: 1008,
      node_id: "ISSUE_8",
      title: "Renamed marker owner",
      body,
    });
    writeCreateState(conflicted);
    const result = runCreateCli([...createArgs(), "--dry-run"]);
    assert.equal(result.status, 1);
    assert.match(
      JSON.parse(result.stderr).error,
      /idempotency key "docs-harness-create".*malformed or multiple.*#8/,
    );
    assert.equal(readCreateState().writes.length, 0);
  }

  const malformedState = resetCreateState();
  malformedState.issues.push({
    ...malformedState.issues[0],
    number: 8,
    id: 1008,
    node_id: "ISSUE_8",
    title: "Malformed marker",
    body: `<!-- lunchtime-work-item:create broken -->\n\n${validBody()}`,
  });
  writeCreateState(malformedState);
  const malformed = runCreateCli([...createArgs(), "--dry-run"]);
  assert.equal(malformed.status, 0, malformed.stderr);
  assert.match(
    JSON.parse(malformed.stdout).planned.join("\n"),
    /create unassigned/,
  );
  assert.equal(readCreateState().writes.length, 0);
});

test("validate-body accepts namespaced IDs with level-two headings", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: validBody(),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal(result.mutations, "");
});

test("validate-body accepts GitHub Issue Form level-three headings", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: validBody(undefined, "###"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal(result.mutations, "");
});

test("validate-body accepts tooling-only traceability only with one type:chore label", () => {
  const accepted = runCli(
    [
      "validate-body",
      "-",
      "--label",
      "type:chore",
      "--label",
      "area:quality",
      "--json",
    ],
    { input: toolingBody() },
  );
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).valid, true);

  for (const labels of [
    [],
    ["type:feat"],
    ["type:docs"],
    ["type:chore", "type:feat"],
    [" type:chore"],
    ["type:chore "],
    ["\ttype:chore\t"],
    ["type:chore", " type:feat"],
  ]) {
    const result = runCli(
      [
        "validate-body",
        "-",
        ...labels.flatMap((label) => ["--label", label]),
        "--json",
      ],
      { input: toolingBody() },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /실제 type label이 type:chore 하나/,
      labels.join(","),
    );
    assert.equal(result.mutations, "");
  }

  const choreWithProductIds = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    { input: validBody() },
  );
  assert.equal(choreWithProductIds.status, 0, choreWithProductIds.stderr);
});

test("tooling source grammar allows its exact marker, normal blocks, inline code, and complete inline links", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const body = [
    "<!-- lunchtime-work-item:create key=tooling-source-grammar project=required -->",
    toolingBody().replace(
      context,
      [
        context,
        "",
        "**강조된 일반 문단**과 [GitHub Issue #57](https://github.com/GoCalendar/LunchTime/issues/57)을 사용합니다.",
        "",
        "| 종류 | 값 |",
        "| --- | --- |",
        "| literal | `<!-- <tag> &amp; ![image][ref] \u200B -->` |",
        "",
        "1. ordered list",
        "- unordered list",
        "   three-space paragraph",
        "-    four-space list content",
        "- - nested list content",
        String.raw`- escaped literal \[brackets\]`,
      ].join("\n"),
    ),
  ].join("\n\n");
  const result = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    { input: body },
  );
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("validate-body rejects malformed, hidden, mixed, and product-owning tooling N/A", () => {
  const reason =
    "개발 하네스의 검증과 이슈 생명주기 계약만 변경한다.";
  const traceSection =
    `## 추적성\n- ${toolingTracePrefix} ${reason}`;
  const malformedBodies = [
    toolingBody().replace(
      traceSection,
      "## 추적성\n- 해당 없음",
    ),
    toolingBody({ traceReason: "TODO" }),
    toolingBody().replace(
      traceSection,
      `## 추적성\n<!-- - ${toolingTracePrefix} ${reason} -->`,
    ),
    toolingBody().replace(
      traceSection,
      [
        "## 추적성",
        "```text",
        `- ${toolingTracePrefix} ${reason}`,
        "```",
      ].join("\n"),
    ),
    toolingBody().replace(
      traceSection,
      `## 추적성\n![근거](https://example.com/${encodeURIComponent(toolingTracePrefix)})`,
    ),
    toolingBody().replace(
      traceSection,
      [
        "## 추적성",
        `- ${toolingTracePrefix} ${reason}`,
        "- PRD-01-FR-01",
      ].join("\n"),
    ),
    toolingBody().replace(
      "- 제품 문서: 변경 없음 — 제품 동작과 PRD·Policy 정본을 변경하지 않는다.",
      "- 제품 문서: 변경 없음 — TODO",
    ),
    toolingBody({ allowedPath: "docs/prd/01_fixture.md" }),
  ];

  for (const body of malformedBodies) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: body },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).valid, false);
    assert.equal(result.mutations, "");
  }
});

test("validate-body rejects tooling N/A mixed with visible product IDs anywhere in the body", () => {
  const visibleProductIds = [
    "PRD-01-FR-01",
    String.raw`PRD\-01\-FR\-01`,
    "PRD—01—FR—01",
    "PRD―01―FR―01",
    "_PRD-01-FR-01_",
    "~~PRD-01-FR-01~~",
    "PRD~~-01-~~FR-01",
    "[PRD-01-FR-01](https://example.com/contract)",
    "`PRD-01-FR-01`",
    "`![PRD-01-FR-01](https://example.com/contract)`",
  ];
  const mixedBodies = visibleProductIds.map((productId) =>
    toolingBody().replace(
      "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 맥락\n${productId} 요구사항도 함께 변경합니다.`,
    ),
  );
  mixedBodies.push(
    validBody().replace(
      "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 맥락\n${toolingTracePrefix} 제품 ID가 없다는 선언을 추가합니다.`,
    ),
  );
  for (const [index, body] of mixedBodies.entries()) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: body },
    );
    assert.equal(
      result.status,
      1,
      `${visibleProductIds[index] ?? "N/A outside trace"}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /이슈 본문 전체에서 제품 계약 ID.*비적용 선언을 함께 사용할 수 없습니다/,
    );
  }

  for (const rejectedProjectionSyntax of [
    "PRD&#45;01&#45;FR&#45;01",
    "PRD&hyphen;01&hyphen;FR&hyphen;01",
    "PRD&horbar;01&horbar;FR&horbar;01",
    "PRD&mdash;01&mdash;FR&mdash;01",
    "P&ZeroWidthSpace;RD-01-FR-01",
    "P&#8203;RD-01-FR-01",
    "P\u200BRD-01-FR-01",
    "&lt;!-- PRD&#45;01&#45;FR&#45;01 --&gt;",
    "<!-- PRD-01-FR-01 -->",
    String.raw`<!-- PRD\-01\-FR\-01 -->`,
    "```text\nPRD-01-FR-01\n```",
    "```text\nPRD&#45;01&#45;FR&#45;01\n```",
    "![PRD-01-FR-01](https://example.com/POL-02-R-04)",
    "![diagram](https://example.com/PRD&#45;01&#45;FR&#45;01)",
  ]) {
    const body = toolingBody().replace(
      "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 맥락\n충분히 구체적인 작업 설명을 작성합니다.\n${rejectedProjectionSyntax}`,
    );
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: body },
    );
    assert.equal(
      result.status,
      1,
      `${rejectedProjectionSyntax}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  for (const hiddenDeclaration of [
    `<!-- ${toolingTracePrefix} 숨은 선언 -->`,
    `\`\`\`text\n${toolingTracePrefix} 숨은 선언\n\`\`\``,
    `![diagram](https://example.com/${toolingTracePrefix}숨은-선언)`,
  ]) {
    const body = validBody().replace(
      "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.",
      `## 맥락\n충분히 구체적인 작업 설명을 작성합니다.\n${hiddenDeclaration}`,
    );
    const result = runCli(
      ["validate-body", "-", "--label", "type:feat", "--json"],
      { input: body },
    );
    assert.equal(
      result.status,
      1,
      `${hiddenDeclaration}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }
});

test("tooling grammar rejects hidden product-ID projection syntax but allows inline-code literals", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const withEvidence = (evidence, definitions = "") =>
    [
      toolingBody().replace(
        context,
        `${context}\n${evidence}`,
      ),
      definitions,
    ]
      .filter(Boolean)
      .join("\n\n");

  const renderedEvidence = [
    {
      evidence: "[PRD-01-][x][FR-01][y]",
      definitions: "[x]: https://example.com/x\n[y]: https://example.com/y",
    },
    {
      evidence: String.raw`[PRD\-01\-][X][FR\-01][Y]`,
      definitions: "[x]: https://example.com/x\n[y]: https://example.com/y",
    },
    {
      evidence: "PRD-01-<em>FR</em>-01",
    },
    {
      evidence: "PRD-01-<kbd data-key=\"safe\">FR</kbd>-01",
    },
    {
      evidence: "<p class=\"safe\">PRD-01-FR-01</p>",
    },
    {
      evidence:
        'PRD-01-<span data-contract="POL-99-R-99">FR</span>-01',
    },
    {
      evidence: "![PRD-01-FR-01]",
    },
    {
      evidence: "![PRD-01-FR-01][diagram]",
    },
    {
      evidence: String.raw`\![PRD-01-FR-01]`,
    },
  ];
  for (const { evidence, definitions } of renderedEvidence) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withEvidence(evidence, definitions) },
    );
    assert.equal(
      result.status,
      1,
      `${evidence}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  const rejectedHiddenEvidence = [
    {
      evidence: "[PRD-01-][missing][FR-01][other]",
    },
    {
      evidence: "[PRD-01-][x][FR-01][y]",
      definitions:
        "<!-- [x]: https://example.com/x\n[y]: https://example.com/y -->",
    },
    {
      evidence: "[PRD-01-][x][FR-01][y]",
      definitions:
        "```text\n[x]: https://example.com/x\n[y]: https://example.com/y\n```",
    },
    {
      evidence: "[PRD-01-][x][FR-01][y]",
      definitions:
        "`[x]: https://example.com/x`\n`[y]: https://example.com/y`",
    },
    {
      evidence: "[PRD-01-][x][[FR]-01][y]",
      definitions: "[x]: https://example.com/x\n[y]: https://example.com/y",
    },
    {
      evidence: String.raw`PRD-01-\<em>FR\</em>-01`,
    },
    {
      evidence: '<span data-contract="PRD-01-FR-01">일반 설명</span>',
    },
    {
      evidence: '<p data-contract="PRD-01-FR-01">일반 설명</p>',
    },
    {
      evidence: "<code>PRD-01-FR-01</code>",
    },
    {
      evidence:
        '![PRD-01-FR-01](https://example.com/assets/(contract-image) "계약 (이미지)")',
    },
    {
      evidence: "일반 설명",
      definitions: "[PRD-01-FR-01]: https://example.com/contract",
    },
  ];
  for (const { evidence, definitions } of rejectedHiddenEvidence) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withEvidence(evidence, definitions) },
    );
    assert.equal(
      result.status,
      1,
      `${evidence}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  for (const literalInlineCode of [
    "`PRD-01-<em>FR</em>-01`",
    "`![PRD-01-<em>FR</em>-01](https://example.com/contract)`",
    "`PRD&#45;01&#45;FR&#45;01`",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withEvidence(literalInlineCode) },
    );
    assert.equal(
      result.status,
      0,
      `${literalInlineCode}\n${result.stdout}\n${result.stderr}`,
    );
  }

  const literalReference = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: withEvidence(
        "`[PRD-01-][x][FR-01][y]`",
        "[x]: https://example.com/x\n[y]: https://example.com/y",
      ),
    },
  );
  assert.equal(literalReference.status, 1);
  const literalReferenceErrors = JSON.parse(
    literalReference.stdout,
  ).errors.join("\n");
  assert.match(literalReferenceErrors, toolingSourceGrammarPattern);
});

test("tooling source grammar rejects raw HTML blocks, tags, autolinks, and blockquotes", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const rawBlockEvidence = [
    "<div>![PRD-01-FR-01](https://example.com/diagram.png)</div>",
    [
      "<section>",
      "![PRD-01-FR-01][diagram]",
      "</section>",
      "",
      "[diagram]: https://example.com/diagram.png",
    ].join("\n"),
    [
      "<table>",
      "<tr><td>![PRD-01-FR-01](https://example.com/diagram.png)</td></tr>",
      "</table>",
    ].join("\n"),
    [
      "<div>",
      "<!-- a nonblank raw HTML line -->",
      "\u00A0",
      "![PRD-01-FR-01](https://example.com/diagram.png)",
      "</div>",
    ].join("\n"),
    [
      "",
      "<x-contract>",
      "![PRD-01-FR-01](https://example.com/diagram.png)",
      "</x-contract>",
    ].join("\n"),
    "- <div>raw HTML inside a list</div>",
    "> blockquote container",
    "<x-contract>custom element</x-contract>",
    "<not a valid HTML tag",
    String.raw`\<em\>escaped raw tag`,
    "<hr>\n## 구조를 바꾸는 가짜 제목",
    "<https://example.com/autolink>",
    "<reviewer@example.com>",
    "- ```text\n  list backtick fence\n  ```",
    "- ~~~text\n  list tilde fence\n  ~~~",
    "1. ~~~text\n   ordered-list tilde fence\n   ~~~",
    "> ~~~text\n> blockquote tilde fence\n> ~~~",
    "    top-level indented code block",
    "\tindented code block with a tab",
    "- item\n\n      list-contained indented code block",
    "-     first-block indented code",
    "1. item\n\n       ordered-list indented code block",
    "1.\tambiguous tab-padded list item",
    "- -     nested list-contained indented code",
    "- -\tnested tab-padded list item",
    "1. -     ordered nested indented code",
    "충분한 문장\r    bare-CR indented code block",
    "[safe\rlabel](https://example.com/destination)",
  ];
  for (const evidence of rawBlockEvidence) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: toolingBody().replace(
          context,
          `${context}\n${evidence}`,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${evidence}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  const inlineVisible = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: toolingBody().replace(
        context,
        `${context}\n일반 문장 <kbd>PRD-01-FR-01</kbd>`,
      ),
    },
  );
  assert.equal(inlineVisible.status, 1, inlineVisible.stderr);
  assert.match(
    JSON.parse(inlineVisible.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );

  const inlineImage = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: toolingBody().replace(
        context,
        `${context}\n일반 문장 <kbd>![PRD-01-FR-01](https://example.com/diagram.png)</kbd>`,
      ),
    },
  );
  assert.equal(
    inlineImage.status,
    1,
    `${inlineImage.stdout}\n${inlineImage.stderr}`,
  );
  assert.match(
    JSON.parse(inlineImage.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );

  const crlfBody = toolingBody().replaceAll("\n", "\r\n");
  const crlf = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    { input: crlfBody },
  );
  assert.equal(
    crlf.status,
    0,
    `${crlf.stdout}\n${crlf.stderr}`,
  );

  const afterBlankLine = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: toolingBody().replace(
        context,
        [
          context,
          "<div>일반 설명</div>",
          "",
          "![PRD-01-FR-01](https://example.com/diagram.png)",
        ].join("\n"),
      ),
    },
  );
  assert.equal(
    afterBlankLine.status,
    1,
    `${afterBlankLine.stdout}\n${afterBlankLine.stderr}`,
  );
  assert.match(
    JSON.parse(afterBlankLine.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );

  for (const hidden of [
    "<code>PRD-01-FR-01</code>",
    "<pre>PRD-01-FR-01</pre>",
    "<script>PRD-01-FR-01</script>",
    "<style>PRD-01-FR-01</style>",
    "<template>PRD-01-FR-01</template>",
    "<textarea>PRD-01-FR-01</textarea>",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: toolingBody().replace(
          context,
          `${context}\n${hidden}`,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${hidden}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  const original =
    "## 변경 허용 경로\n- .agents/skills/run-github-work-item/SKILL.md";
  const pathBlock = toolingBody().replace(
    original,
    [
      "## 변경 허용 경로",
      "- .agents/**",
      "<div>![docs/prd/**](https://example.com/diagram.png)</div>",
    ].join("\n"),
  );
  const pathResult = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    { input: pathBlock },
  );
  assert.equal(
    pathResult.status,
    1,
    `${pathResult.stdout}\n${pathResult.stderr}`,
  );
  assert.match(
    JSON.parse(pathResult.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );
});

test("tooling source grammar rejects comments that join evidence and every reference-link form", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const bodies = [
    toolingBody().replace(
      context,
      `${context}\nPRD-01-FR<!-- split -->-01`,
    ),
    toolingBody().replace(
      context,
      `${context}\ndocs/pr<!-- split -->d/**`,
    ),
    toolingBody().replace(
      context,
      `${context}\n\\![PRD-01-FR-01]`,
    ),
    toolingBody().replace(
      context,
      [
        context,
        "![PRD-01-FR-01][diagram]",
        "일반 문단이 계속됩니다.",
        "[diagram]: https://example.com/diagram.png",
      ].join("\n"),
    ),
    toolingBody().replace(
      context,
      [
        context,
        "<?hidden",
        "[diagram]: https://example.com/diagram.png",
        "?>",
      ].join("\n"),
    ),
    ...[
      "[label][reference]",
      "[label][]",
      "[label]",
      "[reference]: https://example.com/reference",
      "[label",
      "label]",
    ].map((evidence) =>
      toolingBody().replace(context, `${context}\n${evidence}`),
    ),
    `${toolingBody()}\n![PRD-01-FR-01](invalid destination with spaces`,
    `${toolingBody()}\n[safe](unterminated-PRD-01-FR-01`,
    [
      "<!-- lunchtime-work-item:create key=tooling-source-grammar project=none -->",
      "<!-- lunchtime-work-item:create key=tooling-source-second project=none -->",
      toolingBody(),
    ].join("\n"),
    [
      "<!-- ordinary comment is not a create marker -->",
      toolingBody(),
    ].join("\n"),
  ];

  for (const body of bodies) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: body },
    );
    assert.equal(
      result.status,
      1,
      `${body}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }
});

test("tooling source grammar rejects resolved and unresolved Markdown images", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const withEvidence = (evidence, definitions = "") =>
    [
      toolingBody().replace(context, `${context}\n${evidence}`),
      definitions,
    ]
      .filter(Boolean)
      .join("\n\n");

  for (const { evidence, definitions } of [
    {
      evidence: "![PRD-01-FR-01][diagram]",
      definitions: "[diagram]: https://example.com/diagram.png",
    },
    {
      evidence: "![PRD-01-FR-01][]",
      definitions: "[PRD-01-FR-01]: https://example.com/diagram.png",
    },
    {
      evidence: "![PRD-01-FR-01]",
      definitions: "[PRD-01-FR-01]: https://example.com/diagram.png",
    },
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withEvidence(evidence, definitions) },
    );
    assert.equal(
      result.status,
      1,
      `${evidence}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  for (const evidence of [
    "![PRD-01-FR-01][missing]",
    "![PRD-01-FR-01][]",
    "![PRD-01-FR-01]",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withEvidence(evidence) },
    );
    assert.equal(
      result.status,
      1,
      `${evidence}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }
});

test("tooling source grammar rejects every reference definition and malformed image", () => {
  const context =
    "## 맥락\n충분히 구체적인 작업 설명을 작성합니다.";
  const withEvidence = (evidence, definition) =>
    [
      toolingBody().replace(context, `${context}\n${evidence}`),
      definition,
    ].join("\n\n");
  const validDefinitions = [
    "[diagram]: <https://example.com/diagram with spaces.png>",
    "[diagram]: https://example.com/assets/(diagram).png",
    "[diagram]: https://example.com/assets/(nested/(diagram)).png",
    '[diagram]: https://example.com/diagram.png "Diagram title"',
    "[diagram]: https://example.com/diagram.png 'Diagram title'",
    "[diagram]: https://example.com/diagram.png (Diagram title)",
    String.raw`[diagram]: https://example.com/diagram.png (Diagram \(v2\))`,
    [
      "[diagram]:",
      "  <https://example.com/diagram with spaces.png>",
      '  "Diagram title"',
    ].join("\n"),
  ];
  for (const definition of validDefinitions) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: withEvidence(
          "![PRD-01-FR-01][diagram]",
          definition,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${definition}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  const invalidDefinitions = [
    "[diagram]: invalid destination with spaces",
    "[diagram]: https://example.com/assets/(diagram.png",
    "[diagram]: <https://example.com/diagram.png",
    '[diagram]: https://example.com/diagram.png "unterminated',
    "[diagram]: https://example.com/diagram.png (title) trailing",
    "[diagram]: https://example.com/diagram.png (Diagram (v2))",
  ];
  for (const definition of invalidDefinitions) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: withEvidence(
          "![PRD-01-FR-01][diagram]",
          definition,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${definition}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  const invalidDefinitionText = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: withEvidence(
        "일반 설명",
        "[PRD-01-FR-01]: invalid destination with spaces",
      ),
    },
  );
  assert.equal(
    invalidDefinitionText.status,
    1,
    `${invalidDefinitionText.stdout}\n${invalidDefinitionText.stderr}`,
  );
  assert.match(
    JSON.parse(invalidDefinitionText.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );

  const original =
    "## 변경 허용 경로\n- .agents/skills/run-github-work-item/SKILL.md";
  const invalidPathBody = [
    toolingBody().replace(
      original,
      [
        "## 변경 허용 경로",
        "- .agents/** ![docs/prd/**][diagram]",
      ].join("\n"),
    ),
    "[diagram]: invalid destination with spaces",
  ].join("\n\n");
  const invalidPath = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    { input: invalidPathBody },
  );
  assert.equal(
    invalidPath.status,
    1,
    `${invalidPath.stdout}\n${invalidPath.stderr}`,
  );
  assert.match(
    JSON.parse(invalidPath.stdout).errors.join("\n"),
    toolingSourceGrammarPattern,
  );
});

test("tooling source scanner rejects a near-limit unclosed link within a linear operation bound", () => {
  const base = `${toolingBody()}\n[safe](`;
  const targetBytes = 65_000;
  const unmatchedCount =
    targetBytes - Buffer.byteLength(base, "utf8");
  assert.ok(unmatchedCount > 0);
  const adversarial = `${base}${"a".repeat(unmatchedCount)}`;
  const bodyBytes = Buffer.byteLength(adversarial, "utf8");
  assert.ok(bodyBytes >= 64_000 && bodyBytes <= 65_536, `${bodyBytes}`);

  const result = runCli(
    ["validate-body", "-", "--label", "type:chore", "--json"],
    {
      input: adversarial,
      extraEnv: {
        WORK_ITEM_TEST_PROJECTION_DIAGNOSTICS: "1",
      },
    },
  );
  assert.equal(
    result.status,
    1,
    `${result.stdout}\n${result.stderr}`,
  );
  const output = JSON.parse(result.stdout);
  assert.match(output.errors.join("\n"), toolingSourceGrammarPattern);
  const operations = output.referenceProjectionOperations;
  assert.equal(Number.isInteger(operations), true);
  assert.ok(
    operations <= adversarial.length * 4,
    `${operations} operations for ${adversarial.length} UTF-16 code units`,
  );
});

test("validate-body recognizes rendered-visible contract IDs in traceability", () => {
  for (const traceability of [
    String.raw`PRD\-01\-FR\-01 POL\-02\-R\-04`,
    "PRD&#45;01&#45;FR&#45;01 POL&#45;02&#45;R&#45;04",
    "_PRD-01-FR-01_ and [POL-02-R-04](https://example.com/policy)",
    "`PRD-01-FR-01` and `POL-02-R-04`",
  ]) {
    const result = runCli(["validate-body", "-", "--json"], {
      input: validBody(traceability),
    });
    assert.equal(
      result.status,
      0,
      `${traceability}\n${result.stdout}\n${result.stderr}`,
    );
  }
});

test("validate-body rejects tooling N/A path scopes that can own product contracts", () => {
  const oversizedBrace = `docs/{${[
    ...Array.from({ length: 32 }, (_, index) => `area${index + 1}`),
    "prd",
  ].join(",")}}/**`;
  for (const allowedPath of [
    "docs/prd/01_fixture.md",
    "docs/policies/**",
    "docs/**",
    "./docs/**",
    "**",
    "./**",
    "docs/*",
    "docs/{prd,policies}/**",
    "docs/./prd/**",
    "tooling/../docs/policies/**",
    "docs/prd/../policies/**",
    "[docs/prd/**](https://example.com/scope)",
    "_docs/prd/**_",
    "~~docs/prd/**~~",
    "docs&#47;prd/**",
    "docs&sol;policies/**",
    String.raw`docs\/prd/**`,
    "&#91;docs&#47;prd/**&#93;",
    "&lbrack;docs/prd/**&rbrack;",
    "do&ZeroWidthSpace;cs/prd/**",
    "do&#8203;cs/policies/**",
    oversizedBrace,
    "docs/{development,prd/**",
    "docs/[development/**",
    "docs/@(development|prd)/**",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: toolingBody({ allowedPath }) },
    );
    assert.equal(result.status, 1, `${allowedPath}\n${result.stderr}`);
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      new RegExp(
        `${toolingSourceGrammarPattern.source}|상위·glob·정규화 경로 범위`,
      ),
      allowedPath,
    );
  }

  const boundedBrace = `docs/{${Array.from(
    { length: 32 },
    (_, index) => `area${index + 1}`,
  ).join(",")}}/**`;
  for (const allowedPath of [
    ".agents/**",
    "docs/development/**",
    "docs/prd/../development/**",
    "docs/prd-old/**",
    "docs/policies-old/**",
    "[docs/development/**](https://example.com/scope)",
    "_docs/development/**_",
    String.raw`docs\/development/**`,
    boundedBrace,
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: toolingBody({ allowedPath }) },
    );
    assert.equal(result.status, 0, `${allowedPath}\n${result.stderr}`);
  }
});

test("tooling grammar rejects hidden product-path syntax but allows inline-code literals", () => {
  const withDefinitions = (allowedPath, definitions = "") =>
    [toolingBody({ allowedPath }), definitions]
      .filter(Boolean)
      .join("\n\n");

  const renderedProductPaths = [
    {
      allowedPath: "[do][x][cs/prd/**][y]",
      definitions: "[x]: https://example.com/x\n[y]: https://example.com/y",
    },
    {
      allowedPath: "[do][x][cs/policies/**][y]",
      definitions: "[x]: https://example.com/x\n[y]: https://example.com/y",
    },
    {
      allowedPath: "do<em>cs/pr</em>d/**",
    },
    {
      allowedPath: "do<strong>cs/policies</strong>/**",
    },
    {
      allowedPath: "do<kbd data-key=\"safe\">cs/pr</kbd>d/**",
    },
    {
      allowedPath:
        '<p data-path="docs/development/**">docs/policies/**</p>',
    },
    {
      allowedPath: ".agents/** ![docs/prd/**]",
    },
    {
      allowedPath: ".agents/** ![docs/policies/**][diagram]",
    },
    {
      allowedPath: ".agents/** `docs/prd/**`",
    },
  ];
  for (const { allowedPath, definitions } of renderedProductPaths) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withDefinitions(allowedPath, definitions) },
    );
    assert.equal(
      result.status,
      1,
      `${allowedPath}\n${result.stdout}\n${result.stderr}`,
    );
    const errors = JSON.parse(result.stdout).errors.join("\n");
    assert.ok(
      new RegExp(
        `${toolingSourceGrammarPattern.source}|상위·glob·정규화 경로 범위`,
      ).test(errors),
      `${allowedPath}\n${errors}`,
    );
  }

  const rejectedHiddenPaths = [
    {
      allowedPath: ".agents/** [do][missing][cs/prd/**][other]",
    },
    {
      allowedPath: ".agents/** [do][x][cs/prd/**][y]",
      definitions:
        "<!-- [x]: https://example.com/x\n[y]: https://example.com/y -->",
    },
    {
      allowedPath: ".agents/** [do][x][cs/prd/**][y]",
      definitions:
        "```text\n[x]: https://example.com/x\n[y]: https://example.com/y\n```",
    },
    {
      allowedPath: ".agents/** [do][x][cs/prd/**][y]",
      definitions:
        "`[x]: https://example.com/x`\n`[y]: https://example.com/y`",
    },
    {
      allowedPath: "do<em>cs/develop</em>ment/**",
    },
    {
      allowedPath:
        '.agents/** <span data-path="docs/prd/**">docs/development/**</span>',
    },
    {
      allowedPath:
        '.agents/** <p data-path="docs/prd/**">docs/development/**</p>',
    },
    {
      allowedPath: ".agents/** <code>docs/prd/**</code>",
    },
    {
      allowedPath:
        '.agents/** ![docs/prd/**](https://example.com/assets/(scope-image) "범위 (이미지)")',
    },
  ];
  for (const { allowedPath, definitions } of rejectedHiddenPaths) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withDefinitions(allowedPath, definitions) },
    );
    assert.equal(
      result.status,
      1,
      `${allowedPath}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }

  for (const literalInlineCodePath of [
    ".agents/** `![docs/prd/**](https://example.com/scope)`",
    ".agents/** `do<em>cs/pr</em>d/**`",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: withDefinitions(literalInlineCodePath) },
    );
    assert.equal(
      result.status,
      0,
      `${literalInlineCodePath}\n${result.stdout}\n${result.stderr}`,
    );
  }
});

test("tooling allowed-path gate scans paragraphs, ordered lists, tables, and unordered bullets", () => {
  const original =
    "## 변경 허용 경로\n- .agents/skills/run-github-work-item/SKILL.md";
  const renderedProductScopes = [
    "docs/prd/**",
    "1. docs/policies/**",
    [
      "| 종류 | 경로 |",
      "| --- | --- |",
      "| 제품 정본 | docs/prd/01_fixture.md |",
    ].join("\n"),
    "- docs/policies/02_fixture.md",
  ];
  for (const content of renderedProductScopes) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: toolingBody().replace(
          original,
          `## 변경 허용 경로\n${content}`,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${content}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /상위·glob·정규화 경로 범위/,
    );
  }
});

test("tooling allowed-path grammar permits inline destinations but rejects hidden Markdown syntax", () => {
  const original =
    "## 변경 허용 경로\n- .agents/skills/run-github-work-item/SKILL.md";
  const bodies = [
    toolingBody().replace(
      original,
      [
        "## 변경 허용 경로",
        ".agents/** [안전한 링크](https://example.com/docs/prd/**)",
      ].join("\n"),
    ),
    toolingBody().replace(
      original,
      [
        "## 변경 허용 경로",
        ".agents/** ![docs/prd/**](https://example.com/diagram.png)",
      ].join("\n"),
    ),
    [
      toolingBody().replace(
        original,
        [
          "## 변경 허용 경로",
          ".agents/** ![docs/prd/**][diagram]",
        ].join("\n"),
      ),
      "[diagram]: https://example.com/diagram.png",
    ].join("\n\n"),
    [
      toolingBody().replace(
        original,
        [
          "## 변경 허용 경로",
          ".agents/** ![docs/policies/**]",
        ].join("\n"),
      ),
      "[docs/policies/**]: https://example.com/diagram.png",
    ].join("\n\n"),
    toolingBody().replace(
      original,
      [
        "## 변경 허용 경로",
        ".agents/** <!-- docs/prd/** -->",
        "<code>docs/policies/**</code>",
        "```text",
        "docs/prd/**",
        "```",
        "`docs/development/**`",
      ].join("\n"),
    ),
    [
      toolingBody().replace(
        original,
        [
          "## 변경 허용 경로",
          ".agents/**",
        ].join("\n"),
      ),
      "[docs/prd/**]: https://example.com/reference-only",
    ].join("\n\n"),
    toolingBody().replace(
      original,
      [
        "## 변경 허용 경로",
        '.agents/** <p data-path="docs/prd/**">docs/development/**</p>',
      ].join("\n"),
    ),
  ];

  for (const [index, body] of bodies.entries()) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      { input: body },
    );
    assert.equal(
      result.status,
      index === 0 ? 0 : 1,
      `${body}\n${result.stdout}\n${result.stderr}`,
    );
    if (index > 0) {
      assert.match(
        JSON.parse(result.stdout).errors.join("\n"),
        toolingSourceGrammarPattern,
      );
    }
  }

  for (const unresolved of [
    ".agents/** ![docs/prd/**][missing]",
    ".agents/** ![docs/policies/**]",
  ]) {
    const result = runCli(
      ["validate-body", "-", "--label", "type:chore", "--json"],
      {
        input: toolingBody().replace(
          original,
          `## 변경 허용 경로\n${unresolved}`,
        ),
      },
    );
    assert.equal(
      result.status,
      1,
      `${unresolved}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      toolingSourceGrammarPattern,
    );
  }
});

test("validate-body accepts namespaced requirement and rule IDs with three-digit suffixes", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: plannedBody(),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal(result.mutations, "");
});

test("validate-body requires undefined planned IDs to own product document paths", () => {
  const missingPlan = runCli(["validate-body", "-", "--json"], {
    input: validBody("PRD-123-FR-456 POL-123-R-456"),
  });
  assert.equal(missingPlan.status, 1, missingPlan.stderr);
  assert.match(
    JSON.parse(missingPlan.stdout).errors.join("\n"),
    /planned — 이 PR에서 정의/,
  );

  const forbiddenDocs = plannedBody().replace(
    "## 변경 금지 경로\n- 애플리케이션 범위 밖 경로",
    [
      "## 변경 금지 경로",
      "- docs/prd/**",
      "- docs/policies/**",
    ].join("\n"),
  );
  const conflict = runCli(["validate-body", "-", "--json"], {
    input: forbiddenDocs,
  });
  assert.equal(conflict.status, 1, conflict.stderr);
  assert.match(
    JSON.parse(conflict.stdout).errors.join("\n"),
    /정본 경로가 "변경 금지 경로"의 상위·동일·하위 범위와 충돌/,
  );

  for (const parentPath of ["docs/**", "./docs/**"]) {
    const parentForbidden = plannedBody().replace(
      "## 변경 금지 경로\n- 애플리케이션 범위 밖 경로",
      `## 변경 금지 경로\n- ${parentPath}`,
    );
    const parentConflict = runCli(["validate-body", "-", "--json"], {
      input: parentForbidden,
    });
    assert.equal(parentConflict.status, 1, parentConflict.stderr);
    assert.match(
      JSON.parse(parentConflict.stdout).errors.join("\n"),
      /상위·동일·하위 범위와 충돌/,
      parentPath,
    );
  }

  for (const allowedExclusion of [
    [
      "## 변경 금지 경로",
      "- docs/prd/other.md",
      "- docs/policies/other.md",
    ].join("\n"),
    [
      "## 변경 금지 경로",
      "- docs/prd-old/**",
      "- docs/policies-old/**",
    ].join("\n"),
  ]) {
    const nonOverlapping = plannedBody().replace(
      "## 변경 금지 경로\n- 애플리케이션 범위 밖 경로",
      allowedExclusion,
    );
    const result = runCli(["validate-body", "-", "--json"], {
      input: nonOverlapping,
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const dotRelativeOwned = plannedBody()
    .replace("- docs/prd/123_fixture.md", "- ./docs/prd/123_fixture.md")
    .replace(
      "- docs/policies/123_fixture.md",
      "- ./docs/policies/123_fixture.md",
    );
  const dotRelativeResult = runCli(["validate-body", "-", "--json"], {
    input: dotRelativeOwned,
  });
  assert.equal(dotRelativeResult.status, 0, dotRelativeResult.stderr);

  for (const invalidPath of [
    "docs/prd/README.md",
    "docs/prd/**",
    "docs/prd/999_fixture.md",
  ]) {
    const invalidDefinitionPath = plannedBody()
      .replace("docs/prd/123_fixture.md", invalidPath);
    const result = runCli(["validate-body", "-", "--json"], {
      input: invalidDefinitionPath,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /구체적 docs\/prd\/NN_\*\.md 정본 파일/,
      invalidPath,
    );
  }

  const splitImpactOwnership = plannedBody().replace(
    "- PRD-123-FR-456: docs/prd/123_fixture.md에서 정의",
    [
      "- PRD-123-FR-456 정의",
      "- docs/prd/123_fixture.md 변경",
    ].join("\n"),
  );
  const splitImpactResult = runCli(["validate-body", "-", "--json"], {
    input: splitImpactOwnership,
  });
  assert.equal(splitImpactResult.status, 1, splitImpactResult.stderr);
  assert.match(
    JSON.parse(splitImpactResult.stdout).errors.join("\n"),
    /"문서 영향"의 같은 항목/,
  );
});

test("validate-body requires the exact planned declaration phrase", () => {
  for (const replacement of [
    "planned - 이 PR에서 정의",
    "Planned — 이 PR에서 정의",
    "planned—이 PR에서 정의",
    "planned — 이 PR에서 정의하지 않음",
  ]) {
    const result = runCli(["validate-body", "-", "--json"], {
      input: plannedBody().replaceAll(
        "planned — 이 PR에서 정의",
        replacement,
      ),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /"planned — 이 PR에서 정의"로 선언/,
    );
  }
});

test("validate-body rejects bare IDs", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: validBody("FR-01 AC-02 SP-03 R-04"),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.equal(result.mutations, "");
});

test("validate-body rejects trace IDs that exist only in comments or fences", () => {
  const cases = [
    "제품 요구사항을 연결합니다. <!-- PRD-01-FR-01 -->",
    "제품 요구사항을 연결합니다. <!-- PRD-01-FR-01",
    [
      "제품 요구사항을 연결합니다.",
      "```text",
      "PRD-01-FR-01",
      "```",
    ].join("\n"),
    "[정본 링크](https://example.com/PRD-01-FR-01)",
    [
      "제품 요구사항을 연결합니다.",
      "[정본]: https://example.com/PRD-01-FR-01",
      "[연결][정본]",
    ].join("\n"),
    '<a href="https://example.com/PRD-01-FR-01">정본 링크</a>',
  ];

  for (const traceability of cases) {
    const result = runCli(["validate-body", "-", "--json"], {
      input: validBody(traceability),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      JSON.parse(result.stdout).errors.join("\n"),
      /"추적성" 섹션에는 전역 네임스페이스가 있는 PRD 또는 정책 ID/,
    );
    assert.equal(result.mutations, "");
  }
});

test("validate-body ignores bare IDs and required headings hidden in comments", () => {
  const bareComment = runCli(["validate-body", "-", "--json"], {
    input: validBody(
      "제품 요구사항을 연결합니다. <!-- FR-01 -->",
    ),
  });
  assert.equal(bareComment.status, 1, bareComment.stderr);
  assert.doesNotMatch(
    JSON.parse(bareComment.stdout).errors.join("\n"),
    /발견된 값: FR-01/,
  );

  const hiddenBody = runCli(["validate-body", "-", "--json"], {
    input: ["<!--", validBody(), "-->"].join("\n"),
  });
  assert.equal(hiddenBody.status, 1, hiddenBody.stderr);
  assert.match(
    JSON.parse(hiddenBody.stdout).errors.join("\n"),
    /"## 개요" 또는 "### 개요" 제목이 하나여야 하지만 0개/,
  );
  assert.equal(bareComment.mutations, "");
  assert.equal(hiddenBody.mutations, "");
});

test("validate-body rejects fenced headings and one-character placeholders", () => {
  const fenced = ["```markdown", validBody(), "```"].join("\n");
  const fencedResult = runCli(["validate-body", "-", "--json"], {
    input: fenced,
  });
  assert.equal(fencedResult.status, 1, fencedResult.stderr);

  const placeholder = validBody().replace(
    "충분히 구체적인 작업 설명을 작성합니다.",
    "x",
  );
  const placeholderResult = runCli(["validate-body", "-", "--json"], {
    input: placeholder,
  });
  assert.equal(placeholderResult.status, 1, placeholderResult.stderr);
  assert.equal(fencedResult.mutations, "");
  assert.equal(placeholderResult.mutations, "");
});

test("check reports a ready Issue using read-only calls", () => {
  const result = runCli([
    "check",
    "1",
    "--config",
    "work-management.json",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ready, true);
  assert.equal(result.mutations, "");
});

test("check ignores an exact marker from a non-write collaborator", () => {
  const result = runCli(
    ["check", "1", "--config", "work-management.json", "--json"],
    { mode: "untrusted-marker" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ready, true);
  assert.equal(output.activeClaim, null);
  assert.equal(result.mutations, "");
});

test("start dry-run plans the claim without mutation", () => {
  const result = runCli([
    "start",
    "1",
    "--branch",
    "work/issue-1-fixture",
    "--agent",
    "codex:test",
    "--config",
    "work-management.json",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.planned.length, 5);
  assert.equal(result.mutations, "");
});

test("start는 Trunk-Based Development 브랜치 형식을 강제한다", () => {
  const result = runCli([
    "start",
    "1",
    "--branch",
    "codex/1-fixture",
    "--agent",
    "codex:test",
    "--config",
    "work-management.json",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /work\/issue-1-<short-slug>/);
  assert.equal(result.mutations, "");
});

test("start rejects an active actor without write-or-higher permission", () => {
  const result = runCli(
    [
      "start",
      "1",
      "--branch",
      "work/issue-1-fixture",
      "--agent",
      "codex:test",
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "actor-readonly" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires write-or-higher permission/);
  assert.equal(result.mutations, "");
});

test("start dry-run fails when another exact claim is the winner", () => {
  const result = runCli(
    [
      "start",
      "1",
      "--branch",
      "work/issue-1-fixture",
      "--agent",
      "codex:test",
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "competing" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Active claim belongs to branch=work\/issue-1-other/);
  assert.equal(result.mutations, "");
});

test("start dry-run creates a fresh epoch claim after release for the same branch and agent", () => {
  const result = runCli(
    [
      "start",
      "1",
      "--branch",
      "work/issue-1-fixture",
      "--agent",
      "codex:test",
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "released" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.epoch, 101);
  assert.match(output.planned[0], /publish claim token/);
  assert.equal(result.mutations, "");
});

test("complete dry-run verifies merge and plans dependent release", () => {
  const result = runCli(
    [
      "complete",
      "1",
      "--pr",
      "9",
      "--head",
      mergedHead,
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "active" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.deepEqual(output.dependents, [
    {
      issue: 2,
      remainingOpenBlockers: [],
      wouldUnblock: true,
      marker: "<!-- lunchtime-work-item:dependency source=1 target=2 -->",
      commentBody:
        "<!-- lunchtime-work-item:dependency source=1 target=2 -->\n" +
        "선행 작업 #1이 PR #9으로 완료되었습니다.\n\n" +
        "모든 선행 작업이 완료되어 작업 가능 상태가 되었습니다.",
    },
  ]);
  assert.equal(result.mutations, "");
});

test("complete는 trunk가 아닌 base에 병합된 PR을 거부한다", () => {
  const result = runCli(
    [
      "complete",
      "1",
      "--pr",
      "9",
      "--head",
      mergedHead,
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "wrong-base" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /base branch.*expected trunk/);
  assert.equal(result.mutations, "");
});

test("complete는 다른 base·head repository 또는 누락된 repository identity를 거부한다", () => {
  for (const mode of [
    "wrong-base-repository",
    "wrong-head-repository",
    "missing-base-repository",
    "missing-head-repository",
  ]) {
    const result = runCli(
      [
        "complete",
        "1",
        "--pr",
        "9",
        "--head",
        mergedHead,
        "--config",
        "work-management.json",
        "--dry-run",
        "--json",
      ],
      { mode },
    );
    assert.equal(result.status, 1, mode);
    assert.match(result.stderr, /repository is not the current work repository/, mode);
    assert.equal(result.mutations, "", mode);
  }
});

test("complete rejects a closed Issue whose state_reason is not completed", () => {
  const result = runCli(
    [
      "complete",
      "1",
      "--pr",
      "9",
      "--head",
      mergedHead,
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "closed-not-planned" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /state_reason=not_planned/);
  assert.equal(result.mutations, "");
});

test("complete requires the exact finalized 40-character head", () => {
  for (const headValue of ["short", `${mergedHead}0`]) {
    const result = runCli(
      [
        "complete",
        "1",
        "--pr",
        "9",
        "--head",
        headValue,
        "--config",
        "work-management.json",
        "--dry-run",
        "--json",
      ],
      { mode: "active" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /40-character-finalized-head/);
    assert.equal(result.mutations, "");
  }
});

test("complete rejects a merged PR whose head differs from finalized head", () => {
  const result = runCli(
    [
      "complete",
      "1",
      "--pr",
      "9",
      "--head",
      mergedHead,
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "head-mismatch" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected finalized head/);
  assert.equal(result.mutations, "");
});

test("complete rejects multiple workflow labels and native closing references", () => {
  for (const mode of ["duplicate-status", "multiple-closing"]) {
    const result = runCli(
      [
        "complete",
        "1",
        "--pr",
        "9",
        "--head",
        mergedHead,
        "--config",
        "work-management.json",
        "--dry-run",
        "--json",
      ],
      { mode },
    );
    assert.equal(result.status, 1, mode);
    assert.equal(result.mutations, "", mode);
    if (mode === "duplicate-status") {
      assert.match(result.stderr, /labels=\[status:in-progress, status:done\]/);
    } else {
      assert.match(result.stderr, /must natively close exactly Issue #1/);
    }
  }
});

test("release dry-run plans a bounded abandon transition", () => {
  const result = runCli(
    [
      "release",
      "1",
      "--branch",
      "work/issue-1-fixture",
      "--agent",
      "codex:test",
      "--reason",
      "작업 우선순위 변경으로 반환합니다.",
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "active" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dryRun, true);
  assert.equal(output.planned.length, 4);
  assert.equal(result.mutations, "");
});

test("release is idempotent after its marker advances the claim epoch", () => {
  const result = runCli(
    [
      "release",
      "1",
      "--branch",
      "work/issue-1-fixture",
      "--agent",
      "codex:test",
      "--reason",
      "abandoned",
      "--config",
      "work-management.json",
      "--dry-run",
      "--json",
    ],
    { mode: "released" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.verified, true);
  assert.deepEqual(output.completed, ["release already satisfied"]);
  assert.deepEqual(output.planned, []);
  assert.equal(result.mutations, "");
});

test("reconcile dry-run removes a stale blocked label with no open native blockers", () => {
  const result = runCli(
    ["reconcile", "1", "--config", "work-management.json", "--dry-run", "--json"],
    { mode: "blocked-stale" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).planned, ["remove dependency:blocked"]);
  assert.equal(result.mutations, "");
});

test("reconcile dry-run adds a missing blocked label for an open native blocker", () => {
  const result = runCli(
    ["reconcile", "1", "--config", "work-management.json", "--dry-run", "--json"],
    { mode: "blocked-missing" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).planned, ["add dependency:blocked"]);
  assert.equal(result.mutations, "");
});

test("reconcile removes a stale blocked label and post-verifies it", () => {
  const result = runCli(
    ["reconcile", "1", "--config", "work-management.json", "--json"],
    { mode: "reconcile-remove" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.verified, true);
  assert.deepEqual(output.completed, ["remove dependency:blocked"]);
  assert.match(result.mutations, /DELETE .*dependency%3Ablocked/);
});

test("reconcile adds a missing blocked label and post-verifies it", () => {
  const result = runCli(
    ["reconcile", "1", "--config", "work-management.json", "--json"],
    { mode: "reconcile-add" },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.verified, true);
  assert.deepEqual(output.completed, ["add dependency:blocked"]);
  assert.match(result.mutations, /POST .*\/issues\/1\/labels/);
});

test("start stops at every mutation boundary when live tooling labels drift", () => {
  const expectedWrites = [
    "POST repos/Example/LunchTime/issues/1/comments",
    "PATCH repos/Example/LunchTime/issues/1",
    "POST repos/Example/LunchTime/issues/1/labels",
    "DELETE repos/Example/LunchTime/issues/1/labels/status%3Atodo",
  ];
  const expectedCompleted = [
    "publish claim token for branch=work/issue-1-tooling-drift agent=codex:tooling-drift",
    "assign @fixture-user",
    "add workflow label status:in-progress",
    "remove workflow label status:todo",
  ];

  for (let boundary = 1; boundary <= expectedWrites.length; boundary += 1) {
    const state = resetLifecycleState();
    state.issueBody = toolingBody();
    state.source.labels = ["status:todo", "type:chore", "custom:keep"];
    state.driftAfterStartMutation = boundary;
    state.driftTypeAfterStartMutation = true;
    writeLifecycleState(state);

    const result = runLifecycleCli([
      "start",
      "1",
      "--branch",
      "work/issue-1-tooling-drift",
      "--agent",
      "codex:tooling-drift",
      "--config",
      "work-management.json",
      "--json",
    ]);
    assert.equal(result.status, 1, `boundary=${boundary}`);
    const failure = JSON.parse(result.stderr);
    assert.match(
      failure.error,
      /Live Issue body\/type label contract changed during start/,
    );
    assert.match(
      failure.error,
      /실제 type label이 type:chore 하나.*type:feat/,
    );
    assert.deepEqual(
      failure.completed,
      expectedCompleted.slice(0, boundary),
      `boundary=${boundary}`,
    );
    assert.match(failure.repair.join("\n"), /Run check/);
    assert.deepEqual(
      lifecycleWrites().map(
        (call) => call.operation || `${call.method} ${call.endpoint}`,
      ),
      expectedWrites.slice(0, boundary),
      `boundary=${boundary}`,
    );
    assert.equal(readLifecycleState().projectStatus, "Todo");
  }
});

test("start revalidates the live Issue body before the next mutation", () => {
  const state = resetLifecycleState();
  state.issueBody = toolingBody();
  state.source.labels = ["status:todo", "type:chore", "custom:keep"];
  state.driftAfterStartMutation = 2;
  state.bodyAfterStartMutation = toolingBody({ traceReason: "TODO" });
  writeLifecycleState(state);

  const result = runLifecycleCli([
    "start",
    "1",
    "--branch",
    "work/issue-1-body-drift",
    "--agent",
    "codex:body-drift",
    "--config",
    "work-management.json",
    "--json",
  ]);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stderr);
  assert.match(
    failure.error,
    /Live Issue body\/type label contract changed during start/,
  );
  assert.match(failure.error, /구체적 사유/);
  assert.deepEqual(failure.completed, [
    "publish claim token for branch=work/issue-1-body-drift agent=codex:body-drift",
    "assign @fixture-user",
  ]);
  assert.match(failure.repair.join("\n"), /Run check/);
  assert.equal(lifecycleWrites().length, 2);
});

test("start re-reads every live ownership, workflow, blocker, and Project invariant before later writes", () => {
  const expectedWrites = [
    "POST repos/Example/LunchTime/issues/1/comments",
    "PATCH repos/Example/LunchTime/issues/1",
    "POST repos/Example/LunchTime/issues/1/labels",
    "DELETE repos/Example/LunchTime/issues/1/labels/status%3Atodo",
  ];
  const expectedCompleted = [
    "publish claim token for branch=work/issue-1-boundary-drift agent=codex:boundary-drift",
    "assign @fixture-user",
    "add workflow label status:in-progress",
    "remove workflow label status:todo",
  ];
  const driftCases = [
    ["claim", /Claim lost|exact active winning claim|requested claim token/],
    ["assignee", /assigned to \[other-user\]|exclusively @fixture-user/],
    ["issue-state", /Issue is closed, expected open/],
    ["workflow-label", /Workflow labels are \[status:done\]/],
    ["native-blocker", /Open native blockers: #4/],
    ["derived-blocked", /Derived blocked label dependency:blocked is present/],
    ["project-status", /Project Status is "Done"/],
    ["project-capacity", /Project has 2 In Progress item\(s\); limit is 2/],
  ];

  for (const [drift, errorPattern] of driftCases) {
    for (let boundary = 1; boundary <= expectedWrites.length; boundary += 1) {
      const state = resetLifecycleState();
      state.driftAfterStartMutation = boundary;
      state.startBoundaryDrift = drift;
      writeLifecycleState(state);

      const result = runLifecycleCli([
        "start",
        "1",
        "--branch",
        "work/issue-1-boundary-drift",
        "--agent",
        "codex:boundary-drift",
        "--config",
        "work-management.json",
        "--json",
      ]);
      assert.equal(
        result.status,
        1,
        `drift=${drift} boundary=${boundary}\n${result.stdout}\n${result.stderr}`,
      );
      const failure = JSON.parse(result.stderr);
      assert.match(
        failure.error,
        errorPattern,
        `drift=${drift} boundary=${boundary}`,
      );
      assert.deepEqual(
        failure.completed,
        expectedCompleted.slice(
          0,
          drift === "claim" && boundary === 1 ? 0 : boundary,
        ),
        `drift=${drift} boundary=${boundary}`,
      );
      assert.deepEqual(
        lifecycleWrites().map(
          (call) => call.operation || `${call.method} ${call.endpoint}`,
        ),
        expectedWrites.slice(0, boundary),
        `drift=${drift} boundary=${boundary}`,
      );
    }
  }
});

test("stateful start and merge-auto-close completion are idempotent and preserve dependent history", () => {
  resetLifecycleState();
  const startArgs = [
    "start",
    "1",
    "--branch",
    "work/issue-1-stateful",
    "--agent",
    "codex:stateful",
    "--config",
    "work-management.json",
    "--json",
  ];
  const completeArgs = [
    "complete",
    "1",
    "--pr",
    "9",
    "--head",
    mergedHead,
    "--config",
    "work-management.json",
    "--json",
  ];

  const started = runLifecycleCli(startArgs);
  assert.equal(started.status, 0, started.stderr);
  assert.equal(JSON.parse(started.stdout).verified, true);
  let state = readLifecycleState();
  assert.equal(state.projectStatus, "In Progress");
  assert.deepEqual(new Set(state.source.labels), new Set([
    "status:in-progress",
    "type:feat",
    "custom:keep",
  ]));
  assert.deepEqual(state.source.assignees, ["fixture-user"]);
  assert.equal(state.comments[1].length, 1);
  assert.equal(state.comments[1][0].user.login, "fixture-user");
  assert.match(
    state.comments[1][0].body,
    /^<!-- lunchtime-work-item:start issue=1 epoch=0 token=[a-f0-9]{64} -->/,
  );

  let writes = lifecycleWrites();
  assert.equal(writes.length, 5);
  assert.deepEqual(
    writes.map((call) => call.operation || `${call.method} ${call.endpoint}`),
    [
      "POST repos/Example/LunchTime/issues/1/comments",
      "PATCH repos/Example/LunchTime/issues/1",
      "POST repos/Example/LunchTime/issues/1/labels",
      "DELETE repos/Example/LunchTime/issues/1/labels/status%3Atodo",
      "UpdateStatus",
    ],
  );

  const writesAfterStart = writes.length;
  const repeatedStart = runLifecycleCli(startArgs);
  assert.equal(repeatedStart.status, 0, repeatedStart.stderr);
  assert.equal(JSON.parse(repeatedStart.stdout).verified, true);
  assert.equal(lifecycleWrites().length, writesAfterStart);

  state = readLifecycleState();
  state.source.state = "closed";
  state.source.stateReason = "completed";
  state.source.assignees = [];
  state.comments[1].push({
    id: 50,
    user: { login: "untrusted-user" },
    body:
      "<!-- lunchtime-work-item:complete issue=1 pr=9 -->\n" +
      "forged completion",
  });
  state.comments[2].push({
    id: 51,
    user: { login: "untrusted-user" },
    body:
      "<!-- lunchtime-work-item:dependency source=1 target=2 -->\n" +
      "forged dependency update",
  });
  writeLifecycleState(state);

  const writesBeforeUnownedComplete = lifecycleWrites().length;
  const unownedComplete = runLifecycleCli(completeArgs);
  assert.equal(unownedComplete.status, 1);
  assert.match(unownedComplete.stderr, /neither active/);
  assert.equal(lifecycleWrites().length, writesBeforeUnownedComplete);

  state = readLifecycleState();
  state.source.assignees = ["fixture-user"];
  writeLifecycleState(state);

  const completed = runLifecycleCli(completeArgs);
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(JSON.parse(completed.stdout).verified, true);
  state = readLifecycleState();
  assert.equal(state.source.state, "closed");
  assert.equal(state.source.stateReason, "completed");
  assert.equal(state.projectStatus, "Done");
  assert.deepEqual(new Set(state.source.labels), new Set([
    "status:done",
    "type:feat",
    "custom:keep",
  ]));
  assert.deepEqual(state.source.assignees, ["fixture-user"]);
  assert.deepEqual(new Set(state.dependent2.labels), new Set([
    "status:todo",
    "area:ui",
  ]));
  assert.deepEqual(new Set(state.dependent3.labels), new Set([
    "status:todo",
    "dependency:blocked",
    "custom:dependent",
  ]));

  const trustedCompletionComments = state.comments[1].filter(
    (comment) =>
      comment.user.login === "fixture-user" &&
      comment.body.startsWith(
        "<!-- lunchtime-work-item:complete issue=1 pr=9 -->",
      ),
  );
  assert.equal(trustedCompletionComments.length, 1);
  const trustedDependent2Comments = state.comments[2].filter(
    (comment) => comment.user.login === "fixture-user",
  );
  const trustedDependent3Comments = state.comments[3].filter(
    (comment) => comment.user.login === "fixture-user",
  );
  assert.equal(trustedDependent2Comments.length, 1);
  assert.equal(trustedDependent3Comments.length, 1);
  assert.match(trustedDependent3Comments[0].body, /#4/);
  const historicalDependent3Body = trustedDependent3Comments[0].body;

  const writesAfterComplete = lifecycleWrites().length;
  assert.equal(writesAfterComplete - writesAfterStart, 7);
  const repeatedComplete = runLifecycleCli(completeArgs);
  assert.equal(repeatedComplete.status, 0, repeatedComplete.stderr);
  assert.equal(JSON.parse(repeatedComplete.stdout).verified, true);
  assert.equal(lifecycleWrites().length, writesAfterComplete);

  state = readLifecycleState();
  state.blocker4.state = "closed";
  writeLifecycleState(state);
  const refreshedDependent = runLifecycleCli(completeArgs);
  assert.equal(refreshedDependent.status, 0, refreshedDependent.stderr);
  state = readLifecycleState();
  assert.equal(state.dependent3.labels.includes("dependency:blocked"), false);
  assert.equal(
    state.comments[3].filter(
      (comment) => comment.user.login === "fixture-user",
    ).length,
    1,
  );
  assert.equal(
    state.comments[3].find(
      (comment) => comment.user.login === "fixture-user",
    ).body,
    historicalDependent3Body,
  );
  assert.equal(lifecycleWrites().length, writesAfterComplete + 1);

  const writesAfterDependencyRefresh = lifecycleWrites().length;
  const finalRepeatedComplete = runLifecycleCli(completeArgs);
  assert.equal(finalRepeatedComplete.status, 0, finalRepeatedComplete.stderr);
  assert.equal(lifecycleWrites().length, writesAfterDependencyRefresh);

  const calls = readLifecycleCalls();
  assert.ok(
    calls.some((call) =>
      call.endpoint?.includes("/issues/1/dependencies/blocked_by"),
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.endpoint?.includes("/issues/1/dependencies/blocking"),
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.endpoint?.includes("/issues/2/dependencies/blocked_by"),
    ),
  );
  assert.ok(
    calls.some((call) =>
      call.endpoint?.includes("/issues/3/dependencies/blocked_by"),
    ),
  );
  assert.ok(
    calls.some((call) => call.operation === "PullRequestClosingIssues"),
  );
  const finalWrites = lifecycleWrites(calls);
  const mutationFingerprints = finalWrites.map((call) =>
    JSON.stringify([
      call.method,
      call.endpoint,
      call.operation,
      call.body,
    ]),
  );
  assert.equal(new Set(mutationFingerprints).size, mutationFingerprints.length);
});

test("child process timeout fails with ETIMEDOUT repair guidance", () => {
  const result = runCli(
    ["check", "1", "--config", "work-management.json", "--json"],
    { mode: "timeout" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /timed out after 50ms/);
  assert.match(result.stderr, /Do not retry in a loop/);
  assert.equal(result.mutations, "");
});

test("missing config fails closed before gh access", () => {
  const result = runCli(["check", "1", "--config", "missing.json", "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing workflow config/);
  assert.equal(result.mutations, "");
});

test("invalid label and Project status semantics fail closed", () => {
  const result = runCli([
    "check",
    "1",
    "--config",
    "invalid-work-management.json",
    "--json",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must start with status:/);
  assert.match(result.stderr, /must be distinct/);
  assert.equal(result.mutations, "");
});
