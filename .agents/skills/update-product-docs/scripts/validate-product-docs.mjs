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

for (const target of [
  "README.md",
  "docs/product-definition",
  "docs/prd",
  "docs/policies",
]) {
  if (!fs.existsSync(path.join(root, target))) {
    errors.push(`필수 경로가 없습니다: ${target}`);
  }
}

const claudeSkillsPath = path.join(root, ".claude/skills");
if (!fs.existsSync(claudeSkillsPath)) {
  errors.push("Claude Skill 연결이 없습니다: .claude/skills");
} else {
  const stat = fs.lstatSync(claudeSkillsPath);
  if (!stat.isSymbolicLink()) {
    errors.push(".claude/skills는 ../.agents/skills를 가리키는 심볼릭 링크여야 합니다.");
  } else if (fs.readlinkSync(claudeSkillsPath) !== "../.agents/skills") {
    errors.push(
      `.claude/skills 대상 오류: ${fs.readlinkSync(claudeSkillsPath)} (기대: ../.agents/skills)`,
    );
  }
}

const agentsInstructionsPath = path.join(root, "AGENTS.md");
const claudeInstructionsPath = path.join(root, "CLAUDE.md");
if (!fs.existsSync(agentsInstructionsPath)) {
  errors.push("공용 AI 작업 협약이 없습니다: AGENTS.md");
}
if (!fs.existsSync(claudeInstructionsPath)) {
  errors.push("Claude 작업 협약 연결이 없습니다: CLAUDE.md");
} else {
  const stat = fs.lstatSync(claudeInstructionsPath);
  if (!stat.isSymbolicLink()) {
    errors.push("CLAUDE.md는 AGENTS.md를 가리키는 심볼릭 링크여야 합니다.");
  } else if (fs.readlinkSync(claudeInstructionsPath) !== "AGENTS.md") {
    errors.push(
      `CLAUDE.md 대상 오류: ${fs.readlinkSync(claudeInstructionsPath)} (기대: AGENTS.md)`,
    );
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

const MAX_ID_DIGITS = 16;
const MAX_ID_RANGE_COUNT = 1_000;
const MAX_EXPANDED_ID_COUNT = 10_000;

function expandIds(text, prefix) {
  const ranges = [];
  let expandedCount = 0;
  let outputLimitExceeded = false;
  const pattern = new RegExp(
    `\\b${prefix}-(\\d{2,}|Infinity)(?:~${prefix}-(\\d{2,}|Infinity))?\\b`,
    "g",
  );

  for (const match of text.matchAll(pattern)) {
    const startText = match[1];
    const endText = match[2] ?? startText;
    if (
      startText.length > MAX_ID_DIGITS ||
      endText.length > MAX_ID_DIGITS
    ) {
      errors.push(
        `ID 숫자부가 너무 깁니다: ${match[0]} (최대 ${MAX_ID_DIGITS}자리). 범위를 더 작은 유효 ID로 나누세요.`,
      );
      continue;
    }

    const start = Number(startText);
    const end = Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      errors.push(
        `안전한 정수 범위를 벗어난 ID: ${match[0]}. 숫자부는 JavaScript 안전한 정수 범위 안의 값이어야 합니다.`,
      );
      continue;
    }
    if (end < start) {
      errors.push(`역순 ID 범위: ${match[0]}`);
      continue;
    }

    const rangeCount = end - start + 1;
    if (
      !Number.isSafeInteger(rangeCount) ||
      rangeCount > MAX_ID_RANGE_COUNT
    ) {
      errors.push(
        `ID 범위가 너무 큽니다: ${match[0]} (한 범위 최대 ${MAX_ID_RANGE_COUNT}개). 범위를 줄이세요.`,
      );
      continue;
    }
    if (expandedCount > MAX_EXPANDED_ID_COUNT - rangeCount) {
      errors.push(
        `ID 확장 결과가 너무 많습니다: ${match[0]} 추가 시 전체 ${MAX_EXPANDED_ID_COUNT}개 한도를 넘습니다. 입력 범위를 줄이세요.`,
      );
      outputLimitExceeded = true;
      continue;
    }
    ranges.push({ start, count: rangeCount });
    expandedCount += rangeCount;
  }

  if (outputLimitExceeded) return [];

  const ids = [];
  for (const { start, count } of ranges) {
    for (let offset = 0; offset < count; offset += 1) {
      const number = start + offset;
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

function normalizeMetadataValue(value) {
  return value.trim().replace(/^`([^`]*)`$/, "$1").trim();
}

function readMetadata(content, file, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^\\|\\s*${escapedLabel}\\s*\\|\\s*(.*?)\\s*\\|$`, "m"),
  );
  if (!match) {
    errors.push(`${file}: 메타데이터 '${label}' 누락`);
    return "";
  }
  const value = normalizeMetadataValue(match[1]);
  if (!value) errors.push(`${file}: 메타데이터 '${label}' 값 누락`);
  return value;
}

function validateMetadataValue(file, label, value, allowedValues) {
  if (value && !allowedValues.includes(value)) {
    errors.push(
      `${file}: 메타데이터 '${label}' 값 오류: ${value} (허용: ${allowedValues.join(", ")})`,
    );
  }
}

function validateReviewDate(file, value) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${file}: '마지막 검토'는 YYYY-MM-DD 형식이어야 합니다: ${value}`);
    return;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push(`${file}: 유효하지 않은 '마지막 검토' 날짜: ${value}`);
  }
}

function recordDefinition(definitions, id, file) {
  const previous = definitions.get(id);
  if (previous) {
    errors.push(`계약 ID 중복: ${id} (${previous}, ${file})`);
    return;
  }
  definitions.set(id, file);
}

function parseMarkdownTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function scanFencedBlockRanges(text) {
  const ranges = [];
  let open;
  let offset = 0;

  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const rawLine = match[0];
    if (!rawLine) break;
    const line = rawLine.replace(/\n$/, "");
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

    if (fence) {
      const marker = fence[1];
      const suffix = fence[2];
      if (!open) {
        open = {
          character: marker[0],
          length: marker.length,
          start: offset,
        };
      } else if (
        marker[0] === open.character &&
        marker.length >= open.length &&
        suffix.trim() === ""
      ) {
        ranges.push({ start: open.start, end: offset + rawLine.length });
        open = undefined;
      }
    }
    offset += rawLine.length;
  }

  if (open) ranges.push({ start: open.start, end: text.length });
  return ranges;
}

function maskRanges(text, ranges) {
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += text.slice(cursor, range.start);
    result += text.slice(range.start, range.end).replace(/[^\n]/g, " ");
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

function maskHtmlComments(text) {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("<!--", cursor);
    if (start < 0) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, start);
    const closing = text.indexOf("-->", start + 4);
    const end = closing < 0 ? text.length : closing + 3;
    result += text.slice(start, end).replace(/[^\n]/g, " ");
    cursor = end;
  }

  return result;
}

function maskInvisibleMarkdown(text) {
  return maskHtmlComments(maskRanges(text, scanFencedBlockRanges(text)));
}

function sameCells(actual, expected) {
  return (
    actual?.length === expected.length &&
    actual.every((cell, index) => cell === expected[index])
  );
}

function readTraceTableRows(section, { file, label, headers }) {
  const lines = maskInvisibleMarkdown(section).split("\n");
  const headerIndexes = lines
    .map((line, index) => {
      const cells = parseMarkdownTableCells(line);
      return headers.some((header) => sameCells(cells, header)) ? index : -1;
    })
    .filter((index) => index >= 0);

  if (headerIndexes.length !== 1) {
    const expected = headers
      .map((header) => `| ${header.join(" | ")} |`)
      .join(" 또는 ");
    errors.push(
      `${file}: ${label} 표는 정확한 header ${expected}를 정확히 하나 사용해야 합니다.`,
    );
    return [];
  }

  const headerIndex = headerIndexes[0];
  const columnCount = headers[0].length;
  const separator = parseMarkdownTableCells(lines[headerIndex + 1] ?? "");
  if (
    separator?.length !== columnCount ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    errors.push(
      `${file}: ${label} 표 header 바로 아래에 ${columnCount}열 Markdown 구분선이 필요합니다.`,
    );
    return [];
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) break;
    const cells = parseMarkdownTableCells(line);
    if (!cells) break;
    if (cells.length !== columnCount) {
      errors.push(
        `${file}: ${label} 표 ${index - headerIndex - 1}번째 데이터 행은 ${columnCount}열이어야 합니다.`,
      );
      continue;
    }
    rows.push(cells);
  }

  if (rows.length === 0) {
    errors.push(`${file}: ${label} 표에 유효한 데이터 행이 필요합니다.`);
  }
  return rows;
}

function createTraceEdge(requirement, policyRule) {
  return `${requirement}\u0000${policyRule}`;
}

function formatTraceEdge(edge) {
  const [requirement, policyRule] = edge.split("\u0000");
  return `${requirement} → ${policyRule}`;
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

const prdFiles = walk("docs/prd")
  .filter(
    (file) => file.endsWith(".md") && path.basename(file) !== "README.md",
  )
  .sort();
const policyFiles = walk("docs/policies")
  .filter(
    (file) => file.endsWith(".md") && path.basename(file) !== "README.md",
  )
  .sort();
const canonicalFiles = [...prdFiles, ...policyFiles];
const prdIds = new Map();
const policyIds = new Map();
const requirementIds = new Map();
const policyRuleIds = new Map();
const approvedFiles = new Set();
const prdTraceEdges = new Set();
const policyTraceEdges = new Set();

for (const file of prdFiles) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const visibleContent = maskInvisibleMarkdown(content);
  const firstLine = visibleContent.split("\n", 1)[0];
  const heading = firstLine.match(/^# (PRD-(\d{2,}))\.\s+\S/);
  const filename = path.basename(file).match(/^(\d{2,})_/);

  if (!heading) {
    errors.push(`${file}: 첫 줄은 '# PRD-NN. 제목' 형식이어야 합니다.`);
    continue;
  }

  const [, prdId, number] = heading;
  if (!filename || filename[1] !== number) {
    errors.push(`${file}: 파일 번호와 ${prdId}가 일치하지 않습니다.`);
  }
  recordDefinition(prdIds, prdId, file);

  const decisionStatus = readMetadata(
    visibleContent,
    file,
    "의사결정 상태",
  );
  const deliveryStatus = readMetadata(visibleContent, file, "전달 상태");
  const owner = readMetadata(visibleContent, file, "책임자");
  const reviewDate = readMetadata(visibleContent, file, "마지막 검토");
  readMetadata(visibleContent, file, "관련 결정");
  readMetadata(visibleContent, file, "관련 정책");
  validateMetadataValue(file, "의사결정 상태", decisionStatus, [
    "draft",
    "approved",
    "superseded",
    "retired",
  ]);
  validateMetadataValue(file, "전달 상태", deliveryStatus, [
    "planned",
    "in-progress",
    "delivered",
  ]);
  if (decisionStatus === "approved") approvedFiles.add(file);
  if (!owner) errors.push(`${file}: 책임자를 지정해야 합니다.`);
  validateReviewDate(file, reviewDate);

  const documentDefinitions = [];
  for (const match of visibleContent.matchAll(
    /^#{2,6}\s+(PRD-\d{2,}-(FR|AC)-\d{2,})\.\s+\S/gm,
  )) {
    documentDefinitions.push({ id: match[1], type: match[2] });
  }
  for (const match of visibleContent.matchAll(
    /^\|\s*(PRD-\d{2,}-(SP)-\d{2,})\s+\S[^|]*\|/gm,
  )) {
    documentDefinitions.push({ id: match[1], type: match[2] });
  }

  for (const { id } of documentDefinitions) {
    if (!id.startsWith(`${prdId}-`)) {
      errors.push(`${file}: 다른 PRD 네임스페이스로 계약을 정의했습니다: ${id}`);
    }
    recordDefinition(requirementIds, id, file);
  }

  for (const requiredType of ["FR", "AC"]) {
    if (!documentDefinitions.some(({ type }) => type === requiredType)) {
      errors.push(`${file}: ${requiredType} 정의가 없습니다.`);
    }
  }

  if (decisionStatus === "approved") {
    const traceSection = visibleContent.match(
      /### 요구사항 추적 매트릭스\s*\n([\s\S]*?)(?=\n#{2,3}\s|$)/,
    );
    if (!traceSection) {
      errors.push(`${file}: 승인 PRD의 요구사항 추적 매트릭스가 없습니다.`);
    } else {
      const mappedRequirements = new Set();
      const mappedAcceptanceCriteria = new Set();
      const rows = readTraceTableRows(traceSection[1], {
        file,
        label: "요구사항 추적 매트릭스",
        headers: [["요구사항", "수용 기준", "정책 규칙"]],
      });

      for (const [rowIndex, cells] of rows.entries()) {
        const requirements = [
          ...cells[0].matchAll(/\bPRD-\d{2,}-FR-\d{2,}\b/g),
        ].map((match) => match[0]);
        const acceptanceCriteria = [
          ...cells[1].matchAll(/\bPRD-\d{2,}-AC-\d{2,}\b/g),
        ].map((match) => match[0]);
        const policyRules = [
          ...cells[2].matchAll(/\bPOL-\d{2,}-R-\d{2,}\b/g),
        ].map((match) => match[0]);

        if (
          requirements.length === 0 ||
          acceptanceCriteria.length === 0 ||
          policyRules.length === 0
        ) {
          errors.push(
            `${file}: 요구사항 추적 매트릭스 ${rowIndex + 1}번째 데이터 행에는 PRD 요구사항(FR), 수용 기준(AC), 정책 규칙(POL)이 모두 필요합니다.`,
          );
          continue;
        }

        for (const id of requirements) mappedRequirements.add(id);
        for (const id of acceptanceCriteria) mappedAcceptanceCriteria.add(id);
        for (const requirement of requirements) {
          for (const policyRule of policyRules) {
            prdTraceEdges.add(createTraceEdge(requirement, policyRule));
          }
        }
      }

      for (const { id, type } of documentDefinitions) {
        if (type === "FR" && !mappedRequirements.has(id)) {
          errors.push(`${file}: 추적 매트릭스의 요구사항 누락 ${id}`);
        }
        if (type === "AC" && !mappedAcceptanceCriteria.has(id)) {
          errors.push(`${file}: 어떤 요구사항에도 연결되지 않은 수용 기준 ${id}`);
        }
      }
    }

    const successSection = visibleContent.match(
      /(?:^|\n)## (?:\d+\.\s+)?성공 (?:기준|측정)\s*\n([\s\S]*?)(?=\n##\s|$)/,
    );
    if (!successSection) {
      errors.push(`${file}: 승인 PRD의 성공 기준 섹션이 없습니다.`);
    } else {
      const lines = successSection[1]
        .split("\n")
        .filter((line) => /^\|.*\|$/.test(line.trim()));
      const headerIndex = lines.findIndex((line) =>
        /^\|\s*지표\s*\|\s*기준선\s*\|\s*목표\s*\|\s*측정 기간\s*\|\s*출처\s*\|\s*가드레일\s*\|$/.test(
          line,
        ),
      );
      const dataRows =
        headerIndex < 0
          ? []
          : lines
              .slice(headerIndex + 2)
              .map((line) =>
                line
                  .slice(1, -1)
                  .split("|")
                  .map((cell) => cell.trim()),
              )
              .filter((cells) => cells.length === 6);
      if (headerIndex < 0 || dataRows.length === 0) {
        errors.push(
          `${file}: 성공 기준 표는 지표·기준선·목표·측정 기간·출처·가드레일과 한 개 이상의 행이 필요합니다.`,
        );
      } else {
        dataRows.forEach((cells, index) => {
          if (cells.some((cell) => !cell)) {
            errors.push(`${file}: 성공 기준 표 ${index + 1}번째 행에 빈 값이 있습니다.`);
          }
        });
      }
    }
  }
}

for (const file of policyFiles) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const visibleContent = maskInvisibleMarkdown(content);
  const firstLine = visibleContent.split("\n", 1)[0];
  const heading = firstLine.match(/^# (POL-(\d{2,}))\.\s+\S/);
  const filename = path.basename(file).match(/^(\d{2,})_/);

  if (!heading) {
    errors.push(`${file}: 첫 줄은 '# POL-NN. 제목' 형식이어야 합니다.`);
    continue;
  }

  const [, policyId, number] = heading;
  if (!filename || filename[1] !== number) {
    errors.push(`${file}: 파일 번호와 ${policyId}가 일치하지 않습니다.`);
  }
  recordDefinition(policyIds, policyId, file);

  const decisionStatus = readMetadata(
    visibleContent,
    file,
    "의사결정 상태",
  );
  const owner = readMetadata(visibleContent, file, "책임자");
  const reviewDate = readMetadata(visibleContent, file, "마지막 검토");
  readMetadata(visibleContent, file, "관련 PRD");
  readMetadata(visibleContent, file, "관련 결정");
  validateMetadataValue(file, "의사결정 상태", decisionStatus, [
    "draft",
    "approved",
    "superseded",
    "retired",
  ]);
  if (decisionStatus === "approved") approvedFiles.add(file);
  if (!owner) errors.push(`${file}: 책임자를 지정해야 합니다.`);
  validateReviewDate(file, reviewDate);

  const rules = [
    ...visibleContent.matchAll(
      /^#{2,6}\s+(POL-\d{2,}-R-\d{2,})\.\s+\S/gm,
    ),
  ].map((match) => match[1]);
  if (rules.length === 0) errors.push(`${file}: 정책 규칙 정의가 없습니다.`);
  for (const id of rules) {
    if (!id.startsWith(`${policyId}-R-`)) {
      errors.push(`${file}: 다른 정책 네임스페이스로 규칙을 정의했습니다: ${id}`);
    }
    recordDefinition(policyRuleIds, id, file);
  }

  if (decisionStatus === "approved") {
    const traceSection = visibleContent.match(
      /(?:^|\n)## (?:\d+\.\s+)?추적성\s*\n([\s\S]*?)(?=\n##\s|$)/,
    );
    if (!traceSection) {
      errors.push(`${file}: 승인 정책의 추적성 섹션이 없습니다.`);
    } else {
      const tracedRules = new Map();
      const rows = readTraceTableRows(traceSection[1], {
        file,
        label: "정책 추적성",
        headers: [
          ["정책 규칙", "PRD 요구사항", "수용 기준", "관련 결정"],
          ["Policy rule", "PRD 요구사항", "수용 기준", "관련 결정"],
        ],
      });

      for (const [rowIndex, cells] of rows.entries()) {
        const ruleMatches = [
          ...cells[0].matchAll(/\bPOL-\d{2,}-R-\d{2,}\b/g),
        ].map((match) => match[0]);
        const requirements = [
          ...cells[1].matchAll(/\bPRD-\d{2,}-FR-\d{2,}\b/g),
        ].map((match) => match[0]);
        const acceptanceCriteria = [
          ...cells[2].matchAll(/\bPRD-\d{2,}-AC-\d{2,}\b/g),
        ].map((match) => match[0]);
        const decisions = [...cells[3].matchAll(/\bD-\d{2,}\b/g)].map(
          (match) => match[0],
        );

        if (
          ruleMatches.length === 0 ||
          requirements.length === 0 ||
          acceptanceCriteria.length === 0 ||
          decisions.length === 0
        ) {
          errors.push(
            `${file}: 정책 추적성 ${rowIndex + 1}번째 데이터 행에는 정책 규칙(R), PRD 요구사항(FR), 수용 기준(AC), 결정 ID(D)가 모두 필요합니다.`,
          );
          continue;
        }

        for (const rule of ruleMatches) {
          tracedRules.set(rule, (tracedRules.get(rule) ?? 0) + 1);
        }
        for (const requirement of requirements) {
          for (const policyRule of ruleMatches) {
            policyTraceEdges.add(createTraceEdge(requirement, policyRule));
          }
        }
      }

      for (const rule of rules) {
        const count = tracedRules.get(rule) ?? 0;
        if (count === 0) errors.push(`${file}: 추적성 매트릭스의 규칙 누락 ${rule}`);
        if (count > 1) errors.push(`${file}: 추적성 매트릭스의 규칙 중복 ${rule}`);
      }
    }
  }
}

for (const edge of [...prdTraceEdges].sort()) {
  if (!policyTraceEdges.has(edge)) {
    errors.push(
      `추적성 불일치: PRD 요구사항 추적 매트릭스에만 있는 연결 ${formatTraceEdge(edge)}; 정책 역추적 표에 같은 연결을 추가하거나 PRD 연결을 제거하세요.`,
    );
  }
}

for (const edge of [...policyTraceEdges].sort()) {
  if (!prdTraceEdges.has(edge)) {
    errors.push(
      `추적성 불일치: 정책 역추적 표에만 있는 연결 ${formatTraceEdge(edge)}; PRD 요구사항 추적 매트릭스에 같은 연결을 추가하거나 정책 연결을 제거하세요.`,
    );
  }
}

for (const file of canonicalFiles) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const visibleContent = maskInvisibleMarkdown(content);

  for (const match of visibleContent.matchAll(
    /(?:^|[^A-Za-z0-9-])((?:FR|AC|SP)-\d{2,})\b/g,
  )) {
    errors.push(`${file}: 네임스페이스 없는 계약 ID ${match[1]}`);
  }

  for (const match of visibleContent.matchAll(
    /\bPRD-\d{2,}-(?:FR|AC|SP)-\d{2,}\b/g,
  )) {
    if (!requirementIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 PRD 계약 ID ${match[0]}`);
    }
  }

  for (const match of visibleContent.matchAll(
    /\bPOL-\d{2,}-R-\d{2,}\b/g,
  )) {
    if (!policyRuleIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 정책 규칙 ID ${match[0]}`);
    }
  }

  for (const match of visibleContent.matchAll(/\bPRD-\d{2,}\b/g)) {
    if (!prdIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 PRD ID ${match[0]}`);
    }
  }

  for (const match of visibleContent.matchAll(/\bPOL-\d{2,}\b/g)) {
    if (!policyIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 정책 ID ${match[0]}`);
    }
  }

  if (
    approvedFiles.has(file) &&
    /\b(?:TODO|TBD|FIXME)\b/i.test(visibleContent)
  ) {
    errors.push(`${file}: 승인 문서에 TODO/TBD/FIXME가 남아 있습니다.`);
  }

  if (/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/.test(content)) {
    errors.push(`${file}: 개인 머신 절대 경로가 포함되어 있습니다.`);
  }

  if (/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/.test(content)) {
    errors.push(`${file}: GitHub credential로 보이는 값이 포함되어 있습니다.`);
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

  for (const file of canonicalFiles) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    const visibleContent = maskInvisibleMarkdown(content);
    for (const match of visibleContent.matchAll(/\bF-(\d{2,})\b/g)) {
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

  for (const file of canonicalFiles) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    const visibleContent = maskInvisibleMarkdown(content);
    for (const id of expandIds(visibleContent, "D")) {
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

for (const [directory, indexFile] of [
  ["docs/prd", "docs/prd/README.md"],
  ["docs/policies", "docs/policies/README.md"],
]) {
  if (!fs.existsSync(path.join(root, indexFile))) {
    errors.push(`문서 인덱스가 없습니다: ${indexFile}`);
    continue;
  }
  const indexContent = fs.readFileSync(path.join(root, indexFile), "utf8");
  for (const file of walk(directory).filter(
    (entry) =>
      entry.endsWith(".md") && path.basename(entry) !== "README.md",
  )) {
    if (!indexContent.includes(path.basename(file))) {
      errors.push(`${indexFile} 인덱스 누락: ${file}`);
    }
  }
}

for (const target of [
  "AGENTS.md",
  "CONTRIBUTING.md",
  ".agents/skills/update-product-docs/SKILL.md",
  ".agents/skills/run-github-work-item/SKILL.md",
  ".agents/skills/commit-work-item/SKILL.md",
  ".agents/skills/open-pull-request/SKILL.md",
  ".github/ISSUE_TEMPLATE/work-item.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/validate-harness.yml",
]) {
  if (!readme.includes(target)) {
    errors.push(`README 하네스 인덱스 누락: ${target}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `제품 문서 검증 통과: Markdown ${markdownFiles.length}개, PRD ${prdFiles.length}개, Policy ${policyFiles.length}개, 계약 ID ${requirementIds.size + policyRuleIds.size}개, 제외 ${excludedPaths.size}개, 오류 0개`,
);
