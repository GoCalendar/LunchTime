import assert from "node:assert/strict";
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
import { after, before, test } from "node:test";
import {
  REQUIRED_HEADINGS,
  evaluateExistingIssue,
  issueMarker,
  renderIssueBody,
  validateDag,
  validateManifest,
} from "./bootstrap-mvp.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bootstrapScript = resolve(scriptDirectory, "bootstrap-mvp.mjs");
const workItemScript = resolve(scriptDirectory, "work-item.mjs");
let fixtureDirectory;
let fakeGh;
let writeLog;

function workItem(
  key,
  order,
  {
    dependsOn = [],
    type = "type:feat",
    areas = ["area:domain"],
    priority = "P1",
    phase = "Domain",
  } = {},
) {
  return {
    key,
    title: `${key} 관찰 가능한 작업 항목`,
    type,
    areas,
    priority,
    phase,
    order,
    dependsOn,
    overview: `${key}에서 독립적으로 병합 가능한 결과를 구현합니다.`,
    context: "병렬 AI 개발자가 대화 이력 없이도 같은 맥락을 이해해야 합니다.",
    goal: "검증 가능한 결과가 저장소와 사용자 동작에서 관찰됩니다.",
    scope: {
      include: ["명시된 계약과 최소 구현을 추가합니다."],
      exclude: ["후속 기능과 범위 밖 최적화는 구현하지 않습니다."],
    },
    acceptance: [
      "조건: 유효한 입력, 행동: 기능 실행, 결과: 예상 결과 확인",
    ],
    traceability: ["PRD-01-FR-01", "POL-01-R-01"],
    allowedPaths: ["Sources/LunchTime/**"],
    forbiddenPaths: ["docs/product-definition/**"],
    verification: ["node --test"],
    documentImpact: ["docs/prd/01_lunchtime_mvp.md의 영향 여부를 검토합니다."],
  };
}

function manifest(items = [workItem("LT-001", 1)]) {
  return {
    schemaVersion: 1,
    repository: "Example/LunchTime",
    project: { owner: "Example", number: 7 },
    milestone: "MVP",
    items,
  };
}

const statefulGhSource = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const statePath = process.env.BOOTSTRAP_STATE_FILE;
let state = JSON.parse(fs.readFileSync(statePath, "utf8"));

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
function output(value) {
  process.stdout.write(JSON.stringify(value));
}
function recordWrite(value) {
  state.writes.push(value);
  save();
}
function recordRead(kind) {
  state.reads[kind] += 1;
  save();
}

if (args[0] === "repo" && args[1] === "view") {
  output({ nameWithOwner: "Example/LunchTime" });
  process.exit(0);
}
if (args[0] !== "api") process.exit(2);
if (!args.includes("X-GitHub-Api-Version: 2026-03-10")) process.exit(4);

const endpoint = args.find(
  (arg) => arg === "user" || arg === "graphql" || arg.startsWith("repos/"),
);
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const input = args.includes("--input")
  ? JSON.parse(fs.readFileSync(0, "utf8"))
  : null;

if (endpoint === "user") {
  output({ login: "fixture-user" });
} else if (endpoint?.includes("/labels?")) {
  output(
    [
      "status:todo",
      "dependency:blocked",
      "type:spike",
      "type:feat",
      "area:p2p",
      "area:app-shell",
    ].map((name) => ({ name })),
  );
} else if (endpoint?.includes("/milestones?state=open")) {
  output([{ number: 3, title: "MVP", state: "open" }]);
} else if (endpoint?.includes("/issues?state=all")) {
  recordRead("issues");
  output(state.issues);
} else if (
  endpoint === "repos/Example/LunchTime/issues" &&
  method === "POST"
) {
  const number =
    state.issues.reduce(
      (maximum, issue) => Math.max(maximum, issue.number),
      0,
    ) + 1;
  const issue = {
    number,
    id: 1000 + number,
    node_id: "ISSUE_" + number,
    html_url: "https://github.com/Example/LunchTime/issues/" + number,
    title: input.title,
    body: input.body,
    state: "open",
    assignees: [],
    labels: input.labels.map((name) => ({ name })),
    milestone: { number: input.milestone, title: "MVP" },
  };
  recordWrite({ kind: "issue-create", body: input });
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.issues.push(issue);
  save();
  output(issue);
} else if (/issues\/\d+\/dependencies\/blocked_by/.test(endpoint || "")) {
  const issueNumber = Number(/issues\/(\d+)/.exec(endpoint)[1]);
  if (method === "GET") {
    recordRead("dependencies");
    output(
      (state.dependencies[String(issueNumber)] || []).map((number) =>
        state.issues.find((issue) => issue.number === number),
      ),
    );
  } else {
    const blocker = state.issues.find((issue) => issue.id === input?.issue_id);
    if (!blocker || !Number.isInteger(input?.issue_id)) process.exit(9);
    recordWrite({
      kind: "dependency",
      issueNumber,
      body: input,
    });
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.dependencies[String(issueNumber)] = [
      ...new Set([
        ...(state.dependencies[String(issueNumber)] || []),
        blocker.number,
      ]),
    ];
    save();
    output(blocker);
  }
} else if (/issues\/\d+\/labels$/.test(endpoint || "")) {
  const issueNumber = Number(/issues\/(\d+)/.exec(endpoint)[1]);
  recordWrite({ kind: "labels", issueNumber, body: input });
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const issue = state.issues.find((entry) => entry.number === issueNumber);
  for (const name of input.labels) {
    if (!issue.labels.some((label) => label.name === name)) {
      issue.labels.push({ name });
    }
  }
  save();
  output(issue.labels);
} else if (/issues\/\d+$/.test(endpoint || "") && method === "PATCH") {
  const issueNumber = Number(/issues\/(\d+)$/.exec(endpoint)[1]);
  recordWrite({ kind: "milestone", issueNumber, body: input });
  state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const issue = state.issues.find((entry) => entry.number === issueNumber);
  issue.milestone = { number: input.milestone, title: "MVP" };
  save();
  output(issue);
} else if (endpoint === "graphql") {
  const query = input.query || "";
  const variables = input.variables || {};
  if (query.includes("addProjectV2ItemById")) {
    const issue = state.issues.find(
      (entry) => entry.node_id === variables.contentId,
    );
    const projectItem = {
      id: "PROJECT_ITEM_" + issue.number,
      number: issue.number,
      status: null,
      priority: null,
      phase: null,
      order: null,
    };
    recordWrite({ kind: "project-add", variables });
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.projectItems.push(projectItem);
    save();
    output({ data: { addProjectV2ItemById: { item: { id: projectItem.id } } } });
  } else if (query.includes("updateProjectV2ItemFieldValue")) {
    recordWrite({ kind: "project-field", variables });
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const projectItem = state.projectItems.find(
      (entry) => entry.id === variables.itemId,
    );
    if (variables.fieldId === "STATUS_FIELD") projectItem.status = "Todo";
    if (variables.fieldId === "PRIORITY_FIELD") {
      projectItem.priority = variables.optionId;
    }
    if (variables.fieldId === "PHASE_FIELD") {
      projectItem.phase = {
        DISCOVERY: "Discovery",
        FOUNDATION: "Foundation",
        DOMAIN: "Domain",
      }[variables.optionId];
    }
    if (variables.fieldId === "ORDER_FIELD") {
      projectItem.order = variables.number;
    }
    save();
    output({
      data: {
        updateProjectV2ItemFieldValue: {
          projectV2Item: { id: projectItem.id },
        },
      },
    });
  } else {
    recordRead("project");
    const nodes = state.projectItems.map((projectItem) => {
      const issue = state.issues.find(
        (entry) => entry.number === projectItem.number,
      );
      return {
        id: projectItem.id,
        content: {
          id: issue.node_id,
          number: issue.number,
          repository: { nameWithOwner: "Example/LunchTime" },
        },
        status: projectItem.status
          ? { name: projectItem.status, optionId: "TODO" }
          : null,
        priority: projectItem.priority
          ? { name: projectItem.priority, optionId: projectItem.priority }
          : null,
        phase: projectItem.phase
          ? { name: projectItem.phase, optionId: projectItem.phase.toUpperCase() }
          : null,
        order:
          projectItem.order === null ? null : { number: projectItem.order },
      };
    });
    output({
      data: {
        repositoryOwner: {
          projectV2: {
            id: "PROJECT",
            title: "LunchTime MVP",
            fields: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: "STATUS_FIELD",
                  name: "Status",
                  dataType: "SINGLE_SELECT",
                  options: [{ id: "TODO", name: "Todo" }],
                },
                {
                  id: "PRIORITY_FIELD",
                  name: "Priority",
                  dataType: "SINGLE_SELECT",
                  options: ["P0", "P1"].map((name) => ({ id: name, name })),
                },
                {
                  id: "PHASE_FIELD",
                  name: "Phase",
                  dataType: "SINGLE_SELECT",
                  options: [
                    { id: "DISCOVERY", name: "Discovery" },
                    { id: "FOUNDATION", name: "Foundation" },
                    { id: "DOMAIN", name: "Domain" },
                  ],
                },
                {
                  id: "ORDER_FIELD",
                  name: "Order",
                  dataType: "NUMBER",
                },
              ],
            },
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
            },
          },
        },
      },
    });
  }
} else {
  process.stderr.write("unhandled endpoint: " + endpoint + "\n");
  process.exit(3);
}
`;

before(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "lunchtime-bootstrap-"));
  fakeGh = join(fixtureDirectory, "gh");
  writeLog = join(fixtureDirectory, "writes.log");
  writeFileSync(writeLog, "");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const log = process.env.BOOTSTRAP_WRITE_LOG;

if (process.env.BOOTSTRAP_FAKE_SLEEP === "1") {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
}

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

function record(value) {
  fs.appendFileSync(log, value + "\\n");
  process.stderr.write("unexpected write: " + value + "\\n");
  process.exit(91);
}

if (args[0] === "repo" && args[1] === "view") {
  output({ nameWithOwner: "Example/LunchTime" });
  process.exit(0);
}
if (args[0] !== "api") {
  process.stderr.write("unexpected gh command: " + args.join(" ") + "\\n");
  process.exit(2);
}
if (!args.includes("X-GitHub-Api-Version: 2026-03-10")) {
  process.stderr.write("missing current GitHub API version header\\n");
  process.exit(4);
}

const endpoint = args.find(
  (arg) => arg === "user" || arg === "graphql" || arg.startsWith("repos/"),
);
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const input = args.includes("--input")
  ? JSON.parse(fs.readFileSync(0, "utf8"))
  : null;

if (endpoint === "graphql" && /\\bmutation\\b/.test(input?.query || "")) {
  record("graphql mutation");
}
if (endpoint !== "graphql" && method !== "GET") {
  record(method + " " + endpoint);
}

if (endpoint === "user") {
  output({ login: "fixture-user" });
} else if (endpoint?.includes("/labels?")) {
  output([
    { name: "status:todo" },
    { name: "dependency:blocked" },
    { name: "type:spike" },
    { name: "type:feat" },
    { name: "area:p2p" },
    { name: "area:app-shell" },
  ]);
} else if (endpoint?.includes("/milestones?state=open")) {
  output([{ number: 3, title: "MVP", state: "open" }]);
} else if (endpoint?.includes("/issues?state=all")) {
  output([]);
} else if (endpoint === "graphql") {
  output({
    data: {
      repositoryOwner: {
        projectV2: {
          id: "PROJECT",
          title: "LunchTime MVP",
          fields: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "STATUS_FIELD",
                name: "Status",
                dataType: "SINGLE_SELECT",
                options: [
                  { id: "TODO", name: "Todo" },
                  { id: "IN_PROGRESS", name: "In Progress" },
                  { id: "DONE", name: "Done" },
                ],
              },
              {
                id: "PRIORITY_FIELD",
                name: "Priority",
                dataType: "SINGLE_SELECT",
                options: [
                  { id: "P0", name: "P0" },
                  { id: "P1", name: "P1" },
                  { id: "P2", name: "P2" },
                  { id: "P3", name: "P3" },
                ],
              },
              {
                id: "PHASE_FIELD",
                name: "Phase",
                dataType: "SINGLE_SELECT",
                options: [
                  { id: "DISCOVERY", name: "Discovery" },
                  { id: "FOUNDATION", name: "Foundation" },
                  { id: "DOMAIN", name: "Domain" },
                  { id: "SURFACE", name: "Surface" },
                  { id: "VERIFICATION", name: "Verification" },
                ],
              },
              { id: "ORDER_FIELD", name: "Order", dataType: "NUMBER" },
            ],
          },
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      },
    },
  });
} else {
  process.stderr.write("unhandled endpoint: " + endpoint + "\\n");
  process.exit(3);
}
`,
  );
  chmodSync(fakeGh, 0o755);
});

after(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

test("validateManifest accepts a continuous, ordered dependency DAG", () => {
  const value = manifest([
    workItem("LT-001", 1, {
      type: "type:spike",
      areas: ["area:p2p"],
      priority: "P0",
      phase: "Discovery",
    }),
    workItem("LT-002", 2, {
      dependsOn: ["LT-001"],
      areas: ["area:app-shell"],
      phase: "Foundation",
    }),
  ]);
  value.items[0].traceability = [
    "PRD-101-FR-001",
    "POL-101-R-001",
    "D-01",
    "F-001",
  ];
  const result = validateManifest(value);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("D/F references are supplemental and cannot replace a PRD or Policy source", () => {
  const value = manifest([workItem("LT-001", 1)]);
  value.items[0].traceability = ["D-01", "F-01"];
  const result = validateManifest(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /PRD or Policy source ID/);
});

test("validateManifest returns structured errors for non-object items", () => {
  const value = manifest([null, "not-an-object"]);
  let result;
  assert.doesNotThrow(() => {
    result = validateManifest(value);
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /\$\.items\[0\] must be an object/);
  assert.match(result.errors.join("\n"), /\$\.items\[1\] must be an object/);
});

test("validateManifest fails closed on gaps, forward dependencies, unsafe data, and bare IDs", () => {
  const value = manifest([
    workItem("LT-001", 1),
    {
      ...workItem("LT-003", 4, { dependsOn: ["LT-003"] }),
      context: "credential access_token=do-not-publish must never be accepted",
      traceability: ["FR-01"],
    },
  ]);
  const result = validateManifest(value);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /must be LT-002/);
  assert.match(result.errors.join("\n"), /order must be 2/);
  assert.match(result.errors.join("\n"), /must not contain itself/);
  assert.match(result.errors.join("\n"), /non-namespaced ID/);
  assert.match(result.errors.join("\n"), /unsafe data/);
});

test("validateDag reports a cycle independently of manifest ordering", () => {
  const errors = validateDag([
    { key: "LT-001", dependsOn: ["LT-002"] },
    { key: "LT-002", dependsOn: ["LT-001"] },
  ]);
  assert.match(errors.join("\n"), /Dependency cycle/);
});

test("renderIssueBody emits the exact marker and eleven ordered headings with dependency links", () => {
  const item = workItem("LT-002", 2, { dependsOn: ["LT-001"] });
  const body = renderIssueBody(
    item,
    new Map([
      [
        "LT-001",
        {
          number: 41,
          html_url: "https://github.com/Example/LunchTime/issues/41",
        },
      ],
    ]),
  );
  assert.ok(body.startsWith(`${issueMarker("LT-002")}\n\n`));
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, REQUIRED_HEADINGS);
  assert.match(body, /`LT-001`/);
  assert.match(body, /\[GitHub Issue #41\]\(https:\/\/github\.com\/Example\/LunchTime\/issues\/41\)/);
});

test("rendered body satisfies the shared work-item body validator", () => {
  const item = workItem("LT-002", 2, { dependsOn: ["LT-001"] });
  const body = renderIssueBody(
    item,
    new Map([
      [
        "LT-001",
        {
          number: 41,
          html_url: "https://github.com/Example/LunchTime/issues/41",
        },
      ],
    ]),
  );
  const result = spawnSync(
    process.execPath,
    [workItemScript, "validate-body", "-", "--json"],
    { input: body, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).valid, true);
});

test("existing-state evaluation skips exact state, recovers omissions, and refuses human conflicts", () => {
  const item = workItem("LT-001", 1);
  const body = renderIssueBody(item);
  const exact = {
    number: 9,
    state: "open",
    assignees: [],
    title: item.title,
    body,
    labels: [
      { name: "status:todo" },
      { name: "type:feat" },
      { name: "area:domain" },
      { name: "reviewed-by-human" },
    ],
    milestone: { number: 3 },
  };
  const desiredLabels = ["area:domain", "status:todo", "type:feat"];
  assert.deepEqual(
    evaluateExistingIssue({
      issue: exact,
      item,
      expectedBody: body,
      desiredLabels,
      milestoneNumber: 3,
    }),
    { conflicts: [], recover: [] },
  );

  const recoverable = {
    ...exact,
    labels: [{ name: "status:todo" }],
    milestone: null,
  };
  const recovery = evaluateExistingIssue({
    issue: recoverable,
    item,
    expectedBody: body,
    desiredLabels,
    milestoneNumber: 3,
  });
  assert.equal(recovery.conflicts.length, 0);
  assert.deepEqual(
    recovery.recover.map((entry) => entry.type),
    ["add-labels", "set-milestone"],
  );

  const conflict = evaluateExistingIssue({
    issue: {
      ...exact,
      body: `${body}\n\n사람이 추가한 내용`,
      labels: [...exact.labels, { name: "status:in-progress" }],
    },
    item,
    expectedBody: body,
    desiredLabels,
    milestoneNumber: 3,
  });
  assert.match(conflict.conflicts.join("\n"), /body differs/);
  assert.match(conflict.conflicts.join("\n"), /managed label/);
});

test("apply --dry-run performs live reads and zero writes with a fake gh", () => {
  const manifestPath = join(fixtureDirectory, "manifest.json");
  const configPath = join(fixtureDirectory, "config.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      manifest([
        workItem("LT-001", 1, {
          type: "type:spike",
          areas: ["area:p2p"],
          priority: "P0",
          phase: "Discovery",
        }),
        workItem("LT-002", 2, {
          dependsOn: ["LT-001"],
          areas: ["area:app-shell"],
          phase: "Foundation",
        }),
      ]),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        repository: "Example/LunchTime",
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
  writeFileSync(writeLog, "");
  const result = spawnSync(
    process.execPath,
    [
      bootstrapScript,
      "apply",
      "--dry-run",
      "--json",
      "--manifest",
      manifestPath,
      "--config",
      configPath,
    ],
    {
      cwd: fixtureDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH}`,
        BOOTSTRAP_WRITE_LOG: writeLog,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.writes, 0);
  assert.equal(payload.items, 2);
  assert.match(payload.planned.join("\n"), /create Issue LT-001/);
  assert.match(payload.planned.join("\n"), /link LT-002 blocked by LT-001/);
  assert.equal(readFileSync(writeLog, "utf8"), "");
});

test("apply creates an empty backlog in order and reruns without duplicates", () => {
  const binDirectory = join(fixtureDirectory, "empty-state-bin");
  const statefulGh = join(binDirectory, "gh");
  const statePath = join(fixtureDirectory, "empty-state-apply.json");
  const manifestPath = join(fixtureDirectory, "empty-state-manifest.json");
  const configPath = join(fixtureDirectory, "empty-state-config.json");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(statefulGh, statefulGhSource);
  chmodSync(statefulGh, 0o755);

  const items = [
    workItem("LT-001", 1, {
      type: "type:spike",
      areas: ["area:p2p"],
      priority: "P0",
      phase: "Discovery",
    }),
    workItem("LT-002", 2, {
      dependsOn: ["LT-001"],
      areas: ["area:app-shell"],
      phase: "Foundation",
    }),
  ];
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest(items), null, 2)}\n`,
  );
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        repository: "Example/LunchTime",
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
    statePath,
    `${JSON.stringify(
      {
        issues: [],
        projectItems: [],
        dependencies: {},
        writes: [],
        reads: { issues: 0, project: 0, dependencies: 0 },
      },
      null,
      2,
    )}\n`,
  );

  const invoke = () =>
    spawnSync(
      process.execPath,
      [
        bootstrapScript,
        "apply",
        "--json",
        "--manifest",
        manifestPath,
        "--config",
        configPath,
      ],
      {
        cwd: fixtureDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          BOOTSTRAP_STATE_FILE: statePath,
          LUNCHTIME_BOOTSTRAP_GH_TIMEOUT_MS: "2000",
        },
      },
    );

  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const firstResult = JSON.parse(first.stdout);
  const afterFirst = JSON.parse(readFileSync(statePath, "utf8"));
  assert.match(firstResult.completed.join("\n"), /created LT-001 as Issue #1/);
  assert.match(firstResult.completed.join("\n"), /created LT-002 as Issue #2/);
  assert.match(
    firstResult.completed.join("\n"),
    /verified 2 exact Issue, Project, label, milestone, and dependency states/,
  );
  assert.deepEqual(afterFirst.reads, {
    issues: 2,
    project: 2,
    dependencies: 2,
  });
  assert.deepEqual(
    afterFirst.writes.map((entry) => entry.kind),
    [
      "issue-create",
      "project-add",
      "project-field",
      "project-field",
      "project-field",
      "project-field",
      "issue-create",
      "project-add",
      "project-field",
      "project-field",
      "project-field",
      "project-field",
      "dependency",
    ],
  );

  const expectedFirstBody = renderIssueBody(items[0]);
  const expectedSecondBody = renderIssueBody(
    items[1],
    new Map([["LT-001", afterFirst.issues[0]]]),
  );
  assert.deepEqual(
    afterFirst.issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((label) => label.name),
      milestone: issue.milestone.number,
    })),
    [
      {
        number: 1,
        title: items[0].title,
        body: expectedFirstBody,
        labels: ["area:p2p", "status:todo", "type:spike"],
        milestone: 3,
      },
      {
        number: 2,
        title: items[1].title,
        body: expectedSecondBody,
        labels: [
          "area:app-shell",
          "dependency:blocked",
          "status:todo",
          "type:feat",
        ],
        milestone: 3,
      },
    ],
  );
  assert.ok(
    afterFirst.issues[0].body.startsWith(`${issueMarker("LT-001")}\n\n`),
  );
  assert.ok(
    afterFirst.issues[1].body.startsWith(`${issueMarker("LT-002")}\n\n`),
  );
  assert.deepEqual(afterFirst.projectItems, [
    {
      id: "PROJECT_ITEM_1",
      number: 1,
      status: "Todo",
      priority: "P0",
      phase: "Discovery",
      order: 1,
    },
    {
      id: "PROJECT_ITEM_2",
      number: 2,
      status: "Todo",
      priority: "P1",
      phase: "Foundation",
      order: 2,
    },
  ]);
  assert.deepEqual(
    afterFirst.writes
      .filter((entry) => entry.kind === "project-add")
      .map((entry) => entry.variables),
    [
      { projectId: "PROJECT", contentId: "ISSUE_1" },
      { projectId: "PROJECT", contentId: "ISSUE_2" },
    ],
  );
  assert.deepEqual(
    afterFirst.writes
      .filter((entry) => entry.kind === "project-field")
      .map((entry) => entry.variables),
    [
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_1",
        fieldId: "STATUS_FIELD",
        optionId: "TODO",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_1",
        fieldId: "PRIORITY_FIELD",
        optionId: "P0",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_1",
        fieldId: "PHASE_FIELD",
        optionId: "DISCOVERY",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_1",
        fieldId: "ORDER_FIELD",
        number: 1,
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "STATUS_FIELD",
        optionId: "TODO",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "PRIORITY_FIELD",
        optionId: "P1",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "PHASE_FIELD",
        optionId: "FOUNDATION",
      },
      {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "ORDER_FIELD",
        number: 2,
      },
    ],
  );
  assert.deepEqual(
    afterFirst.writes.filter((entry) => entry.kind === "dependency"),
    [
      {
        kind: "dependency",
        issueNumber: 2,
        body: { issue_id: 1001 },
      },
    ],
  );
  assert.deepEqual(afterFirst.dependencies, { 2: [1] });

  const writeCount = afterFirst.writes.length;
  const second = invoke();
  assert.equal(second.status, 0, second.stderr);
  const afterSecond = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(afterSecond.writes.length, writeCount);
  assert.equal(
    afterSecond.writes.filter((entry) => entry.kind === "issue-create").length,
    2,
  );
  assert.equal(afterSecond.issues.length, 2);
  assert.deepEqual(afterSecond.reads, {
    issues: 4,
    project: 4,
    dependencies: 6,
  });
});

test("apply recovers partial state, verifies writes, and reruns with zero writes", () => {
  const binDirectory = join(fixtureDirectory, "stateful-bin");
  const statefulGh = join(binDirectory, "gh");
  const statePath = join(fixtureDirectory, "stateful-apply.json");
  const manifestPath = join(fixtureDirectory, "stateful-manifest.json");
  const configPath = join(fixtureDirectory, "stateful-config.json");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(statefulGh, statefulGhSource);
  chmodSync(statefulGh, 0o755);

  const items = [
    workItem("LT-001", 1, {
      type: "type:spike",
      areas: ["area:p2p"],
      priority: "P0",
      phase: "Discovery",
    }),
    workItem("LT-002", 2, {
      dependsOn: ["LT-001"],
      areas: ["area:app-shell"],
      phase: "Foundation",
    }),
  ];
  const value = manifest(items);
  const workflowConfig = {
    repository: "Example/LunchTime",
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
  };
  const firstIssue = {
    number: 1,
    id: 1001,
    node_id: "ISSUE_1",
    html_url: "https://github.com/Example/LunchTime/issues/1",
    title: items[0].title,
    body: renderIssueBody(items[0]),
    state: "open",
    assignees: [],
    labels: ["area:p2p", "status:todo", "type:spike"].map((name) => ({
      name,
    })),
    milestone: { number: 3, title: "MVP" },
  };
  const secondIssue = {
    number: 2,
    id: 1002,
    node_id: "ISSUE_2",
    html_url: "https://github.com/Example/LunchTime/issues/2",
    title: items[1].title,
    body: renderIssueBody(
      items[1],
      new Map([["LT-001", firstIssue]]),
    ),
    state: "open",
    assignees: [],
    labels: [{ name: "status:todo" }],
    milestone: null,
  };
  writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(configPath, `${JSON.stringify(workflowConfig, null, 2)}\n`);
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        issues: [firstIssue, secondIssue],
        projectItems: [
          {
            id: "PROJECT_ITEM_1",
            number: 1,
            status: "Todo",
            priority: "P0",
            phase: "Discovery",
            order: 1,
          },
        ],
        dependencies: {},
        writes: [],
        reads: { issues: 0, project: 0, dependencies: 0 },
      },
      null,
      2,
    )}\n`,
  );

  const invoke = () =>
    spawnSync(
      process.execPath,
      [
        bootstrapScript,
        "apply",
        "--json",
        "--manifest",
        manifestPath,
        "--config",
        configPath,
      ],
      {
        cwd: fixtureDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          BOOTSTRAP_STATE_FILE: statePath,
          LUNCHTIME_BOOTSTRAP_GH_TIMEOUT_MS: "2000",
        },
      },
    );

  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const firstResult = JSON.parse(first.stdout);
  const afterFirst = JSON.parse(readFileSync(statePath, "utf8"));
  assert.match(
    firstResult.completed.join("\n"),
    /verified 2 exact Issue, Project, label, milestone, and dependency states/,
  );
  assert.deepEqual(afterFirst.reads, {
    issues: 2,
    project: 2,
    dependencies: 4,
  });
  assert.deepEqual(afterFirst.writes, [
    {
      kind: "labels",
      issueNumber: 2,
      body: {
        labels: ["area:app-shell", "dependency:blocked", "type:feat"],
      },
    },
    { kind: "milestone", issueNumber: 2, body: { milestone: 3 } },
    {
      kind: "project-add",
      variables: { projectId: "PROJECT", contentId: "ISSUE_2" },
    },
    {
      kind: "project-field",
      variables: {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "STATUS_FIELD",
        optionId: "TODO",
      },
    },
    {
      kind: "project-field",
      variables: {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "PRIORITY_FIELD",
        optionId: "P1",
      },
    },
    {
      kind: "project-field",
      variables: {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "PHASE_FIELD",
        optionId: "FOUNDATION",
      },
    },
    {
      kind: "project-field",
      variables: {
        projectId: "PROJECT",
        itemId: "PROJECT_ITEM_2",
        fieldId: "ORDER_FIELD",
        number: 2,
      },
    },
    {
      kind: "dependency",
      issueNumber: 2,
      body: { issue_id: 1001 },
    },
  ]);
  assert.deepEqual(afterFirst.dependencies, { 2: [1] });

  const writeCount = afterFirst.writes.length;
  const second = invoke();
  assert.equal(second.status, 0, second.stderr);
  const afterSecond = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(afterSecond.writes.length, writeCount);
  assert.deepEqual(afterSecond.reads, {
    issues: 4,
    project: 4,
    dependencies: 8,
  });
});

test("a stalled gh call is terminated by the bounded timeout without retry or write", () => {
  const manifestPath = join(fixtureDirectory, "timeout-manifest.json");
  const configPath = join(fixtureDirectory, "timeout-config.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      manifest([
        workItem("LT-001", 1, {
          type: "type:spike",
          areas: ["area:p2p"],
          priority: "P0",
          phase: "Discovery",
        }),
      ]),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        repository: "Example/LunchTime",
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
  writeFileSync(writeLog, "");
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [
      bootstrapScript,
      "apply",
      "--dry-run",
      "--json",
      "--manifest",
      manifestPath,
      "--config",
      configPath,
    ],
    {
      cwd: fixtureDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixtureDirectory}:${process.env.PATH}`,
        BOOTSTRAP_WRITE_LOG: writeLog,
        BOOTSTRAP_FAKE_SLEEP: "1",
        LUNCHTIME_BOOTSTRAP_GH_TIMEOUT_MS: "100",
      },
    },
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stderr);
  assert.match(payload.error, /timed out after 0\.1 seconds/);
  assert.match(payload.recovery.join("\n"), /Do not retry automatically/);
  assert.ok(elapsedMs < 900, `expected bounded failure, took ${elapsedMs}ms`);
  assert.equal(readFileSync(writeLog, "utf8"), "");
});
