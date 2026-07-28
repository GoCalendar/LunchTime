import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  aggregateInputFromEnvironment,
  classifyChangedPaths,
  classifyEvent,
  parseArguments,
  parseNulDelimitedPaths,
  readChangedPaths,
  renderGitHubOutputs,
  validateAggregateResults,
} from "./validate-app-paths.mjs";

const BASE = "1".repeat(40);
const HEAD = "2".repeat(40);
const SCRIPT = fileURLToPath(
  new URL("./validate-app-paths.mjs", import.meta.url),
);

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

test("앱 소스, 테스트와 Xcode project는 앱 검증을 선택한다", () => {
  for (const path of [
    "LunchTime/App/LunchTimeApp.swift",
    "LunchTimeTests/LunchTimeTests.swift",
    "LunchTimeUITests/LunchTimeUITests.swift",
    "LunchTime.xcodeproj/project.pbxproj",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.app, true, path);
    assert.equal(result.full, false, path);
    assert.equal(result.reason, "app-path", path);
  }
});

test("앱 CI workflow와 classifier 계약 변경은 전체 앱 검증을 선택한다", () => {
  for (const path of [
    ".github/workflows/app-ci.yml",
    ".github/workflows/validate-app-paths.mjs",
    ".github/workflows/validate-app-paths.test.mjs",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.app, true, path);
    assert.equal(result.full, true, path);
    assert.equal(result.reason, "app-ci-contract", path);
  }
});

test("문서, 하네스, 작업 도구와 독립 실험은 앱 검증을 생략한다", () => {
  const paths = [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    ".gitignore",
    "docs/meetings/2026-07-29-harness.md",
    ".agents/skills/open-pull-request/SKILL.md",
    ".claude/skills",
    "Experiments/SP01PeerDiscovery/Package.swift",
    ".github/ISSUE_TEMPLATE/work-item.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/mvp-work-items.json",
    ".github/work-management.json",
    ".github/workflows/validate-harness-paths.mjs",
    ".github/workflows/validate-harness-paths.test.mjs",
    ".github/workflows/validate-harness.yml",
    ".github/workflows/validate-pr-metadata.yml",
  ];
  const result = classifyChangedPaths(paths);
  assert.equal(result.app, false);
  assert.equal(result.full, false);
  assert.equal(result.reason, "known-non-app-path");
  assert.deepEqual(result.changedPaths, paths);
});

test("알 수 없는 경로는 앱 검증을 전체 실행하도록 fail-closed한다", () => {
  for (const path of [
    "Package.swift",
    "Config/App.entitlements",
    ".github/workflows/new-workflow.yml",
    ".swiftlint.yml",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.app, true, path);
    assert.equal(result.full, true, path);
    assert.equal(result.reason, "unclassified-path", path);
  }
});

test("빈 diff는 앱 검증을 전체 실행하도록 fail-closed한다", () => {
  const result = classifyChangedPaths([]);
  assert.equal(result.app, true);
  assert.equal(result.full, true);
  assert.equal(result.reason, "empty-diff");
});

test("앱과 비앱 경로가 섞이면 앱 검증을 선택한다", () => {
  const result = classifyChangedPaths([
    "docs/development/01_harness_guide.md",
    "LunchTime/App/LunchTimeApp.swift",
  ]);
  assert.equal(result.app, true);
  assert.equal(result.full, false);
});

test("schedule, workflow_dispatch와 명시적 full은 앱 검증을 전체 실행한다", () => {
  for (const result of [
    classifyEvent({ eventName: "schedule" }),
    classifyEvent({ eventName: "workflow_dispatch" }),
    classifyEvent({ eventName: "pull_request", forceFull: true }),
  ]) {
    assert.equal(result.app, true);
    assert.equal(result.full, true);
  }
});

test("zero 또는 모호한 ref와 지원하지 않는 이벤트는 Git 실행 없이 전체 실행한다", () => {
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
    assert.equal(result.app, true);
    assert.equal(result.full, true);
  }
  assert.equal(calls, 0);
});

test("Git diff 실패와 비정상 NUL 출력은 전체 실행으로 복구한다", () => {
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
  assert.equal(failed.app, true);
  assert.equal(failed.full, true);

  const unterminated = classifyEvent({
    eventName: "pull_request",
    base: BASE,
    head: HEAD,
    gitRunner: successfulGit("README.md"),
  });
  assert.equal(unterminated.app, true);
  assert.equal(unterminated.full, true);
});

test("PR은 three-dot, push는 two-dot을 사용하고 rename 양쪽 경로를 유지한다", () => {
  const pullRequestCalls = [];
  const pullRequest = classifyEvent({
    eventName: "pull_request",
    base: BASE,
    head: HEAD,
    cwd: "/tmp/example",
    gitRunner: successfulGit(
      "LunchTime/Old.swift\0docs/New.swift\0",
      pullRequestCalls,
    ),
  });
  assert.equal(pullRequest.app, true);
  assert.deepEqual(pullRequest.changedPaths, [
    "LunchTime/Old.swift",
    "docs/New.swift",
  ]);
  assert.deepEqual(pullRequestCalls, [
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

  const pushCalls = [];
  const push = classifyEvent({
    eventName: "push",
    base: BASE,
    head: HEAD,
    gitRunner: successfulGit("README.md\0", pushCalls),
  });
  assert.equal(push.app, false);
  assert.equal(
    pushCalls[0].arguments_.includes(`${BASE}..${HEAD}`),
    true,
  );
  assert.equal(
    pushCalls[0].arguments_.includes(`${BASE}...${HEAD}`),
    false,
  );
});

test("diff operator와 ref는 고정된 안전한 값만 허용한다", () => {
  let called = false;
  for (const input of [
    { base: BASE, head: HEAD, operator: "--stat" },
    { base: "--output=/tmp/injected", head: HEAD },
    { base: BASE, head: "0".repeat(40) },
  ]) {
    assert.throws(
      () =>
        readChangedPaths({
          ...input,
          gitRunner: () => {
            called = true;
          },
        }),
      /operator|40자리/,
    );
  }
  assert.equal(called, false);
});

test("NUL parser는 파일명 경계를 보존하고 비정상 입력을 거부한다", () => {
  assert.deepEqual(
    parseNulDelimitedPaths(
      Buffer.from("docs/review\napp=true.md\0LunchTime/A.swift\0"),
    ),
    ["docs/review\napp=true.md", "LunchTime/A.swift"],
  );
  assert.throws(
    () => parseNulDelimitedPaths(Buffer.from("one\0\0")),
    /빈 경로/,
  );
  assert.throws(
    () => parseNulDelimitedPaths(Buffer.from([0xff, 0])),
    /UTF-8/,
  );
  assert.throws(
    () => parseNulDelimitedPaths(Buffer.from("unterminated")),
    /NUL/,
  );
});

test("비정규 저장소 경로는 전체 실행으로 fail-closed한다", () => {
  for (const path of [
    "../LunchTime/A.swift",
    "docs/../LunchTime/A.swift",
    "/LunchTime/A.swift",
    "LunchTime\\A.swift",
    "LunchTime//A.swift",
    "LunchTime/A.swift\0ignored",
  ]) {
    const result = classifyChangedPaths([path]);
    assert.equal(result.app, true, path);
    assert.equal(result.full, true, path);
  }
});

test("Actions output은 고정 key와 안전한 JSON 진단 경로를 제공한다", () => {
  const output = renderGitHubOutputs(
    classifyChangedPaths([
      "docs/review\napp=true.md",
      "LunchTime/A.swift",
    ]),
  );
  assert.match(output, /^app=true\nfull=false\nreason=app-path\n/m);
  assert.equal(output.includes("\napp=true.md"), false);
  assert.match(output, /docs\/review\\napp=true\.md/);
});

function aggregateFixture(overrides = {}) {
  return {
    app: "true",
    full: "false",
    classifyResult: "success",
    appBuildResult: "success",
    ...overrides,
  };
}

test("aggregate는 앱 선택과 macOS job 결과를 양방향 결속한다", () => {
  assert.deepEqual(validateAggregateResults(aggregateFixture()), []);
  assert.deepEqual(
    validateAggregateResults(
      aggregateFixture({
        app: "false",
        appBuildResult: "skipped",
      }),
    ),
    [],
  );
  assert.deepEqual(
    validateAggregateResults(
      aggregateFixture({
        app: "true",
        full: "true",
      }),
    ),
    [],
  );
});

test("aggregate는 누락, 실패, cancelled와 선택 불일치를 거부한다", () => {
  for (const [overrides, pattern] of [
    [{ app: undefined }, /app 선택값/],
    [{ full: "TRUE" }, /full 선택값/],
    [{ classifyResult: "failure" }, /classify job 결과/],
    [{ appBuildResult: "cancelled" }, /app-build job 결과/],
    [{ app: "true", appBuildResult: "skipped" }, /선택됐으므로/],
    [{ app: "false", appBuildResult: "success" }, /선택되지 않았으므로/],
    [{ app: "false", full: "true", appBuildResult: "skipped" }, /full=true/],
  ]) {
    assert.match(
      validateAggregateResults(aggregateFixture(overrides)).join("\n"),
      pattern,
    );
  }
});

test("aggregate env 이름은 workflow 계약과 정확히 대응한다", () => {
  assert.deepEqual(
    aggregateInputFromEnvironment({
      APP_SELECTED: "false",
      FULL_SELECTED: "false",
      CLASSIFY_RESULT: "success",
      APP_BUILD_RESULT: "skipped",
    }),
    aggregateFixture({
      app: "false",
      appBuildResult: "skipped",
    }),
  );
});

test("CLI 인자는 중복과 미지 인자를 거부하고 verify mode를 분리한다", () => {
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
  assert.throws(
    () => parseArguments(["--verify-results", "--event", "push"]),
    /함께 사용할 수 없습니다/,
  );
});

test("--verify-results CLI는 정상 aggregate만 성공시킨다", () => {
  const environment = {
    ...process.env,
    APP_SELECTED: "false",
    FULL_SELECTED: "false",
    CLASSIFY_RESULT: "success",
    APP_BUILD_RESULT: "skipped",
  };
  const valid = spawnSync(
    process.execPath,
    [SCRIPT, "--verify-results"],
    {
      encoding: "utf8",
      env: environment,
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
        ...environment,
        APP_BUILD_RESULT: "success",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /선택되지 않았으므로/);
});
