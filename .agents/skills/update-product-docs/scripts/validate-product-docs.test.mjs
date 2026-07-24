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
