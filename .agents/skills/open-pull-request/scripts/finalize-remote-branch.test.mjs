import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteBranchPlanToken,
  executeFinalizeRemoteBranch,
  inspectCanonicalOrigin,
  parseArguments,
  parseCanonicalGitHubRemoteUrl,
  parseRemoteBranchListing,
  remoteUrlFingerprint,
} from "./finalize-remote-branch.mjs";

const repository = "GoCalendar/LunchTime";
const normalizedRepository = "gocalendar/lunchtime";
const branch = "work/issue-51-finalize-integrity";
const head = "1234567890abcdef1234567890abcdef12345678";
const otherHead = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const fetchUrl = "https://github.com/GoCalendar/LunchTime.git";
const pushUrl = "git@github.com:GoCalendar/LunchTime.git";

function listing(oid = head, ref = `refs/heads/${branch}`) {
  return `${oid}\t${ref}\n`;
}

function fakeGit({
  fetchUrls = [fetchUrl],
  pushUrls = [pushUrl],
  listings = [listing()],
  pushStatus = 0,
  pushStderr = "",
  lsStatus = 0,
  lsStderr = "",
} = {}) {
  const calls = [];
  let listingIndex = 0;
  const git = (arguments_) => {
    calls.push([...arguments_]);
    if (
      arguments_.join("\0") ===
      ["remote", "get-url", "--all", "origin"].join("\0")
    ) {
      return {
        status: 0,
        stdout: `${fetchUrls.join("\n")}\n`,
        stderr: "",
      };
    }
    if (
      arguments_.join("\0") ===
      ["remote", "get-url", "--push", "--all", "origin"].join("\0")
    ) {
      return {
        status: 0,
        stdout: `${pushUrls.join("\n")}\n`,
        stderr: "",
      };
    }
    if (arguments_[0] === "ls-remote") {
      const stdout =
        listings[Math.min(listingIndex, listings.length - 1)] ?? "";
      listingIndex += 1;
      return { status: lsStatus, stdout, stderr: lsStderr };
    }
    if (arguments_[0] === "push") {
      return { status: pushStatus, stdout: "", stderr: pushStderr };
    }
    throw new Error("unexpected git invocation");
  };
  return { git, calls };
}

function inspect(mock, overrides = {}) {
  return executeFinalizeRemoteBranch(
    {
      repo: repository,
      branch,
      head,
      dryRun: true,
      ...overrides,
    },
    { git: mock.git },
  );
}

function mutation(mock, planToken, overrides = {}) {
  return executeFinalizeRemoteBranch(
    {
      repo: repository,
      branch,
      head,
      confirmPlan: planToken,
      ...overrides,
    },
    { git: mock.git },
  );
}

function callsOf(mock, command) {
  return mock.calls.filter((arguments_) => arguments_[0] === command);
}

test("credential 없는 canonical GitHub HTTPS와 SSH URL만 허용한다", () => {
  for (const value of [
    "https://github.com/GoCalendar/LunchTime.git",
    "https://github.com/GoCalendar/LunchTime",
    "ssh://git@github.com/GoCalendar/LunchTime.git",
    "ssh://git@github.com:22/GoCalendar/LunchTime.git",
    "git@github.com:GoCalendar/LunchTime.git",
  ]) {
    assert.equal(parseCanonicalGitHubRemoteUrl(value), normalizedRepository);
    assert.match(remoteUrlFingerprint(value), /^[0-9a-f]{64}$/);
  }

  for (const value of [
    " https://github.com/GoCalendar/LunchTime.git",
    "http://github.com/GoCalendar/LunchTime.git",
    "https://token@github.com/GoCalendar/LunchTime.git",
    "https://user:token@github.com/GoCalendar/LunchTime.git",
    "https://github.com:8443/GoCalendar/LunchTime.git",
    "ssh://other@github.com/GoCalendar/LunchTime.git",
    "ssh://git@github.com:2222/GoCalendar/LunchTime.git",
    "git@github-work:GoCalendar/LunchTime.git",
    "file:///tmp/LunchTime.git",
    "../LunchTime.git",
    "https://github.com/GoCalendar/LunchTime.git?token=secret",
    "https://github.com/GoCalendar/LunchTime.git/",
    "https://github.com/GoCalendar/LunchTime/extra.git",
  ]) {
    assert.throws(
      () => parseCanonicalGitHubRemoteUrl(value),
      (error) =>
        /canonical GitHub URL/.test(error.message) &&
        !error.message.includes(value),
      value,
    );
  }
});

test("CLI는 필수 identity와 dry-run 또는 confirm token 하나만 허용한다", () => {
  assert.deepEqual(
    parseArguments(["--repo", repository, "--inspect-origin"]),
    { inspectOrigin: true, repo: repository },
  );
  assert.deepEqual(
    parseArguments([
      "--repo",
      repository,
      "--branch",
      branch,
      "--head",
      head,
      "--dry-run",
    ]),
    { dryRun: true, repo: repository, branch, head },
  );
  assert.throws(
    () =>
      parseArguments([
        "--repo",
        repository,
        "--branch",
        branch,
        "--head",
        head,
      ]),
    /정확히 하나/,
  );
  assert.throws(
    () =>
      parseArguments([
        "--repo",
        repository,
        "--branch",
        branch,
        "--head",
        head,
        "--dry-run",
        "--confirm-plan",
        "a".repeat(64),
      ]),
    /정확히 하나/,
  );
  assert.throws(
    () =>
      parseArguments([
        "--repo",
        repository,
        "--inspect-origin",
        "--branch",
        branch,
      ]),
    /--repo OWNER\/REPO.*함께 지정/,
  );
});

test("origin 사전 점검은 raw URL 없이 same-repository fingerprint만 출력한다", () => {
  const mock = fakeGit();
  assert.deepEqual(inspectCanonicalOrigin({ repo: repository }, mock), {
    command: "inspect-origin",
    verified: true,
    repository: normalizedRepository,
    remote: "origin",
    fetchFingerprint: remoteUrlFingerprint(fetchUrl),
    pushFingerprint: remoteUrlFingerprint(pushUrl),
  });
  assert.equal(callsOf(mock, "ls-remote").length, 0);
  assert.equal(callsOf(mock, "push").length, 0);

  const wrong = fakeGit({
    pushUrls: ["git@github.com:Other/LunchTime.git"],
  });
  assert.throws(
    () => inspectCanonicalOrigin({ repo: repository }, wrong),
    (error) =>
      /same-repository 작업 저장소/.test(error.message) &&
      !error.message.includes("git@github.com"),
  );
});

test("계획 token은 exact origin URL fingerprint·repo·branch·head에 귀속한다", () => {
  const common = {
    repository,
    branch,
    head,
    fetchFingerprint: remoteUrlFingerprint(fetchUrl),
    pushFingerprint: remoteUrlFingerprint(pushUrl),
  };
  const token = createRemoteBranchPlanToken(common);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.notEqual(
    token,
    createRemoteBranchPlanToken({
      ...common,
      pushFingerprint: remoteUrlFingerprint(
        "ssh://git@github.com/GoCalendar/LunchTime.git",
      ),
    }),
  );
  assert.notEqual(
    token,
    createRemoteBranchPlanToken({ ...common, head: otherHead }),
  );
});

test("exact ref listing만 해석하고 absent·wrong·multiple 상태를 구분한다", () => {
  assert.deepEqual(parseRemoteBranchListing("", branch), {
    alreadyAbsent: true,
    oid: null,
  });
  assert.deepEqual(parseRemoteBranchListing(listing(), branch), {
    alreadyAbsent: false,
    oid: head,
  });
  assert.throws(
    () =>
      parseRemoteBranchListing(
        listing(head, "refs/heads/work/issue-51-other"),
        branch,
      ),
    /exact ref/,
  );
  assert.throws(
    () => parseRemoteBranchListing(`${listing()}${listing()}`, branch),
    /정확히 0개 또는 1개/,
  );
});

test("origin fetch 또는 push가 다른 저장소면 remote 조회와 삭제를 하지 않는다", () => {
  for (const overrides of [
    {
      fetchUrls: ["https://github.com/Other/LunchTime.git"],
      pushUrls: [pushUrl],
    },
    {
      fetchUrls: [fetchUrl],
      pushUrls: ["git@github.com:Other/LunchTime.git"],
    },
  ]) {
    const mock = fakeGit(overrides);
    assert.throws(() => inspect(mock), /same-repository PR source/);
    assert.equal(callsOf(mock, "ls-remote").length, 0);
    assert.equal(callsOf(mock, "push").length, 0);
  }
});

test("fetch와 별도인 same-repository push URL을 캡처해 inspection에 사용한다", () => {
  const mock = fakeGit();
  const result = inspect(mock);
  assert.equal(result.repository, normalizedRepository);
  assert.equal(result.alreadyAbsent, false);
  assert.match(result.planToken, /^[0-9a-f]{64}$/);
  const [remoteRead] = callsOf(mock, "ls-remote");
  assert.equal(remoteRead[2], pushUrl);
  assert.notEqual(remoteRead[2], fetchUrl);
  assert.equal(callsOf(mock, "push").length, 0);
});

test("origin fetch 또는 push URL이 여러 개면 remote 조회와 삭제를 하지 않는다", () => {
  for (const overrides of [
    { fetchUrls: [fetchUrl, "ssh://git@github.com/GoCalendar/LunchTime.git"] },
    { pushUrls: [pushUrl, "ssh://git@github.com/GoCalendar/LunchTime.git"] },
  ]) {
    const mock = fakeGit(overrides);
    assert.throws(() => inspect(mock), /정확히 하나/);
    assert.equal(callsOf(mock, "ls-remote").length, 0);
    assert.equal(callsOf(mock, "push").length, 0);
  }
});

test("exact plan과 head에서 캡처한 push URL로 lease 삭제를 한 번만 실행한다", () => {
  const planMock = fakeGit();
  const plan = inspect(planMock);
  const applyMock = fakeGit({ listings: [listing(), ""] });
  const result = mutation(applyMock, plan.planToken);
  assert.equal(result.verified, true);
  assert.equal(result.alreadyAbsent, false);
  const pushes = callsOf(applyMock, "push");
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0], [
    "push",
    `--force-with-lease=refs/heads/${branch}:${head}`,
    pushUrl,
    `:refs/heads/${branch}`,
  ]);
  assert.equal(callsOf(applyMock, "ls-remote").length, 2);
});

test("mutation은 origin 설정을 다시 읽고 변경된 URL fingerprint를 거부한다", () => {
  const plan = inspect(fakeGit());
  const changed = fakeGit({
    pushUrls: ["ssh://git@github.com/GoCalendar/LunchTime.git"],
  });
  assert.throws(() => mutation(changed, plan.planToken), /계획 token/);
  assert.equal(callsOf(changed, "ls-remote").length, 0);
  assert.equal(callsOf(changed, "push").length, 0);
});

test("계획 뒤 branch가 이미 사라졌으면 mutation에서 push하지 않는다", () => {
  const plan = inspect(fakeGit());
  const absent = fakeGit({ listings: [""] });
  const result = mutation(absent, plan.planToken);
  assert.equal(result.alreadyAbsent, true);
  assert.equal(callsOf(absent, "push").length, 0);

  const dryAbsent = fakeGit({ listings: [""] });
  const dryResult = inspect(dryAbsent);
  assert.equal(dryResult.alreadyAbsent, true);
  assert.equal("planToken" in dryResult, false);
  assert.equal(callsOf(dryAbsent, "push").length, 0);
});

test("원격 OID가 이동했거나 listing이 모호하면 push하지 않는다", () => {
  const plan = inspect(fakeGit());
  for (const remoteListing of [
    listing(otherHead),
    `${listing()}${listing()}`,
    listing(head, "refs/heads/work/issue-51-other"),
  ]) {
    const changed = fakeGit({ listings: [remoteListing] });
    assert.throws(() => mutation(changed, plan.planToken));
    assert.equal(callsOf(changed, "push").length, 0);
  }
});

test("삭제 뒤 ref가 남으면 실패하고 push를 반복하지 않는다", () => {
  const plan = inspect(fakeGit());
  const remains = fakeGit({ listings: [listing(), listing()] });
  assert.throws(
    () => mutation(remains, plan.planToken),
    /삭제 뒤 exact ref 부재/,
  );
  assert.equal(callsOf(remains, "push").length, 1);
  assert.equal(callsOf(remains, "ls-remote").length, 2);
});

test("remote URL과 Git stderr의 credential은 오류에 노출하지 않는다", () => {
  const credential = "fixture-secret";
  const invalid = fakeGit({
    fetchUrls: [
      `https://${credential}@github.com/GoCalendar/LunchTime.git`,
    ],
  });
  assert.throws(
    () => inspect(invalid),
    (error) => !error.message.includes(credential),
  );

  const failedRead = fakeGit({
    lsStatus: 1,
    lsStderr: `fatal: https://${credential}@github.com/private/repo.git`,
  });
  assert.throws(
    () => inspect(failedRead),
    (error) =>
      /안전하게 읽지 못했습니다/.test(error.message) &&
      !error.message.includes(credential),
  );

  const plan = inspect(fakeGit());
  const failedPush = fakeGit({
    listings: [listing()],
    pushStatus: 1,
    pushStderr: `fatal: https://${credential}@github.com/private/repo.git`,
  });
  assert.throws(
    () => mutation(failedPush, plan.planToken),
    (error) =>
      /lease 삭제가 실패/.test(error.message) &&
      !error.message.includes(credential),
  );
  assert.equal(callsOf(failedPush, "push").length, 1);
});
