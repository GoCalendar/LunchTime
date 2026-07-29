import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRepository } from "./validate-product-docs.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
}

function replace(root, relativePath, source, replacement) {
  const target = path.join(root, relativePath);
  const content = fs.readFileSync(target, "utf8");
  assert.ok(content.includes(source), `fixture pattern missing: ${source}`);
  fs.writeFileSync(target, content.replace(source, replacement));
}

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "lunchtime-product-docs-"),
  );

  write(
    root,
    "README.md",
    [
      "# Fixture",
      "",
      "- [Architecture](docs/architecture/README.md)",
      "- [Harness](docs/development/01_harness_guide.md)",
      "- [Tests](docs/development/02_testing_standard.md)",
      "- [CI](docs/development/03_validation_ci_flow.md)",
    ].join("\n"),
  );
  write(root, "AGENTS.md", "# Fixture agents");
  fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.symlinkSync("../.agents/skills", path.join(root, ".claude/skills"));

  write(
    root,
    "docs/prd/README.md",
    "# PRD\n\n- [Fixture](01_fixture.md)",
  );
  write(
    root,
    "docs/prd/01_fixture.md",
    [
      "# PRD-01. Fixture",
      "",
      "| 항목 | 값 |",
      "|---|---|",
      "| 의사결정 상태 | approved |",
      "| 전달 상태 | delivered |",
      "| 책임자 | Product |",
      "| 마지막 검토 | 2026-07-29 |",
      "",
      "## PRD-01-FR-01. 행동",
      "",
      "행동은 POL-01-R-01을 따른다.",
      "",
      "## PRD-01-AC-01. 결과",
      "",
      "결과를 확인한다.",
      "",
      "### 요구사항 추적 매트릭스",
      "",
      "| 요구사항 | 수용 기준 | 정책 규칙 |",
      "|---|---|---|",
      "| PRD-01-FR-01 | PRD-01-AC-01 | POL-01-R-01 |",
      "",
      "## 성공 기준",
      "",
      "| 지표 | 기준선 | 목표 | 측정 기간 | 출처 | 가드레일 |",
      "|---|---|---|---|---|---|",
      "| 성공률 | 0% | 100% | 1주 | 테스트 | 오류 0 |",
    ].join("\n"),
  );
  write(
    root,
    "docs/policies/README.md",
    "# Policy\n\n- [Fixture](01_fixture.md)",
  );
  write(
    root,
    "docs/policies/01_fixture.md",
    [
      "# POL-01. Fixture",
      "",
      "| 항목 | 값 |",
      "|---|---|",
      "| 의사결정 상태 | approved |",
      "| 책임자 | Product |",
      "| 마지막 검토 | 2026-07-29 |",
      "",
      "## POL-01-R-01. 규칙",
      "",
      "PRD-01-FR-01과 PRD-01-AC-01을 보장한다.",
      "",
      "## 추적성",
      "",
      "| 정책 규칙 | PRD 요구사항 | 수용 기준 | 관련 결정 |",
      "|---|---|---|---|",
      "| POL-01-R-01 | PRD-01-FR-01 | PRD-01-AC-01 | D-01 |",
    ].join("\n"),
  );
  write(
    root,
    "docs/architecture/README.md",
    "# Architecture\n\nPRD-01-FR-01과 POL-01-R-01을 구현한다.",
  );
  for (const file of [
    "docs/development/01_harness_guide.md",
    "docs/development/02_testing_standard.md",
    "docs/development/03_validation_ci_flow.md",
  ]) {
    write(root, file, `# ${path.basename(file)}`);
  }

  for (const skill of [
    "update-product-docs",
    "run-github-work-item",
    "commit-work-item",
    "open-pull-request",
  ]) {
    write(
      root,
      `.agents/skills/${skill}/SKILL.md`,
      `---\nname: ${skill}\ndescription: fixture\n---\n\n# ${skill}`,
    );
    write(
      root,
      `.agents/skills/${skill}/agents/openai.yaml`,
      `interface:\n  display_name: "${skill}"\n  short_description: "fixture"\n  default_prompt: "fixture"`,
    );
  }

  write(
    root,
    ".github/workflows/validate-harness.yml",
    [
      "name: harness",
      "on:",
      "  pull_request:",
      "    types:",
      "      - opened",
      "      - synchronize",
      "  workflow_dispatch:",
      "jobs:",
      "  validate:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "        with:",
      "          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
      "      - run: git diff --name-only --diff-filter=ACDMRT",
      "      - run: |",
      "          declare -A deleted_tools=()",
      '          paired_test="${changed_path%.mjs}.test.mjs"',
      '          if [ -f "$paired_test" ]; then',
      '            selected_tests["$paired_test"]=1',
      "          fi",
      '          git grep -n -F -- "$deleted_name"',
    ].join("\n"),
  );
  write(
    root,
    ".github/workflows/app-ci.yml",
    [
      "name: app",
      "on:",
      "  pull_request:",
      "    types:",
      "      - opened",
      "      - synchronize",
      "  workflow_dispatch:",
      "jobs:",
      "  app-build:",
      "    runs-on: macos-15",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "        with:",
      "          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
      "      - run: |",
      "          xcodebuild test \\",
      "            -project LunchTime.xcodeproj",
      "  app-test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "        with:",
      "          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
    ].join("\n"),
  );
  write(
    root,
    ".github/workflows/validate-pr-metadata.yml",
    [
      "name: metadata",
      "on:",
      "  pull_request:",
      "jobs:",
      "  pr-metadata:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "        with:",
      "          ref: ${{ github.event.pull_request.head.sha }}",
      "      - run: |",
      "          gh api \\",
      "            repos/example/repository/pulls/1",
    ].join("\n"),
  );

  return root;
}

function withFixture(callback) {
  const root = createFixture();
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function errorText(root) {
  return validateRepository(root).errors.join("\n");
}

test("현재 저장소의 활성 제품 계약과 최소 CI가 통과한다", () => {
  const result = validateRepository(repositoryRoot);
  assert.deepEqual(result.errors, []);
  assert.ok(result.counts.prd > 0);
  assert.ok(result.counts.policy > 0);
});

test("최소 fixture의 PRD·Policy 추적성과 CI 계약이 통과한다", () => {
  withFixture((root) => {
    assert.deepEqual(validateRepository(root).errors, []);
  });
});

test("product-definition archive는 존재 여부와 내용에 관계없이 읽지 않는다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/product-definition/history.md",
      "PRD-99-FR-99  \n[broken](missing.md)",
    );
    assert.deepEqual(validateRepository(root).errors, []);
  });
});

test("PRD namespace·metadata와 승인 성공 기준을 검증한다", () => {
  withFixture((root) => {
    replace(root, "docs/prd/01_fixture.md", "# PRD-01.", "# PRD-02.");
    replace(
      root,
      "docs/prd/01_fixture.md",
      "| 전달 상태 | delivered |",
      "| 전달 상태 | unknown |",
    );
    replace(root, "docs/prd/01_fixture.md", "## 성공 기준", "## 관찰");
    const output = errorText(root);
    assert.match(output, /파일 번호와 PRD-02가 일치하지 않습니다/);
    assert.match(output, /전달 상태.*unknown/);
    assert.match(output, /승인 PRD의 성공 기준 섹션이 없습니다/);
  });
});

test("PRD와 Policy의 양방향 추적 불일치를 거부한다", () => {
  withFixture((root) => {
    replace(
      root,
      "docs/policies/01_fixture.md",
      "| POL-01-R-01 | PRD-01-FR-01 |",
      "| POL-01-R-01 | PRD-01-FR-99 |",
    );
    const output = errorText(root);
    assert.match(output, /정의되지 않은 제품 계약 ID PRD-01-FR-99/);
    assert.match(output, /추적성 불일치/);
  });
});

test("활성 정본과 Architecture의 정의되지 않은 계약 ID를 거부한다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/architecture/01_detail.md",
      "# Detail\n\nPRD-01-AC-99와 POL-01-R-99",
    );
    const output = errorText(root);
    assert.match(output, /PRD-01-AC-99/);
    assert.match(output, /POL-01-R-99/);
  });
});

test("활성 문서의 깨진 로컬 링크만 검사한다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/development/04_links.md",
      [
        "# Links",
        "",
        "```md",
        "[hidden](hidden.md)",
        "```",
        "<!-- [comment](comment.md) -->",
        "[broken](missing.md)",
      ].join("\n"),
    );
    const output = errorText(root);
    assert.match(output, /깨진 링크 -> missing\.md/);
    assert.doesNotMatch(output, /hidden\.md|comment\.md/);
  });
});

test("제품 하위 인덱스는 정본 파일을 연결해야 한다", () => {
  withFixture((root) => {
    write(root, "docs/prd/README.md", "# PRD");
    assert.match(errorText(root), /docs\/prd\/README\.md 인덱스 누락/);
  });
});

test("하네스와 앱 CI는 head 변경만 자동 실행하고 exact head를 사용한다", () => {
  withFixture((root) => {
    replace(
      root,
      ".github/workflows/validate-harness.yml",
      "      - synchronize",
      "      - reopened",
    );
    replace(
      root,
      ".github/workflows/app-ci.yml",
      "          ref: ${{ github.event.pull_request.head.sha || github.sha }}",
      "          ref: main",
    );
    const output = errorText(root);
    assert.match(output, /opened\+synchronize/);
    assert.match(output, /app-ci\.yml: exact PR head checkout 누락/);
  });
});

test("하네스 CI는 삭제된 도구의 paired test와 잔존 참조를 확인한다", () => {
  withFixture((root) => {
    const harnessFile = ".github/workflows/validate-harness.yml";
    replace(
      root,
      harnessFile,
      'paired_test="${changed_path%.mjs}.test.mjs"',
      'paired_test="${changed_path%.mjs}.spec.mjs"',
    );
    replace(
      root,
      harnessFile,
      'git grep -n -F -- "$deleted_name"',
      'echo "$deleted_name"',
    );
    const output = errorText(root);
    assert.match(output, /잔존 paired test/);
    assert.match(output, /잔존 참조 검사/);
  });
});

test("앱 CI의 중복 build·test와 PR API 중복 조회를 거부한다", () => {
  withFixture((root) => {
    const appFile = ".github/workflows/app-ci.yml";
    replace(
      root,
      appFile,
      "          xcodebuild test \\",
      "          xcodebuild build \\\n            -project LunchTime.xcodeproj\n          xcodebuild test \\\n            -project LunchTime.xcodeproj\n          xcodebuild test \\",
    );
    replace(
      root,
      ".github/workflows/validate-pr-metadata.yml",
      "          gh api \\",
      "          gh api \\\n            repos/example/first\n          gh api \\",
    );
    const output = errorText(root);
    assert.match(output, /xcodebuild test는 한 번/);
    assert.match(output, /별도 build를 중복 실행/);
    assert.match(output, /live PR API 조회는 한 번/);
  });
});

test("공용 지침과 Skill symlink 경계를 유지한다", () => {
  withFixture((root) => {
    fs.unlinkSync(path.join(root, "CLAUDE.md"));
    write(root, "CLAUDE.md", "not a symlink");
    assert.match(errorText(root), /CLAUDE\.md는 AGENTS\.md/);
  });
});
