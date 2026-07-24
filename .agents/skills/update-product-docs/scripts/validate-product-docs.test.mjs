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
  write(
    root,
    developmentFiles[0],
    [
      "# 개발 하네스 가이드",
      "",
      ...developmentOverview,
      ...Array.from({ length: 11 }, (_, index) => {
        const number = String(index + 1).padStart(2, "0");
        return [
          `## STEP ${number}. 작업 단계`,
          "",
          `- **목적:** ${number}단계의 목적을 확인한다.`,
          `- **핵심 입력:** ${number}단계 입력 계약`,
          `- **완료 조건:** ${number}단계 증거가 남는다.`,
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
