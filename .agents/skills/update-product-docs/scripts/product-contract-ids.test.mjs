import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  definedProductContractIds,
  definedProductContractIdsAtGitRef,
  referencedContractIds,
  undefinedProductContractIds,
  visibleContractMarkdown,
} from "./product-contract-ids.mjs";
import { spawnSync } from "node:child_process";

function withFixture(callback) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "lunchtime-contract-ids-"),
  );
  fs.mkdirSync(path.join(root, "docs/prd"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/policies"), { recursive: true });
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), `${content}\n`);
}

test("PRD heading·기술 스파이크 표와 Policy heading만 정의로 수집한다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/prd/01_fixture.md",
      [
        "# PRD-01. fixture",
        "## PRD-01-FR-100. 요구사항",
        "### PRD-01-AC-101. 수용 기준",
        "| PRD-01-SP-102 기술 스파이크 | 책임자 |",
        "| PRD-01-SP-103 | 참조일 뿐인 별도 셀 |",
      ].join("\n"),
    );
    write(
      root,
      "docs/policies/02_fixture.md",
      [
        "# POL-02. fixture",
        "## POL-02-R-100. 정책 규칙",
      ].join("\n"),
    );

    assert.deepEqual(
      [...definedProductContractIds(root)].sort(),
      [
        "POL-02-R-100",
        "PRD-01-AC-101",
        "PRD-01-FR-100",
        "PRD-01-SP-102",
      ],
    );
  });
});

test("README·fence·닫히지 않은 HTML comment의 가짜 정의를 제외한다", () => {
  withFixture((root) => {
    write(root, "docs/prd/README.md", "## PRD-99-FR-99. 가짜 정의");
    write(
      root,
      "docs/prd/01_fixture.md",
      [
        "# PRD-01. fixture",
        "```md",
        "## PRD-98-FR-98. fence 내부",
        "```",
        "## PRD-01-FR-01. 실제 정의",
        "<!--",
        "## PRD-97-AC-97. 닫히지 않은 주석 내부",
      ].join("\n"),
    );
    write(root, "docs/policies/README.md", "## POL-99-R-99. 가짜 정의");
    write(
      root,
      "docs/policies/02_fixture.md",
      [
        "# POL-02. fixture",
        "## POL-02-R-01. 실제 정의",
      ].join("\n"),
    );

    assert.deepEqual(
      [...definedProductContractIds(root)].sort(),
      ["POL-02-R-01", "PRD-01-FR-01"],
    );
  });
});

test("visible Markdown 참조만 수집하고 정의되지 않은 ID를 보고한다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/prd/01_fixture.md",
      [
        "# PRD-01. fixture",
        "## PRD-01-FR-01. 실제 정의",
      ].join("\n"),
    );
    write(
      root,
      "docs/policies/02_fixture.md",
      [
        "# POL-02. fixture",
        "## POL-02-R-01. 실제 정의",
      ].join("\n"),
    );
    const markdown = [
      "PRD-01-FR-01 POL-02-R-01 PRD-01-SP-99",
      "<!-- POL-99-R-99 -->",
      "<!-- PRD-98-AC-98",
    ].join("\n");

    assert.deepEqual(
      [...referencedContractIds(markdown)].sort(),
      ["POL-02-R-01", "PRD-01-FR-01", "PRD-01-SP-99"],
    );
    assert.deepEqual(undefinedProductContractIds(markdown, root), [
      "PRD-01-SP-99",
    ]);
    assert.equal(
      visibleContractMarkdown(markdown).split("\n").length,
      markdown.split("\n").length,
    );
  });
});

test("링크 label의 ID만 보존하고 destination·reference key·HTML attribute는 가린다", () => {
  const markdown = [
    "[PRD-01-FR-01](https://example.com/POL-99-R-99)",
    "[보이는 설명](https://example.com/PRD-99-AC-99)",
    "[PRD-01-AC-01][정본]",
    "[설명][PRD-98-SP-98]",
    "[정본]: https://example.com/POL-97-R-97",
    "[PRD-98-SP-98]: https://example.com/PRD-96-FR-96",
    '<a href="https://example.com/POL-95-R-95">링크</a>',
    "<https://example.com/PRD-94-FR-94>",
    "POL-02-R-01",
  ].join("\n");

  assert.deepEqual(
    [...referencedContractIds(markdown)].sort(),
    ["POL-02-R-01", "PRD-01-AC-01", "PRD-01-FR-01"],
  );
  assert.equal(
    visibleContractMarkdown(markdown).split("\n").length,
    markdown.split("\n").length,
  );
});

test("여러 줄 HTML·링크 destination과 reference 정의의 ID를 가린다", () => {
  const markdown = [
    "<a",
    ' href="https://example.com/PRD-01-AC-02"',
    ">정본 링크</a>",
    "[여러 줄 링크](",
    "  https://example.com/POL-02-R-04",
    ")",
    "[reference]:",
    "  https://example.com/PRD-01-SP-03",
    '  "POL-03-R-01"',
    "화면에 보이는 PRD-01-FR-01",
  ].join("\n");

  assert.deepEqual([...referencedContractIds(markdown)], [
    "PRD-01-FR-01",
  ]);
  assert.equal(
    visibleContractMarkdown(markdown).split("\n").length,
    markdown.split("\n").length,
  );
});

test("image alt·closed details·raw HTML code의 ID와 정의를 제외한다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/prd/01_fixture.md",
      [
        "![PRD-01-FR-90](fixture.png)",
        "<details>",
        "<summary>접힌 계약</summary>",
        "## PRD-01-FR-91. 접힌 정의",
        "</details>",
        "<pre>",
        "## PRD-01-FR-92. raw HTML 정의",
        "</pre>",
        "<span hidden>",
        "## PRD-01-FR-93. hidden 정의",
        "</span>",
        '<div style="display: none">',
        "## PRD-01-FR-94. display none 정의",
        "</div>",
        '<iframe title="x > y">',
        "## PRD-01-FR-95. iframe 정의",
        "</iframe>",
        "<textarea>",
        "## PRD-01-FR-96. textarea 정의",
        "</textarea>",
        "## PRD-01-FR-01. 실제 정의",
      ].join("\n"),
    );
    write(root, "docs/policies/02_fixture.md", "# POL-02. fixture");

    assert.deepEqual([...definedProductContractIds(root)], [
      "PRD-01-FR-01",
    ]);
    assert.deepEqual(
      [...referencedContractIds(
        [
          "![POL-02-R-90](fixture.png)",
          "![POL-02-R-92]",
          "\\\\![POL-02-R-93](fixture.png)",
          "<details>",
          "POL-02-R-91",
          "</details>",
          "POL-02-R-01",
        ].join("\n"),
      )],
      ["POL-02-R-01"],
    );
  });
});

test("계약 ID에 영문·숫자·underscore·hyphen suffix가 붙으면 참조로 인정하지 않는다", () => {
  assert.deepEqual(
    [...referencedContractIds(
      [
        "PRD-01-FR-01-garbage",
        "PRD-01-AC-02_suffix",
        "POL-02-R-03x",
        "POL-02-R-04",
      ].join("\n"),
    )],
    ["POL-02-R-04"],
  );
});

test("working tree가 달라져도 exact Git commit의 제품 ID만 읽는다", () => {
  withFixture((root) => {
    write(
      root,
      "docs/prd/01_fixture.md",
      "# PRD-01. fixture\n\n## PRD-01-FR-01. exact head 정의",
    );
    write(root, "docs/policies/02_fixture.md", "# POL-02. fixture");
    for (const arguments_ of [
      ["init", "-q"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.com"],
      ["add", "--", "docs/prd/01_fixture.md", "docs/policies/02_fixture.md"],
      ["commit", "-q", "-m", "docs: #1 - fixture를 추가한다"],
    ]) {
      const result = spawnSync("git", arguments_, {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    write(
      root,
      "docs/prd/01_fixture.md",
      "# PRD-01. fixture\n\n## PRD-01-FR-99. working tree 정의",
    );

    assert.deepEqual(
      [...definedProductContractIdsAtGitRef(head, root)],
      ["PRD-01-FR-01"],
    );
  });
});

test("exact Git tree의 symlink Markdown 정본을 일반 문서로 읽지 않는다", () => {
  withFixture((root) => {
    write(root, "fixture-target.md", "# PRD-01. fixture");
    fs.symlinkSync(
      "../../fixture-target.md",
      path.join(root, "docs/prd/01_fixture.md"),
    );
    write(root, "docs/policies/02_fixture.md", "# POL-02. fixture");
    for (const arguments_ of [
      ["init", "-q"],
      ["config", "user.name", "Fixture"],
      ["config", "user.email", "fixture@example.com"],
      ["add", "--", "fixture-target.md", "docs/prd/01_fixture.md", "docs/policies/02_fixture.md"],
      ["commit", "-q", "-m", "docs: #1 - symlink fixture를 추가한다"],
    ]) {
      const result = spawnSync("git", arguments_, {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim();
    assert.throws(
      () => definedProductContractIdsAtGitRef(head, root),
      /일반 Markdown blob이 아닙니다/,
    );
  });
});
