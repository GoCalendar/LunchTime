import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LOCAL_EVIDENCE_CONTROL_PATHS,
  REGRESSION_GROUP_INPUT_RULES,
  aggregateInputFromEnvironment,
  classifyChangedPaths,
  classifyEvent,
  parseArguments,
  parseNulDelimitedPaths,
  readChangedPaths,
  regressionGroupsForPath,
  regressionInputRuleForPath,
  renderGitHubOutputs,
  validateAggregateResults,
} from "./validate-harness-paths.mjs";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const SCRIPT = fileURLToPath(
  new URL("./validate-harness-paths.mjs", import.meta.url),
);

function falseGroups(result) {
  assert.equal(result.full, false);
  assert.equal(result.productDocsRegression, false);
  assert.equal(result.workItemRegression, false);
  assert.equal(result.commitPrRegression, false);
  assert.equal(result.finalizeRegression, false);
  assert.deepEqual(result.groups, []);
}

function successfulGit(stdout, capture) {
  return (arguments_, options) => {
    if (capture) capture.push({ arguments_, options });
    return {
      status: 0,
      signal: null,
      stdout: Buffer.from(stdout),
      stderr: Buffer.alloc(0),
    };
  };
}

test("owner script 경로는 해당 회귀군만 선택한다", () => {
  const productDocs = classifyChangedPaths([
    ".agents/skills/update-product-docs/scripts/validate-product-docs.mjs",
  ]);
  assert.equal(productDocs.productDocsRegression, true);
  assert.deepEqual(productDocs.groups, ["productDocsRegression"]);

  const workItem = classifyChangedPaths([
    ".agents/skills/run-github-work-item/scripts/work-item.test.mjs",
  ]);
  assert.equal(workItem.workItemRegression, true);
  assert.deepEqual(workItem.groups, ["workItemRegression"]);

  const commitPr = classifyChangedPaths([
    ".agents/skills/commit-work-item/scripts/validate-commit-paths.mjs",
  ]);
  assert.equal(commitPr.commitPrRegression, true);
  assert.deepEqual(commitPr.groups, ["commitPrRegression"]);

  const finalize = classifyChangedPaths([
    ".agents/skills/open-pull-request/scripts/finalize-local-cleanup.test.mjs",
  ]);
  assert.equal(finalize.finalizeRegression, true);
  assert.deepEqual(finalize.groups, ["finalizeRegression"]);
});

test("owner 입력 파일도 관련 회귀군을 선택한다", () => {
  assert.deepEqual(
    classifyChangedPaths([".github/mvp-work-items.json"]).groups,
    ["workItemRegression"],
  );
  assert.deepEqual(
    classifyChangedPaths([".gitignore"]).groups,
    ["commitPrRegression"],
  );
  assert.deepEqual(
    classifyChangedPaths([".github/PULL_REQUEST_TEMPLATE.md"]).groups,
    ["commitPrRegression", "finalizeRegression"],
  );
});

test("일반 문서와 회귀 명령이 직접 읽지 않는 Skill 설명은 대형 회귀군을 선택하지 않는다", () => {
  const result = classifyChangedPaths([
    "README.md",
    "docs/meetings/2026-07-29-harness.md",
    ".agents/skills/open-pull-request/SKILL.md",
    ".agents/skills/open-pull-request/references/cleanup-notes.md",
  ]);
  falseGroups(result);
  assert.deepEqual(result.changedPaths, [
    "README.md",
    "docs/meetings/2026-07-29-harness.md",
    ".agents/skills/open-pull-request/SKILL.md",
    ".agents/skills/open-pull-request/references/cleanup-notes.md",
  ]);
});

test("work-item test가 직접 읽는 Skill·issue contract·interface는 work-item 회귀를 선택한다", () => {
  for (const path of [
    ".agents/skills/run-github-work-item/SKILL.md",
    ".agents/skills/run-github-work-item/references/issue-contract.md",
    ".agents/skills/run-github-work-item/agents/openai.yaml",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.full, false, path);
    assert.deepEqual(result.groups, ["workItemRegression"], path);
    assert.deepEqual(regressionGroupsForPath(path), [
      "workItemRegression",
    ]);
    assert.equal(
      regressionInputRuleForPath(path)?.id,
      "work-item-owner-and-live-contract",
    );
  }
});

test("공용 input manifest는 remote selection과 local evidence control 경계를 분리한다", () => {
  assert.equal(
    REGRESSION_GROUP_INPUT_RULES.some(
      (rule) => rule.id === "work-item-owner-and-live-contract",
    ),
    true,
  );
  for (const path of LOCAL_EVIDENCE_CONTROL_PATHS) {
    assert.deepEqual(regressionGroupsForPath(path), [
      "commitPrRegression",
    ]);
    assert.equal(classifyChangedPaths([path]).full, false);
  }
});

test("workflow, classifier, 공유 루트 계약은 전체 회귀로 fail-closed한다", () => {
  for (const path of [
    ".github/workflows/validate-harness.yml",
    ".github/workflows/validate-harness-paths.mjs",
    ".github/workflows/app-ci.yml",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "docs/development/01_harness_guide.md",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.full, true, path);
    assert.deepEqual(result.groups, [
      "productDocsRegression",
      "workItemRegression",
      "commitPrRegression",
      "finalizeRegression",
    ]);
  }
});

test("공유 구현과 여러 owner 변경은 영향 회귀군을 합집합으로 선택한다", () => {
  const sharedIds = classifyChangedPaths([
    ".agents/skills/update-product-docs/scripts/product-contract-ids.mjs",
  ]);
  assert.equal(sharedIds.full, false);
  assert.deepEqual(sharedIds.groups, [
    "productDocsRegression",
    "workItemRegression",
    "commitPrRegression",
    "finalizeRegression",
  ]);

  const sharedPr = classifyChangedPaths([
    ".agents/skills/open-pull-request/scripts/validate-pr-body.mjs",
  ]);
  assert.deepEqual(sharedPr.groups, [
    "commitPrRegression",
    "finalizeRegression",
  ]);

  const multipleOwners = classifyChangedPaths([
    ".agents/skills/run-github-work-item/scripts/bootstrap-mvp.test.mjs",
    ".agents/skills/commit-work-item/scripts/validate-commit-message.test.mjs",
  ]);
  assert.deepEqual(multipleOwners.groups, [
    "workItemRegression",
    "commitPrRegression",
  ]);
});

test("새 open-pull-request script는 좁은 owner 경계를 추측하지 않는다", () => {
  const result = classifyChangedPaths([
    ".agents/skills/open-pull-request/scripts/new-owner-helper.mjs",
  ]);
  assert.deepEqual(result.groups, [
    "commitPrRegression",
    "finalizeRegression",
  ]);
});

test("명시적 전체 실행과 schedule, workflow_dispatch는 모든 회귀군을 선택한다", () => {
  for (const result of [
    classifyEvent({ eventName: "schedule" }),
    classifyEvent({ eventName: "workflow_dispatch" }),
    classifyEvent({ eventName: "pull_request", forceFull: true }),
  ]) {
    assert.equal(result.full, true);
    assert.equal(result.groups.length, 4);
  }
});

test("push의 zero/missing base와 모호한 ref는 전체 회귀로 fail-closed한다", () => {
  let calls = 0;
  const gitRunner = () => {
    calls += 1;
    throw new Error("호출되면 안 됩니다.");
  };

  for (const input of [
    { eventName: "push", base: "0".repeat(40), head: HEAD },
    { eventName: "push", base: "", head: HEAD },
    { eventName: "pull_request", base: "--all", head: HEAD },
    { eventName: "pull_request", base: BASE, head: "HEAD" },
    { eventName: "", base: BASE, head: HEAD },
  ]) {
    const result = classifyEvent({ ...input, gitRunner });
    assert.equal(result.full, true);
    assert.equal(result.reason.includes("diff") || result.reason.includes("event"), true);
  }
  assert.equal(calls, 0);
});

test("Git diff 실패와 비정상 NUL 출력은 전체 회귀로 복구한다", () => {
  const failed = classifyEvent({
    eventName: "pull_request",
    base: BASE,
    head: HEAD,
    gitRunner: () => ({
      status: 128,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.from("missing object"),
    }),
  });
  assert.equal(failed.full, true);

  const unterminated = classifyEvent({
    eventName: "pull_request",
    base: BASE,
    head: HEAD,
    gitRunner: successfulGit("README.md"),
  });
  assert.equal(unterminated.full, true);
});

test("Git은 검증된 OID와 고정 argv로 호출하고 rename 양쪽 경로를 유지한다", () => {
  const calls = [];
  const paths = readChangedPaths({
    base: BASE.toUpperCase(),
    head: HEAD,
    cwd: "/tmp/example",
    gitRunner: successfulGit(
      ".agents/skills/run-github-work-item/scripts/old.mjs\0docs/new.mjs\0",
      calls,
    ),
  });

  assert.deepEqual(paths, [
    ".agents/skills/run-github-work-item/scripts/old.mjs",
    "docs/new.mjs",
  ]);
  assert.deepEqual(calls, [
    {
      arguments_: [
        "diff",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--no-renames",
        `${BASE}...${HEAD}`,
        "--",
      ],
      options: { cwd: "/tmp/example" },
    },
  ]);
});

test("PR은 merge-base three-dot, push는 exact before/after two-dot를 사용한다", () => {
  const pullRequestCalls = [];
  const pullRequest = classifyEvent({
    eventName: "pull_request",
    base: BASE,
    head: HEAD,
    gitRunner: successfulGit("README.md\0", pullRequestCalls),
  });
  falseGroups(pullRequest);
  assert.equal(
    pullRequestCalls[0].arguments_.includes(`${BASE}...${HEAD}`),
    true,
  );

  const pushCalls = [];
  const push = classifyEvent({
    eventName: "push",
    base: BASE,
    head: HEAD,
    gitRunner: successfulGit("README.md\0", pushCalls),
  });
  falseGroups(push);
  assert.equal(
    pushCalls[0].arguments_.includes(`${BASE}..${HEAD}`),
    true,
  );
  assert.equal(
    pushCalls[0].arguments_.includes(`${BASE}...${HEAD}`),
    false,
  );
});

test("허용되지 않은 diff operator는 Git 실행 전에 거부한다", () => {
  let called = false;
  assert.throws(
    () =>
      readChangedPaths({
        base: BASE,
        head: HEAD,
        operator: "--stat",
        gitRunner: () => {
          called = true;
        },
      }),
    /operator/,
  );
  assert.equal(called, false);
});

test("옵션처럼 보이는 ref는 Git 실행 전에 거부한다", () => {
  let called = false;
  assert.throws(
    () =>
      readChangedPaths({
        base: "--output=/tmp/injected",
        head: HEAD,
        gitRunner: () => {
          called = true;
        },
      }),
    /40자리/,
  );
  assert.equal(called, false);
});

test("NUL 경계는 줄바꿈과 output 문법처럼 보이는 파일명을 그대로 보존한다", () => {
  const paths = parseNulDelimitedPaths(
    Buffer.from(
      "docs/review\nfull=true.md\0--output=/tmp/not-an-option\0",
    ),
  );
  assert.deepEqual(paths, [
    "docs/review\nfull=true.md",
    "--output=/tmp/not-an-option",
  ]);

  const result = classifyChangedPaths(paths);
  falseGroups(result);

  const output = renderGitHubOutputs(result);
  assert.match(
    output,
    /^full=false\nproduct_docs=false\nwork_item=false\ncommit_pr=false\nfinalize=false\n/m,
  );
  assert.equal(output.includes("\nfull=true.md"), false);
  assert.match(output, /docs\/review\\nfull=true\.md/);
});

test("빈 중간 NUL, 비 UTF-8, traversal path는 fail-closed한다", () => {
  assert.throws(
    () => parseNulDelimitedPaths(Buffer.from("one\0\0")),
    /빈 경로/,
  );
  assert.throws(
    () => parseNulDelimitedPaths(Buffer.from([0xff, 0])),
    /UTF-8/,
  );

  for (const path of [
    "../AGENTS.md",
    "docs/../AGENTS.md",
    "/AGENTS.md",
    "docs\\AGENTS.md",
    "docs//AGENTS.md",
    "AGENTS.md\0ignored",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.full, true, path);
  }
});

test("CLI 인자는 Actions output 이름과 별개로 중복과 미지 인자를 거부한다", () => {
  assert.deepEqual(
    parseArguments([
      "--event",
      "pull_request",
      "--base",
      BASE,
      "--head",
      HEAD,
      "--output",
      "/tmp/github-output",
    ]),
    {
      full: false,
      eventName: "pull_request",
      base: BASE,
      head: HEAD,
      output: "/tmp/github-output",
    },
  );
  assert.throws(
    () => parseArguments(["--event", "push", "--event", "pull_request"]),
    /중복/,
  );
  assert.throws(() => parseArguments(["--unknown"]), /알 수 없는/);
});

test("Actions output은 underscore key와 JSON 진단 경로를 제공한다", () => {
  const output = renderGitHubOutputs(
    classifyChangedPaths([
      ".agents/skills/run-github-work-item/scripts/work-item.mjs",
    ]),
  );
  assert.equal(
    output,
    [
      "full=false",
      "product_docs=false",
      "work_item=true",
      "commit_pr=false",
      "finalize=false",
      "reason=path-scoped",
      'changed_paths_json=[".agents/skills/run-github-work-item/scripts/work-item.mjs"]',
      "",
    ].join("\n"),
  );
});

function aggregateFixture(overrides = {}) {
  return {
    full: "false",
    productDocs: "false",
    workItem: "true",
    commitPr: "false",
    finalize: "false",
    classifyResult: "success",
    harnessResult: "success",
    productDocsResult: "success",
    patchWhitespaceResult: "success",
    productDocsRegressionResult: "skipped",
    workItemRegressionResult: "success",
    commitPrRegressionResult: "skipped",
    finalizeRegressionResult: "skipped",
    ...overrides,
  };
}

test("aggregate는 always-on 성공과 선택된 회귀 성공을 결속한다", () => {
  assert.deepEqual(validateAggregateResults(aggregateFixture()), []);
  assert.deepEqual(
    validateAggregateResults(
      aggregateFixture({
        full: "true",
        productDocs: "true",
        commitPr: "true",
        finalize: "true",
        productDocsRegressionResult: "success",
        commitPrRegressionResult: "success",
        finalizeRegressionResult: "success",
      }),
    ),
    [],
  );
});

test("aggregate는 누락되거나 모호한 selection/result를 실패시킨다", () => {
  const errors = validateAggregateResults(
    aggregateFixture({
      full: undefined,
      productDocs: "TRUE",
      classifyResult: undefined,
      finalizeRegressionResult: "cancelled",
    }),
  );
  assert.match(errors.join("\n"), /full 선택값/);
  assert.match(errors.join("\n"), /product_docs 선택값/);
  assert.match(errors.join("\n"), /classify job 결과/);
  assert.match(errors.join("\n"), /finalize-regression job 결과/);
});

test("aggregate는 selection과 job 결과의 양방향 불일치를 실패시킨다", () => {
  const errors = validateAggregateResults(
    aggregateFixture({
      productDocsRegressionResult: "success",
      workItemRegressionResult: "skipped",
    }),
  );
  assert.match(errors.join("\n"), /선택되지 않았으므로/);
  assert.match(errors.join("\n"), /선택됐으므로/);
});

test("aggregate는 full=true일 때 네 회귀군 선택을 모두 강제한다", () => {
  const errors = validateAggregateResults(
    aggregateFixture({
      full: "true",
    }),
  );
  assert.equal(
    errors.filter((error) => error.startsWith("full=true이면")).length,
    3,
  );
});

test("aggregate env 이름은 workflow 계약과 정확히 대응한다", () => {
  assert.deepEqual(
    aggregateInputFromEnvironment({
      FULL_SELECTED: "false",
      PRODUCT_DOCS_SELECTED: "false",
      WORK_ITEM_SELECTED: "true",
      COMMIT_PR_SELECTED: "false",
      FINALIZE_SELECTED: "false",
      CLASSIFY_RESULT: "success",
      HARNESS_RESULT: "success",
      PRODUCT_DOCS_RESULT: "success",
      PATCH_WHITESPACE_RESULT: "success",
      PRODUCT_DOCS_REGRESSION_RESULT: "skipped",
      WORK_ITEM_REGRESSION_RESULT: "success",
      COMMIT_PR_REGRESSION_RESULT: "skipped",
      FINALIZE_REGRESSION_RESULT: "skipped",
    }),
    aggregateFixture(),
  );
});

test("--verify-results CLI는 정상 aggregate만 성공시킨다", () => {
  const validEnvironment = {
    ...process.env,
    FULL_SELECTED: "false",
    PRODUCT_DOCS_SELECTED: "false",
    WORK_ITEM_SELECTED: "true",
    COMMIT_PR_SELECTED: "false",
    FINALIZE_SELECTED: "false",
    CLASSIFY_RESULT: "success",
    HARNESS_RESULT: "success",
    PRODUCT_DOCS_RESULT: "success",
    PATCH_WHITESPACE_RESULT: "success",
    PRODUCT_DOCS_REGRESSION_RESULT: "skipped",
    WORK_ITEM_REGRESSION_RESULT: "success",
    COMMIT_PR_REGRESSION_RESULT: "skipped",
    FINALIZE_REGRESSION_RESULT: "skipped",
  };
  const valid = spawnSync(
    process.execPath,
    [SCRIPT, "--verify-results"],
    {
      encoding: "utf8",
      env: validEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /일치합니다/);

  const invalid = spawnSync(
    process.execPath,
    [SCRIPT, "--verify-results"],
    {
      encoding: "utf8",
      env: {
        ...validEnvironment,
        WORK_ITEM_REGRESSION_RESULT: "skipped",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /선택됐으므로/);
});

test("--verify-results는 경로 분류 인자와 혼합할 수 없다", () => {
  assert.throws(
    () => parseArguments(["--verify-results", "--event", "push"]),
    /함께 사용할 수 없습니다/,
  );
});
