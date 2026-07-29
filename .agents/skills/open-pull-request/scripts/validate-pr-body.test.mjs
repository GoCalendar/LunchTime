import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  pullRequestFromEvent,
  validatePullRequest,
  validateTemplate,
} from "./validate-pr-body.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const template = await readFile(
  resolve(repositoryRoot, ".github/PULL_REQUEST_TEMPLATE.md"),
  "utf8",
);
const currentHead = "1234567890abcdef1234567890abcdef12345678";
const independentReviewRow =
  "| 독립 리뷰 | 원본 요구사항·diff·관련 테스트를 한 번 검토 | 통과 | round=1; reviewers=1; findings=0; main-closure=0/0; scope-expansion=none |";

function readyBody() {
  return `<!-- lunchtime-pr:v2 -->

## 연결된 이슈

<!-- pr:issues:start -->
Closes #17
<!-- pr:issues:end -->

## 변경 요약

<!-- pr:summary:start -->
- 문제·목표: 메뉴 확인 상태가 없어 누락을 막을 수 없으므로 확인 결과를 명시적으로 저장합니다.
- 결과:
  - 참여자별 메뉴 확인 상태와 주문 차단 조건을 추가했습니다.
- 결정·트레이드오프: 방 단위 집계 대신 참여자별 상태를 저장해 데이터는 늘지만 누락 원인을 추적할 수 있습니다.
- 위험·복구: 기존 데이터는 미확인으로 보수적으로 처리하며 문제 시 해당 커밋을 revert합니다.
- 리뷰 시작점: \`Sources/LunchTime/MenuAck.swift\` — 상태 전이와 주문 차단 조건
- 제외·후속 작업: 해당 없음 — 누락 방지 상태와 검증을 이 PR에서 함께 완료합니다.
<!-- pr:summary:end -->

## 추적성

<!-- pr:traceability:start -->
| 구분 | ID 또는 근거 |
| --- | --- |
| 요구사항 | \`PRD-01-FR-06\` |
| 수용 기준 | \`PRD-01-AC-02\` |
| 정책 규칙 | \`POL-02-R-04\` |
| 기술 스파이크 | 해당 없음 — 이미 확정된 누락 방지 규칙의 구현입니다. |
<!-- pr:traceability:end -->

## 검증

<!-- pr:verification:start -->
| 대상 | 명령·확인 | 결과 | 증거 |
| --- | --- | --- | --- |
${independentReviewRow}
| 상태 전이 | \`swift test --filter MenuAckTests\` | 통과 | 8개 테스트 통과 |
| 문서 계약 | \`node validate-product-docs.mjs\` | 통과 | 5개 검사 통과 |
<!-- pr:verification:end -->

## 문서 영향

<!-- pr:docs-impact:start -->
- 판정: 변경 없음
- 대상 파일·ID: \`PRD-01-FR-06\`, \`POL-02-R-04\`
- 근거: 승인된 누락 차단 규칙을 구현하며 사용자 동작과 정책 보장을 바꾸지 않습니다.
<!-- pr:docs-impact:end -->
`;
}

function validate(overrides = {}) {
  return validatePullRequest({
    body: readyBody(),
    title: "feat: LT-017 - 메뉴 누락 차단 상태를 추가한다",
    issueNumber: 17,
    branch: "work/issue-17-menu-ack",
    ...overrides,
  });
}

function joined(errors) {
  return errors.join("\n");
}

test("저장소 템플릿이 고정 구조를 만족한다", () => {
  assert.deepEqual(validateTemplate(template), []);
});

test("완결된 Ready PR을 허용한다", () => {
  assert.deepEqual(validate(), []);
});

test("GitHub 이슈 fallback 제목을 허용한다", () => {
  assert.deepEqual(
    validate({
      title: "docs: #17 - PR 계약을 명확히 한다",
    }),
    [],
  );
});

test("정확히 다섯 H2와 marker를 요구한다", () => {
  assert.match(joined(validate({ body: readyBody().replace("## 검증", "## 테스트") })), /다섯 개/);
  assert.match(joined(validate({ body: readyBody().replace("<!-- pr:summary:end -->", "") })), /summary:end/);

  const inlineMarker = readyBody().replace(
    "<!-- pr:issues:start -->",
    "`<!-- pr:issues:start -->`\n<!-- pr:issues:start -->",
  );
  assert.match(joined(validate({ body: inlineMarker })), /issues:start/);

  const inlineSchema = readyBody().replace(
    "<!-- lunchtime-pr:v2 -->",
    "`<!-- lunchtime-pr:v2 -->`\n<!-- lunchtime-pr:v2 -->",
  );
  assert.match(joined(validate({ body: inlineSchema })), /lunchtime-pr:v2/);
});

test("숨긴 H2와 section 밖 marker를 거부한다", () => {
  const hiddenHeading = readyBody().replace(
    "## 연결된 이슈",
    "<!--\n## 연결된 이슈\n-->",
  );
  assert.match(joined(validate({ body: hiddenHeading })), /다섯 개|issues/);

  const block = readyBody().match(
    /<!-- pr:issues:start -->[\s\S]*?<!-- pr:issues:end -->/,
  )[0];
  const moved = `${readyBody().replace(block, "")}\n${block}\n`;
  assert.match(joined(validate({ body: moved })), /issues.*순서/);
});

test("코드 fence 안 section marker를 거부한다", () => {
  const fenced = readyBody()
    .replace(
      "<!-- pr:summary:start -->",
      "```markdown\n<!-- pr:summary:start -->",
    )
    .replace(
      "<!-- pr:summary:end -->",
      "<!-- pr:summary:end -->\n```",
    );
  assert.match(joined(validate({ body: fenced })), /fence 밖/);
});

test("닫히지 않은 code fence로 렌더링 계약을 숨길 수 없다", () => {
  const unmatched = readyBody().replace(
    "<!-- lunchtime-pr:v2 -->",
    "<!-- lunchtime-pr:v2 -->\n```markdown",
  );
  assert.match(joined(validate({ body: unmatched })), /닫히지 않은/);
});

test("변경 요약의 고정 필드와 1~5개 결과를 요구한다", () => {
  assert.match(
    joined(validate({ body: readyBody().replace("- 위험·복구:", "- 복구:") })),
    /위험·복구/,
  );
  const tooMany = readyBody().replace(
    "  - 참여자별 메뉴 확인 상태와 주문 차단 조건을 추가했습니다.",
    Array.from({ length: 6 }, (_, index) => `  - 결과 ${index + 1}`).join("\n"),
  );
  assert.match(joined(validate({ body: tooMany })), /1~5개/);
});

test("Closes와 브랜치 이슈 번호 불일치를 거부한다", () => {
  assert.match(joined(validate({ issueNumber: 18 })), /예상 이슈/);
  assert.match(joined(validate({ branch: "work/issue-18-menu-ack" })), /head의 이슈 번호/);
});

test("주석이나 코드 블록의 Closes를 종료 이슈로 인정하지 않는다", () => {
  const commented = readyBody().replace(
    "Closes #17",
    "<!-- Closes #17 -->",
  );
  assert.match(joined(validate({ body: commented })), /Closes|종료/);

  const fenced = readyBody().replace(
    "Closes #17",
    "```text\nCloses #17\n```",
  );
  assert.match(joined(validate({ body: fenced })), /Closes|종료/);
});

test("접두어가 있거나 독립된 줄이 아닌 Closes 문법을 거부한다", () => {
  for (const replacement of [
    "- 종료: Closes #17",
    "- Closes #17",
    "병합하면 Closes #17",
    "> Closes #17",
  ]) {
    const body = readyBody().replace("Closes #17", replacement);
    assert.match(joined(validate({ body })), /독립된 줄/);
  }
});

test("독립된 Closes 지시문 중복을 거부한다", () => {
  const body = readyBody().replace("Closes #17", "Closes #17\n\nCloses #17");
  assert.match(joined(validate({ body })), /정확히 하나/);
});

test("연결된 이슈의 중복 종료·작업 키 메타데이터를 거부한다", () => {
  for (const metadata of ["- 종료: #17", "- 작업 키: `LT-017`"]) {
    const body = readyBody().replace(
      "Closes #17",
      `${metadata}\n\nCloses #17`,
    );
    assert.match(
      joined(validate({ body })),
      /중복 종료·작업 키 메타데이터/,
      metadata,
    );
  }
});

test("주석으로 숨긴 변경 요약 필드를 인정하지 않는다", () => {
  const hidden = readyBody().replace(
    "- 위험·복구: 기존 데이터는 미확인으로 보수적으로 처리하며 문제 시 해당 커밋을 revert합니다.",
    "<!-- - 위험·복구: 숨긴 내용 -->",
  );
  assert.match(joined(validate({ body: hidden })), /위험·복구/);
});

test("AI 해석이 모호해지는 고정 필드 중복을 거부한다", () => {
  const duplicated = readyBody().replace(
    "- 판정: 변경 없음",
    "- 판정: 변경 없음\n- 판정: 결정 필요",
  );
  assert.match(joined(validate({ body: duplicated })), /판정.*정확히 하나/);
});

test("제목의 GitHub 이슈 fallback 불일치를 거부한다", () => {
  assert.match(
    joined(validate({ title: "feat: #18 - 메뉴 누락 차단 상태를 추가한다" })),
    /제목의 이슈 번호/,
  );
});

test("잘못된 base와 브랜치 형식을 거부한다", () => {
  assert.match(joined(validate({ base: "develop" })), /base/);
  assert.match(joined(validate({ branch: "feature/menu-ack" })), /브랜치 계약/);
});

test("Ready의 placeholder와 미실행 검증을 거부한다", () => {
  assert.match(
    joined(validate({ body: readyBody().replace("8개 테스트 통과", "<증거>") })),
    /placeholder/,
  );
  assert.match(
    joined(validate({ body: readyBody().replace("| 통과 | 8개", "| 미실행 | 8개") })),
    /Ready PR/,
  );
});

test("검증 표는 대상 cell이 정확히 독립 리뷰인 행을 하나 요구한다", () => {
  const missing = readyBody().replace(`${independentReviewRow}\n`, "");
  assert.match(
    joined(validate({ body: missing })),
    /대상 cell이 정확히 `독립 리뷰`.*현재 0개/,
  );

  const duplicate = readyBody().replace(
    independentReviewRow,
    `${independentReviewRow}\n${independentReviewRow}`,
  );
  assert.match(
    joined(validate({ body: duplicate })),
    /대상 cell이 정확히 `독립 리뷰`.*현재 2개/,
  );

  const renamed = readyBody().replace("| 독립 리뷰 |", "| 독립 리뷰 결과 |");
  assert.match(
    joined(validate({ body: renamed })),
    /대상 cell이 정확히 `독립 리뷰`.*현재 0개/,
  );

  const standalone = missing.replace(
    "<!-- pr:verification:end -->",
    [
      "검증 표 밖의 메모",
      "",
      independentReviewRow,
      "<!-- pr:verification:end -->",
    ].join("\n"),
  );
  assert.match(
    joined(validate({ body: standalone })),
    /대상 cell이 정확히 `독립 리뷰`.*현재 0개/,
  );
});

test("독립 리뷰 target row도 검증 표의 네 열을 모두 가져야 한다", () => {
  const malformed = readyBody().replace(
    independentReviewRow,
    "| 독립 리뷰 | 통과 | 증거 |",
  );
  assert.match(
    joined(validate({ body: malformed })),
    /`독립 리뷰` 행은 네 열/,
  );
});

test("Draft의 독립 리뷰는 실패와 미실행을 사실대로 남길 수 있다", () => {
  for (const result of ["실패", "미실행"]) {
    const evidence =
      result === "실패"
        ? "P1 계약 누락 발견, 수정 대기"
        : "reviewer 배정 대기, review pass 0";
    const body = readyBody().replace(
      independentReviewRow,
      `| 독립 리뷰 | 위험 판단 대기 | ${result} | ${evidence} |`,
    );
    assert.deepEqual(validate({ body, draft: true }), []);
  }
});

test("Ready의 독립 리뷰 실패와 미실행은 구체적으로 거부한다", () => {
  for (const result of ["실패", "미실행"]) {
    const evidence =
      result === "실패"
        ? "P1 계약 누락 발견, 수정 대기"
        : "reviewer 배정 대기, review pass 0";
    const body = readyBody().replace(
      independentReviewRow,
      `| 독립 리뷰 | 위험 판단 대기 | ${result} | ${evidence} |`,
    );
    assert.match(
      joined(validate({ body })),
      /Ready PR의 `독립 리뷰` 결과는 `통과` 또는 .*`생략`/,
    );
  }
});

test("Ready의 독립 리뷰에는 non-placeholder 증거가 필요하다", () => {
  for (const evidence of ["<독립 리뷰 증거>", "TODO", ""]) {
    const body = readyBody().replace(
      independentReviewRow,
      `| 독립 리뷰 | 원본 요구사항·diff·관련 테스트를 한 번 검토 | 통과 | ${evidence} |`,
    );
    assert.match(
      joined(validate({ body })),
      /Ready PR의 `독립 리뷰`에는 placeholder가 아닌 증거가 필요합니다/,
    );
  }
});

test("Ready는 구체적인 저위험 근거로 독립 리뷰를 생략할 수 있다", () => {
  const skipped = readyBody().replace(
    independentReviewRow,
    "| 독립 리뷰 | 변경 위험을 판단해 생략 | 생략 | low-risk=제품 동작이 없는 문서 오탈자만 수정 |",
  );
  assert.deepEqual(validate({ body: skipped }), []);

  for (const evidence of [
    "low-risk=해당 없음",
    "저위험 변경",
    "low-risk=없음",
    "low-risk=저위험",
  ]) {
    const invalid = readyBody().replace(
      independentReviewRow,
      `| 독립 리뷰 | 변경 위험을 판단해 생략 | 생략 | ${evidence} |`,
    );
    assert.match(
      joined(validate({ body: invalid })),
      /low-risk=<구체적인 저위험 근거>/,
      evidence,
    );
  }
});

test("Ready의 독립 리뷰 통과는 한 round와 메인 closure만 기록한다", () => {
  assert.deepEqual(validate(), []);

  for (const evidence of [
    "round=2; reviewers=1; findings=0; main-closure=0/0; scope-expansion=none",
    "round=1; reviewers=0; findings=0; main-closure=0/0; scope-expansion=none",
    `round=1; reviewers=1; findings=0; main-closure=0/0; scope-expansion=none; review-head=${currentHead}`,
  ]) {
    const invalid = readyBody().replace(
      "round=1; reviewers=1; findings=0; main-closure=0/0; scope-expansion=none",
      evidence,
    );
    assert.match(
      joined(validate({ body: invalid })),
      /round=1; reviewers=N; findings=N; main-closure=N\/N; scope-expansion=none/,
      evidence,
    );
  }

  const tooManyReviewers = readyBody().replace(
    "round=1; reviewers=1; findings=0; main-closure=0/0; scope-expansion=none",
    "round=1; reviewers=3; findings=0; main-closure=0/0; scope-expansion=none",
  );
  assert.match(
    joined(validate({ body: tooManyReviewers })),
    /reviewers는 1~2명/,
  );
});

test("독립 리뷰 finding은 메인 세션에서 모두 닫혀야 한다", () => {
  const incomplete = readyBody().replace(
    "findings=0; main-closure=0/0",
    "findings=2; main-closure=1/2",
  );
  assert.match(
    joined(validate({ body: incomplete })),
    /finding은 메인 세션의 `main-closure`에서 모두 닫혀야/,
  );

  const complete = readyBody().replace(
    "findings=0; main-closure=0/0",
    "findings=2; main-closure=2/2",
  );
  assert.deepEqual(validate({ body: complete }), []);
});

test("closed details 안의 PR 본문 구조를 실제 다섯 section으로 인정하지 않는다", () => {
  const body = [
    "<!-- lunchtime-pr:v2 -->",
    "<details>",
    "<summary>접힌 PR 계약</summary>",
    readyBody().replace("<!-- lunchtime-pr:v2 -->\n\n", ""),
    "</details>",
  ].join("\n");
  assert.match(joined(validate({ body })), /H2는 다음 다섯 개/);
});

test("Draft는 실패·미실행과 결정 필요를 허용한다", () => {
  const body = readyBody()
    .replace("| 통과 | 8개", "| 미실행 | 담당자가 실행 예정")
    .replace("- 판정: 변경 없음", "- 판정: 결정 필요");
  assert.deepEqual(validate({ body, draft: true }), []);
});

test("검증 명령의 pipe를 표 열 구분자로 오인하지 않는다", () => {
  const body = readyBody().replace(
    "`swift test --filter MenuAckTests`",
    "`swift test | tee test.log`",
  );
  assert.deepEqual(validate({ body }), []);
});

test("코드 블록 안 H2를 본문 section으로 오인하지 않는다", () => {
  const body = readyBody().replace(
    "- 결과:",
    "```markdown\n## 예시\n```\n- 결과:",
  );
  assert.deepEqual(validate({ body }), []);
});

test("추적 ID가 없으면 구체적인 미적용 근거를 요구한다", () => {
  const invalid = readyBody().replace(
    "| 요구사항 | `PRD-01-FR-06` |",
    "| 요구사항 | 해당 없음 |",
  );
  assert.match(joined(validate({ body: invalid })), /요구사항|구체적인 근거/);
});

test("완전한 3자리 ID가 미정의이면 일부 2자리 ID로 인정하지 않는다", () => {
  const invalid = readyBody().replace("PRD-01-FR-06", "PRD-01-FR-060");
  assert.match(
    joined(validate({ body: invalid })),
    /PRD-01-FR-060.*정의되어 있지 않습니다/,
  );
});

test("세 자리 PRD·Policy·Spike 추적 ID를 허용한다", () => {
  const body = readyBody()
    .replace("PRD-01-FR-06", "PRD-100-FR-100")
    .replace("PRD-01-AC-02", "PRD-100-AC-100")
    .replace("POL-02-R-04", "POL-100-R-100")
    .replace(
      "해당 없음 — 이미 확정된 누락 방지 규칙의 구현입니다.",
      "`PRD-100-SP-100`",
    );
  const definedContractIds = new Set([
    "PRD-100-FR-100",
    "PRD-100-AC-100",
    "POL-100-R-100",
    "PRD-100-SP-100",
  ]);

  assert.deepEqual(validate({ body, definedContractIds }), []);
});

test("Ready 추적 ID는 현재 branch의 제품 정본에 실제로 정의되어야 한다", () => {
  const undefinedIds = readyBody()
    .replace("PRD-01-FR-06", "PRD-99-FR-99")
    .replace("PRD-01-AC-02", "PRD-99-AC-99")
    .replace("POL-02-R-04", "POL-99-R-99");

  const errors = joined(validate({ body: undefinedIds }));
  assert.match(errors, /PRD-99-FR-99.*정의되어 있지 않습니다/);
  assert.match(errors, /PRD-99-AC-99.*정의되어 있지 않습니다/);
  assert.match(errors, /POL-99-R-99.*정의되어 있지 않습니다/);

  assert.doesNotMatch(
    joined(validate({ body: undefinedIds, draft: true })),
    /정의되어 있지 않습니다/,
  );
});

test("Ready 추적 ID는 dirty working tree가 아니라 exact head Git tree에서 확인한다", (context) => {
  const root = mkdtempSync(join(tmpdir(), "lunchtime-pr-head-ids-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs/prd"), { recursive: true });
  mkdirSync(join(root, "docs/policies"), { recursive: true });
  writeFileSync(
    join(root, "docs/prd/01_fixture.md"),
    [
      "# PRD-01. fixture",
      "## PRD-01-FR-06. exact 요구사항",
      "## PRD-01-AC-02. exact 수용 기준",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "docs/policies/02_fixture.md"),
    ["# POL-02. fixture", "## POL-02-R-04. exact 정책", ""].join("\n"),
  );
  const git = (arguments_) => {
    const result = spawnSync("git", arguments_, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "-q"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.com"]);
  git(["add", "--", "docs/prd/01_fixture.md", "docs/policies/02_fixture.md"]);
  git(["commit", "-q", "-m", "docs: #17 - exact ID를 추가한다"]);
  const exactHead = git(["rev-parse", "HEAD"]);

  writeFileSync(
    join(root, "docs/prd/01_fixture.md"),
    [
      "# PRD-01. fixture",
      "## PRD-01-FR-99. dirty 요구사항",
      "## PRD-01-AC-02. exact 수용 기준",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    validate({
      definitionsRef: exactHead,
      repositoryRoot: root,
    }),
    [],
  );
  const dirtyOnly = readyBody().replace(
    "PRD-01-FR-06",
    "PRD-01-FR-99",
  );
  assert.match(
    joined(
      validate({
        body: dirtyOnly,
        definitionsRef: exactHead,
        repositoryRoot: root,
      }),
    ),
    /PRD-01-FR-99.*정의되어 있지 않습니다/,
  );
});

test("링크 destination·reference 정의·HTML attribute의 ID를 Ready 추적으로 인정하지 않는다", () => {
  const body = readyBody()
    .replace(
      "`PRD-01-FR-06`",
      "[요구사항 링크](https://example.com/PRD-01-FR-06)",
    )
    .replace("`PRD-01-AC-02`", "[수용 기준][ac-link]")
    .replace(
      "`POL-02-R-04`",
      '<a href="https://example.com/POL-02-R-04">정책 링크</a>',
    )
    .replace(
      "<!-- pr:traceability:end -->",
      [
        "[ac-link]: https://example.com/PRD-01-AC-02",
        "<!-- pr:traceability:end -->",
      ].join("\n"),
    );
  const errors = joined(validate({ body }));

  assert.match(errors, /`요구사항`에는 완전한 ID/);
  assert.match(errors, /`수용 기준`에는 완전한 ID/);
  assert.match(errors, /`정책 규칙`에는 완전한 ID/);
});

test("Markdown URL과 이메일 autolink를 placeholder로 오인하지 않는다", () => {
  const body = readyBody().replace(
    "8개 테스트 통과",
    "8개 테스트 통과 — <https://example.com/checks/17> — <reviewer@example.com>",
  );
  assert.deepEqual(validate({ body }), []);
});

test("체크박스와 로컬 절대 경로를 거부한다", () => {
  assert.match(joined(validate({ body: `${readyBody()}\n- [x] 완료\n` })), /checkbox/);
  assert.match(
    joined(validate({ body: readyBody().replace("Sources/LunchTime", "/Users/example/LunchTime") })),
    /로컬 절대 경로/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n\`\`\`text\n/Users/example/private\n\`\`\`\n` })),
    /로컬 절대 경로/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n/home/example/private\n` })),
    /로컬 절대 경로/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n/private/tmp/build-output.log\n` })),
    /로컬 절대 경로/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n/private/company/secrets.txt\n` })),
    /로컬 절대 경로/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n+ [x] 완료\n` })),
    /checkbox/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n1. [ ] 미완료\n` })),
    /checkbox/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n1) [ ] 미완료\n` })),
    /checkbox/,
  );
  assert.match(
    joined(validate({ body: `${readyBody()}\n> > + [ ] 인용된 미완료\n` })),
    /checkbox/,
  );
});

test("구두점 뒤 로컬 절대 경로를 차단하고 URL 경로는 허용한다", () => {
  for (const candidate of [
    "artifact=/private/tmp/build-output.log",
    "artifact:/tmp/build-output.log",
    "[/home/example/output.log]",
    'path="/Users/example/LunchTime/output.log"',
    "cache=/var/folders/ab/cache",
    "root=/private",
  ]) {
    assert.match(
      joined(validate({ body: `${readyBody()}\n${candidate}\n` })),
      /로컬 절대 경로/,
      candidate,
    );
  }

  for (const uri of [
    "file:///Users/example/LunchTime/output.log",
    "file:///private/tmp/build-output.log",
    "file:///home/example/output.log",
    "file:///root/output.log",
    "file:///tmp/output.log",
    "file:///var/folders/ab/cache",
  ]) {
    assert.match(
      joined(validate({ body: `${readyBody()}\n${uri}\n` })),
      /로컬 절대 경로/,
      uri,
    );
  }

  assert.deepEqual(
    validate({
      body: `${readyBody()}\nhttps://example.com/private/assets/result.json\n`,
    }),
    [],
  );
});

test("검증 표 구분선 누락을 거부한다", () => {
  const invalid = readyBody().replace(
    "| --- | --- | --- | --- |\n",
    "",
  );
  assert.match(joined(validate({ body: invalid })), /Markdown 구분선/);
});

test("GitHub pull_request event를 안전한 입력으로 변환한다", () => {
  const event = {
    pull_request: {
      title: "feat: LT-017 - 메뉴 누락 차단 상태를 추가한다",
      body: readyBody(),
      draft: false,
      head: {
        ref: "work/issue-17-menu-ack",
        sha: currentHead,
      },
      base: { ref: "main" },
    },
  };
  assert.deepEqual(
    validatePullRequest({
      ...pullRequestFromEvent(event),
      definedContractIds: new Set([
        "PRD-01-FR-06",
        "PRD-01-AC-02",
        "POL-02-R-04",
      ]),
    }),
    [],
  );
});
