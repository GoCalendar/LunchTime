import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  parseGitHubRepositoryFromRemoteUrl,
  parseArguments,
  readFinalizeGitProof,
  validateFinalizeSnapshot,
} from "./validate-finalize.mjs";

const head = "1234567890abcdef1234567890abcdef12345678";
const base = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const tree = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const merge = "cccccccccccccccccccccccccccccccccccccccc";
const repository = "GoCalendar/LunchTime";

function body({ review = "reviewed" } = {}) {
  const reviewRow =
    review === "skipped"
      ? "| 독립 리뷰 | 변경 위험을 판단해 생략 | 생략 | low-risk=제품 동작이 없는 문서 오탈자만 수정 |"
      : "| 독립 리뷰 | 원본 이슈·diff·관련 테스트를 한 번 검토 | 통과 | round=1; reviewers=1; findings=1; main-closure=1/1; scope-expansion=none |";
  return `<!-- lunchtime-pr:v2 -->

## 연결된 이슈

<!-- pr:issues:start -->
Closes #49
<!-- pr:issues:end -->

## 변경 요약

<!-- pr:summary:start -->
- 문제·목표: 현재 head가 아닌 검증 증거로 병합될 수 있어 finalize 시점의 상태를 고정합니다.
- 결과:
  - exact-head 병합 전 CI와 review 상태를 함께 검증합니다.
- 결정·트레이드오프: 자동 병합 대신 현재 상태를 한 번 검증하고 쓰기를 한 번만 실행합니다.
- 위험·복구: 응답이 불명확하면 재조회하며 같은 병합 명령을 반복하지 않습니다.
- 리뷰 시작점: \`.agents/skills/open-pull-request/SKILL.md\` — finalize 순서
- 제외·후속 작업: 해당 없음 — finalize 계약과 validator를 함께 제공합니다.
<!-- pr:summary:end -->

## 추적성

<!-- pr:traceability:start -->
| 구분 | ID 또는 근거 |
| --- | --- |
| 요구사항 | 해당 없음 — 개발 하네스의 실행 계약 변경입니다. |
| 수용 기준 | 해당 없음 — 이슈 완료 조건과 결정적 fixture로 검증합니다. |
| 정책 규칙 | 해당 없음 — 제품 동작을 바꾸지 않습니다. |
| 기술 스파이크 | 해당 없음 — GitHub CLI의 지원 인자를 확인했습니다. |
<!-- pr:traceability:end -->

## 검증

<!-- pr:verification:start -->
| 대상 | 명령·확인 | 결과 | 증거 |
| --- | --- | --- | --- |
${reviewRow}
| finalize fixture | \`node --test validate-finalize.test.mjs\` | 통과 | happy·error·recovery fixture 통과 |
<!-- pr:verification:end -->

## 문서 영향

<!-- pr:docs-impact:start -->
- 판정: 변경 없음
- 대상 파일·ID: 제품 PRD·Policy 변경 없음
- 근거: 개발 하네스의 GitHub 수명주기만 명확히 합니다.
<!-- pr:docs-impact:end -->
`;
}

function snapshot(overrides = {}) {
  return {
    pr: {
      number: 49,
      id: "PR_fixture_49",
      url: "https://github.com/GoCalendar/LunchTime/pull/49",
      updatedAt: "2026-07-25T01:00:00Z",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      baseRefOid: base,
      headRefName: "work/issue-49-harness-lifecycle",
      headRefOid: head,
      headRepository: {
        name: "LunchTime",
        nameWithOwner: repository,
      },
      headRepositoryOwner: { login: "GoCalendar" },
      isCrossRepository: false,
      title: "docs: #49 - 하네스 finalize 계약을 추가한다",
      body: body(),
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      statusCheckRollup: [
        {
          __typename: "CheckRun",
          name: "validate",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          detailsUrl:
            "https://github.com/GoCalendar/LunchTime/actions/runs/1",
        },
      ],
      closingIssuesReferences: [
        {
          number: 49,
          repository: { nameWithOwner: repository },
          url: "https://github.com/GoCalendar/LunchTime/issues/49",
        },
      ],
    },
    checks: [
      {
        name: "validate",
        state: "SUCCESS",
        bucket: "pass",
        link: "https://github.com/GoCalendar/LunchTime/actions/runs/1",
      },
    ],
    threads: {
      data: {
        repository: {
          nameWithOwner: repository,
          pullRequest: {
            id: "PR_fixture_49",
            number: 49,
            url: "https://github.com/GoCalendar/LunchTime/pull/49",
            updatedAt: "2026-07-25T01:00:00Z",
            baseRefName: "main",
            baseRefOid: base,
            headRefName: "work/issue-49-harness-lifecycle",
            headRefOid: head,
            headRepository: { nameWithOwner: repository },
            isCrossRepository: false,
            reviewThreads: {
              totalCount: 2,
              nodes: [
                { id: "PRRT_fixture_1", isResolved: true },
                { id: "PRRT_fixture_2", isResolved: true },
              ],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: "cursor-1",
                endCursor: "cursor-2",
              },
            },
          },
        },
      },
    },
    issueNumber: 49,
    pullRequestNumber: 49,
    repository,
    gitProof: {
      base,
      head,
      headTree: tree,
      main: base,
      baseIsAncestorOfHead: true,
      originFetchRepository: repository,
      originFetchUrlCount: 1,
      originPushRepository: repository,
      originPushUrlCount: 1,
    },
    ...overrides,
  };
}

function validate(overrides = {}) {
  return validateFinalizeSnapshot(snapshot(overrides));
}

function joined(result) {
  return result.errors.join("\n");
}

test("현재 head의 Ready·CI·review thread snapshot을 finalize 입력으로 고정한다", () => {
  assert.deepEqual(validate(), {
    errors: [],
    snapshot: {
      verified: true,
      repository,
      issue: 49,
      pr: 49,
      base,
      head,
      headTree: tree,
      branch: "work/issue-49-harness-lifecycle",
      title: "docs: #49 - 하네스 finalize 계약을 추가한다",
      updatedAt: "2026-07-25T01:00:00Z",
      sourceRepository: repository,
      remote: "origin",
    },
  });
});

test("MERGED PR의 exact head를 남은 단계 복구 snapshot으로 고정한다", () => {
  const value = snapshot({ mode: "merged-recovery" });
  delete value.checks;
  delete value.threads;
  value.pr = {
    ...value.pr,
    state: "MERGED",
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    mergedAt: "2026-07-25T01:02:03Z",
    mergeCommit: {
      oid: merge,
    },
    mergedBy: { login: "fixture-user" },
  };
  value.actor = "fixture-user";
  value.gitProof = {
    ...value.gitProof,
    main: merge,
    merge,
    mergeTree: tree,
    mergeParents: [base],
    mergeSubject: value.pr.title,
    mainFirstParentContainsMerge: true,
  };
  assert.deepEqual(validateFinalizeSnapshot(value), {
    errors: [],
    snapshot: {
      verified: true,
      repository,
      issue: 49,
      pr: 49,
      base,
      head,
      headTree: tree,
      branch: "work/issue-49-harness-lifecycle",
      title: "docs: #49 - 하네스 finalize 계약을 추가한다",
      updatedAt: "2026-07-25T01:00:00Z",
      sourceRepository: repository,
      remote: "origin",
      recovery: true,
      mergeCommit: merge,
      mergeTree: tree,
    },
  });
});

test("OPEN finalize와 MERGED recovery 상태를 섞거나 병합 증거를 생략할 수 없다", () => {
  const mergedInOpen = snapshot();
  mergedInOpen.pr = {
    ...mergedInOpen.pr,
    state: "MERGED",
    mergedAt: "2026-07-25T01:02:03Z",
    mergeCommit: {
      oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    },
  };
  assert.match(
    joined(validateFinalizeSnapshot(mergedInOpen)),
    /Finalize 대상 PR은 현재 `OPEN`/,
  );

  const openInRecovery = snapshot({ mode: "merged-recovery" });
  delete openInRecovery.checks;
  delete openInRecovery.threads;
  assert.match(
    joined(validateFinalizeSnapshot(openInRecovery)),
    /복구 대상 PR은 현재 `MERGED`/,
  );
  assert.match(
    joined(validateFinalizeSnapshot(openInRecovery)),
    /`mergedAt`/,
  );
  assert.match(
    joined(validateFinalizeSnapshot(openInRecovery)),
    /`mergeCommit\.oid`/,
  );
});

test("OPEN gate 입력과 MERGED recovery 입력을 혼용하지 않는다", () => {
  const mixed = snapshot({ mode: "merged-recovery" });
  mixed.pr = {
    ...mixed.pr,
    state: "MERGED",
    mergedAt: "2026-07-25T01:02:03Z",
    mergeCommit: {
      oid: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
    },
  };
  assert.match(
    joined(validateFinalizeSnapshot(mixed)),
    /병합 복구 mode에는 OPEN 시점의 `checks` 또는 `threads`/,
  );

  assert.throws(
    () =>
      parseArguments([
        "--pr",
        "pr.json",
        "--checks",
        "checks.json",
        "--threads",
        "threads.json",
        "--issue",
        "49",
        "--pull-request",
        "49",
        "--repo",
        repository,
        "--actor",
        "fixture-user",
        "--merged-recovery",
      ]),
    /--merged-recovery에는 --checks와 --threads/,
  );
  assert.throws(
    () =>
      parseArguments([
        "--pr",
        "pr.json",
        "--issue",
        "49",
        "--pull-request",
        "49",
        "--repo",
        repository,
      ]),
    /--checks 인자가 필요/,
  );
  assert.deepEqual(
    parseArguments([
      "--pr",
      "pr.json",
      "--issue",
      "49",
      "--pull-request",
      "49",
      "--repo",
      repository,
      "--actor",
      "fixture-user",
      "--merged-recovery",
    ]),
    {
      mergedRecovery: true,
      pr: "pr.json",
      issue: "49",
      pullRequest: "49",
      repo: repository,
      actor: "fixture-user",
    },
  );
});

test("저위험 근거로 독립 리뷰를 생략한 Ready PR도 finalize할 수 있다", () => {
  const value = snapshot();
  value.pr = {
    ...value.pr,
    body: body({ review: "skipped" }),
  };
  assert.deepEqual(validateFinalizeSnapshot(value).errors, []);
});

test("리뷰 head metadata 대신 exact PR head와 Git proof를 검증한다", () => {
  const value = snapshot();
  value.gitProof = {
    ...value.gitProof,
    head: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
  };
  assert.match(
    joined(validateFinalizeSnapshot(value)),
    /Git proof의 head commit이 PR head OID와 다릅니다/,
  );
});

test("실패·대기·비어 있는 required CI snapshot을 거부한다", () => {
  for (const bucket of ["fail", "pending", "cancel"]) {
    const result = validate({
      checks: [{ name: "validate", state: "FAILURE", bucket }],
    });
    assert.match(joined(result), /현재 head에서 통과하지 않았습니다/, bucket);
  }
  assert.match(
    joined(validate({ checks: [] })),
    /required check를 하나 이상/,
  );
});

test("미해결 또는 pagination이 남은 review thread snapshot을 거부한다", () => {
  const unresolved = snapshot();
  unresolved.threads.data.repository.pullRequest.reviewThreads.nodes[0] = {
    id: "PRRT_fixture_1",
    isResolved: false,
  };
  assert.match(
    joined(validateFinalizeSnapshot(unresolved)),
    /미해결 review thread가 1개/,
  );

  const paginated = snapshot();
  paginated.threads.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage =
    true;
  assert.match(
    joined(validateFinalizeSnapshot(paginated)),
    /다음 page가 남아/,
  );
});

test("review thread의 이전 page·잘린 totalCount·중복 id·cursor 불일치를 거부한다", () => {
  const previousPage = snapshot();
  previousPage.threads.data.repository.pullRequest.reviewThreads.pageInfo.hasPreviousPage =
    true;
  assert.match(
    joined(validateFinalizeSnapshot(previousPage)),
    /이전 page가 있어 첫 page 전체 snapshot이 아닙니다/,
  );

  const truncated = snapshot();
  truncated.threads.data.repository.pullRequest.reviewThreads.totalCount = 3;
  assert.match(
    joined(validateFinalizeSnapshot(truncated)),
    /totalCount와 반환된 node 수가 달라/,
  );

  const duplicate = snapshot();
  duplicate.threads.data.repository.pullRequest.reviewThreads.nodes[1].id =
    "PRRT_fixture_1";
  assert.match(
    joined(validateFinalizeSnapshot(duplicate)),
    /node id는 비어 있지 않고 고유/,
  );

  const wrongCursor = snapshot();
  wrongCursor.threads.data.repository.pullRequest.reviewThreads.pageInfo.startCursor =
    null;
  assert.match(
    joined(validateFinalizeSnapshot(wrongCursor)),
    /page cursor가 반환된 node와 일치하지 않습니다/,
  );
});

test("review thread completeness 필드 누락을 부분 응답으로 거부한다", () => {
  for (const mutate of [
    (connection) => delete connection.totalCount,
    (connection) => delete connection.pageInfo.hasPreviousPage,
  ]) {
    const value = snapshot();
    mutate(value.threads.data.repository.pullRequest.reviewThreads);
    assert.match(
      joined(validateFinalizeSnapshot(value)),
      /connection을 완전하게 읽지 못했습니다/,
    );
  }
});

test("required check와 review thread를 같은 repo·PR·base·head snapshot에 귀속한다", () => {
  const wrongCheck = snapshot();
  wrongCheck.checks[0].link =
    "https://github.com/GoCalendar/LunchTime/actions/runs/999";
  assert.match(
    joined(validateFinalizeSnapshot(wrongCheck)),
    /current head rollup 하나에 정확히 귀속/,
  );

  for (const [field, value] of [
    ["id", "PR_other"],
    ["number", 999],
    ["url", "https://github.com/GoCalendar/LunchTime/pull/999"],
    ["updatedAt", "2026-07-25T02:00:00Z"],
    ["baseRefOid", "d".repeat(40)],
    ["headRefOid", "e".repeat(40)],
    ["headRepository", { nameWithOwner: "Other/Repository" }],
    ["isCrossRepository", true],
  ]) {
    const mixed = snapshot();
    mixed.threads.data.repository.pullRequest[field] = value;
    assert.match(
      joined(validateFinalizeSnapshot(mixed)),
      new RegExp(`${field}.*일치하지 않습니다`),
      field,
    );
  }

  const wrongRepository = snapshot();
  wrongRepository.threads.data.repository.nameWithOwner = "Other/Repository";
  assert.match(
    joined(validateFinalizeSnapshot(wrongRepository)),
    /repository.*일치하지 않습니다/,
  );
});

test("same-repository PR과 canonical origin fetch·push만 finalize한다", () => {
  const crossRepository = snapshot();
  crossRepository.pr.isCrossRepository = true;
  assert.match(
    joined(validateFinalizeSnapshot(crossRepository)),
    /same-repository PR에서만 허용/,
  );

  const wrongHeadRepository = snapshot();
  wrongHeadRepository.pr.headRepository = {
    name: "LunchTime",
    nameWithOwner: "",
  };
  wrongHeadRepository.pr.headRepositoryOwner = { login: "ForkOwner" };
  assert.match(
    joined(validateFinalizeSnapshot(wrongHeadRepository)),
    /PR head repository가 현재 작업 저장소와 다릅니다/,
  );

  for (const [field, value] of [
    ["originFetchRepository", "Other/Repository"],
    ["originPushRepository", "Other/Repository"],
    ["originFetchUrlCount", 2],
    ["originPushUrlCount", 0],
  ]) {
    const invalid = snapshot();
    invalid.gitProof = { ...invalid.gitProof, [field]: value };
    assert.match(
      joined(validateFinalizeSnapshot(invalid)),
      /origin (?:fetch|push) URL이 PR source repository 하나에 정확히 귀속/,
      field,
    );
  }
});

test("GitHub origin URL은 credential 없는 canonical HTTPS·SSH 형식만 허용한다", () => {
  for (const url of [
    "https://github.com/GoCalendar/LunchTime.git",
    "https://github.com/GoCalendar/LunchTime",
    "ssh://git@github.com/GoCalendar/LunchTime.git",
    "ssh://git@github.com:22/GoCalendar/LunchTime.git",
    "git@github.com:GoCalendar/LunchTime.git",
  ]) {
    assert.equal(parseGitHubRepositoryFromRemoteUrl(url), repository, url);
  }
  for (const url of [
    " https://github.com/GoCalendar/LunchTime.git",
    "https://token@github.com/GoCalendar/LunchTime.git",
    "https://github.com:8443/GoCalendar/LunchTime.git",
    "http://github.com/GoCalendar/LunchTime.git",
    "git://github.com/GoCalendar/LunchTime.git",
    "ssh://git:secret@github.com/GoCalendar/LunchTime.git",
    "ssh://git@github.com:2222/GoCalendar/LunchTime.git",
    "ssh://git@github-alias/GoCalendar/LunchTime.git",
    "file:///tmp/LunchTime.git",
    "../LunchTime",
    "https://github.com/GoCalendar/LunchTime/extra",
    "https://github.com/GoCalendar/LunchTime.git?token=secret",
    "https://github.com/GoCalendar/LunchTime.git/",
  ]) {
    assert.equal(parseGitHubRepositoryFromRemoteUrl(url), "", url);
  }
});

test("OPEN finalize는 exact Git base·head와 최신 origin/main proof를 요구한다", () => {
  assert.match(
    joined(validate({ gitProof: { ...snapshot().gitProof, main: "f".repeat(40) } })),
    /origin\/main OID가 PR base snapshot과 다릅니다/,
  );
  assert.match(
    joined(
      validate({
        gitProof: {
          ...snapshot().gitProof,
          baseIsAncestorOfHead: false,
        },
      }),
    ),
    /base commit이 exact head의 ancestor가 아닙니다/,
  );
});

test("MERGED recovery는 exact squash topology·tree·subject·main first-parent를 요구한다", () => {
  const value = snapshot({ mode: "merged-recovery" });
  delete value.checks;
  delete value.threads;
  value.actor = "fixture-user";
  value.pr = {
    ...value.pr,
    state: "MERGED",
    mergedAt: "2026-07-25T01:02:03Z",
    mergedBy: { login: "fixture-user" },
    mergeCommit: { oid: merge },
  };
  value.gitProof = {
    ...value.gitProof,
    main: merge,
    merge,
    mergeTree: tree,
    mergeParents: [base],
    mergeSubject: value.pr.title,
    mainFirstParentContainsMerge: true,
  };

  for (const [field, replacement, pattern] of [
    ["mergeParents", [base, "d".repeat(40)], /유일한 parent/],
    ["mergeTree", "d".repeat(40), /merge tree/],
    ["mergeSubject", "다른 제목", /merge subject/],
    ["mainFirstParentContainsMerge", false, /first-parent history/],
  ]) {
    const invalid = {
      ...value,
      gitProof: { ...value.gitProof, [field]: replacement },
    };
    assert.match(joined(validateFinalizeSnapshot(invalid)), pattern, field);
  }

  const wrongActor = {
    ...value,
    actor: "other-user",
  };
  assert.match(
    joined(validateFinalizeSnapshot(wrongActor)),
    /병합 actor가 현재 인증 actor/,
  );
});

test("Draft·잘못된 base·closing reference·mergeability를 함께 거부한다", () => {
  const value = snapshot();
  value.pr = {
    ...value.pr,
    isDraft: true,
    baseRefName: "develop",
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    closingIssuesReferences: [
      {
        number: 50,
        repository: { nameWithOwner: "Other/Repository" },
      },
    ],
  };
  const errors = joined(validateFinalizeSnapshot(value));
  assert.match(errors, /Ready 상태/);
  assert.match(errors, /base는 `main`/);
  assert.match(errors, /`MERGEABLE`/);
  assert.match(errors, /`CLEAN`/);
  assert.match(errors, /종료 이슈 번호/);
  assert.match(errors, /종료 이슈 저장소/);
});

test("부분 GraphQL 응답으로 미해결 0개를 추측하지 않는다", () => {
  assert.match(
    joined(validate({ threads: { data: { repository: {} } } })),
    /완전하게 읽지 못했습니다/,
  );
  assert.match(
    joined(
      validate({
        threads: {
          errors: [{ message: "temporary failure" }],
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  totalCount: 0,
                  nodes: [],
                  pageInfo: {
                    hasNextPage: false,
                    hasPreviousPage: false,
                    startCursor: null,
                    endCursor: null,
                  },
                },
              },
            },
          },
        },
      }),
    ),
    /GraphQL 응답에 오류/,
  );
});

test("GitHub issue URL에서 closing reference 저장소를 복구할 수 있다", () => {
  const value = snapshot();
  value.pr = {
    ...value.pr,
    closingIssuesReferences: [
      {
        number: 49,
        url: "https://github.com/GoCalendar/LunchTime/issues/49",
      },
    ],
  };
  assert.deepEqual(validateFinalizeSnapshot(value).errors, []);
});

test("exact Git objects에서 squash topology와 main first-parent proof를 읽는다", (context) => {
  const root = mkdtempSync(join(tmpdir(), "lunchtime-finalize-proof-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (arguments_, options = {}) => {
    const result = spawnSync("git", arguments_, {
      cwd: root,
      encoding: "utf8",
      ...options,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["remote", "add", "origin", "git@github.com:GoCalendar/LunchTime.git"]);
  writeFileSync(join(root, "fixture.txt"), "base\n");
  git(["add", "--", "fixture.txt"]);
  git(["commit", "-q", "-m", "chore: #49 - base를 추가한다"]);
  const baseOid = git(["rev-parse", "HEAD"]);
  writeFileSync(join(root, "fixture.txt"), "head\n");
  git(["add", "--", "fixture.txt"]);
  git(["commit", "-q", "-m", "chore: #49 - head를 추가한다"]);
  const headOid = git(["rev-parse", "HEAD"]);
  const headTree = git(["rev-parse", `${headOid}^{tree}`]);
  const title = "chore: #49 - exact squash를 검증한다";
  const mergeOid = git(
    ["commit-tree", headTree, "-p", baseOid],
    { input: `${title}\n` },
  );
  git(["update-ref", "refs/remotes/origin/main", mergeOid]);

  assert.deepEqual(
    readFinalizeGitProof(
      {
        baseRefOid: baseOid,
        headRefOid: headOid,
        mergeCommit: { oid: mergeOid },
      },
      { repositoryRoot: root, mode: "merged-recovery" },
    ),
    {
      base: baseOid,
      head: headOid,
      headTree,
      main: mergeOid,
      baseIsAncestorOfHead: true,
      originFetchRepository: repository,
      originFetchUrlCount: 1,
      originPushRepository: repository,
      originPushUrlCount: 1,
      merge: mergeOid,
      mergeTree: headTree,
      mergeParents: [baseOid],
      mergeSubject: title,
      mainFirstParentContainsMerge: true,
    },
  );
});
