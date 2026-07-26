import assert from "node:assert/strict";
import test from "node:test";

import {
  createFinalizeMergePlanToken,
  executeFinalizeMerge,
  normalizeFinalizeMergeSnapshot,
  parseArguments,
} from "./finalize-merge.mjs";

const repository = "gocalendar/lunchtime";
const base = "a".repeat(40);
const head = "b".repeat(40);
const tree = "c".repeat(40);
const branch = "work/issue-51-finalize-integrity";
const updatedAt = "2026-07-25T08:30:00Z";

function snapshot(title = "chore: #51 - finalize 병합을 안전하게 실행한다") {
  return {
    verified: true,
    repository,
    issue: 51,
    pr: 52,
    base,
    head,
    headTree: tree,
    branch,
    title,
    updatedAt,
    sourceRepository: repository,
    remote: "origin",
  };
}

function livePullRequest(title = snapshot().title, overrides = {}) {
  return {
    number: 52,
    updatedAt,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    baseRefOid: base,
    headRefName: branch,
    headRefOid: head,
    headRepository: {
      name: "LunchTime",
      nameWithOwner: "GoCalendar/LunchTime",
    },
    headRepositoryOwner: { login: "GoCalendar" },
    isCrossRepository: false,
    title,
    ...overrides,
  };
}

function fakeGh(current, { mergeStatus = 0 } = {}) {
  const calls = [];
  const gh = (arguments_) => {
    calls.push([...arguments_]);
    if (arguments_[0] === "pr" && arguments_[1] === "view") {
      return {
        status: 0,
        stdout: JSON.stringify(current),
        stderr: "",
      };
    }
    if (arguments_[0] === "pr" && arguments_[1] === "merge") {
      return {
        status: mergeStatus,
        stdout: mergeStatus === 0 ? "merged\n" : "",
        stderr: mergeStatus === 0 ? "" : "untrusted failure detail",
      };
    }
    throw new Error("unexpected gh invocation");
  };
  return { gh, calls };
}

test("CLI는 validator snapshot과 dry-run 또는 confirm token 하나만 허용한다", () => {
  assert.deepEqual(
    parseArguments(["--snapshot", "/tmp/finalize.json", "--dry-run"]),
    { snapshot: "/tmp/finalize.json", dryRun: true },
  );
  assert.deepEqual(
    parseArguments([
      "--snapshot",
      "/tmp/finalize.json",
      "--confirm-plan",
      "d".repeat(64),
    ]),
    {
      snapshot: "/tmp/finalize.json",
      confirmPlan: "d".repeat(64),
    },
  );
  assert.throws(
    () => parseArguments(["--snapshot", "/tmp/finalize.json"]),
    /사용법/,
  );
  assert.throws(
    () =>
      parseArguments([
        "--snapshot",
        "/tmp/finalize.json",
        "--dry-run",
        "--confirm-plan",
        "d".repeat(64),
      ]),
    /사용법/,
  );
});

test("dry-run은 same-repository PR identity를 재조회하고 mutation하지 않는다", () => {
  const expected = snapshot();
  const mock = fakeGh(livePullRequest());
  const result = executeFinalizeMerge(expected, { dryRun: true }, mock);
  assert.equal(result.status, "planned");
  assert.equal(result.planToken, createFinalizeMergePlanToken(expected));
  assert.match(result.titleFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(mock.calls.map((call) => call.slice(0, 2)), [["pr", "view"]]);
  assert.equal(mock.calls[0].includes("-R"), true);
  assert.equal(mock.calls[0].includes(repository), true);
});

test("shell 문법이 있는 제목도 argv 한 항목의 데이터로만 병합한다", () => {
  for (const title of [
    'chore: #51 - x"; touch /tmp/pwn; echo "',
    "chore: #51 - $(touch /tmp/pwn)",
    "chore: #51 - `touch /tmp/pwn`",
  ]) {
    const expected = snapshot(title);
    const dryRunMock = fakeGh(livePullRequest(title));
    const plan = executeFinalizeMerge(
      expected,
      { dryRun: true },
      dryRunMock,
    );
    const mutationMock = fakeGh(livePullRequest(title));
    const result = executeFinalizeMerge(
      expected,
      { confirmPlan: plan.planToken },
      mutationMock,
    );
    assert.equal(result.status, "merge-command-finished");
    const mergeCalls = mutationMock.calls.filter(
      (call) => call[0] === "pr" && call[1] === "merge",
    );
    assert.equal(mergeCalls.length, 1);
    const subjectIndex = mergeCalls[0].indexOf("--subject");
    assert.equal(mergeCalls[0][subjectIndex + 1], title);
    assert.equal(mergeCalls[0].length, 10);
  }
});

test("validator 이후 바뀐 PR identity는 merge 전에 거부한다", () => {
  for (const overrides of [
    { updatedAt: "2026-07-25T08:31:00Z" },
    { headRefOid: "d".repeat(40) },
    { title: "chore: #51 - changed" },
    { isDraft: true },
    {
      headRepository: {
        name: "LunchTime",
        nameWithOwner: "Other/LunchTime",
      },
      isCrossRepository: true,
    },
  ]) {
    const mock = fakeGh(livePullRequest(snapshot().title, overrides));
    assert.throws(
      () => executeFinalizeMerge(snapshot(), { dryRun: true }, mock),
      /변경되었거나 불완전/,
    );
    assert.equal(
      mock.calls.some((call) => call[0] === "pr" && call[1] === "merge"),
      false,
    );
  }
});

test("snapshot 또는 plan token 변경은 mutation 전에 fail-closed한다", () => {
  assert.throws(
    () => normalizeFinalizeMergeSnapshot({ ...snapshot(), recovery: true }),
    /OPEN finalize/,
  );
  const mock = fakeGh(livePullRequest());
  assert.throws(
    () =>
      executeFinalizeMerge(
        snapshot(),
        { confirmPlan: "e".repeat(64) },
        mock,
      ),
    /계획 token/,
  );
  assert.equal(
    mock.calls.some((call) => call[0] === "pr" && call[1] === "merge"),
    false,
  );
});

test("merge 응답이 실패하면 상세를 노출하거나 mutation을 반복하지 않는다", () => {
  const expected = snapshot();
  const planMock = fakeGh(livePullRequest());
  const plan = executeFinalizeMerge(expected, { dryRun: true }, planMock);
  const mutationMock = fakeGh(livePullRequest(), { mergeStatus: 1 });
  assert.throws(
    () =>
      executeFinalizeMerge(
        expected,
        { confirmPlan: plan.planToken },
        mutationMock,
      ),
    (error) =>
      error.uncertainMutation === true &&
      /반복하지 말고 PR을 재조회/.test(error.message) &&
      !error.message.includes("untrusted failure detail"),
  );
  assert.equal(
    mutationMock.calls.filter(
      (call) => call[0] === "pr" && call[1] === "merge",
    ).length,
    1,
  );
});
