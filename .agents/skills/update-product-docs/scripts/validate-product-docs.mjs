#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];
const excludedPaths = new Set();
const args = process.argv.slice(2);

for (let index = 0; index < args.length; index += 1) {
  let value;
  if (args[index] === "--exclude") {
    value = args[index + 1];
    index += 1;
  } else if (args[index].startsWith("--exclude=")) {
    value = args[index].slice("--exclude=".length);
  } else {
    errors.push(`알 수 없는 인자: ${args[index]}`);
    continue;
  }

  if (!value) {
    errors.push("--exclude에는 저장소 기준 상대 경로가 필요합니다.");
    continue;
  }

  const normalized = path.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    path.isAbsolute(normalized) ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    errors.push(`제외 경로는 저장소 안의 상대 경로여야 합니다: ${value}`);
    continue;
  }
  excludedPaths.add(normalized);
}

function isExcluded(relativePath) {
  const normalized = path.normalize(relativePath);
  return [...excludedPaths].some(
    (excluded) =>
      normalized === excluded ||
      normalized.startsWith(`${excluded}${path.sep}`),
  );
}

for (const target of ["README.md", "docs/product-definition"]) {
  if (!fs.existsSync(path.join(root, target))) {
    errors.push(`필수 경로가 없습니다: ${target}`);
  }
}

function walk(relativePath) {
  if (isExcluded(relativePath)) return [];
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.lstatSync(absolutePath);
  if (stat.isFile()) return [relativePath];
  return fs
    .readdirSync(absolutePath, { withFileTypes: true })
    .flatMap((entry) => walk(path.join(relativePath, entry.name)));
}

function expandIds(text, prefix) {
  const ids = [];
  const pattern = new RegExp(
    `\\b${prefix}-(\\d{2,})(?:~${prefix}-(\\d{2,}))?`,
    "g",
  );

  for (const match of text.matchAll(pattern)) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (end < start) {
      errors.push(`역순 ID 범위: ${match[0]}`);
      continue;
    }
    for (let number = start; number <= end; number += 1) {
      ids.push(`${prefix}-${String(number).padStart(2, "0")}`);
    }
  }

  return ids;
}

function reportDuplicateIds(ids, label) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${label} 중복: ${id}`);
    seen.add(id);
  }
}

const markdownFiles = [
  "README.md",
  ...walk("docs").filter((file) => file.endsWith(".md")),
].sort();

for (const file of markdownFiles) {
  const content = fs.readFileSync(path.join(root, file), "utf8");

  if (!content.endsWith("\n")) {
    errors.push(`${file}: EOF newline이 없습니다.`);
  }

  content.split("\n").forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      errors.push(`${file}:${index + 1}: trailing whitespace`);
    }
  });

  for (const match of content.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split("#")[0];
    if (!target) continue;
    const resolved = path.resolve(root, path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`${file}: 깨진 링크 -> ${target}`);
    }
  }
}

const inventoryPath = path.join(
  root,
  "docs/product-definition/06_feature_inventory.md",
);

if (fs.existsSync(inventoryPath)) {
  const inventory = fs.readFileSync(inventoryPath, "utf8");
  const definitions = [
    ...inventory.matchAll(/^\| (F-\d{2,}) \|/gm),
  ].map((match) => match[1]);
  const definitionSet = new Set(definitions);

  reportDuplicateIds(definitions, "기능 ID");

  const canonicalDocs = markdownFiles.filter(
    (file) =>
      file.startsWith("docs/prd/") || file.startsWith("docs/policies/"),
  );

  for (const file of canonicalDocs) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of content.matchAll(/\bF-(\d{2,})\b/g)) {
      const id = `F-${match[1]}`;
      if (!definitionSet.has(id)) {
        errors.push(`${file}: 정의되지 않은 기능 ID ${id}`);
      }
    }
  }

  const scopePath = path.join(
    root,
    "docs/product-definition/09_scope_proposal.md",
  );
  if (fs.existsSync(scopePath)) {
    const scopeRows = fs
      .readFileSync(scopePath, "utf8")
      .split("\n")
      .filter((line) =>
        /^\| (확정 MVP|확정 후속|Retired|선행 검증·MVP 동작 계약) \|/.test(
          line,
        ),
      )
      .join("\n");
    const classified = expandIds(scopeRows, "F");
    reportDuplicateIds(classified, "범위 분류 ID");
    for (const id of definitions) {
      if (!classified.includes(id)) errors.push(`범위 분류 누락: ${id}`);
    }
    for (const id of classified) {
      if (!definitionSet.has(id)) errors.push(`범위 분류의 미정의 ID: ${id}`);
    }
  }

  const experiencePath = path.join(
    root,
    "docs/product-definition/07_experience_structure.md",
  );
  if (fs.existsSync(experiencePath)) {
    const experience = fs.readFileSync(experiencePath, "utf8");
    const mapping = experience.match(
      /## 기능 배치 검증([\s\S]*?)(?=\n## |\s*$)/,
    );
    if (!mapping) {
      errors.push("07_experience_structure.md: 기능 배치 검증 섹션 누락");
    } else {
      const mapped = new Set(expandIds(mapping[1], "F"));
      for (const id of definitions) {
        if (!mapped.has(id)) errors.push(`경험·시스템 배치 누락: ${id}`);
      }
    }
  }
}

const backlogPath = path.join(
  root,
  "docs/product-definition/10_decision_backlog.md",
);
if (fs.existsSync(backlogPath)) {
  const backlog = fs.readFileSync(backlogPath, "utf8");
  const decisions = [
    ...backlog.matchAll(/^\| (D-\d{2,}) \|/gm),
  ].map((match) => match[1]);
  const decisionSet = new Set(decisions);
  reportDuplicateIds(decisions, "결정 ID");

  for (const file of markdownFiles.filter(
    (entry) =>
      entry.startsWith("docs/prd/") || entry.startsWith("docs/policies/"),
  )) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    for (const id of expandIds(content, "D")) {
      if (!decisionSet.has(id)) {
        errors.push(`${file}: 정의되지 않은 결정 ID ${id}`);
      }
    }
  }
}

const readmePath = path.join(root, "README.md");
const readme = fs.existsSync(readmePath)
  ? fs.readFileSync(readmePath, "utf8")
  : "";

for (const directory of ["docs/prd", "docs/policies"]) {
  for (const file of walk(directory).filter((entry) => entry.endsWith(".md"))) {
    if (!readme.includes(file)) {
      errors.push(`README 인덱스 누락: ${file}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `제품 문서 검증 통과: Markdown ${markdownFiles.length}개, 제외 ${excludedPaths.size}개, 오류 0개`,
);
