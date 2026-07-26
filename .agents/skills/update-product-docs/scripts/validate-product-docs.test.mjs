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
const updateProductDocsFixtureContract = [
  "승인된 결정과 planned ID가 있을 때 같은 이슈, branch와 PR에서 작성한다.",
  "별도 문서 이슈나 PR을 만들 필요는 없다.",
  "Ready 전 planned ID를 실제 ID 정의, README·하위 인덱스, validator와 구현·테스트에 연결한다.",
  "namespace에 맞는 `NN_*.md` concrete planned definition file을 소유하며 README와 재귀 glob만으로는 정의하지 않는다.",
  "exact PR head Git tree에서 정의를 읽고 image alt, raw HTML과 <details>를 제외한다.",
  "미결정 제품 선택이 남으면 중단한다.",
];
const runGithubWorkItemFixtureContract = [
  "요청·파생 label의 정확한 집합을 요구하며 요청하지 않은 label은 보존한다.",
  "stale `dependency:blocked`는 live 의존 관계를 재확인한 뒤 제한적으로 복구한다.",
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
  "gh pr merge는 shell 문자열이 아니라 --squash와 --match-head-commit <head>를 포함한 각각 별도 argv로 실행한다.",
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
    "| 작업 범위·경로·행동 시나리오·검증 계획 | GitHub 이슈 | 구현 입력으로 연결 |",
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
      "## PR과 작업 완료",
      "",
      "- PR finalize와 로컬 정리는 [open-pull-request](.agents/skills/open-pull-request/SKILL.md)가 소유한다.",
      "- 이슈·Project 완료 전이는 [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)가 소유한다.",
      "",
    ].join("\n"),
  );
  write(
    root,
    "CONTRIBUTING.md",
    [
      "# 기여 지침",
      "",
      "## 8. 병합과 정리",
      "",
      "- PR finalize와 로컬 정리는 [open-pull-request](.agents/skills/open-pull-request/SKILL.md)가 소유한다.",
      "- 이슈·Project 완료 전이는 [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)가 소유한다.",
      "- 필수 승인 수는 1인 운영을 막지 않도록 0으로 유지합니다. 승인 수와 무관하게 생성된 리뷰 대화는 모두 해결해야 합니다.",
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
      "jobs:",
      "  validate:",
      "    steps:",
      "      - run: |",
      "          node --check .agents/skills/update-product-docs/scripts/product-contract-ids.mjs",
      "          node --check .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      "          node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      "          node --check .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs",
      "          node --test .agents/skills/commit-work-item/scripts/validate-commit-paths.test.mjs",
      "          node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs \\",
      "            --index",
      "          node --check .agents/skills/open-pull-request/scripts/validate-finalize.mjs",
      "          node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
      "          node --check .agents/skills/open-pull-request/scripts/finalize-merge.mjs",
      "          node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
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
        /하네스 owner 라우팅 구역은.*rendered 2개/,
      );
    });
  }
});

test("entity·inline code로 꾸민 owner H2도 rendered 중복으로 계산한다", () => {
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
        /하네스 owner 라우팅 구역은.*rendered 2개/,
      );
    });
  }
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
      .concat("\n[architecture-index]: docs/architecture/README.md\n");
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
