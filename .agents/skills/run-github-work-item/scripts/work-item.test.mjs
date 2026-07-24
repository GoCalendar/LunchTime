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

const active = mode === "active" || mode === "wrong-base";
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
    ...(staleBlocked ? [{ name: "dependency:blocked" }] : []),
  ],
  assignees:
    active || closedNotPlanned ? [{ login: "fixture-user" }] : [],
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
    base: { ref: mode === "wrong-base" ? "work/issue-99-integration" : "main" },
    head: { ref: branch },
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
              ],
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
    base: { ref: "main" },
    head: { ref: "work/issue-1-stateful" },
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
    save();
    output(issue(1));
  } else if (blockersMatch) {
    const number = Number(blockersMatch[1]);
    output(
      number === 1
        ? []
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
    save();
    output(comment);
  } else if (labelsMatch && method === "POST") {
    addLabels(Number(labelsMatch[1]), input.labels);
    save();
    output(labelObjects(input.labels));
  } else if (removeLabelMatch && method === "DELETE") {
    removeLabel(
      Number(removeLabelMatch[1]),
      decodeURIComponent(removeLabelMatch[2]),
    );
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
});

after(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

function runCli(args, { mode = "todo", input } = {}) {
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
    projectStatus: "Todo",
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

test("help does not require gh or configuration", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check <issue-number-or-url>/);
  assert.equal(result.mutations, "");
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

test("validate-body accepts namespaced requirement and rule IDs with three-digit suffixes", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: validBody("PRD-123-FR-456 POL-123-R-456"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  assert.equal(result.mutations, "");
});

test("validate-body rejects bare IDs", () => {
  const result = runCli(["validate-body", "-", "--json"], {
    input: validBody("FR-01 AC-02 SP-03 R-04"),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.equal(result.mutations, "");
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
  assert.equal(output.planned.length, 4);
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

test("complete rejects a closed Issue whose state_reason is not completed", () => {
  const result = runCli(
    [
      "complete",
      "1",
      "--pr",
      "9",
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
