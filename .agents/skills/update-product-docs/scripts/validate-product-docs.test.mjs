#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const validatorPath = fileURLToPath(
  new URL("./validate-product-docs.mjs", import.meta.url),
);
const architectureFiles = [
  "docs/architecture/README.md",
  "docs/architecture/01_system_context.md",
  "docs/architecture/02_peer_network_and_transport.md",
  "docs/architecture/03_communication_protocol.md",
  "docs/architecture/04_replication_consistency_and_recovery.md",
  "docs/architecture/05_storage_and_security.md",
];
const architectureDetailFiles = architectureFiles.slice(1);
const developmentFiles = [
  "docs/development/01_harness_guide.md",
  "docs/development/02_testing_standard.md",
];
const harnessRoutingDocuments = [
  {
    file: "AGENTS.md",
    section: "PR과 작업 완료",
  },
  {
    file: "CONTRIBUTING.md",
    section: "8. 병합과 정리",
  },
  {
    file: developmentFiles[0],
    section: "규칙 소유와 링크",
  },
];
const harnessDetailOwners = [
  {
    name: "run-github-work-item",
    file: ".agents/skills/run-github-work-item/SKILL.md",
  },
  {
    name: "open-pull-request",
    file: ".agents/skills/open-pull-request/SKILL.md",
  },
];
const plannedIdDetailOwner = {
  name: "update-product-docs",
  file: ".agents/skills/update-product-docs/SKILL.md",
};
const plannedIdRoutingDocuments = [
  {
    file: "AGENTS.md",
    section: "구현과 충돌 방지",
  },
  {
    file: "README.md",
    section: "제품 문서 갱신 절차",
  },
  {
    file: "CONTRIBUTING.md",
    section: "4. 개발 템플릿",
  },
  {
    file: developmentFiles[0],
    section: "규칙 소유와 링크",
  },
];
const plannedIdDetailExamples = [
  {
    label: "planned ID marker와 정본 정의 경계",
    content:
      "`planned ID`는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다.",
  },
  {
    label: "planned ID의 구체적 정본 파일 소유",
    content:
      "planned ID의 namespace 번호와 일치하는 구체적 `NN_*.md`를 소유한다.",
  },
  {
    label: "README·재귀 glob의 정의 파일 소유 한계",
    content:
      "README와 재귀 glob만으로는 정의 파일을 소유하지 않는다.",
  },
  {
    label: "planned ID의 실제 정의·validator·구현·테스트·PR 추적",
    content:
      "planned ID를 실제 정의하고 validator, 구현, 테스트와 PR에 추적한다.",
  },
  {
    label: "exact-head 비가시 정의 제외",
    content:
      "exact PR head Git tree에서 image alt와 <details>를 정의에서 제외한다.",
  },
  {
    label: "exact-head 실제 정본 정의",
    content:
      "PR을 열기 직전 exact head Git tree에서 새 ID가 실제 정본에 정의됐는지 확인한다.",
  },
  {
    label: "exact PR head 실제 정본 정의",
    content:
      "exact PR head Git tree에서 새 ID가 실제 정본에 정의됐는지 확인한다.",
  },
  {
    label: "Ready 전 planned ID 실제 정의",
    content:
      "Ready 전에는 planned ID가 실제 정본에 정의되어야 한다.",
  },
  {
    label: "planned ID 승인·경로 소유",
    content:
      "새 ID는 승인된 결정과 planned ID가 있고 변경 경로를 소유할 때만 만든다.",
  },
  {
    label: "planned ID의 같은 branch·PR 동시 작업",
    content: "planned ID는 같은 branch와 PR에서 다룬다.",
  },
];
const forbiddenFinalizeDetailTokens = [
  "snapshot-scratch",
  "snapshot-attempt.json",
  "pending.omc",
  "current.omc",
  "failed-empty",
  "worktree-quarantine",
  "beforeRefDelete",
  "GIT_INDEX_FILE",
  "statusCheckRollup",
  "merged-recovery",
];
const skillDirectories = [
  ".agents/skills/update-product-docs",
  ".agents/skills/run-github-work-item",
  ".agents/skills/commit-work-item",
  ".agents/skills/open-pull-request",
];
const harnessFields = [
  "목적",
  "핵심 입력",
  "완료 조건",
  "대표 실패·중단 조건",
];
const finalSnapshotOrderFixture = [
  "## 최종 snapshot 검증 순서",
  "",
  "| 순서 | 단계 | 필수 계약 |",
  "|---|---|---|",
  "| 1 | 빠른 행동 검증 | 구현 중에는 이슈별 행동 테스트만 빠르게 반복하며 저장소 고정 게이트 전체를 실행하지 않는다. |",
  "| 2 | 정본 의미 영향 | 독립 리뷰 전에 PRD·Policy·Architecture 의미 영향과 이슈 경로를 판정하고 필요한 정본의 누락·충돌·금지 경로가 있으면 중단한다. |",
  "| 3 | candidate 고정 | clean 독립 worktree에서 검토한 경로만 명시적으로 stage하고 cached diff·candidate tree를 고정하며 unstaged tracked 변경과 예상하지 않은 untracked 입력이 없어야 한다. |",
  "| 4 | 독립 리뷰 | 위험도별 reviewer가 같은 cached diff·candidate tree를 병렬 검토하고 발견 사항을 합쳐 일괄 수정하며, 수정하면 행동 테스트·정본 의미 영향 판정 뒤 새 snapshot만 다시 리뷰한다. |",
  "| 5 | 최종 저장소 게이트 | 계획된 수정이 없을 때 같은 filesystem에서 현재 `AGENTS.md` 고정 게이트 전체를 한 번 실행한다. 독립된 읽기 전용·격리 명령만 병렬 실행하고 같은 index·working tree·외부 상태·공유 cache·자원을 쓰는 명령은 순차 실행한 뒤 모든 결과를 join한다. 검증 전후 candidate tree와 gate input은 같아야 한다. |",
  "| 6 | commit | candidate tree와 commit tree가 같고 증거가 완전하면 로컬 게이트를 반복하지 않고 기존 증거를 인계한다. |",
  "| 7 | PR·필수 CI | commit tree와 PR head tree가 같을 때 로컬 증거를 재사용하되 원격 required CI는 생략하지 않는다. |",
  "",
];
const finalSnapshotRecoveryFixture = [
  "## 실패와 증거 무효화",
  "",
  "| 상황 | 기존 증거 | 재진입 |",
  "|---|---|---|",
  "| tracked content 변경 | review·gate 증거 모두 무효 | 새 candidate에서 행동 테스트와 PRD·Policy·Architecture 의미 영향 판정 뒤 독립 리뷰부터 다시 시작한다. |",
  "| 환경 전용 실패·동일 tree·input | review 증거 유지, 실패 gate 미완료 | 원인과 동일 tree·input 근거를 기록하고 새 명령을 한 번만 실행한다. 자동 반복하지 않는다. |",
  "| 의미 영향·리뷰 증거 불완전·동일 tree·input | review·gate 증거 재사용 거부 | 같은 candidate·input에서 PRD·Policy·Architecture 의미 영향 판정과 새 독립 리뷰를 수행한 뒤 최종 게이트로 진행한다. |",
  "| 최종 gate 증거 불완전·동일 tree·input | 로컬 gate 증거 재사용 거부 | exact candidate·input을 동일한 clean snapshot에 재구성하고 현재 `AGENTS.md` 고정 게이트 전체를 새로 실행한다. |",
  "| candidate tree·input 불일치 | review·gate 증거 모두 무효 | 다른 tree나 input에 gate만 실행하지 않고 새 candidate의 행동 테스트·의미 영향 판정·독립 리뷰부터 다시 시작한다. |",
  "",
];
const updateProductDocsFixtureContract = [
  "## Planned ID 계약",
  "",
  "- `planned ID`는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다.",
  "- 승인된 결정과 planned ID가 있을 때 같은 이슈, branch와 PR에서 작성한다.",
  "- 별도 문서 이슈나 PR을 만들 필요는 없다.",
  "- Ready 전 planned ID를 실제 ID 정의, README·하위 인덱스, validator와 구현·테스트에 연결한다.",
  "- namespace에 맞는 `NN_*.md` concrete planned definition file을 소유하며 README와 재귀 glob만으로는 정의하지 않는다.",
  "- exact PR head Git tree에서 정의를 읽고 image alt, raw HTML과 `<details>`를 제외한다.",
  "- 미결정 제품 선택이 남으면 중단한다.",
  "- 이 canonical 구역은 plain top-level H2, direct bullet과 2칸 continuation,",
  "  inline code만 사용한다. blockquote, image, link, reference definition,",
  "  fenced·indented code와 raw HTML은 계약 증거가 모호해지므로 사용하지 않는다.",
  "- owner·routing H2의 보호 이름은 지정된 위치에서 source가 정확히",
  "  `## <name>`인 plain top-level ATX 한 줄로만 쓴다. 들여쓰기·container·",
  "  setext·closing `#`, formatting·link·reference·entity·hardbreak와",
  "  종결되지 않거나 모호한 inline 문법을 보호 이름에 사용할 수 없다.",
  "- validator는 임의의 CommonMark rendered 동등성을 보장하지 않는다. bounded",
  "  block scanner가 fenced·indented code와 숨겨진 raw HTML을 후보에서 제외한",
  "  뒤, 다른 H2 후보의 visible/source skeleton이 보호 이름 token sequence를",
  "  나타내거나 포함할 수 있으면 실제 rendering과 무관하게 fail-closed한다.",
  "",
  "## 품질 게이트 실행",
  "",
  "좁은 행동 테스트는 최종 저장소 게이트를 대신하지 않는다.",
  "PRD·Policy·Architecture 의미 영향 판정은 독립 리뷰 전에 끝내고 cached diff·candidate tree를 검토한다.",
  "review-fix 사이에는 고정 게이트 전체를 실행하지 않는다.",
  "계획된 수정이 없으면 현재 `AGENTS.md` 고정 게이트 전체를 한 번 실행한다.",
  "tracked content가 바뀌면 행동·의미 영향·리뷰·게이트 증거를 무효화하고 빠른 행동 테스트와 의미 영향 판정부터 다시 시작한다.",
  "tree·input이 같은 환경 전용 실패는 한 번만 복구한다.",
  "의미 영향·독립 리뷰 증거가 불완전하면 새 리뷰부터 복구하고 최종 gate 증거만 불완전하면 gate를 새로 실행한다. candidate tree나 input이 다르면 빠른 행동 테스트와 의미 영향 판정부터 다시 시작한다.",
];
const runGithubWorkItemFixtureContract = [
  "요청·파생 label의 정확한 집합을 요구하며 요청하지 않은 label은 보존한다.",
  "stale `dependency:blocked`는 live 의존 관계를 재확인한 뒤 제한적으로 복구한다.",
  "",
  "## 구현 snapshot 검증",
  "",
  "빠른 행동 테스트 뒤 PRD·Policy·Architecture를 확인한다.",
  "cached diff·candidate tree를 같은 snapshot으로 검토한다.",
  "발견 사항을 한 번에 수정하고 새 candidate를 다시 검토한다.",
  "계획된 수정이 없으면 현재 `AGENTS.md` 고정 게이트 전체를 한 번 실행한다.",
];
const commitWorkItemFixtureContract = [
  "## 3. Candidate staging과 독립 리뷰",
  "",
  "빠른 행동 테스트 동안 고정 게이트 전체를 실행하지 않는다.",
  "PRD·Policy·Architecture를 대조하고 candidate tree를 독립 리뷰한 뒤 발견 사항을 일괄 수정한다.",
  "review-fix 사이에는 고정 게이트 전체를 실행하지 않는다.",
  "",
  "## 4. 최종 게이트와 snapshot 결속",
  "",
  "계획된 수정이 없으면 현재 `AGENTS.md` 고정 게이트를 한 번 실행한다.",
  "tracked content가 바뀌면 행동·의미 영향·리뷰·게이트 증거를 모두 무효화하고 빠른 행동 테스트부터 새 candidate를 만든다. tree·input이 같은 환경 전용 실패는 한 번 복구한다.",
  "의미 영향·독립 리뷰 증거가 불완전하면 새 리뷰부터, 최종 gate 증거만 불완전하면 gate부터 복구한다. candidate tree나 input이 다르면 모든 로컬 증거를 버리고 빠른 행동 테스트부터 새 candidate를 만든다.",
  "",
  "## 6. 커밋 후 검증과 보고",
  "",
  "`HEAD^{tree}`와 candidate tree가 같으면 commit path gate 증거를 재사용하고 반복하지 않는다.",
];
const commitContractFixture = [
  "# 커밋 계약",
  "",
  "## 5. 검증 증거",
  "",
  "이슈별 행동 테스트 뒤 PRD·Policy·Architecture를 판정하고 cached diff digest와 candidate tree를 고정해 독립 리뷰한다.",
  "고정 게이트 전체를 한 번 실행하고 commit tree와 PR head tree를 결속하며 원격 required CI는 생략하지 않는다.",
  "tracked content가 바뀌면 행동 테스트·의미 영향·리뷰·게이트 증거를 무효화하고 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 다시 시작한다.",
  "의미 영향·독립 리뷰 증거가 불완전하면 새 리뷰부터, 최종 gate 증거만 불완전하면 gate부터 복구하고 candidate tree나 input이 다르면 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 새 candidate로 돌아간다.",
  "",
  "## 9. 커밋 후 검증",
  "",
  "`HEAD^{tree}`와 candidate tree가 같으면 commit path gate 증거를 재사용하고 다시 실행하지 않는다.",
  "",
];
const openPullRequestFixtureContract = [
  "PR 생성·갱신만 요청은 재조회에서 멈춘다.",
  "완료·병합·end-to-end 요청에서만 finalize한다.",
  "validate-finalize.mjs로 required check, review thread와 closingIssuesReferences를 검증한다.",
  "required check는 `statusCheckRollup`의 유일한 성공 run에 귀속한다.",
  "review thread 응답의 repo·PR node·number·URL·`updatedAt`와 base/head가 일치해야 한다.",
  "exact head Git tree에서 추적 ID를 검증한다.",
  "--merged-recovery는 `MERGED`, `mergedAt`, `mergeCommit.oid`를 검증하고 merge 명령은 실행하지 않고 원격 ref 확인부터 재개한다.",
  "병합 전에만 의미가 있는 required check·review thread는 다시 판정하지 않고 복구한다.",
  "merge commit의 유일한 parent는 `baseRefOid`이고 merge tree는 exact head tree이며 origin/main first-parent에 포함된다.",
  "complete <issue> --pr <pr> --head <validated-head> --repo <validated-repository> --dry-run",
  "issue worktree가 이미 없으면 clean `main` worktree에서 재개한다.",
  "review-head=<40자리 SHA>를 정확히 한 번 기록하고 현재 head와 완전히 일치시킨다.",
  "FR·AC·Policy visible heading 또는 PRD 기술 스파이크 표의 첫 셀로 실제 정의한다.",
  "## 7. Exact-head squash merge\nfinalize-merge.mjs --snapshot <snapshot> --confirm-plan <token>을 사용한다.",
  "gh pr merge는 shell 문자열이 아니라 `--squash`와 `--match-head-commit <head>`를 포함한 각각 별도 argv로 실행한다.",
  "`--delete-branch`는 사용하지 않는다.",
  "병합 재조회가 성공한 뒤에만 exact remote ref를 읽는다.",
  "git ls-remote --heads origin refs/heads/<validated-branch>",
  "OID가 다르면 삭제하지 않고 중단한다.",
  "--force-with-lease=refs/heads/<validated-branch>:<validated-head>",
  "불명확한 응답이면 다시 실행하지 않는다.",
  "`complete` 성공과 사후 검증 전에는 worktree나 local branch를 삭제하지 않는다.",
  "git -C <issue-worktree> rev-parse HEAD와 git -C <main-worktree> rev-parse refs/heads/<validated-branch>를 <validated-head>와 확인한다.",
  "finalize-local-cleanup.mjs --repo <validated-repository> --issue <issue> --pr <pr> --dry-run을 repository를 포함한 같은 일곱 identity로 실행한다.",
  "origin fetch와 push URL은 각각 정확히 하나인 credential 없는 canonical GitHub URL이어야 하며 raw URL은 출력하거나 plan·identity에 저장하지 않고 fingerprint는 plan token과 runtime canary에만 결속한다.",
  "archive key는 stable local locator identity로 유지하고 explicit repository만 durable core identity에 둔다. repository 변경은 core identity collision으로 중단하지만 같은 repository의 canonical URL 변경은 새 dry-run으로 기존 archive를 복구한다.",
  "worktree-quarantine은 검증된 로컬 정리 상태만 소유한다.",
  "worktree root 전체와 metadata directory 전체를 atomic no-replace quarantine하고 `git worktree remove`나 `git worktree prune`은 호출하지 않는다.",
  "원본을 rename·삭제하지 않고 helper-owned 새 inode current.omc sealed snapshot을 만들고 source·payload `contentDigest`를 확인한다.",
  "이 단계는 copy fallback이 아니라 원본을 그대로 보존하는 primary snapshot이다.",
  "`generation.json`은 `intentDigest`와 `payloadProof`를 결속하고 historic generation 전체를 검증한다.",
  "`snapshot-scratch/`의 nonce root는 exact durable intent digest·scratch basename·root device/inode·pending·final 경로를 `snapshot-attempt.json`에 결속하며 attempt 전 중단된 empty inert residue는 payload 채택을 하지 않는다.",
  "helper-owned bound scratch는 `snapshot-failed.json`에 결속하고 `pending.omc`, `current.omc` 순서로 publish하며 candidate가 nonempty일 때만 `partial` orphan receipt로 봉인한 뒤 현재 source를 다음 preserved generation에 append한다.",
  "첫 entry 전 실패한 exact owned empty root는 `failed-empty` orphan receipt로 같은 attempt·root·failed proof를 보존하고 source가 있으면 preserved generation을, 사라졌으면 empty generation을 append한다.",
  "receipt-less preserved intent의 source가 사라져도 nonempty 실패 candidate는 `partial` orphan, exact empty failure는 `failed-empty` orphan, complete candidate는 preserved generation으로 봉인한 뒤 truthful empty generation을 append하며 source와 helper-owned candidate가 모두 없을 때만 fail-closed한다.",
  "snapshot 뒤 원본 write는 sealed generation을 바꾸지 않고 mutable quarantined root에 남으며 sealed payload가 receipt proof에서 drift하면 quarantine과 local ref CAS를 중단한다.",
  "quarantine transition canary는 stage root·metadata와 main worktree root·branch·HEAD·main·origin/main ref·clean 상태·common dir·registration을 검증한다.",
  "root `.git` marker와 metadata의 `commondir`·`gitdir`·`HEAD`는 device·inode·mode·size·byte digest에 결속하고 이동 뒤 bytes를 해석·재작성하지 않는다.",
  "root rename 전 origin canary 뒤 residue scan을 마지막 bounded pre-rename operation으로 실행한다. post-move에는 `GIT_DIR`·`GIT_COMMON_DIR`을 common dir로, `GIT_WORK_TREE`를 quarantined root로, `GIT_INDEX_FILE`을 current metadata index로 명시하고 git ls-files --others --directory -z를 검사한다. post-move residue canary는 root·metadata·receipt hook 뒤와 local ref CAS 직전에 반복하며 사용자가 residue를 제거하거나 다른 곳으로 옮긴 뒤에만 복구한다.",
  "외부 writer를 동결하는 filesystem lease가 없으므로 linearizable freeze를 보장하지 않는다. 이후 residue는 다음 post-move canary에서 fail-closed하며 `.omc` 내부의 mutable write는 허용한다.",
  "repository와 canonical origin fetch·push fingerprint canary는 identity와 published-pending cleanup, generation intent·container, snapshot attempt, copy 시작·종료, scratch→pending, outcome, pending→current, generation receipt, quarantine intent·root·metadata·receipt, local ref CAS의 모든 durable boundary를 검증한다.",
  "`beforeRefDelete` hook 뒤 fresh full plan과 plan token에서 exact generation·quarantine·receipt·registration을 확인한 뒤에만 CAS를 실행한다.",
  "git status --porcelain=v1 --untracked-files=all --ignored=matching --ignore-submodules=none 뒤 git ls-files --others --ignored를 확인한다.",
  "git -C <main-worktree> update-ref -d refs/heads/<validated-branch> <validated-head>",
  "dirty·staged·untracked 사용자 변경이면 중단한다.",
  "",
  "## 2. 중복 PR과 문서 영향 확인",
  "",
  "commit tree와 candidate를 대조하고 tree나 입력이 다르면 새 candidate의 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰로 돌아간다.",
  "의미 영향·독립 리뷰 증거가 불완전하면 새 독립 리뷰를 수행하고, 최종 gate 결과 증거만 불완전하면 recovery worktree에서 고정 게이트 전체를 한 번 실행한다.",
  "",
  "## 3. 제목과 본문 작성",
  "",
  "`review-tree=<40자리 tree OID>`, `verification-tree=<40자리 tree OID>`, `commit-tree=<40자리 tree OID>`, `pr-head-tree=<40자리 tree OID>`의 네 tree는 같아야 한다.",
  "고정 게이트 전체를 한 번 실행하고 required CI는 항상 통과해야 한다.",
];
const prBodyContractFixture = [
  "# PR 본문 계약",
  "",
  "## 4. 검증",
  "",
  "`review-tree=<40자리 tree OID>`, `verification-tree=<40자리 tree OID>`, `commit-tree=<40자리 tree OID>`, `pr-head-tree=<40자리 tree OID>`를 기록한다.",
  "candidate tree와 input의 의미 영향·독립 리뷰 증거가 불완전하면 새 독립 리뷰를 수행하고, 최종 gate 결과 증거만 불완전하면 고정 게이트 전체를 실행한다. candidate tree·input이 다르면 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 새 candidate로 돌아간다.",
  "로컬 증거 재사용은 GitHub required CI를 대신하지 않는다.",
];

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "lunchtime-product-docs-"),
  );

  fs.mkdirSync(path.join(root, ".agents/skills"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/product-definition"), {
    recursive: true,
  });
  fs.symlinkSync("../.agents/skills", path.join(root, ".claude/skills"));

  write(root, "AGENTS.md", "# AI 작업 지침\n");
  fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));

  write(
    root,
    "README.md",
    [
      "# 검증용 저장소",
      "docs/prd/README.md",
      "docs/prd/100_future.md",
      "docs/policies/README.md",
      "docs/policies/100_future.md",
      "[시스템 아키텍처](docs/architecture/README.md)",
      "[개발 하네스 가이드](docs/development/01_harness_guide.md)",
      "[테스트 표준](docs/development/02_testing_standard.md)",
      "AGENTS.md",
      "CONTRIBUTING.md",
      ".agents/skills/update-product-docs/SKILL.md",
      ".agents/skills/run-github-work-item/SKILL.md",
      ".agents/skills/commit-work-item/SKILL.md",
      ".agents/skills/open-pull-request/SKILL.md",
      ".github/ISSUE_TEMPLATE/work-item.yml",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/workflows/validate-harness.yml",
      "",
      "## 제품 문서 갱신 절차",
      "",
      "새 ID 작업은 [update-product-docs](.agents/skills/update-product-docs/SKILL.md)의 planned ID 계약으로 라우팅한다.",
      "",
    ].join("\n"),
  );
  write(root, "docs/prd/README.md", "# PRD 인덱스\n\n100_future.md\n");
  write(
    root,
    "docs/policies/README.md",
    "# 정책 인덱스\n\n100_future.md\n",
  );
  write(
    root,
    "docs/architecture/README.md",
    [
      "# 시스템 아키텍처",
      "",
      "## 빠른 선택",
      "",
      "| 궁금한 질문 | 읽을 문서 | 확정 계약 | 논리 모델 | 미결정 기술의 위치 |",
      "|---|---|---|---|---|",
      ...architectureDetailFiles.map((file, index) =>
        [
          `| 질문 ${index + 1}`,
          `[문서 ${index + 1}](./${path.basename(file)})`,
          `계약 ${index + 1}`,
          `모델 ${index + 1}`,
          `기술 ${index + 1} |`,
        ].join(" | "),
      ),
      "",
      "## 추천 읽기 순서",
      "",
      ...architectureDetailFiles.map(
        (file, index) =>
          `${index + 1}. [문서 ${index + 1}](./${path.basename(file)})`,
      ),
      "",
      "## 정본과의 경계",
      "",
      "PRD와 Policy를 입력 정본으로 사용한다.",
      "",
      "## 입력 계약",
      "",
      "상세 문서는 필요한 입력 계약을 완전한 ID로 기록한다.",
      "",
      "## 기술 검증 대기 지도",
      "",
      "미결정 구현 방식은 기술 검증에서 확정한다.",
      "",
    ].join("\n"),
  );
  for (const file of architectureDetailFiles) {
    write(
      root,
      file,
      [
        `# ${path.basename(file, ".md")}`,
        "",
        "이 문서는 검증 fixture의 아키텍처 범위를 설명한다.",
        "",
        "## 한눈에 보기",
        "",
        "```mermaid",
        "flowchart LR",
        "    A[입력] --> B[결과]",
        "```",
        "",
        "- 입력이 결과로 이동한다.",
        "- 결과는 화면에 표시된다.",
        "- 구현 기술은 아직 확정하지 않는다.",
        "",
      ].join("\n"),
    );
  }

  const developmentOverview = [
    "## 한눈에 보기",
    "",
    "```mermaid",
    "flowchart LR",
    "    A[입력] --> B[검증] --> C[완료]",
    "```",
    "",
    "- 입력 정본을 먼저 확인한다.",
    "- 검증 증거를 실행 결과로 남긴다.",
    "- 실패 조건에서는 다음 단계로 진행하지 않는다.",
    "",
  ];
  const harnessRouting = [
    "## 요청 라우팅",
    "",
    "| 요청 유형 | 첫 정본 입력 | 실행 Skill·소유자 | 종료·인계 지점 |",
    "|---|---|---|---|",
    "| 새 이슈 작성·감사 | 승인된 정본 | run-github-work-item create | on-demand 이슈 생성은 11단계 밖에서 인계한다. |",
    "| 기존 이슈 구현·재개 | 이슈 본문 | run-github-work-item check·start | 검증된 commit을 인계한다. |",
    "| 제품 문서 작성·변경 | 승인된 결정 | update-product-docs | 실제 ID 정의를 인계한다. |",
    "| commit 작성 | raw diff | commit-work-item | push하지 않은 commit을 인계한다. |",
    "| PR 생성·갱신만 | clean branch | open-pull-request | 재조회에서 멈추고 병합하지 않는다. |",
    "| 작업 완료·병합 | 현재 head·CI·review snapshot | open-pull-request와 run-github-work-item | squash merge와 complete 결과를 인계한다. |",
    "| 실패·부분 응답 복구 | 현재 상태 | 쓰기를 소유한 Skill | 재조회 뒤 중복 쓰기 없이 인계한다. |",
    "",
  ];
  const harnessOwnership = [
    "## 규칙 소유와 링크",
    "",
    "한 규칙에는 세부 정본 소유자를 하나만 둔다.",
    "",
    "| 규칙 | 단일 소유 정본 | 이 인덱스의 역할 |",
    "|---|---|---|",
    "| 사용자 결과·수용 동작 | PRD | STEP 입력으로 연결 |",
    "| 상태·권한·실패·복구·보존·보안 | Policy | STEP 입력으로 연결 |",
    "| 작업 범위·경로·행동 시나리오·검증 계획 | [run-github-work-item 이슈 계약](../../.agents/skills/run-github-work-item/references/issue-contract.md) | 이슈 양식·제품 추적 적용 경계·구현·리뷰 입력을 단일 계약으로 라우팅 |",
    "| PRD·Policy planned ID 수명주기 | [update-product-docs](../../.agents/skills/update-product-docs/SKILL.md) | 새 ID 요청을 단일 owner로 라우팅 |",
    "| 이슈·Project 상태 전이·재조회·복구 | [run-github-work-item](../../.agents/skills/run-github-work-item/SKILL.md) | 이슈·Project 요청을 단일 owner로 라우팅 |",
    "| PR 쓰기·exact-head finalize·원격·로컬 정리 | [open-pull-request](../../.agents/skills/open-pull-request/SKILL.md) | PR 수명주기 요청을 단일 owner로 라우팅 |",
    "| PR의 고정 필드 | PR 템플릿과 본문 계약 | STEP 10·11 입력으로 연결 |",
    "| CI의 결정적 증거 | validate workflow | 현재 head gate로 연결 |",
    "",
  ];
  write(
    root,
    "AGENTS.md",
    [
      "# AI 작업 지침",
      "",
      "## 구현과 충돌 방지",
      "",
      "- 새 ID 작업은 [update-product-docs](.agents/skills/update-product-docs/SKILL.md)의 planned ID 계약으로 라우팅한다.",
      "",
      "## PR과 작업 완료",
      "",
      "- PR finalize와 로컬 정리는 [open-pull-request](.agents/skills/open-pull-request/SKILL.md)가 소유한다.",
      "- 이슈·Project 완료 전이는 [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)가 소유한다.",
      "",
      "## 행동 시나리오와 독립 리뷰",
      "",
      "- 이슈별 빠른 테스트만 수행하고 고정 게이트 전체는 실행하지 않는다.",
      "- 리뷰 전에 PRD·Policy·Architecture를 확인하고 cached diff·candidate tree를 독립 리뷰해 발견 사항을 일괄 수정한다.",
      "- review-fix 사이에는 고정 게이트 전체를 실행하지 않는다.",
      "",
      "## 문서와 검증",
      "",
      "- 계획된 변경이 없는 staged candidate에서 고정 게이트 전체를 한 번 실행한다.",
      "- tracked content가 바뀌면 행동·리뷰·게이트 증거를 모두 무효화하고 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 다시 시작한다. tree·input이 같은 환경 전용 실패는 한 번 복구한다.",
      "- 의미 영향·독립 리뷰 증거가 불완전하면 새 리뷰부터, 최종 gate 증거만 불완전하면 gate부터 복구한다. candidate tree나 input이 다르면 모든 로컬 증거를 무효화하고 빠른 행동 테스트, 영향 판정과 독립 리뷰부터 다시 시작한다.",
      "",
    ].join("\n"),
  );
  write(
    root,
    "CONTRIBUTING.md",
    [
      "# 기여 지침",
      "",
      "## 4. 개발 템플릿",
      "",
      "- 새 ID 작업은 [update-product-docs](.agents/skills/update-product-docs/SKILL.md)의 planned ID 계약으로 라우팅한다.",
      "",
      "## 8. 병합과 정리",
      "",
      "- PR finalize와 로컬 정리는 [open-pull-request](.agents/skills/open-pull-request/SKILL.md)가 소유한다.",
      "- 이슈·Project 완료 전이는 [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)가 소유한다.",
      "- 필수 승인 수는 1인 운영을 막지 않도록 0으로 유지합니다. 승인 수와 무관하게 생성된 리뷰 대화는 모두 해결해야 합니다.",
      "",
      "## 5. 테스트와 독립 리뷰",
      "",
      "- PRD·Policy·Architecture를 독립 리뷰 전에 확인하고 cached diff·candidate tree를 검토한다.",
      "- review-fix 사이에는 고정 게이트 전체를 실행하지 않는다. 계획된 수정이 없으면 현재 `AGENTS.md` 고정 게이트 전체를 한 번 실행한다.",
      "- tracked content가 바뀌면 행동·리뷰·게이트 증거를 폐기하고 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 다시 시작한다.",
      "- 동일 tree·input의 환경 전용 실패는 한 번만 복구한다.",
      "- 의미 영향·리뷰 증거가 불완전하면 새 리뷰부터, 최종 gate 증거만 불완전하면 gate부터 복구하고 candidate tree나 input이 다르면 모든 증거를 무효화하고 빠른 행동 테스트, 영향 판정과 독립 리뷰부터 다시 시작한다.",
      "",
    ].join("\n"),
  );
  write(
    root,
    developmentFiles[0],
    [
      "# 개발 하네스 가이드",
      "",
      "Claude Code와 Codex가 공유하는 단일 orchestrator 인덱스다.",
      "",
      ...developmentOverview,
      ...harnessRouting,
      ...harnessOwnership,
      ...finalSnapshotOrderFixture,
      ...finalSnapshotRecoveryFixture,
      ...Array.from({ length: 11 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        const projectCondition =
          number === "02"
            ? " Project 관리 이슈인 경우 Project 상태 Todo도 확인한다."
            : number === "03"
              ? " Project 관리 이슈인 경우 Project 상태 In Progress도 확인한다."
              : "";
        return [
          `## STEP ${number}. 작업 단계`,
          "",
          `- **목적:** ${number}단계의 목적을 확인한다.`,
          `- **핵심 입력:** ${number}단계 입력 계약`,
          `- **완료 조건:** ${number}단계 증거가 남는다.${projectCondition}`,
          `- **대표 실패·중단 조건:** ${number}단계 입력이나 증거가 없다.`,
          "",
        ].join("\n");
      }),
    ].join("\n"),
  );
  write(
    root,
    developmentFiles[1],
    [
      "# 테스트 표준",
      "",
      ...developmentOverview,
      "## 테스트 계층",
      "",
      "요구사항에 맞는 가장 낮은 비용의 테스트 계층을 선택한다.",
      "",
    ].join("\n"),
  );

  for (const [index, skillDirectory] of skillDirectories.entries()) {
    const skillName = path.basename(skillDirectory);
    const contract =
      skillName === "update-product-docs"
        ? updateProductDocsFixtureContract
        : skillName === "run-github-work-item"
          ? runGithubWorkItemFixtureContract
          : skillName === "commit-work-item"
            ? commitWorkItemFixtureContract
            : skillName === "open-pull-request"
              ? openPullRequestFixtureContract
              : [];
    write(
      root,
      `${skillDirectory}/SKILL.md`,
      [
        "---",
        `name: ${path.basename(skillDirectory)}`,
        `description: 검증 fixture에서 사용하는 Skill ${index + 1}`,
        "---",
        "",
        `# 검증용 Skill ${index + 1}`,
        "",
        ...contract,
        "",
      ].join("\n"),
    );
    write(
      root,
      `${skillDirectory}/agents/openai.yaml`,
      [
        "interface:",
        `  display_name: "검증 Skill ${index + 1}"`,
        '  short_description: "검증 fixture에서 사용하는 Skill"',
        '  default_prompt: "이 Skill의 검증 계약을 실행해 주세요."',
        "",
      ].join("\n"),
    );
  }
  write(
    root,
    ".agents/skills/run-github-work-item/references/issue-contract.md",
    "# GitHub 이슈 계약\n\n제품 추적 적용 경계를 정의한다.\n",
  );
  write(
    root,
    ".agents/skills/commit-work-item/references/commit-contract.md",
    commitContractFixture.join("\n"),
  );
  write(
    root,
    ".agents/skills/open-pull-request/references/pr-body-contract.md",
    prBodyContractFixture.join("\n"),
  );
  write(
    root,
    ".github/workflows/validate-harness-paths.mjs",
    "#!/usr/bin/env node\n",
  );
  write(
    root,
    ".github/workflows/validate-harness-paths.test.mjs",
    "import test from \"node:test\";\ntest(\"fixture\", () => {});\n",
  );
  write(
    root,
    ".agents/skills/update-product-docs/scripts/product-contract-ids.mjs",
    "export const fixture = true;\n",
  );
  write(
    root,
    ".agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
    "import test from \"node:test\";\ntest(\"fixture\", () => {});\n",
  );
  write(
    root,
    ".agents/skills/open-pull-request/scripts/validate-finalize.mjs",
    "#!/usr/bin/env node\n",
  );
  write(
    root,
    ".agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
    "import test from \"node:test\";\ntest(\"fixture\", () => {});\n",
  );
  write(
    root,
    ".agents/skills/open-pull-request/scripts/finalize-merge.mjs",
    "#!/usr/bin/env node\n",
  );
  write(
    root,
    ".agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
    "import test from \"node:test\";\ntest(\"fixture\", () => {});\n",
  );
  write(
    root,
    ".github/workflows/validate-harness.yml",
    [
      "name: fixture",
      "on:",
      "  workflow_dispatch:",
      "  schedule:",
      "    - cron: \"17 18 * * 0\"",
      "jobs:",
      "  classify:",
      "    outputs:",
      "      full: ${{ steps.paths.outputs.full }}",
      "      product_docs: ${{ steps.paths.outputs.product_docs }}",
      "      work_item: ${{ steps.paths.outputs.work_item }}",
      "      commit_pr: ${{ steps.paths.outputs.commit_pr }}",
      "      finalize: ${{ steps.paths.outputs.finalize }}",
      "    steps:",
      "      - id: paths",
      "        run: |",
      "          node .github/workflows/validate-harness-paths.mjs \\",
      "            --event \"$GITHUB_EVENT_NAME\" \\",
      "            --base \"$BASE_SHA\" \\",
      "            --head \"$HEAD_SHA\" \\",
      "            --output \"$GITHUB_OUTPUT\"",
      "  harness:",
      "    steps:",
      "      - run: |",
      "          node --check .github/workflows/validate-harness-paths.mjs",
      "          node --check .github/workflows/validate-harness-paths.test.mjs",
      "          node --test .github/workflows/validate-harness-paths.test.mjs",
      "          node --check .agents/skills/update-product-docs/scripts/product-contract-ids.mjs",
      "          node --check .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      "          node --check .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs",
      "          node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs \\",
      "            --index",
      "          node --check .agents/skills/open-pull-request/scripts/validate-finalize.mjs",
      "          node --check .agents/skills/open-pull-request/scripts/finalize-merge.mjs",
      "  product-docs-regression:",
      "    needs: classify",
      "    if: ${{ needs.classify.outputs.product_docs == 'true' }}",
      "    steps:",
      "      - run: node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      "  work-item-regression:",
      "    needs: classify",
      "    if: ${{ needs.classify.outputs.work_item == 'true' }}",
      "    steps:",
      "      - run: node --test .agents/skills/run-github-work-item/scripts/work-item.test.mjs",
      "  commit-pr-regression:",
      "    needs: classify",
      "    if: ${{ needs.classify.outputs.commit_pr == 'true' }}",
      "    steps:",
      "      - run: node --test .agents/skills/commit-work-item/scripts/validate-commit-paths.test.mjs",
      "  finalize-regression:",
      "    needs: classify",
      "    if: ${{ needs.classify.outputs.finalize == 'true' }}",
      "    steps:",
      "      - run: |",
      "          node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
      "          node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
      "  validate:",
      "    if: ${{ always() }}",
      "    needs:",
      "      - classify",
      "      - harness",
      "      - product-docs",
      "      - patch-whitespace",
      "      - product-docs-regression",
      "      - work-item-regression",
      "      - commit-pr-regression",
      "      - finalize-regression",
      "    steps:",
      "      - env:",
      "          CLASSIFY_RESULT: ${{ needs.classify.result }}",
      "          HARNESS_RESULT: ${{ needs.harness.result }}",
      "          PRODUCT_DOCS_RESULT: ${{ needs.product-docs.result }}",
      "          PATCH_WHITESPACE_RESULT: ${{ needs.patch-whitespace.result }}",
      "          FULL_SELECTED: ${{ needs.classify.outputs.full }}",
      "          PRODUCT_DOCS_SELECTED: ${{ needs.classify.outputs.product_docs }}",
      "          WORK_ITEM_SELECTED: ${{ needs.classify.outputs.work_item }}",
      "          COMMIT_PR_SELECTED: ${{ needs.classify.outputs.commit_pr }}",
      "          FINALIZE_SELECTED: ${{ needs.classify.outputs.finalize }}",
      "          PRODUCT_DOCS_REGRESSION_RESULT: ${{ needs.product-docs-regression.result }}",
      "          WORK_ITEM_REGRESSION_RESULT: ${{ needs.work-item-regression.result }}",
      "          COMMIT_PR_REGRESSION_RESULT: ${{ needs.commit-pr-regression.result }}",
      "          FINALIZE_REGRESSION_RESULT: ${{ needs.finalize-regression.result }}",
      "        run: |",
      "          node .github/workflows/validate-harness-paths.mjs \\",
      "            --verify-results",
      "",
    ].join("\n"),
  );

  write(
    root,
    "docs/prd/100_future.md",
    [
      "# PRD-100. 향후 기능",
      "",
      "| 항목 | 값 |",
      "|---|---|",
      "| 의사결정 상태 | `approved` |",
      "| 전달 상태 | `planned` |",
      "| 책임자 | 제품 책임자 |",
      "| 마지막 검토 | 2026-07-24 |",
      "| 관련 결정 | D-100 |",
      "| 관련 정책 | POL-100 |",
      "",
      "## 1. 성공 기준",
      "",
      "| 지표 | 기준선 | 목표 | 측정 기간 | 출처 | 가드레일 |",
      "|---|---|---|---|---|---|",
      "| 성공 | 측정 필요 | 파일럿에서 결정 | 파일럿 기간 | 테스트 기록 | 오류 증가 없음 |",
      "",
      "## 2. 기능 요구사항",
      "",
      "### PRD-100-FR-100. 관찰 가능한 결과",
      "",
      "사용자가 결과를 확인한다.",
      "",
      "### PRD-100-FR-101. 추가 결과",
      "",
      "사용자가 추가 결과를 확인한다.",
      "",
      "## 3. 수용 기준",
      "",
      "### PRD-100-AC-100. 수용된 결과",
      "",
      "- 조건: 입력이 있다.",
      "- 행동: 동작한다.",
      "- 결과: 결과가 보인다.",
      "",
      "### PRD-100-AC-101. 추가 수용 결과",
      "",
      "- 조건: 추가 입력이 있다.",
      "- 행동: 추가 동작을 수행한다.",
      "- 결과: 추가 결과가 보인다.",
      "",
      "## 4. 기술 검증",
      "",
      "| 기술 검증 | 질문 | 결과 |",
      "|---|---|---|",
      "| PRD-100-SP-100 탐색 | 가능한가? | 근거를 남긴다. |",
      "",
      "## 5. 추적",
      "",
      "### 요구사항 추적 매트릭스",
      "",
      "| 요구사항 | 수용 기준 | 정책 규칙 |",
      "|---|---|---|",
      "| PRD-100-FR-100 | PRD-100-AC-100 | POL-100-R-100 |",
      "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |",
      "",
    ].join("\n"),
  );

  write(
    root,
    "docs/policies/100_future.md",
    [
      "# POL-100. 향후 규칙",
      "",
      "| 항목 | 값 |",
      "|---|---|",
      "| 의사결정 상태 | `approved` |",
      "| 책임자 | 제품 책임자 |",
      "| 마지막 검토 | 2026-07-24 |",
      "| 관련 PRD | PRD-100 |",
      "| 관련 결정 | D-100 |",
      "",
      "## POL-100-R-100. 필수 동작",
      "",
      "시스템은 결과를 보여야 한다.",
      "",
      "## POL-100-R-101. 추가 동작",
      "",
      "시스템은 추가 결과를 보여야 한다.",
      "",
      "## 추적성",
      "",
      "| 정책 규칙 | PRD 요구사항 | 수용 기준 | 관련 결정 |",
      "|---|---|---|---|",
      "| POL-100-R-100 | PRD-100-FR-100 | PRD-100-AC-100 | D-100 |",
      "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |",
      "",
    ].join("\n"),
  );

  return root;
}

function runValidator(root) {
  return spawnSync(process.execPath, [validatorPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 2_000,
  });
}

function withFixture(run) {
  const root = createFixture();
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function mutateH2Section(content, heading, mutate) {
  const marker = `## ${heading}`;
  const start = content.indexOf(marker);
  assert.notEqual(start, -1, `fixture heading missing: ${heading}`);
  const next = content.indexOf("\n## ", start + marker.length);
  const end = next < 0 ? content.length : next + 1;
  return (
    content.slice(0, start) +
    mutate(content.slice(start, end)) +
    content.slice(end)
  );
}

function canonicalOwnerLink(documentFile, owner) {
  const target = path
    .relative(path.dirname(documentFile), owner.file)
    .split(path.sep)
    .join("/");
  return `[${owner.name}](${target})`;
}

function writeFeatureScope(root, values) {
  write(
    root,
    "docs/product-definition/06_feature_inventory.md",
    [
      "# 기능 원장",
      "",
      "| F-ID | 설명 |",
      "| --- | --- |",
      "| F-01 | 기준 기능 |",
      "",
    ].join("\n"),
  );
  write(
    root,
    "docs/product-definition/09_scope_proposal.md",
    [
      "# 범위 제안",
      "",
      "| 분류 | 기능 |",
      "| --- | --- |",
      ...values.map((value) => `| 확정 MVP | ${value} |`),
      "",
    ].join("\n"),
  );
}

test("세 자리 문서·계약 ID를 허용한다", () => {
  withFixture((root) => {
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /제품 문서 검증 통과/);
  });
});

test("필수 개발 표준 문서 두 개와 지정된 디렉터리 구성을 요구한다", () => {
  for (const file of developmentFiles) {
    withFixture((root) => {
      fs.unlinkSync(path.join(root, file));
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`필수 개발 표준 문서가 없습니다: ${file}`),
        result.stderr,
      );
    });
  }

  withFixture((root) => {
    write(root, "docs/development/README.md", "# 불필요한 인덱스\n");
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /지정된 두 문서만.*docs\/development\/README\.md/,
    );
  });
});

test("개발 표준 문서는 첫 H2의 첫 자료로 Mermaid flowchart를 요구한다", () => {
  const cases = [
    {
      replace: "## 한눈에 보기",
      replacement: "## 문서 목적",
      message: /개발 표준 문서의 첫 H2는 '## 한눈에 보기'/,
    },
    {
      replace: "## 한눈에 보기\n\n```mermaid",
      replacement:
        "## 한눈에 보기\n\n설명부터 시작한다.\n\n```mermaid",
      message: /첫 자료는 Mermaid fenced block/,
    },
    {
      replace: [
        "flowchart LR",
        "    A[입력] --> B[검증] --> C[완료]",
      ].join("\n"),
      replacement: [
        "sequenceDiagram",
        "    A->>B: 검증 요청",
      ].join("\n"),
      message: /유효한 방향을 가진 flowchart/,
    },
    {
      replace: "flowchart LR",
      replacement: "flowchart LRjunk",
      message: /유효한 방향을 가진 flowchart/,
    },
    {
      replace: "flowchart LR",
      replacement: "flowchart ZZ",
      message: /유효한 방향을 가진 flowchart/,
    },
  ];

  for (const { replace, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[1]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(replace, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("개발 표준 Mermaid 직후에는 direct bullet 요약 3~5개가 필요하다", () => {
  const originalBullets = [
    "- 입력 정본을 먼저 확인한다.",
    "- 검증 증거를 실행 결과로 남긴다.",
    "- 실패 조건에서는 다음 단계로 진행하지 않는다.",
  ].join("\n");
  const replacements = [
    [
      "- 입력 정본을 먼저 확인한다.",
      "- 검증 증거를 실행 결과로 남긴다.",
    ].join("\n"),
    Array.from({ length: 6 }, (_, index) => `- 개발 요약 ${index + 1}`).join(
      "\n",
    ),
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[1]);
      fs.writeFileSync(
        target,
        fs
          .readFileSync(target, "utf8")
          .replace(originalBullets, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /top-level bullet 요약이 3~5개/);
    });
  }
});

test("하네스 가이드는 STEP 01~11을 각각 한 번 정확한 순서로 요구한다", () => {
  const cases = [
    {
      mutate: (content) =>
        content.replace("## STEP 05. 작업 단계", "## 다섯 번째 작업 단계"),
      messages: [/'## STEP 05\.' 섹션이 정확히 하나.*현재 0개/],
    },
    {
      mutate: (content) =>
        content.replace("## STEP 05. 작업 단계", "## STEP 04. 중복 단계"),
      messages: [
        /'## STEP 04\.' 섹션이 정확히 하나.*현재 2개/,
        /'## STEP 05\.' 섹션이 정확히 하나.*현재 0개/,
      ],
    },
    {
      mutate: (content) =>
        content
          .replace("## STEP 04. 작업 단계", "## STEP XX. 임시 단계")
          .replace("## STEP 05. 작업 단계", "## STEP 04. 작업 단계")
          .replace("## STEP XX. 임시 단계", "## STEP 05. 작업 단계"),
      messages: [/정확한 순서와 형식/],
    },
  ];

  for (const { mutate, messages } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(target, mutate(fs.readFileSync(target, "utf8")));
      const result = runValidator(root);
      assert.equal(result.status, 1);
      for (const message of messages) {
        assert.match(result.stderr, message);
      }
    });
  }
});

test("각 STEP은 네 direct 필드를 하나씩 비어 있지 않게 요구한다", () => {
  const field = "- **목적:** 01단계의 목적을 확인한다.";
  const cases = [
    {
      replacement: "목적은 01단계를 확인하는 것이다.",
      message: /현재 0개/,
    },
    {
      replacement: `${field}\n${field}`,
      message: /현재 2개/,
    },
    {
      replacement: "- **목적:**",
      message: /현재 1개/,
    },
    {
      replacement: [
        "- 상위 항목",
        "  - **목적:** nested item은 direct item이 아니다.",
      ].join("\n"),
      message: /현재 0개/,
    },
  ];

  for (const { replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(field, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /STEP 01.*'- \*\*목적:\*\*'/);
      assert.match(result.stderr, message);
    });
  }

  for (const fieldName of harnessFields) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      const content = fs
        .readFileSync(target, "utf8")
        .replace(
          new RegExp(
            `^- \\*\\*${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\*\\*.*$`,
            "m",
          ),
          `- ${fieldName}: 형식이 다르다.`,
        );
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`- **${fieldName}:**`), result.stderr);
    });
  }
});

test("STEP에는 지정된 네 direct item 외의 자료를 둘 수 없다", () => {
  const field = "- **목적:** 01단계의 목적을 확인한다.";
  for (const replacement of [
    `${field}\n- **주의:** 별도 direct item`,
    `${field}\n\n별도 visible prose`,
    `${field}\n\n\`\`\`text\n별도 fenced 자료\n\`\`\``,
  ]) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(field, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /지정된 네 direct item 외의 visible material/);
    });
  }
});

test("parent list가 없는 1~3칸 들여쓰기 STEP bullet은 top-level로 허용한다", () => {
  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    const content = fs.readFileSync(target, "utf8").replace(
      /(## STEP 01\.[^\n]*\n)([\s\S]*?)(?=## STEP 02\.)/,
      (_, heading, section) =>
        `${heading}${section.replace(/^- /gm, "  - ")}`,
    );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("최종 snapshot 검증 순서와 recovery 표의 정상 fixture를 허용한다", () => {
  withFixture((root) => {
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("최종 저장소 게이트는 정본 영향과 독립 리뷰 뒤에만 올 수 있다", () => {
  const cases = [
    {
      first: finalSnapshotOrderFixture.find((line) =>
        line.startsWith("| 4 |"),
      ),
      second: finalSnapshotOrderFixture.find((line) =>
        line.startsWith("| 5 |"),
      ),
    },
    {
      first: finalSnapshotOrderFixture.find((line) =>
        line.startsWith("| 2 |"),
      ),
      second: finalSnapshotOrderFixture.find((line) =>
        line.startsWith("| 5 |"),
      ),
    },
  ];

  for (const { first, second } of cases) {
    assert.ok(first);
    assert.ok(second);
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content
          .replace(first, "__ORDER_FIRST__")
          .replace(second, first)
          .replace("__ORDER_FIRST__", second),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /exact 7행/);
    });
  }
});

test("최종 게이트는 병렬·공유 자원 순차·join·전후 동일성 계약을 모두 요구한다", () => {
  const cases = [
    {
      source: "독립된 읽기 전용·격리 명령만 병렬 실행하고",
      replacement: "모든 명령을 실행하고",
      message: /격리 명령만 병렬/,
    },
    {
      source:
        "같은 index·working tree·외부 상태·공유 cache·자원을 쓰는 명령은 순차 실행한 뒤",
      replacement: "공유 명령도 동시에 실행한 뒤",
      message: /공유 명령은 순차·join/,
    },
    {
      source: "모든 결과를 join한다.",
      replacement: "먼저 끝난 결과만 확인한다.",
      message: /공유 명령은 순차·join/,
    },
    {
      source:
        "검증 전후 candidate tree와 gate input은 같아야 한다.",
      replacement: "검증 뒤 결과만 확인한다.",
      message: /검증 전후 candidate tree·input 동일/,
    },
  ];

  for (const { source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(source, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("최종 snapshot 표는 숨긴 H2와 비가시 계약 cell을 거부한다", () => {
  const hiddenSectionWrappers = [
    ["<details>\n", "</details>\n"],
    ["<details>\n\n", "</details>\n"],
    [
      "<details><summary>숨김</summary>\n\n",
      "</details>\n",
    ],
    ["<div>\n\n", "</div>\n"],
    ["<center hidden>\n\n", "</center>\n"],
    ["<x-contract hidden>\n\n", "</x-contract>\n"],
    ["<center hidden>\n\n", ""],
    ["<x-contract hidden>\n\n", ""],
  ];

  for (const [opening, closing] of hiddenSectionWrappers) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          "최종 snapshot 검증 순서",
          (section) => `${opening}${section}${closing}`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /최종 snapshot 검증 순서.*exact plain-text top-level H2/,
      );
    });
  }

  const contract =
    "독립 리뷰 전에 PRD·Policy·Architecture 의미 영향";
  const replacements = [
    `[계약 없음](<${contract}>)`,
    `[계약 없음][${contract}]`,
    `<span data-contract="${contract}">계약 없음</span>`,
    `<details>${contract}</details>`,
    `<center hidden>${contract}</center>`,
    `<x-contract hidden>${contract}</x-contract>`,
    `계약 없음\n    ${contract}`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(contract));
      fs.writeFileSync(
        target,
        content.replace(contract, replacement),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /(?:정본 의미 영향.*필수 계약이 없습니다|exact 7행|raw HTML)/,
      );
    });
  }

  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    const content = fs.readFileSync(target, "utf8");
    const recoveryContract =
      "새 candidate의 행동 테스트·의미 영향 판정·독립 리뷰부터 다시 시작한다.";
    assert.ok(content.includes(recoveryContract));
    fs.writeFileSync(
      target,
      content.replace(
        recoveryContract,
        `[계약 없음](<${recoveryContract}>)`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /candidate tree·input 불일치.*재진입 계약이 불완전/,
    );
  });
});

test("content 변경과 동일 tree·input 환경 실패는 서로 다른 recovery를 요구한다", () => {
  const cases = [
    {
      source:
        "새 candidate에서 행동 테스트와 PRD·Policy·Architecture 의미 영향 판정 뒤 독립 리뷰부터 다시 시작한다.",
      replacement: "실패한 gate만 다시 실행한다.",
      message: /tracked content 변경.*재진입 계약이 불완전/,
    },
    {
      source:
        "원인과 동일 tree·input 근거를 기록하고 새 명령을 한 번만 실행한다. 자동 반복하지 않는다.",
      replacement: "성공할 때까지 자동 재시도한다.",
      message: /환경 전용 실패·동일 tree·input.*재진입 계약이 불완전/,
    },
  ];

  for (const { source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(source, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("local evidence 재사용은 연속 tree 결속과 remote required CI를 요구한다", () => {
  const cases = [
    {
      source: "candidate tree와 commit tree가 같고 증거가 완전하면",
      replacement: "commit이 만들어지면",
      message: /동일 tree의 완전한 로컬 증거 인계/,
    },
    {
      source: "commit tree와 PR head tree가 같을 때",
      replacement: "PR이 열리면",
      message: /동일 tree의 로컬 증거 재사용과 원격 CI 유지/,
    },
    {
      source:
        "같은 candidate·input에서 PRD·Policy·Architecture 의미 영향 판정과 새 독립 리뷰를 수행한 뒤 최종 게이트로 진행한다.",
      replacement: "gate만 다시 실행한다.",
      message: /의미 영향·리뷰 증거 불완전·동일 tree·input.*재진입 계약이 불완전/,
    },
    {
      source:
        "exact candidate·input을 동일한 clean snapshot에 재구성하고 현재 `AGENTS.md` 고정 게이트 전체를 새로 실행한다.",
      replacement: "이전 gate 증거를 사용한다.",
      message: /최종 gate 증거 불완전·동일 tree·input.*재진입 계약이 불완전/,
    },
    {
      source:
        "다른 tree나 input에 gate만 실행하지 않고 새 candidate의 행동 테스트·의미 영향 판정·독립 리뷰부터 다시 시작한다.",
      replacement:
        "다른 tree에만 gate를 실행하지 않고 새 candidate의 행동 테스트·의미 영향 판정·독립 리뷰부터 다시 시작한다.",
      message: /candidate tree·input 불일치.*재진입 계약이 불완전/,
    },
  ];

  for (const { source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(source, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("관련 owner 문서는 최종 snapshot 실행·복구·재사용 경계를 유지한다", () => {
  const cases = [
    {
      file: "AGENTS.md",
      source: "tracked content",
      replacement: "tracked 변경",
    },
    {
      file: "AGENTS.md",
      source: "빠른 행동 테스트",
      replacement: "이전 행동 증거",
    },
    {
      file: "CONTRIBUTING.md",
      source: "review-fix 사이",
      replacement: "수정 사이",
    },
    {
      file: "CONTRIBUTING.md",
      source: "빠른 행동 테스트",
      replacement: "이전 행동 증거",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      source: "PRD·Policy·Architecture 의미 영향 판정",
      replacement: "정본 영향 판정",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      source: "빠른 행동 테스트와 의미 영향 판정",
      replacement: "이전 행동 증거와 의미 영향 판정",
    },
    {
      file: ".agents/skills/run-github-work-item/SKILL.md",
      source: "빠른 행동 테스트",
      replacement: "일반 작업",
    },
    {
      file: ".agents/skills/commit-work-item/SKILL.md",
      source: "빠른 행동 테스트",
      replacement: "일반 테스트",
    },
    {
      file: ".agents/skills/commit-work-item/SKILL.md",
      source: "commit path gate 증거",
      replacement: "path 증거",
    },
    {
      file: ".agents/skills/commit-work-item/SKILL.md",
      source: "빠른 행동 테스트부터 새 candidate",
      replacement: "이전 행동 증거로 새 candidate",
    },
    {
      file:
        ".agents/skills/commit-work-item/references/commit-contract.md",
      source: "PR head tree",
      replacement: "PR 상태",
    },
    {
      file:
        ".agents/skills/commit-work-item/references/commit-contract.md",
      source: "commit path gate 증거",
      replacement: "path 증거",
    },
    {
      file:
        ".agents/skills/commit-work-item/references/commit-contract.md",
      source: "빠른 행동 테스트, 의미 영향 판정",
      replacement: "이전 행동 증거, 의미 영향 판정",
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "required CI는 항상 통과해야 한다",
      replacement: "remote check",
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "새 candidate의 빠른 행동 테스트",
      replacement: "새 candidate의 이전 행동 증거",
    },
    {
      file:
        ".agents/skills/open-pull-request/references/pr-body-contract.md",
      source: "GitHub required CI",
      replacement: "GitHub check",
    },
    {
      file:
        ".agents/skills/open-pull-request/references/pr-body-contract.md",
      source: "빠른 행동 테스트, 의미 영향 판정",
      replacement: "이전 행동 증거, 의미 영향 판정",
    },
  ];

  for (const { file, source, replacement } of cases) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(source), `${file}: ${source}`);
      fs.writeFileSync(target, content.replace(source, replacement));
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /최종 snapshot 검증 계약이 없습니다/);
    });
  }
});

test("최종 snapshot owner 계약은 비가시·비규범 source로 대체할 수 없다", () => {
  const visibleContract = commitContractFixture.slice(4, 8).join("\n");
  const compactContract = visibleContract.replaceAll("\n", " ");
  for (const [opening, closing] of [
    ["<details>\n\n", "</details>\n"],
    [
      "<details><summary>숨김</summary>\n\n",
      "</details>\n",
    ],
    ["<div>\n\n", "</div>\n"],
    ["<center hidden>\n\n", "</center>\n"],
    ["<x-contract hidden>\n\n", "</x-contract>\n"],
    ["<center hidden>\n\n", ""],
    ["<x-contract hidden>\n\n", ""],
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/commit-work-item/references/commit-contract.md",
      );
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          "5. 검증 증거",
          (section) => `${opening}${section}${closing}`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /commit-contract\.md: 최종 snapshot 계약 owner 구역은 exact plain-text top-level H2/,
      );
    });
  }

  const replacements = [
    [
      "<details>",
      "<summary>숨김</summary>",
      visibleContract,
      "</details>",
    ].join("\n"),
    visibleContract
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    `<div data-contract="${compactContract}">숨김</div>`,
    `[숨김](<${compactContract}>)`,
    `<center hidden>\n\n${visibleContract}\n</center>`,
    `<x-contract hidden>\n\n${visibleContract}\n</x-contract>`,
    `<center hidden>${compactContract}</center>`,
    `<x-contract hidden>${compactContract}</x-contract>`,
    `앞 문장 <center hidden>${compactContract}</center> 뒤`,
    `앞 문장 <x-contract hidden>${compactContract}</x-contract> 뒤`,
    `앞 문장 <x-contract style="display:none">${compactContract}</x-contract> 뒤`,
    `앞 문장 <x-contract style='visibility: hidden'>${compactContract}`,
    `앞 문장 <span style=display:none>${compactContract}`,
    `앞 문장 <x-contract style=visibility:hidden>${compactContract}`,
    `<center hidden>\n\n${visibleContract}`,
    `<x-contract hidden>\n\n${visibleContract}`,
    `앞 문장 <x-contract hidden>${compactContract}`,
    `[숨김](\`${compactContract}\`)`,
    `[숨김](https://example.invalid "\`${compactContract}\`")`,
    `[숨김](https://example.invalid "제목 ) \`${compactContract}\`")`,
    `[숨김](https://example.invalid '제목 ) \`${compactContract}\`')`,
    `[숨김](https://example.invalid/\`x "제목 ) ${compactContract}\`")`,
    `[숨김]: \`${compactContract}\``,
    `![\`${compactContract}\`](image.png)`,
    `<img alt="\`${compactContract}\`">`,
    `<div\n${visibleContract}`,
    `<div></div>\n${visibleContract}`,
    `<?숨김\n${visibleContract}\n?>`,
    `<!DECLARATION\n${visibleContract}\n>`,
    `<![CDATA[\n${visibleContract}\n]]>`,
    [
      "> <?숨김",
      ...visibleContract.split("\n").map((line) => `> ${line}`),
      "> ?>",
    ].join("\n"),
    [
      "- <!DECLARATION",
      ...visibleContract.split("\n").map((line) => `  ${line}`),
      "  >",
    ].join("\n"),
    [
      "- <![CDATA[",
      ...visibleContract.split("\n").map((line) => `  ${line}`),
      "  ]]>",
    ].join("\n"),
    "\\`<x-contract hidden>" +
      compactContract +
      "</x-contract>\\`",
    `<script\n${visibleContract}`,
    `<pre\n${visibleContract}`,
    `<style\n${visibleContract}`,
    `<textarea\n${visibleContract}`,
    `<x-contract />\n${visibleContract}`,
    `계약 없음\n\n## 무관한 구역\n\n${visibleContract}`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/commit-work-item/references/commit-contract.md",
      );
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(visibleContract));
      fs.writeFileSync(
        target,
        content.replace(visibleContract, replacement),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /commit-contract\.md: '5\. 검증 증거'에 최종 snapshot 검증 계약이 없습니다/,
      );
    });
  }
});

test("하네스 가이드는 요청 라우팅과 단일 규칙 소유 인덱스를 요구한다", () => {
  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace("## 요청 라우팅", "## 요청 분류"),
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /'## 요청 라우팅' 섹션이 정확히 하나/);
  });

  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace("on-demand 이슈 생성은 11단계 밖", "이슈 생성"),
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /on-demand 11단계 밖 작업/);
  });

  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace(
          "한 규칙에는 세부 정본 소유자를 하나만 둔다.",
          "규칙을 여러 문서에 적는다.",
        ),
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /세부 정본 소유자를 하나만/);
  });

  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace(
          "Project 관리 이슈인 경우 Project 상태 Todo도 확인한다.",
          "모든 이슈에서 Project 상태 Todo를 확인한다.",
        ),
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /STEP 02은 Project 상태 Todo를.*조건부/);
  });
});

test("라우팅 문서는 top-level 목록·표·fence와 inline code를 허용한다", () => {
  for (const { file } of harnessRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, file);
      fs.appendFileSync(
        target,
        [
          "",
          "## strict 문법 허용 fixture",
          "",
          "- top-level 목록",
          "",
          "| 열 | 값 |",
          "|---|---|",
          "| inline code | `<span>안전한 예시</span>` |",
          "",
          "```html",
          "<div>fenced example</div>",
          "```",
          "",
        ].join("\n"),
      );

      const result = runValidator(root);
      assert.equal(result.status, 0, `${file}\n${result.stderr}`);
    });
  }
});

test("세 라우팅 문서는 모호하거나 숨길 수 있는 Markdown 문법을 fail-closed한다", () => {
  const cases = [
    {
      block: "\r\nCR",
      message: /CR line ending/,
    },
    {
      block: "\tindented",
      message: /tab/,
    },
    {
      block: "> quote",
      message: /raw HTML·autolink·blockquote/,
    },
    {
      block: "- > nested quote",
      message: /raw HTML·autolink·blockquote/,
    },
    {
      block: "[owner]: README.md",
      message: /reference 정의/,
    },
    {
      block: "[owner][target]",
      message: /reference-style·shortcut link/,
    },
    {
      block: "[owner][]",
      message: /reference-style·shortcut link/,
    },
    {
      block: "[owner]",
      message: /reference-style·shortcut link/,
    },
    {
      block: "setext heading\n---",
      message: /setext heading·thematic break/,
    },
    {
      block: "<span>raw HTML</span>",
      message: /raw HTML·autolink·blockquote/,
    },
    {
      block: "<!-- hidden contract -->",
      message: /raw HTML·autolink·blockquote/,
    },
    {
      block: "`unclosed inline code",
      message: /inline code span이 종결되지 않았습니다/,
    },
    {
      block: "\\`<span>escaped delimiter</span>\\`",
      message: /escaped backtick/,
    },
    {
      block: "`multi\nline inline code`",
      message: /inline code span은 한 줄 안에서 종결/,
    },
    {
      block: "```lang`invalid\ntext\n```",
      message: /backtick fence info/,
    },
    {
      block: "~~~text\nunclosed fence",
      message: /fenced code block이 종결되지 않았습니다/,
    },
    {
      block: "- ## nested heading",
      message: /list container 안에 heading/,
    },
    {
      block: '[link](README.md "title")',
      message: /공백·괄호·title이 없는 한 줄 canonical target/,
    },
    {
      block: "[link](README(1).md)",
      message: /공백·괄호·title이 없는 한 줄 canonical target/,
    },
    {
      block: "  ## indented heading",
      message: /들여쓴 ATX heading/,
    },
    {
      block: "## closing heading ##",
      message: /closing # sequence/,
    },
  ];

  for (const { file } of harnessRoutingDocuments) {
    for (const { block, message } of cases) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## strict 문법 거부 fixture\n\n${block}\n`,
        );

        const result = runValidator(root);
        assert.equal(result.status, 1, `${file}: ${block}`);
        assert.match(result.stderr, message, `${file}: ${block}`);
      });
    }
  }
});

test("세 라우팅 구역은 두 canonical inline owner 링크를 각각 하나만 요구한다", () => {
  for (const document of harnessRoutingDocuments) {
    for (const owner of harnessDetailOwners) {
      const literal = canonicalOwnerLink(document.file, owner);
      const mutations = [
        () => "",
        () => literal.replace(`[${owner.name}]`, "[wrong-owner]"),
        () => literal.replace(/\([^)]+\)$/, "(README.md)"),
        () => `${literal} ${literal}`,
        () => `${literal} !${literal}`,
      ];

      for (const mutate of mutations) {
        withFixture((root) => {
          const target = path.join(root, document.file);
          const content = fs.readFileSync(target, "utf8");
          const changed = mutateH2Section(
            content,
            document.section,
            (section) => {
              assert.ok(
                section.includes(literal),
                `fixture owner link missing: ${literal}`,
              );
              return section.replace(literal, mutate());
            },
          );
          fs.writeFileSync(target, changed);

          const result = runValidator(root);
          assert.equal(result.status, 1, result.stderr);
          assert.match(
            result.stderr,
            /canonical inline owner 링크.*정확히 하나/,
          );
        });
      }
    }
  }
});

test("owner Skill의 symlink alias도 canonical 링크 중복으로 거부한다", () => {
  withFixture((root) => {
    const owner = harnessDetailOwners[0];
    const alias = "owner-alias.md";
    fs.symlinkSync(owner.file, path.join(root, alias));
    const target = path.join(root, "AGENTS.md");
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      mutateH2Section(
        content,
        "PR과 작업 완료",
        (section) => `${section}\n[alias](${alias})\n`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /canonical inline owner 링크.*정확히 하나/,
    );
  });
});

test("네 planned ID 라우팅 구역은 update-product-docs canonical owner 링크를 정확히 하나 요구한다", () => {
  for (const document of plannedIdRoutingDocuments) {
    const literal = canonicalOwnerLink(
      document.file,
      plannedIdDetailOwner,
    );
    const mutations = [
      () => "",
      () => literal.replace(
        "[update-product-docs]",
        "[wrong-owner]",
      ),
      () => literal.replace(/\([^)]+\)$/, "(README.md)"),
      () => `${literal} ${literal}`,
      () => `${literal} !${literal}`,
      () => `\`${literal}\``,
      () => literal.replace("[", "\\["),
    ];

    for (const mutate of mutations) {
      withFixture((root) => {
        const target = path.join(root, document.file);
        const content = fs.readFileSync(target, "utf8");
        const changed = mutateH2Section(
          content,
          document.section,
          (section) => {
            assert.ok(
              section.includes(literal),
              `fixture owner link missing: ${literal}`,
            );
            return section.replace(literal, mutate());
          },
        );
        fs.writeFileSync(target, changed);

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${document.file}: ${mutate()}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
        );
      });
    }
  }
});

test("top-level indented code의 planned ID owner 링크를 canonical 링크로 세지 않는다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const literal = canonicalOwnerLink(
        document.file,
        plannedIdDetailOwner,
      );
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          document.section,
          (section) =>
            section
              .split("\n")
              .map((line) =>
                line.includes(literal) ? `    ${line}` : line,
              )
              .join("\n"),
        ),
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${document.file}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
      );
    });
  }
});

test("container code·image metadata를 planned ID owner 링크 증거로 세지 않는다", () => {
  const document = plannedIdRoutingDocuments.find(
    ({ file }) => file === "README.md",
  );
  assert.ok(document, "README planned ID routing fixture missing");
  const literal = canonicalOwnerLink(
    document.file,
    plannedIdDetailOwner,
  );
  const mutations = [
    (line) => `>     ${line.trim()}`,
    (line) => `-     ${line.trim()}`,
    (line) =>
      line.replace(
        literal,
        `![owner image\n${literal}\n](https://example.com/owner.png)`,
      ),
    (line) =>
      `${line.replace(literal, "")}\n[hidden]: https://example.com "${literal}"`,
    () =>
      `- [hidden-owner]: https://example.com "${literal}"`,
    (line) => `-\t\t${line.trim()}`,
    (line) =>
      `- ~~~\n  ${line.trim()}`,
    (line) =>
      `\\\\![owner image\n${line.trim()}\n](https://example.com/owner.png)`,
  ];

  for (const [mutationIndex, mutate] of mutations.entries()) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          document.section,
          (section) =>
            section
              .split("\n")
              .map((line) =>
                line.includes(literal) ? mutate(line) : line,
              )
              .join("\n"),
        ),
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `mutation ${mutationIndex}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID owner 라우팅 구역에는/,
      );
    });
  }
});

test("planned ID owner Skill의 symlink alias도 canonical 링크 중복으로 거부한다", () => {
  withFixture((root) => {
    const alias = "planned-id-owner-alias.md";
    fs.symlinkSync(plannedIdDetailOwner.file, path.join(root, alias));
    const target = path.join(root, "AGENTS.md");
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      mutateH2Section(
        content,
        "구현과 충돌 방지",
        (section) => `${section}\n[alias](${alias})\n`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
    );
  });
});

test("balanced·escaped inline destination의 symlink owner alias도 canonical 링크 중복으로 거부한다", () => {
  for (const aliasLink of [
    "[owner alias](planned(alias).md)",
    "[owner alias](planned(alias).md \"title )\")",
    "[owner alias](planned\\(alias\\).md)",
  ]) {
    withFixture((root) => {
      const alias = "planned(alias).md";
      fs.symlinkSync(
        plannedIdDetailOwner.file,
        path.join(root, alias),
      );
      const target = path.join(root, "AGENTS.md");
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          "구현과 충돌 방지",
          (section) => `${section}\n${aliasLink}\n`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
        aliasLink,
      );
    });
  }
});

test("collapsed·shortcut reference로 숨긴 planned ID owner alias를 네 문서에서 거부한다", () => {
  for (const document of plannedIdRoutingDocuments) {
    for (const usage of ["[planned-owner][]", "[planned-owner]"]) {
      withFixture((root) => {
        const alias = "planned-id-owner-alias.md";
        fs.symlinkSync(
          plannedIdDetailOwner.file,
          path.join(root, alias),
        );
        const relativeAlias = path
          .relative(path.dirname(document.file), alias)
          .split(path.sep)
          .join("/");
        const target = path.join(root, document.file);
        const content = fs.readFileSync(target, "utf8");
        fs.writeFileSync(
          target,
          mutateH2Section(
            content,
            document.section,
            (section) =>
              `${section}\n${usage}\n\n[planned-owner]: ${relativeAlias}\n`,
          ),
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${document.file}: ${usage}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
        );
      });
    }
  }
});

test("구역 밖 전역 정의를 사용하는 shortcut owner alias도 네 문서에서 거부한다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const alias = "planned-id-owner-alias.md";
      fs.symlinkSync(
        plannedIdDetailOwner.file,
        path.join(root, alias),
      );
      const relativeAlias = path
        .relative(path.dirname(document.file), alias)
        .split(path.sep)
        .join("/");
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      const changed = mutateH2Section(
        content,
        document.section,
        (section) => `${section}\n[planned-owner]\n`,
      );
      fs.writeFileSync(
        target,
        `${changed}\n[planned-owner]: ${relativeAlias}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /PRD·Policy planned ID 수명주기.*canonical inline owner 링크.*정확히 하나/,
      );
    });
  }
});

test("container·multiline 전역 정의를 쓰는 shortcut owner alias도 거부한다", () => {
  for (const definition of [
    "> [planned-owner]: planned-id-owner-alias.md",
    "[planned-owner]:\n  planned-id-owner-alias.md",
  ]) {
    withFixture((root) => {
      const alias = "planned-id-owner-alias.md";
      fs.symlinkSync(
        plannedIdDetailOwner.file,
        path.join(root, alias),
      );
      const target = path.join(root, "README.md");
      const content = fs.readFileSync(target, "utf8");
      const changed = mutateH2Section(
        content,
        "제품 문서 갱신 절차",
        (section) => `${section}\n[planned-owner]\n`,
      );
      fs.writeFileSync(
        target,
        `${changed}\n## 다른 절\n\n${definition}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID owner 라우팅 구역에는 reference-style·collapsed·shortcut link usage/,
      );
    });
  }
});

test("planned ID owner 구역의 raw HTML alias를 네 문서에서 거부한다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          document.section,
          (section) =>
            `${section}\n<a href=\"owner-alias.md\">planned-owner</a>\n`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID owner 라우팅 구역에는 raw HTML·autolink/,
      );
    });
  }
});

test("raw HTML block으로 planned ID owner H2를 감출 수 없다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content.replace(
          `## ${document.section}`,
          `<script>\n## ${document.section}`,
        ) + "\n</script>\n",
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 라우팅 문서에는 code 밖의 raw HTML·autolink/,
      );
    });
  }
});

test("닫히지 않은 raw HTML block으로 planned ID owner H2를 감출 수 없다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content.replace(
          `## ${document.section}`,
          `<script\n## ${document.section}`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 라우팅 문서에는 code 밖의 raw HTML·autolink/,
      );
    });
  }
});

test("네 planned ID owner 라우팅 H2는 plain-text top-level에 정확히 하나여야 한다", () => {
  for (const document of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content.replace(
          `## ${document.section}`,
          `## ${document.section} 변경됨`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /planned ID owner 라우팅 구역은.*정확히 하나/,
      );
    });

    withFixture((root) => {
      const target = path.join(root, document.file);
      fs.appendFileSync(target, `\n## **${document.section}**\n`);

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /planned ID owner 라우팅 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("비정본 H2 source 변형으로 planned ID 라우팅 owner H2 중복을 숨길 수 없다", () => {
  for (const document of plannedIdRoutingDocuments) {
    const setextLabel =
      /^\d{1,9}[.)][ \t]+/.test(document.section)
        ? `[${document.section}](#duplicate)`
        : document.section;
    for (const alternateHeading of [
      `${setextLabel}\n---`,
      ` ## ${document.section}`,
      `  ## ${document.section}`,
      `   ## ${document.section}`,
      `##\t${document.section}`,
      `## ${document.section} ##`,
    ]) {
      withFixture((root) => {
        const target = path.join(root, document.file);
        fs.appendFileSync(
          target,
          `\n${alternateHeading}\n`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${document.file}: ${alternateHeading}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /planned ID owner 라우팅 구역은.*보호 후보 2개/,
        );
      });
    }
  }
});

test("README의 container-prefixed planned ID 라우팅 H2 중복을 숨길 수 없다", () => {
  const section = "제품 문서 갱신 절차";
  for (const alternateHeading of [
    `> ## ${section}`,
    `> -\t> ## ${section} ##`,
    `> ${section}\n> ---`,
    `- ${section}\n  ---`,
    `-\t${section}\n\t---`,
    `> - ${section}\n>   ---`,
    `> \`\`\`markdown\n> <!--\n> \`\`\`\n> ## ${section}`,
  ]) {
    withFixture((root) => {
      const target = path.join(root, "README.md");
      fs.appendFileSync(
        target,
        `\n## container heading fixture\n\n${alternateHeading}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${alternateHeading}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /README\.md: planned ID owner 라우팅 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("README YAML frontmatter의 owner 문구를 보호 H2 후보로 세지 않는다", () => {
  withFixture((root) => {
    const document = plannedIdRoutingDocuments.find(
      ({ file }) => file === "README.md",
    );
    assert.ok(document, "README routing document missing");
    const target = path.join(root, document.file);
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      `---\n${document.section}\n---\n${content}`,
    );

    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("bare CR fence로 README의 planned ID owner 링크를 숨길 수 없다", () => {
  withFixture((root) => {
    const target = path.join(root, "README.md");
    const content = fs.readFileSync(target, "utf8");
    const ownerParagraph = content
      .split("\n")
      .find((line) =>
        line.includes(
          "[update-product-docs](.agents/skills/update-product-docs/SKILL.md)",
        ),
      );
    assert.ok(ownerParagraph, "fixture owner paragraph missing");
    fs.writeFileSync(
      target,
      content.replace(
        ownerParagraph,
        `~~~text\r${ownerParagraph}\r~~~`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /README\.md: planned ID 라우팅 문서에는 CRLF가 아닌 bare CR 줄바꿈을 사용할 수 없습니다/,
    );
  });
});

test("planned ID 세부 계약은 네 라우팅 문서 전체에 복제할 수 없다", () => {
  for (const { file, section } of plannedIdRoutingDocuments) {
    for (const example of plannedIdDetailExamples) {
      withFixture((root) => {
        const target = path.join(root, file);
        const content = fs.readFileSync(target, "utf8");
        fs.writeFileSync(
          target,
          mutateH2Section(
            content,
            section,
            (ownerSection) =>
              `${ownerSection}\n${example.content}\n`,
          ),
        );

        const result = runValidator(root);
        assert.equal(result.status, 1, `${file}: ${example.content}`);
        assert.ok(
          result.stderr.includes(
            `planned ID 내부 상세 '${example.label}'`,
          ),
          result.stderr,
        );
      });
    }
  }
});

test("planned ID 세부 계약을 다른 H2로 옮겨도 whole-file 경계를 우회할 수 없다", () => {
  const detail = plannedIdDetailExamples[0];

  for (const { file } of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, file);
      fs.appendFileSync(
        target,
        `\n## 관련 참고\n\n${detail.content}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}\n${result.stderr}`);
      assert.ok(
        result.stderr.includes(
          `planned ID 내부 상세 '${detail.label}'`,
        ),
        result.stderr,
      );
    });
  }
});

test("HTML comment 분할과 fragment 역순으로 planned ID 상세 재복제를 숨길 수 없다", () => {
  for (const content of [
    "planned<!--detail--> ID의 namespace 번호와 일치하는 구체적 `NN_*.md`를 소유한다.",
    "`NN_*.md` 정본 파일을 소유하려면 namespace 번호를 planned ID와 일치시킨다.",
  ]) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "README.md"),
        `\n## 상세 재복제 fixture\n\n${content}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 내부 상세 'planned ID의 구체적 정본 파일 소유'을 재복제할 수 없습니다/,
      );
    });
  }
});

test("reference-style link label로 planned ID 상세 재복제를 숨길 수 없다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "README.md"),
      [
        "",
        "## reference label 상세 fixture",
        "",
        "[planned][term] ID의 namespace 번호와 일치하는 구체적 `NN_*.md`를 소유한다.",
        "",
        "[planned]: https://example.com/planned",
        "[term]: https://example.com/term",
        "",
      ].join("\n"),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 내부 상세 'planned ID의 구체적 정본 파일 소유'을 재복제할 수 없습니다/,
    );
  });
});

test("hard-wrap·inline code·link label·entity·emphasis로 분리한 planned ID 세부도 거부한다", () => {
  const disguisedDetail = [
    "**planned**",
    "`ID`의 name&#x73;pace 번호와 [NN_*](README.md).md",
    "",
  ].join("\n");

  for (const { file, section } of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          section,
          (ownerSection) =>
            `${ownerSection}\n${disguisedDetail}`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}\n${result.stderr}`);
      assert.match(
        result.stderr,
        /planned ID 내부 상세 'planned ID의 구체적 정본 파일 소유'/,
      );
    });
  }
});

test("balanced inline link로 분리한 planned ID 상세 재복제를 거부한다", () => {
  for (const disguisedDetail of [
    "[planned](#owner(and)alias) [ID](#other(and)alias)의 namespace 번호와 일치하는 구체적 `NN_*.md`를 소유한다.",
    "[planned](#owner \"title )\") [ID](#other\\(and\\)alias)의 namespace 번호와 일치하는 구체적 `NN_*.md`를 소유한다.",
  ]) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "README.md"),
        `\n## balanced link 상세 fixture\n\n${disguisedDetail}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 내부 상세 'planned ID의 구체적 정본 파일 소유'을 재복제할 수 없습니다/,
        disguisedDetail,
      );
    });
  }
});

test("balanced destination을 가진 무관한 inline link를 planned ID 상세로 오인하지 않는다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "README.md"),
      [
        "",
        "## balanced link 비계약 fixture",
        "",
        "[planned elsewhere](#owner(and)alias) [ID index](#other \"title )\")를 참고한다.",
        "",
      ].join("\n"),
    );

    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("fenced code에 넣은 planned ID 세부도 문서 복제로 거부한다", () => {
  const trackedDetail = plannedIdDetailExamples.find(
    (example) =>
      example.label ===
      "planned ID의 실제 정의·validator·구현·테스트·PR 추적",
  );
  assert.ok(trackedDetail, "fixture tracked planned ID detail missing");
  const fencedDetail = [
    "```text",
    trackedDetail.content,
    "```",
    "",
  ].join("\n");

  for (const { file, section } of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          section,
          (ownerSection) => `${ownerSection}\n${fencedDetail}`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}\n${result.stderr}`);
      assert.match(
        result.stderr,
        /planned ID 내부 상세 'planned ID의 실제 정의·validator·구현·테스트·PR 추적'/,
      );
    });
  }
});

test("named entity로 감싼 exact-head planned ID 세부도 거부한다", () => {
  const detail =
    "exact PR head Git tree에서 image alt와 &lt;details&gt;를 정의에서 제외한다.";

  for (const { file, section } of plannedIdRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(
          content,
          section,
          (ownerSection) => `${ownerSection}\n${detail}\n`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}\n${result.stderr}`);
      assert.match(
        result.stderr,
        /planned ID 내부 상세 'exact-head 비가시 정의 제외'/,
      );
    });
  }
});

test("하네스 소유 표는 planned ID 수명주기 owner 행을 정확히 하나 요구한다", () => {
  const row =
    "| PRD·Policy planned ID 수명주기 | [update-product-docs](../../.agents/skills/update-product-docs/SKILL.md) | 새 ID 요청을 단일 owner로 라우팅 |";
  for (const replacement of ["", `${row}\n${row}`]) {
    withFixture((root) => {
      const target = path.join(root, developmentFiles[0]);
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(row), "fixture owner row missing");
      fs.writeFileSync(target, content.replace(row, replacement));

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /규칙 소유와 링크 표에 'PRD·Policy planned ID 수명주기' 행이 정확히 하나/,
      );
    });
  }
});

test("planned ID 수명주기 owner 링크는 소유 표의 정확한 행에 결합되어야 한다", () => {
  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    const content = fs.readFileSync(target, "utf8");
    const plannedRow =
      "| PRD·Policy planned ID 수명주기 | [update-product-docs](../../.agents/skills/update-product-docs/SKILL.md) | 새 ID 요청을 단일 owner로 라우팅 |";
    const productRow =
      "| 사용자 결과·수용 동작 | PRD | STEP 입력으로 연결 |";
    fs.writeFileSync(
      target,
      content
        .replace(
          plannedRow,
          "| PRD·Policy planned ID 수명주기 | PRD | STEP 입력으로 연결 |",
        )
        .replace(
          productRow,
          "| 사용자 결과·수용 동작 | [update-product-docs](../../.agents/skills/update-product-docs/SKILL.md) | 새 ID 요청을 단일 owner로 라우팅 |",
        ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /PRD·Policy planned ID 수명주기.*canonical update-product-docs owner.*결합/,
    );
  });
});

test("이슈 추적 적용 경계는 run-github-work-item 이슈 계약 행에 결합되어야 한다", () => {
  withFixture((root) => {
    const target = path.join(root, developmentFiles[0]);
    const content = fs.readFileSync(target, "utf8");
    const issueRow =
      "| 작업 범위·경로·행동 시나리오·검증 계획 | [run-github-work-item 이슈 계약](../../.agents/skills/run-github-work-item/references/issue-contract.md) | 이슈 양식·제품 추적 적용 경계·구현·리뷰 입력을 단일 계약으로 라우팅 |";
    const projectRow =
      "| 이슈·Project 상태 전이·재조회·복구 | [run-github-work-item](../../.agents/skills/run-github-work-item/SKILL.md) | 이슈·Project 요청을 단일 owner로 라우팅 |";
    fs.writeFileSync(
      target,
      content
        .replace(
          issueRow,
          "| 작업 범위·경로·행동 시나리오·검증 계획 | [run-github-work-item](../../.agents/skills/run-github-work-item/SKILL.md) | 이슈·Project 요청을 단일 owner로 라우팅 |",
        )
        .replace(
          projectRow,
          "| 이슈·Project 상태 전이·재조회·복구 | [run-github-work-item 이슈 계약](../../.agents/skills/run-github-work-item/references/issue-contract.md) | 이슈 양식·제품 추적 적용 경계·구현·리뷰 입력을 단일 계약으로 라우팅 |",
        ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /작업 범위·경로·행동 시나리오·검증 계획 행은 canonical run-github-work-item 이슈 계약과 제품 추적 적용 경계/,
    );
  });
});

test("planned ID 상세 owner는 visible canonical H2 하나에만 계약을 둔다", () => {
  const skillFile =
    ".agents/skills/update-product-docs/SKILL.md";

  for (const mutate of [
    (content) =>
      content.replace(
        "## Planned ID 계약",
        "## Planned ID 계약 변경됨",
      ),
    (content) =>
      `${content}\n## **Planned ID 계약**\n`,
  ]) {
    withFixture((root) => {
      const target = path.join(root, skillFile);
      fs.writeFileSync(
        target,
        mutate(fs.readFileSync(target, "utf8")),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*정확히 하나/,
      );
    });
  }

  withFixture((root) => {
    const target = path.join(root, skillFile);
    fs.appendFileSync(
      target,
      "\n## 다른 절\n\nplanned ID는 같은 branch와 PR에서 다룬다.\n",
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 내부 상세 'planned ID의 같은 branch·PR 동시 작업'.*Planned ID 계약/,
    );
  });
});

test("planned ID 상세 owner의 fenced code는 visible 계약 증거가 아니다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail = updateProductDocsFixtureContract.find((line) =>
      line.includes("exact PR head Git tree"),
    );
    assert.ok(detail, "fixture exact-head contract missing");
    fs.writeFileSync(
      target,
      content.replace(detail, `\`\`\`text\n${detail}\n\`\`\``),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역의 각 visible line은 '- ' direct bullet 또는 그 bullet의 정확히 2칸 continuation/,
    );
  });
});

test("planned ID 상세 owner의 list-contained fence를 inline code로 오인하지 않는다", () => {
  for (const marker of ["```text", "~~~text"]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      const detail = updateProductDocsFixtureContract.find((line) =>
        line.includes("승인된 결정과 planned ID"),
      );
      assert.ok(detail, "fixture planned ID marker contract missing");
      const closingMarker = marker.startsWith("`") ? "```" : "~~~";
      fs.writeFileSync(
        target,
        content.replace(
          detail,
          [
            `- ${marker}`,
            `  ${detail.slice(2)}`,
            `  ${closingMarker}`,
          ].join("\n"),
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역에는 direct bullet·2칸 continuation에 넣은 fenced code marker를 사용할 수 없습니다/,
      );
    });
  }
});

test("planned ID 상세 owner의 indented code는 visible 계약 증거가 아니다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail = updateProductDocsFixtureContract.find((line) =>
      line.includes("exact PR head Git tree"),
    );
    assert.ok(detail, "fixture exact-head contract missing");
    fs.writeFileSync(
      target,
      content.replace(detail, `    ${detail}`),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역의 각 visible line은 '- ' direct bullet 또는 그 bullet의 정확히 2칸 continuation/,
    );
  });
});

test("planned ID 상세 owner의 4칸 continuation은 fail-closed한다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail =
      "별도 문서 이슈나 PR을 만들 필요는 없다.";
    assert.ok(content.includes(detail), "fixture separate Issue contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        `- 문서와 구현은 함께 작성한다.\n    ${detail}`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역의 각 visible line은 '- ' direct bullet 또는 그 bullet의 정확히 2칸 continuation/,
    );
  });
});

test("planned ID 상세 owner의 reference·image metadata는 fail-closed한다", () => {
  const detail =
    "별도 문서 이슈나 PR을 만들 필요는 없다.";
  const replacements = [
    `![${detail}][hidden-image]\n\n[hidden-image]: https://example.com/image.png`,
    `> [hidden-contract]: https://example.com "${detail}"`,
    `[hidden\\]]: https://example.com "${detail}"`,
    `[visible-contract]: not a valid reference definition ${detail}`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(detail), "fixture separate Issue contract missing");
      fs.writeFileSync(target, content.replace(detail, replacement));

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역(?:의 각 visible line은|에는 inline code 밖의 Markdown formatting)/,
      );
    });
  }
});

test("planned ID 상세 owner의 nested·tab·container code와 escaped raw HTML은 fail-closed한다", () => {
  const detail =
    "별도 문서 이슈나 PR을 만들 필요는 없다.";
  const mutations = [
    () => `-\t\t${detail}`,
    () => `- parent\n  - ${detail}`,
    () => `- ~~~\n  ${detail}`,
    () => `- \\` + `<img alt="${detail}">` + "\\`",
  ];

  for (const mutate of mutations) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content
          .split("\n")
          .map((line) => line.includes(detail) ? mutate() : line)
          .join("\n"),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역/,
      );
    });
  }
});

test("planned ID 상세 owner의 bare CR 줄바꿈은 fail-closed한다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail =
      "별도 문서 이슈나 PR을 만들 필요는 없다.";
    assert.ok(content.includes(detail), "fixture separate Issue contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        `visible owner contract\r\r      ${detail}`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner에는 CRLF가 아닌 bare CR 줄바꿈을 사용할 수 없습니다/,
    );
  });
});

test("sibling list item fence의 문구는 planned ID 상세 owner 계약 증거가 아니다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail =
      "- 별도 문서 이슈나 PR을 만들 필요는 없다.";
    assert.ok(content.includes(detail), "fixture separate Issue contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        [
          "- ```",
          "  별도 문서 이슈나 PR을 만들 필요는 없다.",
          "- ```",
        ].join("\n"),
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /하네스 수명주기 계약이 없습니다: 별도 문서 이슈 불필요/,
    );
  });
});

test("planned ID 상세 owner는 CRLF Markdown에서도 검증된다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, content.replaceAll("\n", "\r\n"));

    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("planned ID 상세 owner의 canonical grammar 문장은 필수다", () => {
  for (const { pattern, message } of [
    {
      pattern:
        /- 이 canonical 구역은 plain top-level H2[\s\S]*?사용하지 않는다\.\n/,
      message:
        /하네스 수명주기 계약이 없습니다: canonical owner grammar/,
    },
    {
      pattern:
        /- owner·routing H2의 보호 이름은[\s\S]*?사용할 수 없다\.\n/,
      message:
        /하네스 수명주기 계약이 없습니다: fail-closed owner H2 source grammar/,
    },
    {
      pattern:
        /- validator는 임의의 CommonMark rendered 동등성을[\s\S]*?fail-closed한다\.\n/,
      message:
        /하네스 수명주기 계약이 없습니다: bounded owner H2 scanner/,
    },
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      const changed = content.replace(pattern, "");
      assert.notEqual(changed, content, `fixture pattern missing: ${pattern}`);
      fs.writeFileSync(target, changed);

      const result = runValidator(root);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
    });
  }
});

test("reference definition metadata는 visible planned ID 계약 증거가 아니다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    const detail =
      "별도 문서 이슈나 PR을 만들 필요는 없다.";
    assert.ok(content.includes(detail), "fixture separate Issue contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        `[hidden-contract]: https://example.com "${detail}"`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역에는 inline code 밖의 Markdown formatting·link·image·reference·raw HTML/,
    );
  });
});

test("planned ID 상세 owner의 image alt와 link destination은 계약 증거가 아니다", () => {
  const skillFile =
    ".agents/skills/update-product-docs/SKILL.md";

  withFixture((root) => {
    const target = path.join(root, skillFile);
    const content = fs.readFileSync(target, "utf8");
    const detail = updateProductDocsFixtureContract.find((line) =>
      line.includes("exact PR head Git tree"),
    );
    assert.ok(detail, "fixture exact-head contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        `![${detail}](https://example.com/owner.png)`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /하네스 수명주기 계약이 없습니다: exact-head product definitions/,
    );
  });

  withFixture((root) => {
    const target = path.join(root, skillFile);
    const content = fs.readFileSync(target, "utf8");
    const detail =
      "별도 문서 이슈나 PR을 만들 필요는 없다.";
    assert.ok(content.includes(detail), "fixture separate Issue contract missing");
    fs.writeFileSync(
      target,
      content.replace(
        detail,
        `[참고](https://example.com \"${detail}\")`,
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /하네스 수명주기 계약이 없습니다: 별도 문서 이슈 불필요/,
    );
  });
});

test("raw HTML block으로 planned ID 상세 owner H2를 감출 수 없다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      content.replace(
        "## Planned ID 계약",
        "<script>\n## Planned ID 계약",
      ) + "\n</script>\n",
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner에는 code 밖의 raw HTML·autolink/,
    );
  });
});

test("reference-style owner H2를 보호 이름 후보에서 숨길 수 없다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    fs.appendFileSync(
      target,
      "\n## [Planned ID 계약][duplicate]\n\n[duplicate]: #planned-id-계약\n",
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner의 H2는 Markdown formatting·link가 없는 plain text/,
    );
  });
});

test("balanced-parentheses link destination으로 planned ID owner H2 중복을 숨길 수 없다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    fs.appendFileSync(
      target,
      "\n## [Planned ID 계약](owner(and)alias)\n",
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner의 H2는 Markdown formatting·link가 없는 plain text/,
    );
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역은.*보호 후보 2개/,
    );
  });
});

test("비정본 H2 source 변형으로 planned ID 상세 owner H2 중복을 숨길 수 없다", () => {
  for (const alternateHeading of [
    "Planned ID 계약\n---",
    " ## Planned ID 계약",
    "  ## Planned ID 계약",
    "   ## Planned ID 계약",
    "##\tPlanned ID 계약",
    "## Planned ID 계약 ##",
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n${alternateHeading}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${alternateHeading}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner의 H2는 Markdown formatting·link가 없는 plain text/,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("detail owner의 container-prefixed Planned ID 계약 H2 중복을 숨길 수 없다", () => {
  const section = "Planned ID 계약";
  for (const alternateHeading of [
    `- ## ${section}`,
    `-\t> ## ${section} ##`,
    `> ${section}\n> ---`,
    `- ${section}\n  ---`,
    `-\t${section}\n\t---`,
    `> - ${section}\n>   ---`,
    `> \`\`\`markdown\n> <!--\n> \`\`\`\n> ## ${section}`,
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n## container heading fixture\n\n${alternateHeading}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${alternateHeading}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("container code·comment·thematic break·list content를 owner H2로 오인하지 않는다", () => {
  for (const { file, section } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
    },
  ]) {
    withFixture((root) => {
      const target = path.join(root, file);
      fs.appendFileSync(
        target,
        [
          "",
          "## container non-heading fixture",
          "",
          `    ## ${section}`,
          "> ```markdown",
          `> ## ${section}`,
          "> ```",
          "- ```markdown",
          `  ## ${section}`,
          "  ```",
          `-     ## ${section}`,
          `-\t\t## ${section}`,
          "> <!--",
          `> ## ${section}`,
          "> -->",
          `> ${section}`,
          "---",
          "> ---",
          `- ${section}`,
          "",
        ].join("\n"),
      );

      const result = runValidator(root);
      assert.equal(result.status, 0, `${file}\n${result.stderr}`);
    });
  }
});

test("container raw HTML block 안의 owner 문구를 보호 H2 후보로 세지 않는다", () => {
  for (const { file, section, rawHtmlMessage } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
      rawHtmlMessage:
        /planned ID 라우팅 문서에는 code 밖의 raw HTML·autolink/,
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
      rawHtmlMessage:
        /planned ID 상세 owner에는 code 밖의 raw HTML·autolink/,
    },
  ]) {
    withFixture((root) => {
      const target = path.join(root, file);
      fs.appendFileSync(
        target,
        [
          "",
          "## container raw HTML fixture",
          "",
          "> <script>",
          `> ## ${section}`,
          "> </script>",
          "",
        ].join("\n"),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}\n${result.stderr}`);
      assert.match(result.stderr, rawHtmlMessage);
      assert.doesNotMatch(
        result.stderr,
        /owner (?:라우팅 )?구역은.*보호 후보 2개/,
      );
    });
  }
});

test("thematic break·code·non-H2를 planned ID 상세 owner H2로 오인하지 않는다", () => {
  for (const nonH2 of [
    "Planned ID 계약\n\n---",
    "Planned ID 계약\n===",
    "    ## Planned ID 계약",
    "\t## Planned ID 계약",
    "### Planned ID 계약",
    "##Planned ID 계약",
    "```\n## Planned ID 계약\n```",
    "<!--\n## Planned ID 계약\n-->",
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content.replace(
          "## Planned ID 계약",
          `${nonH2}\n\n## Planned ID 계약`,
        ),
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        0,
        `${nonH2}\n${result.stderr}`,
      );
    });
  }
});

test("quoted title의 parenthesis·escape로 planned ID owner H2 중복을 숨길 수 없다", () => {
  for (const destination of [
    'owner "title )"',
    "owner 'title )'",
    'owner "title \\" )"',
    "owner (title \\))",
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n## [Planned ID 계약](${destination})\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1, `${destination}\n${result.stderr}`);
      assert.match(
        result.stderr,
        /planned ID 상세 owner의 H2는 Markdown formatting·link가 없는 plain text/,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("종결되지 않은 inline title의 보호 이름도 fail-closed한다", () => {
  for (const malformedHeading of [
    "[Planned ID 계약](owner \"unclosed title )",
    "[Planned ID 계약](owner\\ title)",
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n## ${malformedHeading}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${malformedHeading}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("owner와 무관한 formatted H2는 planned ID owner H2 오류가 아니다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    fs.appendFileSync(target, "\n## `PRD` 예시\n\n설명\n");

    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("닫히지 않은 raw HTML block으로 planned ID 상세 owner H2를 감출 수 없다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      content.replace(
        "## Planned ID 계약",
        "<script\n## Planned ID 계약",
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner에는 code 밖의 raw HTML·autolink/,
    );
  });
});

test("세 owner 라우팅 H2는 top-level에 정확히 하나만 존재해야 한다", () => {
  for (const document of harnessRoutingDocuments) {
    withFixture((root) => {
      const target = path.join(root, document.file);
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        content.replace(
          `## ${document.section}`,
          `## ${document.section} 변경됨`,
        ),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /하네스 owner 라우팅 구역은.*정확히 하나/,
      );
    });

    withFixture((root) => {
      const target = path.join(root, document.file);
      fs.appendFileSync(target, `\n## ${document.section}\n`);

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /하네스 owner 라우팅 구역은.*정확히 하나.*canonical 2개/,
      );
    });

    withFixture((root) => {
      const target = path.join(root, document.file);
      fs.appendFileSync(
        target,
        `\n## **${document.section}**\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /하네스 owner 라우팅 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("entity·inline code로 꾸민 owner H2도 보호 source 후보로 계산한다", () => {
  for (const heading of [
    "&#80;R과 작업 완료",
    "PR과 작업 `완료`",
    "[PR과 작업 완료](README.md)",
  ]) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "AGENTS.md"),
        `\n## ${heading}\n`,
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /하네스 owner 라우팅 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("nested list continuation의 ATX·setext·tab owner H2를 보호 source 후보로 계산한다", () => {
  for (const { file, section } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
    },
  ]) {
    for (const alternateHeading of [
      `- outer\n  - inner\n    ## ${section}`,
      `- outer\n  - inner\n\n    ${section}\n    ---`,
      `- outer\n  - inner\n\t## ${section}`,
    ]) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## nested continuation fixture\n\n${alternateHeading}\n`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${file}: ${alternateHeading}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /owner (?:라우팅 )?구역은.*보호 후보 2개/,
        );
      });
    }
  }
});

test("multi-line blockquote setext와 comment·inline-code 뒤 실제 owner H2를 찾는다", () => {
  for (const { file, section } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
    },
  ]) {
    const [firstWord, ...remainingWords] = section.split(" ");
    for (const alternateHeading of [
      `> ${firstWord}\n> ${remainingWords.join(" ")}\n> ---`,
      `<!--\n\`\`\`\n-->\n## ${section}`,
      `\\<!--\n## ${section}\n-->`,
      `\` \`\`\` \`\n## ${section}`,
    ]) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## visibility precedence fixture\n\n${alternateHeading}\n`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${file}: ${alternateHeading}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /owner (?:라우팅 )?구역은.*보호 후보 2개/,
        );
      });
    }
  }
});

test("indented code·outdented thematic break를 owner H2 후보로 오인하지 않는다", () => {
  for (const { file, section } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
    },
  ]) {
    const nonOwnerHeadings = [
      `    ${section}\n---`,
      `- outer\n  ${section}\n---`,
    ];

    for (const nonOwnerHeading of nonOwnerHeadings) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## exact non-owner fixture\n\n${nonOwnerHeading}\n`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          0,
          `${file}: ${nonOwnerHeading}\n${result.stderr}`,
        );
      });
    }
  }
});

test("reference·entity·미종결 delimiter·ordered-list 보호 이름을 fail-closed한다", () => {
  for (const protectedCandidate of [
    "## [Planned ID 계약][missing]",
    "## Planned&colon; ID 계약",
    "## Planned ID 계약 `",
    "## Planned ID 계약 *",
    "paragraph stays open\n2. ## Planned ID 계약",
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n## fail-closed source fixture\n\n${protectedCandidate}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${protectedCandidate}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("rule-of-three·multiline reference·hardbreak·link title 보호 이름을 fail-closed한다", () => {
  for (const protectedCandidate of [
    "## *Planned ID *계약**",
    [
      "## [Planned ID 계약][dup]",
      "",
      "[dup]:",
      "  https://example.com/owner",
    ].join("\n"),
    ["Planned\\", "ID 계약", "---"].join("\n"),
    [
      '[Planned ID 계약](https://example.com "multi',
      ' line")',
      "---",
    ].join("\n"),
  ]) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/update-product-docs/SKILL.md",
      );
      fs.appendFileSync(
        target,
        `\n## remaining P1 fixture\n\n${protectedCandidate}\n`,
      );

      const result = runValidator(root);
      assert.equal(
        result.status,
        1,
        `${protectedCandidate}\n${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /planned ID 상세 owner 구역은.*보호 후보 2개/,
      );
    });
  }
});

test("processing instruction·type 6 raw HTML block의 pseudo owner H2를 세지 않는다", () => {
  for (const { file, section, rawHtmlMessage } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
      rawHtmlMessage:
        /planned ID 라우팅 문서에는 code 밖의 raw HTML·autolink/,
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
      rawHtmlMessage:
        /planned ID 상세 owner에는 code 밖의 raw HTML·autolink/,
    },
  ]) {
    for (const rawBlock of [
      `<?target\n## ${section}\n?>`,
      `<hr>\n## ${section}`,
    ]) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## raw HTML type fixture\n\n${rawBlock}\n\nvisible\n`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${file}: ${rawBlock}\n${result.stderr}`,
        );
        assert.match(result.stderr, rawHtmlMessage);
        assert.doesNotMatch(
          result.stderr,
          /owner (?:라우팅 )?구역은.*보호 후보 2개/,
        );
      });
    }
  }
});

test("link·entity·code와 emphasis의 owner source skeleton을 보호 후보로 계산한다", () => {
  for (const { file, section } of [
    {
      file: "README.md",
      section: "제품 문서 갱신 절차",
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: "Planned ID 계약",
    },
  ]) {
    const characters = [...section];
    const firstSpace = section.indexOf(" ");
    const exactHeadings = [
      {
        heading: `[${section}][resolved-owner]`,
        suffix: "\n[resolved-owner]: #canonical-owner\n",
      },
      {
        heading:
          `&#${characters[0].codePointAt(0)};` +
          characters.slice(1).join(""),
        suffix: "",
      },
      {
        heading:
          firstSpace < 0
            ? `\`${section}\``
            : `${section.slice(0, firstSpace)}&#32;${section.slice(firstSpace + 1)}`,
        suffix: "",
      },
      {
        heading: `\`${section}\``,
        suffix: "",
      },
      {
        heading: `*${section}*`,
        suffix: "",
      },
      {
        heading: `[${section}](#canonical-owner)`,
        suffix: "",
      },
    ];

    for (const { heading, suffix } of exactHeadings) {
      withFixture((root) => {
        const target = path.join(root, file);
        fs.appendFileSync(
          target,
          `\n## exact inline fixture\n\n## ${heading}\n${suffix}`,
        );

        const result = runValidator(root);
        assert.equal(
          result.status,
          1,
          `${file}: ${heading}\n${result.stderr}`,
        );
        assert.match(
          result.stderr,
          /owner (?:라우팅 )?구역은.*보호 후보 2개/,
        );
      });
    }
  }
});

test("owner scanner는 큰 보호 delimiter·container 입력을 제한 시간 안에 fail-closed한다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const unmatchedDelimiters = "*".repeat(20_001);
    const nestedContainers = "- ".repeat(2_000);
    fs.appendFileSync(
      target,
      [
        "",
        "## bounded scanner fixture",
        "",
        `## Planned ID 계약${unmatchedDelimiters}`,
        `${nestedContainers}not an owner heading`,
        "",
      ].join("\n"),
    );

    const result = runValidator(root);
    assert.equal(result.signal, null, result.error?.message);
    assert.notEqual(result.status, null, result.error?.message);
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /planned ID 상세 owner 구역은.*보호 후보 2개/,
    );
  });
});

test("owner scanner는 큰 무관한 formatting 입력에서도 제한 시간 안에 종료한다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      ".agents/skills/update-product-docs/SKILL.md",
    );
    const unmatchedDelimiters = "*".repeat(20_001);
    const nestedContainers = "- ".repeat(2_000);
    const inlineComments = "<!-- bounded -->".repeat(2_000);
    fs.appendFileSync(
      target,
      [
        "",
        "## bounded unrelated scanner fixture",
        "",
        `## unrelated owner example${inlineComments}${unmatchedDelimiters}`,
        `${nestedContainers}unrelated content`,
        "",
      ].join("\n"),
    );

    const result = runValidator(root);
    assert.equal(result.signal, null, result.error?.message);
    assert.notEqual(result.status, null, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("CONTRIBUTING은 승인 수 0과 리뷰 대화 해결 문장을 각각 하나 요구한다", () => {
  const approval =
    "필수 승인 수는 1인 운영을 막지 않도록 0으로 유지합니다.";
  const threads =
    "승인 수와 무관하게 생성된 리뷰 대화는 모두 해결해야 합니다.";
  const mutations = [
    (section) => section.replace("0으로", "1로"),
    (section) => section.replace(approval, ""),
    (section) => section.replace(approval, `${approval} ${approval}`),
    (section) => section.replace(threads, "리뷰 대화는 참고합니다."),
    (section) =>
      `${section}\n\`필수 승인 수는 1로 유지합니다.\`\n`,
    (section) =>
      section.replace(
        `${approval} ${threads}`,
        `[승인 설정](README.md "${approval} ${threads}")`,
      ),
  ];

  for (const mutate of mutations) {
    withFixture((root) => {
      const target = path.join(root, "CONTRIBUTING.md");
      const content = fs.readFileSync(target, "utf8");
      fs.writeFileSync(
        target,
        mutateH2Section(content, "8. 병합과 정리", mutate),
      );

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /필수 승인 수 0과 생성된 리뷰 대화 해결 계약이 각각 정확히 하나/,
      );
    });
  }
});

test("괄호가 든 link title에 승인 계약을 숨길 수 없다", () => {
  withFixture((root) => {
    const target = path.join(root, "CONTRIBUTING.md");
    const approval =
      "필수 승인 수는 1인 운영을 막지 않도록 0으로 유지합니다.";
    const threads =
      "승인 수와 무관하게 생성된 리뷰 대화는 모두 해결해야 합니다.";
    const content = fs.readFileSync(target, "utf8");
    fs.writeFileSync(
      target,
      mutateH2Section(content, "8. 병합과 정리", (section) =>
        section.replace(
          `${approval} ${threads}`,
          `[승인 설정](README.md "dummy ) ${approval} ${threads}")`,
        ),
      ),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /공백·괄호·title이 없는 한 줄 canonical target/,
    );
  });
});

test("finalize 내부 토큰은 세 라우팅 문서의 prose·code·fence에 복제할 수 없다", () => {
  const contexts = [
    forbiddenFinalizeDetailTokens.join(" "),
    forbiddenFinalizeDetailTokens
      .map((token) => `\`${token}\``)
      .join(" "),
    [
      "```text",
      ...forbiddenFinalizeDetailTokens,
      "```",
    ].join("\n"),
  ];

  for (const { file } of harnessRoutingDocuments) {
    for (const context of contexts) {
      withFixture((root) => {
        fs.appendFileSync(
          path.join(root, file),
          `\n## 금지 토큰 fixture\n\n${context}\n`,
        );

        const result = runValidator(root);
        assert.equal(result.status, 1);
        for (const token of forbiddenFinalizeDetailTokens) {
          assert.ok(result.stderr.includes(`'${token}'`), result.stderr);
        }
      });
    }
  }
});

test("formatting·entity·hard wrap으로 분리한 finalize 토큰도 거부한다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "AGENTS.md"),
      [
        "",
        "## 분리 토큰 fixture",
        "",
        "snapshot&#x2d;scratch",
        "snapshot-&Tab;scratch",
        "[snapshot-](README.md)scratch",
        '[snapshot-](README.md ")")scratch',
        "GIT_**INDEX**_FILE",
        "GIT&UnderBar;INDEX&UnderBar;FILE",
        "merged-",
        "recovery",
        "",
      ].join("\n"),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    for (const token of [
      "snapshot-scratch",
      "GIT_INDEX_FILE",
      "merged-recovery",
    ]) {
      assert.ok(result.stderr.includes(`'${token}'`), result.stderr);
    }
  });
});

test("finalize 금지 토큰 목록은 open-pull-request 상세 owner와 대칭이다", () => {
  for (const token of forbiddenFinalizeDetailTokens) {
    withFixture((root) => {
      const target = path.join(
        root,
        ".agents/skills/open-pull-request/SKILL.md",
      );
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(token), `fixture token missing: ${token}`);
      fs.writeFileSync(target, content.replaceAll(token, "removed-token"));

      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`finalize 상세 owner 토큰 '${token}'`),
        result.stderr,
      );
    });
  }
});

test("제품 문서와 PR Skill의 수명주기 핵심 계약을 요구한다", () => {
  const cases = [
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      source: "승인된 결정",
      replacement: "정의된 내용",
      message: /하네스 수명주기 계약이 없습니다: 승인된 결정/,
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      source:
        "- `planned ID`는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다.\n",
      replacement: "",
      message:
        /하네스 수명주기 계약이 없습니다: planned ID marker는 정본 정의가 아님/,
    },
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      source: "exact PR head Git tree",
      replacement: "현재 문서 폴더",
      message:
        /하네스 수명주기 계약이 없습니다: exact-head product definitions/,
    },
    {
      file: ".agents/skills/run-github-work-item/SKILL.md",
      source: "요청·파생 label의 정확한 집합",
      replacement: "일부 관리 label",
      message: /하네스 수명주기 계약이 없습니다: exact create labels/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "--match-head-commit",
      replacement: "--head",
      message: /하네스 수명주기 계약이 없습니다: exact-head guard/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "각각 별도 argv",
      replacement: "하나의 shell command",
      message: /하네스 수명주기 계약이 없습니다: argv-bound merge/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "`statusCheckRollup`",
      replacement: "별도 check 목록",
      message:
        /하네스 수명주기 계약이 없습니다: identity-bound required CI/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "--ignored=matching",
      replacement: "--ignored=no",
      message:
        /하네스 수명주기 계약이 없습니다: ignored worktree preflight/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "review-head=<40자리 SHA>",
      replacement: "임의 SHA",
      message:
        /하네스 수명주기 계약이 없습니다: structured exact review head/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "--merged-recovery",
      replacement: "--retry-merge",
      message: /하네스 수명주기 계약이 없습니다: MERGED recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "병합 전에만 의미가 있는 required check·review thread",
      replacement: "병합된 상태의 게이트",
      message:
        /하네스 수명주기 계약이 없습니다: recovery OPEN gate 분리/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "complete <issue> --pr <pr> --head <validated-head> --repo <validated-repository> --dry-run",
      replacement: "complete <issue> --pr <pr>",
      message:
        /하네스 수명주기 계약이 없습니다: recovery ownership dry-run/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "issue worktree가 이미 없으면",
      replacement: "issue worktree가 반드시 있으면",
      message: /하네스 수명주기 계약이 없습니다: recovery main cwd/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "--repo <validated-repository> --issue <issue> --pr <pr> --dry-run",
      replacement: "--issue <issue> --pr <pr> --dry-run",
      message:
        /하네스 수명주기 계약이 없습니다: local cleanup explicit repository/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "raw URL은 출력하거나 plan·identity에 저장하지 않고",
      replacement: "raw URL을 plan에 저장하고",
      message:
        /하네스 수명주기 계약이 없습니다: local cleanup canonical origin identity/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "plan token과 runtime canary에만 결속한다.",
      replacement: "durable identity에 결속한다.",
      message:
        /하네스 수명주기 계약이 없습니다: local cleanup canonical origin identity/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "stable local locator identity",
      replacement: "repository별 archive identity",
      message:
        /하네스 수명주기 계약이 없습니다: local cleanup stable archive namespace/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "같은 repository의 canonical",
      replacement: "다른 repository의 canonical",
      message:
        /하네스 수명주기 계약이 없습니다: local cleanup stable archive namespace/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "git -C <main-worktree> update-ref -d",
      replacement: "git branch -d <validated-branch>",
      message: /하네스 수명주기 계약이 없습니다: CAS local 삭제/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "`git worktree remove`나 `git worktree prune`은 호출하지 않는다.",
      replacement: "git worktree remove로 정리한다.",
      message:
        /하네스 수명주기 계약이 없습니다: metadata-only worktree quarantine/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "원본을 rename·삭제하지 않고",
      replacement: "원본을 archive inode로 rename하고",
      message:
        /하네스 수명주기 계약이 없습니다: OMC sealed new-inode snapshot/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "copy fallback이 아니라",
      replacement: "copy fallback으로",
      message:
        /하네스 수명주기 계약이 없습니다: OMC sealed snapshot은 fallback 아님/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "`intentDigest`와",
      replacement: "intent와",
      message:
        /하네스 수명주기 계약이 없습니다: OMC generation proof chain/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "root device/inode·pending·final",
      replacement: "pending·final",
      message:
        /하네스 수명주기 계약이 없습니다: OMC scratch ownership/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "helper-owned bound scratch",
      replacement: "unowned pending",
      message:
        /하네스 수명주기 계약이 없습니다: OMC partial snapshot forward recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "`snapshot-failed.json`에 결속하고",
      replacement: "partial payload를 삭제하고",
      message:
        /하네스 수명주기 계약이 없습니다: OMC partial snapshot forward recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "candidate가 nonempty일",
      replacement: "candidate가 empty일",
      message:
        /하네스 수명주기 계약이 없습니다: OMC partial snapshot forward recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "첫 entry 전 실패한 exact owned empty root",
      replacement: "첫 entry 전 실패한 payload",
      message:
        /하네스 수명주기 계약이 없습니다: OMC failed-empty snapshot forward recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "source와 helper-owned candidate가 모두 없을 때만",
      replacement: "source가 없어도",
      message:
        /하네스 수명주기 계약이 없습니다: OMC absent-source exact candidate recovery/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "mutable quarantined root",
      replacement: "discarded root",
      message:
        /하네스 수명주기 계약이 없습니다: OMC mutable root와 drift 중단/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "main worktree root·branch·HEAD·main·origin/main ref·clean 상태·common dir·",
      replacement: "main worktree를",
      message:
        /하네스 수명주기 계약이 없습니다: quarantine transition global canary/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "device·inode·mode·size·byte digest",
      replacement: "파일 이름",
      message:
        /하네스 수명주기 계약이 없습니다: quarantine Git plumbing byte proof/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "마지막 bounded pre-rename operation",
      replacement: "root 이동 전에 한 번",
      message:
        /하네스 수명주기 계약이 없습니다: bounded pre-rename and post-move residue canary/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "linearizable freeze를 보장하지 않는다",
      replacement: "모든 writer를 동결한다",
      message:
        /하네스 수명주기 계약이 없습니다: external writer no-freeze boundary/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "identity와 published-pending cleanup",
      replacement: "quarantine cleanup",
      message:
        /하네스 수명주기 계약이 없습니다: origin all durable-boundary canary/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source: "fresh full plan과 plan token",
      replacement: "직전 plan",
      message:
        /하네스 수명주기 계약이 없습니다: pre-CAS fresh full plan/,
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      source:
        "FR·AC·Policy visible heading 또는 PRD 기술 스파이크",
      replacement: "모든 ID는 visible heading",
      message: /하네스 수명주기 계약이 없습니다: Ready ID 정의 형식/,
    },
    {
      file: ".github/workflows/validate-harness.yml",
      source:
        "node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
      replacement:
        "node --test .agents/skills/open-pull-request/scripts/validate-pr-body.test.mjs",
      message: /하네스 수명주기 계약이 없습니다: CI finalize 회귀 테스트/,
    },
    {
      file: ".github/workflows/validate-harness.yml",
      source:
        "node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
      replacement:
        "node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
      message: /하네스 수명주기 계약이 없습니다: CI merge helper 회귀 테스트/,
    },
    {
      file: ".github/workflows/validate-harness.yml",
      source:
        "node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      replacement:
        "node --test .agents/skills/update-product-docs/scripts/validate-product-docs.test.mjs",
      message:
        /하네스 수명주기 계약이 없습니다: CI product contract ID 회귀 테스트/,
    },
  ];

  for (const { file, source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, file);
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(source, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1, `${file}: ${source}`);
      assert.match(result.stderr, message);
    });
  }

  withFixture((root) => {
    const file =
      ".agents/skills/open-pull-request/scripts/validate-finalize.test.mjs";
    fs.unlinkSync(path.join(root, file));
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(`필수 하네스 검증 파일이 없습니다: ${file}`),
      result.stderr,
    );
  });

  withFixture((root) => {
    const file =
      ".agents/skills/open-pull-request/scripts/finalize-merge.mjs";
    fs.unlinkSync(path.join(root, file));
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(`필수 하네스 검증 파일이 없습니다: ${file}`),
      result.stderr,
    );
  });

  withFixture((root) => {
    const file =
      ".agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs";
    fs.unlinkSync(path.join(root, file));
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(`필수 하네스 검증 파일이 없습니다: ${file}`),
      result.stderr,
    );
  });
});

test("변경 경로별 하네스 workflow 정적 계약을 요구한다", () => {
  const cases = [
    {
      source: "--event \"$GITHUB_EVENT_NAME\"",
      replacement: "--trigger \"$GITHUB_EVENT_NAME\"",
      message: /하네스 수명주기 계약이 없습니다: CI base\/head 경로 분류 실행/,
    },
    {
      source: "  schedule:",
      replacement: "  scheduled:",
      message: /하네스 수명주기 계약이 없습니다: CI schedule 전체 회귀 trigger/,
    },
    {
      source: "  workflow_dispatch:",
      replacement: "  manual:",
      message:
        /하네스 수명주기 계약이 없습니다: CI workflow_dispatch 전체 회귀 trigger/,
    },
    {
      source: "full: ${{ steps.paths.outputs.full }}",
      replacement: "full: false",
      message: /하네스 수명주기 계약이 없습니다: CI classifier full 선택 출력/,
    },
    {
      source: "needs.classify.outputs.product_docs == 'true'",
      replacement: "needs.classify.outputs.product_docs == 'false'",
      message: /하네스 수명주기 계약이 없습니다: CI product docs 조건부 회귀군/,
    },
    {
      source: "needs.classify.outputs.work_item == 'true'",
      replacement: "needs.classify.outputs.work_item == 'false'",
      message: /하네스 수명주기 계약이 없습니다: CI work item 조건부 회귀군/,
    },
    {
      source: "needs.classify.outputs.commit_pr == 'true'",
      replacement: "needs.classify.outputs.commit_pr == 'false'",
      message: /하네스 수명주기 계약이 없습니다: CI commit PR 조건부 회귀군/,
    },
    {
      source: "needs.classify.outputs.finalize == 'true'",
      replacement: "needs.classify.outputs.finalize == 'false'",
      message: /하네스 수명주기 계약이 없습니다: CI finalize 조건부 회귀군/,
    },
    {
      source: "if: ${{ always() }}",
      replacement: "if: ${{ success() }}",
      message: /하네스 수명주기 계약이 없습니다: CI aggregate always 실행/,
    },
    {
      source: "      - finalize-regression",
      replacement: "      - omitted-finalize-regression",
      message:
        /하네스 수명주기 계약이 없습니다: CI aggregate direct needs: finalize-regression/,
    },
    {
      source: "FULL_SELECTED: ${{ needs.classify.outputs.full }}",
      replacement: "FULL_SELECTED: ${{ needs.classify.outputs.finalize }}",
      message:
        /하네스 수명주기 계약이 없습니다: CI aggregate 선택값 결속: FULL_SELECTED/,
    },
    {
      source:
        "FINALIZE_REGRESSION_RESULT: ${{ needs.finalize-regression.result }}",
      replacement:
        "FINALIZE_RESULT: ${{ needs.finalize-regression.result }}",
      message:
        /하네스 수명주기 계약이 없습니다: CI aggregate job 결과 결속: FINALIZE_REGRESSION_RESULT/,
    },
    {
      source: "--verify-results",
      replacement: "--report-results",
      message: /하네스 수명주기 계약이 없습니다: CI 선택 결과 aggregate/,
    },
  ];

  for (const { source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, ".github/workflows/validate-harness.yml");
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(source), `fixture pattern missing: ${source}`);
      fs.writeFileSync(target, content.replace(source, replacement));

      const result = runValidator(root);
      assert.equal(result.status, 1, source);
      assert.match(result.stderr, message);
    });
  }

  for (const file of [
    ".github/workflows/validate-harness-paths.mjs",
    ".github/workflows/validate-harness-paths.test.mjs",
  ]) {
    withFixture((root) => {
      fs.unlinkSync(path.join(root, file));
      const result = runValidator(root);
      assert.equal(result.status, 1, file);
      assert.ok(
        result.stderr.includes(`필수 하네스 검증 파일이 없습니다: ${file}`),
        result.stderr,
      );
    });
  }
});

test("aggregate wiring 검증은 주석을 거부하고 의미 없는 순서에는 독립적이다", () => {
  for (const source of [
    "      - finalize-regression",
    "          FINALIZE_REGRESSION_RESULT: ${{ needs.finalize-regression.result }}",
  ]) {
    withFixture((root) => {
      const target = path.join(root, ".github/workflows/validate-harness.yml");
      const content = fs.readFileSync(target, "utf8");
      assert.ok(content.includes(source), `fixture pattern missing: ${source}`);
      fs.writeFileSync(target, content.replace(source, `      # ${source.trim()}`));

      const result = runValidator(root);
      assert.equal(result.status, 1, source);
      assert.match(result.stderr, /CI aggregate/);
    });
  }

  withFixture((root) => {
    const target = path.join(root, ".github/workflows/validate-harness.yml");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "      - classify\n      - harness",
        "      - harness\n      - classify",
      )
      .replace(
        "          CLASSIFY_RESULT: ${{ needs.classify.result }}\n          HARNESS_RESULT: ${{ needs.harness.result }}",
        "          HARNESS_RESULT: ${{ needs.harness.result }}\n          CLASSIFY_RESULT: ${{ needs.classify.result }}",
      );
    fs.writeFileSync(target, content);

    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("README는 두 개발 표준 문서를 visible link로 연결해야 한다", () => {
  for (const file of developmentFiles) {
    withFixture((root) => {
      const target = path.join(root, "README.md");
      const content = fs
        .readFileSync(target, "utf8")
        .replace(
          new RegExp(`\\[[^\\]]+\\]\\(${file.replaceAll("/", "\\/")}\\)`),
          file,
        );
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(
          `README.md: ${file}를 가리키는 visible Markdown link가 필요합니다.`,
        ),
        result.stderr,
      );
    });
  }
});

test("네 운영 Skill의 SKILL.md와 완전한 interface YAML을 요구한다", () => {
  for (const skillDirectory of skillDirectories) {
    for (const file of ["SKILL.md", "agents/openai.yaml"]) {
      withFixture((root) => {
        fs.unlinkSync(path.join(root, `${skillDirectory}/${file}`));
        const result = runValidator(root);
        assert.equal(result.status, 1);
        assert.ok(
          result.stderr.includes(
            `필수 Skill 파일이 없습니다: ${skillDirectory}/${file}`,
          ),
          result.stderr,
        );
      });
    }
  }

  const invalidInterfaces = [
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "display_name: 잘못된 top-level 값",
      message: /interface\.display_name/,
    },
    {
      replace: '  short_description: "검증 fixture에서 사용하는 Skill"',
      replacement: '  short_description: ""',
      message: /interface\.short_description/,
    },
    {
      replace:
        '  default_prompt: "이 Skill의 검증 계약을 실행해 주세요."',
      replacement: "  default_prompt:",
      message: /interface\.default_prompt/,
    },
    {
      replace: [
        '  display_name: "검증 Skill 1"',
        '  short_description: "검증 fixture에서 사용하는 Skill"',
        '  default_prompt: "이 Skill의 검증 계약을 실행해 주세요."',
      ].join("\n"),
      replacement: [
        "  nested:",
        '    display_name: "잘못된 nested 이름"',
        '    short_description: "잘못된 nested 설명"',
        '    default_prompt: "잘못된 nested prompt"',
      ].join("\n"),
      message: /interface\.display_name/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: foo: bar",
      message: /YAML block-mapping/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: - x",
      message: /YAML block-mapping/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: *missing",
      message: /YAML block-mapping/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: 검증 Skill 1",
      message: /interface\.display_name/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: false",
      message: /interface\.display_name/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: "  display_name: 123",
      message: /interface\.display_name/,
    },
    {
      replace: '  display_name: "검증 Skill 1"',
      replacement: [
        '  display_name: "검증 Skill 1"',
        "    orphan: 잘못된 scalar child",
      ].join("\n"),
      message: /YAML block-mapping/,
    },
    {
      replace:
        '  default_prompt: "이 Skill의 검증 계약을 실행해 주세요."',
      replacement: [
        '  default_prompt: "이 Skill의 검증 계약을 실행해 주세요."',
        "not yaml [",
      ].join("\n"),
      message: /YAML block-mapping/,
    },
    {
      replace: "interface:",
      replacement: "interface:\n---",
      message: /단일-document YAML block-mapping/,
    },
  ];

  for (const { replace, replacement, message } of invalidInterfaces) {
    withFixture((root) => {
      const target = path.join(
        root,
        `${skillDirectories[0]}/agents/openai.yaml`,
      );
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace(replace, replacement),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("Skill frontmatter는 파일 맨 앞의 단일 block과 정확한 name·description을 요구한다", () => {
  const skillDirectory = skillDirectories[0];
  const expectedName = path.basename(skillDirectory);
  const body = "\n# 검증용 Skill\n";
  const frontmatter = (lines) => ["---", ...lines, "---", body].join("\n");
  const cases = [
    {
      content: "# frontmatter 없는 Skill\n",
      message: /파일 맨 앞.*YAML frontmatter/,
    },
    {
      content: ["---", `name: ${expectedName}`, "description: 설명", body].join(
        "\n",
      ),
      message: /frontmatter 종료 구분자/,
    },
    {
      content: [
        frontmatter([`name: ${expectedName}`, "description: 첫 설명"]),
        frontmatter([`name: ${expectedName}`, "description: 중복 설명"]),
      ].join("\n"),
      message: /frontmatter block은.*정확히 하나/,
    },
    {
      content: frontmatter(["description: 설명"]),
      message: /frontmatter 'name'.*정확히 하나/,
    },
    {
      content: frontmatter([
        `name: ${expectedName}`,
        `name: ${expectedName}`,
        "description: 설명",
      ]),
      message: /frontmatter 'name'.*정확히 하나/,
    },
    {
      content: frontmatter(["name:", "description: 설명"]),
      message: /frontmatter 'name'.*정확히 하나/,
    },
    {
      content: frontmatter(["name: 다른-skill", "description: 설명"]),
      message: /Skill 디렉터리 이름.*일치/,
    },
    {
      content: frontmatter([`name: ${expectedName}`]),
      message: /frontmatter 'description'.*정확히 하나/,
    },
    {
      content: frontmatter([
        `name: ${expectedName}`,
        "description: 설명",
        "description: 중복 설명",
      ]),
      message: /frontmatter 'description'.*정확히 하나/,
    },
    {
      content: frontmatter([`name: ${expectedName}`, 'description: ""']),
      message: /frontmatter 'description'.*정확히 하나/,
    },
  ];

  for (const { content, message } of cases) {
    withFixture((root) => {
      write(root, `${skillDirectory}/SKILL.md`, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("Skill frontmatter는 malformed·non-string scalar 우회를 거부한다", () => {
  const skillDirectory = skillDirectories[0];
  const expectedName = path.basename(skillDirectory);
  const cases = [
    "false",
    "123",
    "null",
    "[설명]",
    "{ value: 설명 }",
    "*description",
    "|",
    '"끝나지 않은 설명',
    "설명: nested mapping",
  ];

  for (const description of cases) {
    withFixture((root) => {
      write(
        root,
        `${skillDirectory}/SKILL.md`,
        [
          "---",
          `name: ${expectedName}`,
          `description: ${description}`,
          "---",
          "",
          "# 검증용 Skill",
          "",
          ...updateProductDocsFixtureContract,
          "",
        ].join("\n"),
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /안전한 단일-line string scalar/);
      assert.match(
        result.stderr,
        /frontmatter 'description'.*정확히 하나/,
      );
    });
  }
});

test("Skill frontmatter는 합법적인 quoted·unquoted description을 허용한다", () => {
  const skillDirectory = skillDirectories[0];
  const expectedName = path.basename(skillDirectory);
  const descriptions = [
    "검증 fixture에서 사용하는 unquoted Skill # 설명 comment",
    '"검증 fixture: quoted description"',
    "'검증 fixture의 ''quoted'' description'",
  ];

  for (const description of descriptions) {
    withFixture((root) => {
      write(
        root,
        `${skillDirectory}/SKILL.md`,
        [
          "---",
          `name: "${expectedName}"`,
          `description: ${description}`,
          "---",
          "",
          "# 검증용 Skill",
          "",
          ...updateProductDocsFixtureContract,
          "",
        ].join("\n"),
      );
      const result = runValidator(root);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

test("Skill interface의 CRLF와 quoted scalar 뒤 YAML comment를 허용한다", () => {
  withFixture((root) => {
    const target = path.join(
      root,
      `${skillDirectories[0]}/agents/openai.yaml`,
    );
    const content = fs
      .readFileSync(target, "utf8")
      .replace("interface:", "---\ninterface:")
      .replace('"검증 Skill 1"', '"검증 Skill 1" # 사용자 표시 이름')
      .replace(
        '"검증 fixture에서 사용하는 Skill"',
        '"검증 fixture에서 사용하는 Skill" # 짧은 설명',
      )
      .replaceAll("\n", "\r\n");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("필수 아키텍처 문서가 하나라도 없으면 거부한다", () => {
  for (const file of architectureFiles) {
    withFixture((root) => {
      fs.unlinkSync(path.join(root, file));
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`필수 아키텍처 문서가 없습니다: ${file}`),
        result.stderr,
      );
    });
  }
});

test("상세 아키텍처 문서의 첫 H2가 한눈에 보기가 아니면 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, architectureDetailFiles[0]);
    const content = fs
      .readFileSync(target, "utf8")
      .replace("## 한눈에 보기", "## 구성요소");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /상세 아키텍처 문서의 첫 H2는 '## 한눈에 보기'여야 합니다/,
    );
  });
});

test("한눈에 보기의 첫 자료가 Mermaid가 아니면 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, architectureDetailFiles[0]);
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "## 한눈에 보기\n\n```mermaid",
        "## 한눈에 보기\n\n설명부터 시작한다.\n\n```mermaid",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /'## 한눈에 보기'의 첫 자료는 Mermaid fenced block이어야 합니다/,
    );
  });
});

test("한눈에 보기 Mermaid의 빈 chart body와 미종결 fence를 거부한다", () => {
  const cases = [
    {
      replace: [
        "```mermaid",
        "flowchart LR",
        "    A[입력] --> B[결과]",
        "```",
      ].join("\n"),
      replacement: ["```mermaid", "", "```"].join("\n"),
      message: /Mermaid chart body가 비어 있습니다/,
    },
    {
      replace: [
        "```mermaid",
        "flowchart LR",
        "    A[입력] --> B[결과]",
        "```",
      ].join("\n"),
      replacement: [
        "```mermaid",
        "flowchart LR",
        "    A[입력] --> B[결과]",
      ].join("\n"),
      message: /Mermaid fenced block이 종결되지 않았습니다/,
    },
  ];

  for (const { replace, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, architectureDetailFiles[0]);
      const content = fs
        .readFileSync(target, "utf8")
        .replace(replace, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("한눈에 보기 Mermaid 뒤 top-level bullet 요약은 3~5개여야 한다", () => {
  const originalBullets = [
    "- 입력이 결과로 이동한다.",
    "- 결과는 화면에 표시된다.",
    "- 구현 기술은 아직 확정하지 않는다.",
  ].join("\n");
  const cases = [
    { count: 0, replacement: "" },
    {
      count: 2,
      replacement: [
        "- 입력이 결과로 이동한다.",
        "- 결과는 화면에 표시된다.",
      ].join("\n"),
    },
    {
      count: 6,
      replacement: Array.from(
        { length: 6 },
        (_, index) => `- 요약 ${index + 1}`,
      ).join("\n"),
    },
  ];

  for (const { count, replacement } of cases) {
    withFixture((root) => {
      const target = path.join(root, architectureDetailFiles[0]);
      const content = fs
        .readFileSync(target, "utf8")
        .replace(originalBullets, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        new RegExp(`visible top-level bullet 요약이 3~5개.*현재 ${count}개`),
      );
    });
  }
});

test("한눈에 보기 Mermaid 직후의 선행 문단과 nested bullet 오산을 거부한다", () => {
  const originalBullets = [
    "- 입력이 결과로 이동한다.",
    "- 결과는 화면에 표시된다.",
    "- 구현 기술은 아직 확정하지 않는다.",
  ].join("\n");
  const cases = [
    {
      replacement: [
        "요약보다 설명이 먼저 나온다.",
        "",
        originalBullets,
      ].join("\n"),
      message: /첫 visible material은 연속된 top-level bullet list/,
    },
    {
      replacement: [
        "- 직접 요약은 하나뿐이다.",
        "  - nested 요약 1",
        "  - nested 요약 2",
      ].join("\n"),
      message: /현재 1개/,
    },
  ];

  for (const { replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, architectureDetailFiles[0]);
      const content = fs
        .readFileSync(target, "utf8")
        .replace(originalBullets, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("Mermaid 요약 앞의 주석은 건너뛰고 intervening fence는 visible material로 거부한다", () => {
  const boundary = [
    "```",
    "",
    "- 입력이 결과로 이동한다.",
  ].join("\n");

  withFixture((root) => {
    const target = path.join(root, architectureDetailFiles[0]);
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        boundary,
        [
          "```",
          "",
          "<!-- Mermaid 요약 설명 -->",
          "",
          "- 입력이 결과로 이동한다.",
        ].join("\n"),
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });

  withFixture((root) => {
    const target = path.join(root, architectureDetailFiles[0]);
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        boundary,
        [
          "```",
          "",
          "```text",
          "요약보다 먼저 나온 fenced block",
          "```",
          "",
          "- 입력이 결과로 이동한다.",
        ].join("\n"),
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Mermaid 직후 첫 visible material은 연속된 top-level bullet list/,
    );
  });
});

test("CommonMark thematic break를 bullet 요약 항목으로 세지 않는다", () => {
  const originalBullets = [
    "- 입력이 결과로 이동한다.",
    "- 결과는 화면에 표시된다.",
    "- 구현 기술은 아직 확정하지 않는다.",
  ].join("\n");

  for (const thematicBreak of ["***", "* * *", "---", "- - -", "_ _ _"]) {
    withFixture((root) => {
      const target = path.join(root, architectureDetailFiles[0]);
      const replacement = [
        thematicBreak,
        "- 결과는 화면에 표시된다.",
        "- 구현 기술은 아직 확정하지 않는다.",
      ].join("\n");
      const content = fs
        .readFileSync(target, "utf8")
        .replace(originalBullets, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /visible top-level bullet 요약이 3~5개/,
      );
    });
  }
});

test("Markdown이 허용하는 1~3칸 들여쓰기 top-level bullet을 허용한다", () => {
  withFixture((root) => {
    const target = path.join(root, architectureDetailFiles[0]);
    const content = fs
      .readFileSync(target, "utf8")
      .replaceAll("\n- ", "\n   - ");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("README는 아키텍처 인덱스를 visible Markdown link로 연결해야 한다", () => {
  const link = "[시스템 아키텍처](docs/architecture/README.md)";
  const replacements = [
    "docs/architecture/README.md",
    "[](docs/architecture/README.md)",
    `\`${link}\``,
    `<!-- ${link} -->`,
    ["```markdown", link, "```"].join("\n"),
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "README.md");
      const content = fs.readFileSync(target, "utf8").replace(link, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /README\.md: docs\/architecture\/README\.md를 가리키는 visible Markdown link가 필요합니다/,
      );
    });
  }
});

test("README의 visible reference-style link를 아키텍처 탐색 링크로 인정한다", () => {
  withFixture((root) => {
    const target = path.join(root, "README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "[시스템 아키텍처](docs/architecture/README.md)",
        "[시스템 아키텍처][architecture-index]",
      )
      .concat(
        "\n## 링크 정의 fixture\n\n[architecture-index]: docs/architecture/README.md\n",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("아키텍처 탐색 topology는 image를 문서 링크로 인정하지 않는다", () => {
  withFixture((root) => {
    const target = path.join(root, "README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "[시스템 아키텍처](docs/architecture/README.md)",
        "![시스템 아키텍처](docs/architecture/README.md)",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /README\.md: docs\/architecture\/README\.md를 가리키는 visible Markdown link가 필요합니다/,
    );
  });

  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "[문서 1](./01_system_context.md)",
        "![문서 1](./01_system_context.md)",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /빠른 선택 표 1번째 행의 '읽을 문서'에는 허용된 상세 아키텍처 문서 링크가 정확히 하나 필요합니다/,
    );
  });

  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const source = "1. [문서 1](./01_system_context.md)";
    const content = fs
      .readFileSync(target, "utf8")
      .replace(source, `1. ![문서 1](./01_system_context.md)`);
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추천 읽기 순서에는 visible Markdown link가 정확히 5개 필요합니다/,
    );
  });
});

test("아키텍처 인덱스의 필수 H2 섹션 누락을 거부한다", () => {
  const requiredSections = [
    "빠른 선택",
    "추천 읽기 순서",
    "정본과의 경계",
    "입력 계약",
    "기술 검증 대기 지도",
  ];

  for (const heading of requiredSections) {
    withFixture((root) => {
      const target = path.join(root, "docs/architecture/README.md");
      const content = fs
        .readFileSync(target, "utf8")
        .replace(`## ${heading}`, `## 누락된 ${heading}`);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`필수 H2 섹션이 없습니다: ${heading}`),
        result.stderr,
      );
    });
  }
});

test("빠른 선택 표의 계약 열과 상세 문서 행 누락을 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(" | 논리 모델 |", " | 다른 모델 |");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /빠른 선택 표는 정확한 header/);
  });

  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const missingFile = architectureDetailFiles[4];
    const missingRow = new RegExp(
      `^.*\\]\\(\\./${path.basename(missingFile).replaceAll(".", "\\.")}\\).*$\\n`,
      "m",
    );
    const content = fs
      .readFileSync(target, "utf8")
      .replace(missingRow, "");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /빠른 선택 표에는 상세 아키텍처 문서 행이 정확히 5개 필요합니다/,
    );
    assert.ok(
      result.stderr.includes(
        `빠른 선택 표의 문서 열은 ${missingFile} 링크를 정확히 한 번 포함해야 합니다.`,
      ),
      result.stderr,
    );
  });

  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const content = fs.readFileSync(target, "utf8");
    const boundary = "\n## 추천 읽기 순서";
    const boundaryIndex = content.indexOf(boundary);
    let quickSelection = content.slice(0, boundaryIndex);
    const remainingSections = content.slice(boundaryIndex);
    const links = architectureDetailFiles.map(
      (file, index) => `[문서 ${index + 1}](./${path.basename(file)})`,
    );
    for (const [index, link] of links.slice(1).entries()) {
      quickSelection = quickSelection.replace(link, `문서 ${index + 2}`);
    }
    quickSelection = quickSelection.replace(links[0], links.join(" / "));
    fs.writeFileSync(target, quickSelection + remainingSections);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /빠른 선택 표 1번째 행의 '읽을 문서'에는 허용된 상세 아키텍처 문서 링크가 정확히 하나 필요합니다/,
    );
    assert.match(
      result.stderr,
      /빠른 선택 표 2번째 행의 '읽을 문서'에는 허용된 상세 아키텍처 문서 링크가 정확히 하나 필요합니다/,
    );
  });
});

test("추천 읽기 순서에서 상세 문서 링크 누락을 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const missingFile = architectureDetailFiles[2];
    const source = `3. [문서 3](./${path.basename(missingFile)})`;
    const content = fs.readFileSync(target, "utf8").replace(source, "3. 문서 3");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.ok(
      result.stderr.includes(
        `추천 읽기 순서는 ${missingFile} 링크를 정확히 한 번 포함해야 합니다.`,
      ),
      result.stderr,
    );
  });

  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "5. [문서 5](./05_storage_and_security.md)",
        [
          "5. [문서 5](./05_storage_and_security.md)",
          "6. [추가 링크](./01_system_context.md)",
        ].join("\n"),
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추천 읽기 순서에는 visible Markdown link가 정확히 5개 필요합니다/,
    );
  });
});

test("추천 읽기 순서는 상세 문서 배열의 순서를 그대로 따라야 한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/architecture/README.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "1. [문서 1](./01_system_context.md)",
        "1. [문서 1](./02_peer_network_and_transport.md)",
      )
      .replace(
        "2. [문서 2](./02_peer_network_and_transport.md)",
        "2. [문서 2](./01_system_context.md)",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추천 읽기 순서는 상세 아키텍처 문서를 지정된 순서대로 연결해야 합니다/,
    );
  });
});

test("아키텍처 문서의 깨진 내부 링크를 거부한다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "docs/architecture/README.md"),
      "\n[없는 문서](./missing.md)\n",
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /docs\/architecture\/README\.md: 깨진 링크 -> \.\/missing\.md/,
    );
  });
});

test("아키텍처 문서의 깨진 image resource를 거부한다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "docs/architecture/README.md"),
      "\n![없는 이미지](./missing.png)\n",
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /docs\/architecture\/README\.md: 깨진 링크 -> \.\/missing\.png/,
    );
  });
});

test("reference-style Markdown link와 image의 깨진 local target을 거부한다", () => {
  const cases = [
    [
      "[없는 문서][missing-document]",
      "[missing-document]: ./missing-reference.md",
    ],
    [
      "![없는 이미지][missing-image]",
      "[missing-image]: ./missing-reference.png",
    ],
  ];

  for (const referenceResource of cases) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "docs/architecture/README.md"),
        `\n${referenceResource.join("\n\n")}\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /docs\/architecture\/README\.md: 깨진 링크 -> \.\/missing-reference\.(?:md|png)/,
      );
    });
  }
});

test("Markdown local target은 저장소 루트 내부의 상대 경로만 허용한다", () => {
  for (const unsafeTarget of [
    "/etc/passwd",
    "C:\\Windows\\system32\\drivers\\etc\\hosts",
    "../../../outside.md",
  ]) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "docs/architecture/README.md"),
        `\n[허용되지 않는 대상](${unsafeTarget})\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(
          `저장소 루트 내부의 상대 링크만 허용됩니다 -> ${unsafeTarget}`,
        ),
        result.stderr,
      );
    });
  }
});

test("정상 fragment와 저장소 루트 내부 local link를 허용한다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "docs/architecture/README.md"),
      [
        "",
        "[현재 문서 위치](#빠른-선택)",
        "[저장소 README](../../README.md)",
        "",
      ].join("\n"),
    );
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("fence·HTML comment·inline code의 pseudo link는 검사하지 않는다", () => {
  const pseudoLinks = [
    ["```markdown", "[없는 문서](./missing.md)", "```"].join("\n"),
    "<!-- [없는 문서](./missing.md) -->",
    "`[없는 문서](./missing.md)`",
    [
      "```markdown",
      "[없는 문서][missing-reference]",
      "[missing-reference]: ./missing.md",
      "```",
    ].join("\n"),
    [
      "<!--",
      "[없는 문서][missing-reference]",
      "[missing-reference]: ./missing.md",
      "-->",
    ].join("\n"),
    [
      "`[없는 문서][missing-reference]`",
      "`[missing-reference]: ./missing.md`",
    ].join("\n"),
  ];

  for (const pseudoLink of pseudoLinks) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, "docs/architecture/README.md"),
        `\n${pseudoLink}\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

test("아키텍처의 정의되지 않은 완전한 계약 참조를 거부한다", () => {
  const cases = [
    {
      id: "PRD-100-FR-999",
      message: /정의되지 않은 PRD 계약 ID PRD-100-FR-999/,
    },
    {
      id: "PRD-100-AC-999",
      message: /정의되지 않은 PRD 계약 ID PRD-100-AC-999/,
    },
    {
      id: "PRD-100-SP-999",
      message: /정의되지 않은 PRD 계약 ID PRD-100-SP-999/,
    },
    {
      id: "PRD-999",
      message: /정의되지 않은 PRD ID PRD-999/,
    },
    {
      id: "POL-03-R-99",
      message: /정의되지 않은 정책 규칙 ID POL-03-R-99/,
    },
    {
      id: "POL-999",
      message: /정의되지 않은 정책 ID POL-999/,
    },
    {
      id: "D-999",
      message: /정의되지 않은 결정 ID D-999/,
    },
    {
      id: "F-999",
      message: /정의되지 않은 기능 ID F-999/,
    },
  ];

  for (const { id, message } of cases) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, architectureDetailFiles[0]),
        `\n참조: ${id}\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("fence와 HTML comment의 pseudo F·D 정의를 현재 정의로 인정하지 않는다", () => {
  const cases = [
    {
      definitionFile: "docs/product-definition/06_feature_inventory.md",
      id: "F-999",
      definition: ["```markdown", "| F-999 | 숨긴 기능 |", "```", ""].join(
        "\n",
      ),
      message: /정의되지 않은 기능 ID F-999/,
    },
    {
      definitionFile: "docs/product-definition/06_feature_inventory.md",
      id: "F-999",
      definition: "<!-- | F-999 | 숨긴 기능 | -->\n",
      message: /정의되지 않은 기능 ID F-999/,
    },
    {
      definitionFile: "docs/product-definition/10_decision_backlog.md",
      id: "D-999",
      definition: ["```markdown", "| D-999 | 숨긴 결정 |", "```", ""].join(
        "\n",
      ),
      message: /정의되지 않은 결정 ID D-999/,
    },
    {
      definitionFile: "docs/product-definition/10_decision_backlog.md",
      id: "D-999",
      definition: "<!-- | D-999 | 숨긴 결정 | -->\n",
      message: /정의되지 않은 결정 ID D-999/,
    },
  ];

  for (const { definitionFile, id, definition, message } of cases) {
    withFixture((root) => {
      write(root, definitionFile, definition);
      fs.appendFileSync(
        path.join(root, architectureDetailFiles[0]),
        `\n참조: ${id}\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("아키텍처의 FR·AC·SP·R shorthand를 거부한다", () => {
  for (const id of ["FR-01", "AC-01", "SP-01", "R-01"]) {
    withFixture((root) => {
      fs.appendFileSync(
        path.join(root, architectureDetailFiles[0]),
        `\n참조: ${id}\n`,
      );
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.ok(
        result.stderr.includes(`네임스페이스 없는 아키텍처 계약 ID ${id}`),
        result.stderr,
      );
    });
  }
});

test("자리수가 과도하거나 안전한 정수가 아닌 ID를 유한 시간에 거부한다", () => {
  const cases = [
    {
      value: `F-${"9".repeat(400)}`,
      message: /ID 숫자부가 너무 깁니다.*최대 16자리/,
    },
    {
      value: "F-Infinity",
      message: /안전한 정수 범위를 벗어난 ID/,
    },
    {
      value: "F-9007199254740992",
      message: /안전한 정수 범위를 벗어난 ID/,
    },
  ];

  for (const { value, message } of cases) {
    withFixture((root) => {
      writeFeatureScope(root, [value]);
      const result = runValidator(root);
      assert.equal(result.status, 1, result.error?.message);
      assert.match(result.stderr, message);
      assert.notEqual(result.error?.code, "ETIMEDOUT");
    });
  }
});

test("과도한 단일 ID 범위와 누적 확장 결과를 반복 전에 거부한다", () => {
  withFixture((root) => {
    writeFeatureScope(root, ["F-01~F-5000"]);
    const result = runValidator(root);
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /ID 범위가 너무 큽니다.*최대 1000개/);
  });

  withFixture((root) => {
    const ranges = Array.from({ length: 11 }, (_, index) => {
      const start = String(index * 1_000 + 1).padStart(5, "0");
      const end = String((index + 1) * 1_000).padStart(5, "0");
      return `F-${start}~F-${end}`;
    });
    writeFeatureScope(root, ranges);
    const result = runValidator(root);
    assert.equal(result.status, 1, result.error?.message);
    assert.match(result.stderr, /ID 확장 결과가 너무 많습니다.*10000개 한도/);
  });
});

test("PRD와 정책의 양방향 추적 연결이 일치하면 통과한다", () => {
  withFixture((root) => {
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /추적성 불일치/);
  });
});

test("PRD의 prose·fence·주석 pseudo row를 추적 데이터로 인정하지 않는다", () => {
  const row =
    "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |";
  const replacements = [
    "PRD-100-FR-101은 PRD-100-AC-101과 POL-100-R-101을 참고한다.",
    ["```markdown", row, "```"].join("\n"),
    `<!-- ${row} -->`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "docs/prd/100_future.md");
      const content = fs.readFileSync(target, "utf8").replace(row, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /추적 매트릭스의 요구사항 누락 PRD-100-FR-101/,
      );
      assert.match(
        result.stderr,
        /어떤 요구사항에도 연결되지 않은 수용 기준 PRD-100-AC-101/,
      );
    });
  }
});

test("정책의 prose·fence·주석 pseudo row를 역추적 데이터로 인정하지 않는다", () => {
  const row =
    "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |";
  const replacements = [
    "POL-100-R-101은 PRD-100-FR-101, PRD-100-AC-101, D-100을 참고한다.",
    ["```markdown", row, "```"].join("\n"),
    `<!-- ${row} -->`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "docs/policies/100_future.md");
      const content = fs.readFileSync(target, "utf8").replace(row, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /추적성 매트릭스의 규칙 누락 POL-100-R-101/,
      );
    });
  }
});

test("fence와 주석의 pseudo 추적 section보다 실제 section만 사용한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |",
        "실제 추적 행 제거",
      )
      .replace(
        "## 1. 성공 기준",
        [
          "```markdown",
          "### 요구사항 추적 매트릭스",
          "| 요구사항 | 수용 기준 | 정책 규칙 |",
          "| --- | --- | --- |",
          "| PRD-100-FR-100 | PRD-100-AC-100 | POL-100-R-100 |",
          "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |",
          "```",
          "",
          "## 1. 성공 기준",
        ].join("\n"),
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추적 매트릭스의 요구사항 누락 PRD-100-FR-101/,
    );
  });

  withFixture((root) => {
    const target = path.join(root, "docs/policies/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |",
        "실제 추적 행 제거",
      )
      .replace(
        "## POL-100-R-100. 필수 동작",
        [
          "<!--",
          "## 추적성",
          "| 정책 규칙 | PRD 요구사항 | 수용 기준 | 관련 결정 |",
          "| --- | --- | --- | --- |",
          "| POL-100-R-100 | PRD-100-FR-100 | PRD-100-AC-100 | D-100 |",
          "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |",
          "-->",
          "",
          "## POL-100-R-100. 필수 동작",
        ].join("\n"),
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추적성 매트릭스의 규칙 누락 POL-100-R-101/,
    );
  });
});

test("추적 표의 정확한 header·구분선·열 수를 요구한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| 요구사항 | 수용 기준 | 정책 규칙 |",
        "| 요구사항 | 수용 기준 | 정책 규칙 | 비고 |",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /정확한 header/);
  });

  withFixture((root) => {
    const target = path.join(root, "docs/policies/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace("|---|---|---|---|", "|---|---|---|");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /4열 Markdown 구분선/);
  });

  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |",
        "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 | 비고 |",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /데이터 행은 3열/);
  });
});

test("fence와 주석에 숨긴 PRD·정책 metadata를 인정하지 않는다", () => {
  const cases = [
    {
      file: "docs/prd/100_future.md",
      row: "| 책임자 | 제품 책임자 |",
      replacement: [
        "```markdown",
        "| 책임자 | 제품 책임자 |",
        "```",
      ].join("\n"),
      message: /메타데이터 '책임자' 누락/,
    },
    {
      file: "docs/policies/100_future.md",
      row: "| 의사결정 상태 | `approved` |",
      replacement: "<!-- | 의사결정 상태 | `approved` | -->",
      message: /메타데이터 '의사결정 상태' 누락/,
    },
  ];

  for (const { file, row, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs.readFileSync(target, "utf8").replace(row, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }
});

test("fence와 주석에 숨긴 PRD 계약·정책 규칙 정의를 인정하지 않는다", () => {
  const cases = [
    {
      file: "docs/prd/100_future.md",
      source: "### PRD-100-FR-101. 추가 결과",
      replacement: "<!-- ### PRD-100-FR-101. 추가 결과 -->",
      message: /정의되지 않은 PRD 계약 ID PRD-100-FR-101/,
    },
    {
      file: "docs/prd/100_future.md",
      source: "### PRD-100-AC-101. 추가 수용 결과",
      replacement: [
        "```markdown",
        "### PRD-100-AC-101. 추가 수용 결과",
        "```",
      ].join("\n"),
      message: /정의되지 않은 PRD 계약 ID PRD-100-AC-101/,
    },
    {
      file: "docs/policies/100_future.md",
      source: "## POL-100-R-101. 추가 동작",
      replacement: [
        "```markdown",
        "## POL-100-R-101. 추가 동작",
        "```",
      ].join("\n"),
      message: /정의되지 않은 정책 규칙 ID POL-100-R-101/,
    },
  ];

  for (const { file, source, replacement, message } of cases) {
    withFixture((root) => {
      const target = path.join(root, file);
      const content = fs
        .readFileSync(target, "utf8")
        .replace(source, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
    });
  }

  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const spikeRow =
      "| PRD-100-SP-100 탐색 | 가능한가? | 근거를 남긴다. |";
    const content = fs
      .readFileSync(target, "utf8")
      .replace(spikeRow, `<!-- ${spikeRow} -->`)
      .concat("\n참조: PRD-100-SP-100\n");
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /정의되지 않은 PRD 계약 ID PRD-100-SP-100/,
    );
  });
});

test("fence와 주석에 숨긴 성공 기준 표를 승인 PRD 구조로 인정하지 않는다", () => {
  const successTable = [
    "| 지표 | 기준선 | 목표 | 측정 기간 | 출처 | 가드레일 |",
    "|---|---|---|---|---|---|",
    "| 성공 | 측정 필요 | 파일럿에서 결정 | 파일럿 기간 | 테스트 기록 | 오류 증가 없음 |",
  ].join("\n");
  const replacements = [
    ["```markdown", successTable, "```"].join("\n"),
    `<!--\n${successTable}\n-->`,
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "docs/prd/100_future.md");
      const content = fs
        .readFileSync(target, "utf8")
        .replace(successTable, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /성공 기준 표/);
    });
  }
});

test("숨긴 TODO와 정의되지 않은 참조는 승인 문서 의미 검사에 포함하지 않는다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    fs.appendFileSync(
      target,
      [
        "<!-- TODO PRD-999-FR-999 POL-999-R-999 -->",
        "```text",
        "TBD PRD-999-AC-999",
        "```",
        "",
      ].join("\n"),
    );
    const result = runValidator(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("미종결 HTML 주석 뒤의 추적 행을 인정하지 않는다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const row =
      "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |";
    const content = fs
      .readFileSync(target, "utf8")
      .replace(row, `<!--\n${row}`);
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /추적 매트릭스의 요구사항 누락 PRD-100-FR-101/,
    );
  });
});

test("PRD 추적 데이터 행마다 FR·AC·POL을 모두 요구한다", () => {
  const row =
    "| PRD-100-FR-101 | PRD-100-AC-101 | POL-100-R-101 |";
  const replacements = [
    "| 요구사항 없음 | PRD-100-AC-101 | POL-100-R-101 |",
    "| PRD-100-FR-101 | 수용 기준 없음 | POL-100-R-101 |",
    "| PRD-100-FR-101 | PRD-100-AC-101 | 정책 규칙 없음 |",
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "docs/prd/100_future.md");
      const content = fs.readFileSync(target, "utf8").replace(row, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /데이터 행에는 PRD 요구사항\(FR\), 수용 기준\(AC\), 정책 규칙\(POL\)이 모두 필요/,
      );
    });
  }
});

test("정책 추적 데이터 행마다 R·FR·AC·D를 모두 요구한다", () => {
  const row =
    "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |";
  const replacements = [
    "| 정책 규칙 없음 | PRD-100-FR-101 | PRD-100-AC-101 | D-100 |",
    "| POL-100-R-101 | 요구사항 없음 | PRD-100-AC-101 | D-100 |",
    "| POL-100-R-101 | PRD-100-FR-101 | 수용 기준 없음 | D-100 |",
    "| POL-100-R-101 | PRD-100-FR-101 | PRD-100-AC-101 | 결정 없음 |",
  ];

  for (const replacement of replacements) {
    withFixture((root) => {
      const target = path.join(root, "docs/policies/100_future.md");
      const content = fs.readFileSync(target, "utf8").replace(row, replacement);
      fs.writeFileSync(target, content);
      const result = runValidator(root);
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /데이터 행에는 정책 규칙\(R\), PRD 요구사항\(FR\), 수용 기준\(AC\), 결정 ID\(D\)가 모두 필요/,
      );
    });
  }
});

test("정책 역추적 표만 한쪽에서 바꾼 연결을 양쪽 불일치로 보고한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/policies/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| POL-100-R-100 | PRD-100-FR-100 | PRD-100-AC-100 | D-100 |",
        "| POL-100-R-100 | PRD-100-FR-101 | PRD-100-AC-100 | D-100 |",
      );
    fs.writeFileSync(target, content);

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /PRD 요구사항 추적 매트릭스에만 있는 연결 PRD-100-FR-100 → POL-100-R-100/,
    );
    assert.match(
      result.stderr,
      /정책 역추적 표에만 있는 연결 PRD-100-FR-101 → POL-100-R-100/,
    );
  });
});

test("네임스페이스가 없는 계약 ID를 거부한다", () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, "docs/prd/100_future.md"),
      "\nFR-100\n",
    );
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /네임스페이스 없는 계약 ID FR-100/);
  });
});

test("완전한 성공 기준 표가 없는 승인 PRD를 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/prd/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| 성공 | 측정 필요 | 파일럿에서 결정 | 파일럿 기간 | 테스트 기록 | 오류 증가 없음 |",
        "| 성공 | 측정 필요 | | 파일럿 기간 | 테스트 기록 | 오류 증가 없음 |",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /성공 기준 표 1번째 행에 빈 값/);
  });
});

test("완전한 역추적성이 없는 정책 규칙을 거부한다", () => {
  withFixture((root) => {
    const target = path.join(root, "docs/policies/100_future.md");
    const content = fs
      .readFileSync(target, "utf8")
      .replace(
        "| POL-100-R-100 | PRD-100-FR-100 | PRD-100-AC-100 | D-100 |",
        "| POL-100-R-100 | PRD-100-FR-100 | 없음 | D-100 |",
      );
    fs.writeFileSync(target, content);
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /수용 기준/);
  });
});

test("잘못된 Claude 작업 지침 연결을 거부한다", () => {
  withFixture((root) => {
    fs.unlinkSync(path.join(root, "CLAUDE.md"));
    write(root, "CLAUDE.md", "# 분리된 작업 지침\n");
    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CLAUDE\.md는 AGENTS\.md/);
  });
});
