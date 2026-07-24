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

function isFile(relativePath) {
  try {
    return fs.statSync(path.join(root, relativePath)).isFile();
  } catch {
    return false;
  }
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

function scanInlineCodeRanges(text) {
  const ranges = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let openingEnd = cursor + 1;
    while (text[openingEnd] === "`") openingEnd += 1;
    const markerLength = openingEnd - cursor;
    let closingStart = openingEnd;
    let foundClosing = false;

    while (closingStart < text.length) {
      closingStart = text.indexOf("`", closingStart);
      if (closingStart < 0) break;

      let closingEnd = closingStart + 1;
      while (text[closingEnd] === "`") closingEnd += 1;
      if (closingEnd - closingStart === markerLength) {
        ranges.push({ start: cursor, end: closingEnd });
        cursor = closingEnd;
        foundClosing = true;
        break;
      }
      closingStart = closingEnd;
    }

    if (!foundClosing) cursor = openingEnd;
  }

  return ranges;
}

function maskMarkdownForLinkScan(text) {
  const withoutInvisibleBlocks = maskInvisibleMarkdown(text);
  return maskRanges(
    withoutInvisibleBlocks,
    scanInlineCodeRanges(withoutInvisibleBlocks),
  );
}

function parseMarkdownLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing < 0 ? trimmed : trimmed.slice(1, closing);
  }
  return trimmed.split(/\s+/, 1)[0];
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function findVisibleMarkdownResources(text) {
  const visibleMarkdown = maskMarkdownForLinkScan(text);
  const resources = [
    ...visibleMarkdown.matchAll(/(!?)\[([^\]\n]*)]\(([^)\n]+)\)/g),
  ].map((match) => ({
    isImage: match[1] === "!",
    label: match[2],
    target: parseMarkdownLinkTarget(match[3]),
  }));
  const referenceDefinitions = new Map();

  for (const match of visibleMarkdown.matchAll(
    /^ {0,3}\[([^\]\n]+)\]:[ \t]*(\S.*)$/gm,
  )) {
    const label = normalizeReferenceLabel(match[1]);
    const target = parseMarkdownLinkTarget(match[2]);
    if (label && target && !referenceDefinitions.has(label)) {
      referenceDefinitions.set(label, target);
    }
  }

  for (const match of visibleMarkdown.matchAll(
    /(!?)\[([^\]\n]*)]\[([^\]\n]+)]/g,
  )) {
    const target = referenceDefinitions.get(
      normalizeReferenceLabel(match[3]),
    );
    if (!target) continue;
    resources.push({
      isImage: match[1] === "!",
      label: match[2],
      target,
    });
  }

  return resources;
}

function findVisibleMarkdownLinks(text) {
  return findVisibleMarkdownResources(text)
    .filter((resource) => !resource.isImage && resource.label.trim())
    .map((resource) => resource.target);
}

function inspectLocalMarkdownTarget(file, target) {
  if (!target || target.startsWith("#")) return null;
  const pathTarget = target.split("#", 1)[0];
  if (!pathTarget) return null;
  const isAbsoluteTarget =
    path.isAbsolute(pathTarget) || path.win32.isAbsolute(pathTarget);
  if (
    !isAbsoluteTarget &&
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(pathTarget)
  ) {
    return null;
  }

  const resolved = path.resolve(root, path.dirname(file), pathTarget);
  const relativeToRoot = path.relative(root, resolved);
  const isInsideRoot =
    !isAbsoluteTarget &&
    relativeToRoot !== ".." &&
    !relativeToRoot.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeToRoot);

  return { pathTarget, resolved, isInsideRoot };
}

function resolveLocalMarkdownTarget(file, target) {
  const inspected = inspectLocalMarkdownTarget(file, target);
  return inspected?.isInsideRoot ? inspected.resolved : null;
}

function isCommonMarkThematicBreak(line) {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(
    line,
  );
}

function matchTopLevelBullet(line) {
  if (isCommonMarkThematicBreak(line)) return null;
  return line.match(/^( {0,3})[-+*][ \t]+\S/);
}

function findFirstNonBlankLine(text, start) {
  let cursor = start;
  while (cursor <= text.length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline < 0 ? text.length : newline;
    const line = text.slice(cursor, lineEnd);
    if (line.trim()) {
      return {
        line,
        start: cursor,
        end: newline < 0 ? text.length : newline + 1,
      };
    }
    if (newline < 0) break;
    cursor = newline + 1;
  }
  return null;
}

function readLeadingTopLevelBulletSummary(text) {
  const lines = text.split("\n");
  const firstMaterialIndex = lines.findIndex((line) => line.trim());
  if (firstMaterialIndex < 0) {
    return { startsWithList: false, directItemCount: 0 };
  }

  const firstBullet = matchTopLevelBullet(lines[firstMaterialIndex]);
  if (!firstBullet) {
    return { startsWithList: false, directItemCount: 0 };
  }

  const directIndent = firstBullet[1].length;
  let directItemCount = 0;

  for (let index = firstMaterialIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) break;

    const bullet = matchTopLevelBullet(line);
    if (bullet && bullet[1].length === directIndent) {
      directItemCount += 1;
      continue;
    }

    const indentation = line.match(/^ */)[0].length;
    if (indentation > directIndent) continue;
    break;
  }

  return { startsWithList: true, directItemCount };
}

function findClosingFence(text, start, character, minimumLength) {
  let cursor = start;
  while (cursor <= text.length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline < 0 ? text.length : newline;
    const line = text.slice(cursor, lineEnd);
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (
      fence &&
      fence[1][0] === character &&
      fence[1].length >= minimumLength
    ) {
      return {
        start: cursor,
        end: newline < 0 ? text.length : newline + 1,
      };
    }
    if (newline < 0) break;
    cursor = newline + 1;
  }
  return null;
}

function readH2Section(content, heading) {
  const visibleStructure = maskInvisibleMarkdown(content);
  const headingPattern = /^## (?!#)(.+?)[ \t]*$/gm;
  let match;

  while ((match = headingPattern.exec(visibleStructure))) {
    if (match[1] !== heading) continue;
    const sectionStart = match.index + match[0].length;
    headingPattern.lastIndex = sectionStart;
    const nextHeading = headingPattern.exec(visibleStructure);
    return content.slice(
      sectionStart,
      nextHeading ? nextHeading.index : content.length,
    );
  }

  return null;
}

function validateOverviewDocument(
  file,
  { documentLabel, requireFlowchart = false },
) {
  const absolutePath = path.join(root, file);
  if (!isFile(file)) return;

  const content = fs.readFileSync(absolutePath, "utf8");
  const withoutComments = maskHtmlComments(content);
  const visibleStructure = maskRanges(
    withoutComments,
    scanFencedBlockRanges(withoutComments),
  );
  const firstH2 = visibleStructure.match(/^## (?!#)(.+?)[ \t]*$/m);

  if (!firstH2 || firstH2[1] !== "한눈에 보기") {
    errors.push(
      `${file}: ${documentLabel}의 첫 H2는 '## 한눈에 보기'여야 합니다.`,
    );
    return;
  }

  const firstMaterial = findFirstNonBlankLine(
    withoutComments,
    firstH2.index + firstH2[0].length,
  );
  const openingFence = firstMaterial?.line.match(
    /^ {0,3}(`{3,}|~{3,})mermaid\s*$/i,
  );
  if (!openingFence) {
    errors.push(
      `${file}: '## 한눈에 보기'의 첫 자료는 Mermaid fenced block이어야 합니다.`,
    );
    return;
  }

  const marker = openingFence[1];
  const closingFence = findClosingFence(
    withoutComments,
    firstMaterial.end,
    marker[0],
    marker.length,
  );
  if (!closingFence) {
    errors.push(
      `${file}: '## 한눈에 보기'의 Mermaid fenced block이 종결되지 않았습니다.`,
    );
    return;
  }

  const chartBody = withoutComments.slice(
    firstMaterial.end,
    closingFence.start,
  );
  if (!chartBody.trim()) {
    errors.push(
      `${file}: '## 한눈에 보기'의 Mermaid chart body가 비어 있습니다.`,
    );
  } else if (requireFlowchart) {
    const firstDirective = chartBody
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("%%"));
    if (
      !firstDirective ||
      !/^flowchart[ \t]+(?:TB|TD|BT|RL|LR)[ \t]*$/i.test(firstDirective)
    ) {
      errors.push(
        `${file}: '## 한눈에 보기'의 Mermaid chart는 유효한 방향을 가진 flowchart여야 합니다.`,
      );
    }
  }

  const afterClosingFence = withoutComments.slice(closingFence.end);
  const summaryStructure = maskRanges(
    afterClosingFence,
    scanFencedBlockRanges(afterClosingFence),
  );
  const nextH2 = summaryStructure.match(/^## (?!#).+?[ \t]*$/m);
  const summarySection = afterClosingFence.slice(
    0,
    nextH2 ? nextH2.index : afterClosingFence.length,
  );
  const { startsWithList, directItemCount } =
    readLeadingTopLevelBulletSummary(summarySection);
  if (!startsWithList || directItemCount < 3 || directItemCount > 5) {
    errors.push(
      `${file}: 한눈에 보기 Mermaid 직후 첫 visible material은 연속된 top-level bullet list여야 하며, visible top-level bullet 요약이 3~5개 필요합니다. (현재 ${directItemCount}개)`,
    );
  }
}

function readVisibleH2Sections(content) {
  const visibleStructure = maskInvisibleMarkdown(content);
  const matches = [
    ...visibleStructure.matchAll(/^## (?!#)(.+?)[ \t]*$/gm),
  ];
  return matches.map((match, index) => ({
    heading: match[1],
    content: content.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? content.length,
    ),
  }));
}

function validateHarnessSteps(file) {
  const absolutePath = path.join(root, file);
  if (!isFile(file)) return;

  const sections = readVisibleH2Sections(
    fs.readFileSync(absolutePath, "utf8"),
  );
  const stepSections = sections.filter((section) =>
    /^STEP(?:[ \t]|$)/.test(section.heading),
  );
  const parsedSteps = stepSections.map((section) => ({
    ...section,
    number: section.heading.match(
      /^STEP ([0-9]{2})\.(?:[ \t]+\S.*)?$/,
    )?.[1],
  }));
  const expectedNumbers = Array.from(
    { length: 11 },
    (_, index) => String(index + 1).padStart(2, "0"),
  );

  for (const number of expectedNumbers) {
    const count = parsedSteps.filter((step) => step.number === number).length;
    if (count !== 1) {
      errors.push(
        `${file}: '## STEP ${number}.' 섹션이 정확히 하나 필요합니다. (현재 ${count}개)`,
      );
    }
  }

  const actualOrder = parsedSteps.map((step) => step.number ?? "형식 오류");
  if (
    actualOrder.length !== expectedNumbers.length ||
    actualOrder.some((number, index) => number !== expectedNumbers[index])
  ) {
    errors.push(
      `${file}: STEP H2는 '## STEP 01.'부터 '## STEP 11.'까지 정확한 순서와 형식으로 나와야 합니다.`,
    );
  }

  const fields = [
    "목적",
    "핵심 입력",
    "완료 조건",
    "대표 실패·중단 조건",
  ];
  for (const step of parsedSteps.filter(({ number }) => number)) {
    const withoutComments = maskHtmlComments(step.content);
    const fencedBlocks = scanFencedBlockRanges(withoutComments);
    const visibleContent = maskRanges(withoutComments, fencedBlocks);
    const directItems = [];
    let directIndent;
    let directBulletCount = 0;
    let currentItem;
    let hasUnexpectedMaterial = fencedBlocks.length > 0;

    for (const line of visibleContent.split("\n")) {
      if (!line.trim()) continue;

      const bullet = matchTopLevelBullet(line);
      if (bullet) {
        const indent = bullet[1].length;
        directIndent ??= indent;
        if (indent !== directIndent) {
          hasUnexpectedMaterial = true;
          currentItem = undefined;
          continue;
        }

        directBulletCount += 1;
        const normalized = line.slice(indent);
        const fieldMatch = normalized.match(
          /^- \*\*(목적|핵심 입력|완료 조건|대표 실패·중단 조건):\*\*(?:[ \t]+(.*))?[ \t]*$/,
        );
        if (!fieldMatch) {
          hasUnexpectedMaterial = true;
          currentItem = undefined;
          continue;
        }

        currentItem = {
          field: fieldMatch[1],
          hasValue: Boolean(fieldMatch[2]?.trim()),
        };
        directItems.push(currentItem);
        continue;
      }

      const indentation = line.match(/^ */)[0].length;
      const looksLikeNestedBullet = /^ +[-+*][ \t]+\S/.test(line);
      if (
        !currentItem ||
        indentation < (directIndent ?? 0) + 2 ||
        looksLikeNestedBullet
      ) {
        hasUnexpectedMaterial = true;
        currentItem = undefined;
        continue;
      }
      currentItem.hasValue ||= Boolean(line.trim());
    }

    if (directBulletCount !== fields.length || hasUnexpectedMaterial) {
      errors.push(
        `${file}: '## STEP ${step.number}.'에는 지정된 네 direct item 외의 visible material을 둘 수 없습니다. (direct item ${directBulletCount}개)`,
      );
    }

    for (const field of fields) {
      const matches = directItems.filter((item) => item.field === field);
      if (matches.length !== 1 || !matches[0]?.hasValue) {
        errors.push(
          `${file}: '## STEP ${step.number}.'에는 비어 있지 않은 direct item '- **${field}:**'이 정확히 하나 필요합니다. (현재 ${matches.length}개)`,
        );
      }
    }
  }
}

function isSupportedYamlScalarSyntax(rawValue) {
  const value = rawValue.trim();
  if (!value || value.startsWith("#")) return true;

  if (value.startsWith('"')) {
    const quoted = value.match(/^("(?:[^"\\]|\\.)*")(?:[ \t]+#.*)?$/);
    if (!quoted) return false;
    try {
      return typeof JSON.parse(quoted[1]) === "string";
    } catch {
      return false;
    }
  }
  if (value.startsWith("'")) {
    return /^'(?:[^']|'')*'(?:[ \t]+#.*)?$/.test(value);
  }

  const withoutComment = value.replace(/[ \t]+#.*$/, "").trim();
  if (
    !withoutComment ||
    /:[ \t]/.test(withoutComment) ||
    /^(?:[-?:](?:[ \t]|$)|[,}\]\[{\#&*!|>%@`])/.test(withoutComment)
  ) {
    return false;
  }
  return true;
}

function parseSimpleYamlScalar(rawValue) {
  if (!isSupportedYamlScalarSyntax(rawValue)) return null;

  const value = rawValue.trim();
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith('"')) {
    const quoted = value.match(/^("(?:[^"\\]|\\.)*")/);
    const parsed = quoted ? JSON.parse(quoted[1]) : "";
    return parsed.trim() ? parsed : null;
  }
  if (value.startsWith("'")) {
    const quoted = value.match(/^('(?:[^']|'')*')/);
    const parsed = quoted
      ? quoted[1].slice(1, -1).replace(/''/g, "'")
      : "";
    return parsed.trim() ? parsed : null;
  }
  return null;
}

function parseSafeYamlStringScalar(rawValue) {
  if (!isSupportedYamlScalarSyntax(rawValue)) return null;

  const value = rawValue.trim();
  if (!value || value.startsWith("#")) return null;
  if (value.startsWith('"')) {
    const quoted = value.match(/^("(?:[^"\\]|\\.)*")(?:[ \t]+#.*)?$/);
    if (!quoted) return null;
    try {
      const parsed = JSON.parse(quoted[1]);
      return parsed.trim() ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) {
    const quoted = value.match(/^('(?:[^']|'')*')(?:[ \t]+#.*)?$/);
    if (!quoted) return null;
    const parsed = quoted[1].slice(1, -1).replace(/''/g, "'");
    return parsed.trim() ? parsed : null;
  }

  const parsed = value.replace(/[ \t]+#.*$/, "").trim();
  if (
    !parsed ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(parsed) ||
    /^(?:~|null|true|false|yes|no|on|off|y|n)$/i.test(parsed) ||
    /^[-+]?(?:\.(?:inf|nan|[0-9][0-9_]*)|0b[01_]+|0o[0-7_]+|0x[0-9a-f_]+|[0-9][0-9_]*(?::[0-5]?[0-9])*(?:\.[0-9_]*)?(?:e[-+]?[0-9]+)?)$/i.test(
      parsed,
    ) ||
    /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::?\d{2})?))?)?$/.test(
      parsed,
    )
  ) {
    return null;
  }
  return parsed;
}

function looksLikeSimpleFrontmatterBlock(lines) {
  let hasRequiredField = false;
  let hasContent = false;

  for (const line of lines) {
    if (!line.trim() || /^[ \t]*#/.test(line)) continue;
    hasContent = true;
    const mapping = line.match(
      /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/,
    );
    if (!mapping) return false;
    hasRequiredField ||= ["name", "description"].includes(mapping[1]);
  }

  return hasContent && hasRequiredField;
}

function validateSkillFrontmatter(skillDirectory) {
  const skillFile = `${skillDirectory}/SKILL.md`;
  if (!isFile(skillFile)) return;

  const content = fs
    .readFileSync(path.join(root, skillFile), "utf8")
    .replace(/\r\n?/g, "\n");
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    errors.push(
      `${skillFile}: 파일 맨 앞에 '---'로 시작하는 YAML frontmatter가 필요합니다.`,
    );
    return;
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) {
    errors.push(
      `${skillFile}: YAML frontmatter 종료 구분자 '---'가 없습니다.`,
    );
    return;
  }

  const visibleLines = maskInvisibleMarkdown(content).split("\n");
  for (
    let openingIndex = closingIndex + 1;
    openingIndex < visibleLines.length;
    openingIndex += 1
  ) {
    if (visibleLines[openingIndex] !== "---") continue;
    const duplicateClosingIndex = visibleLines.indexOf(
      "---",
      openingIndex + 1,
    );
    if (duplicateClosingIndex < 0) continue;
    if (
      looksLikeSimpleFrontmatterBlock(
        visibleLines.slice(openingIndex + 1, duplicateClosingIndex),
      )
    ) {
      errors.push(
        `${skillFile}: YAML frontmatter block은 파일 맨 앞에 정확히 하나만 허용합니다.`,
      );
      break;
    }
    openingIndex = duplicateClosingIndex;
  }

  const entries = [];
  const invalidLines = [];
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^[ \t]*#/.test(line)) continue;
    const mapping = line.match(
      /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/,
    );
    if (!mapping) {
      invalidLines.push(index + 1);
      continue;
    }

    const value = parseSafeYamlStringScalar(mapping[2]);
    if (value === null) invalidLines.push(index + 1);
    entries.push({ key: mapping[1], value });
  }

  if (invalidLines.length > 0) {
    errors.push(
      `${skillFile}: frontmatter는 안전한 단일-line string scalar만 사용하는 YAML block-mapping이어야 합니다. (line ${invalidLines.join(", ")})`,
    );
  }

  for (const field of ["name", "description"]) {
    const matches = entries.filter(({ key }) => key === field);
    if (matches.length !== 1 || matches[0]?.value === null) {
      errors.push(
        `${skillFile}: frontmatter '${field}'에 비어 있지 않은 안전한 string 값이 정확히 하나 필요합니다.`,
      );
    }
  }

  const nameEntries = entries.filter(({ key }) => key === "name");
  if (nameEntries.length === 1 && nameEntries[0].value !== null) {
    const expectedName = path.basename(skillDirectory);
    if (nameEntries[0].value !== expectedName) {
      errors.push(
        `${skillFile}: frontmatter 'name'은 Skill 디렉터리 이름 '${expectedName}'과 일치해야 합니다: ${nameEntries[0].value}`,
      );
    }
  }
}

function validateSkillInterface(skillDirectory) {
  const skillFile = `${skillDirectory}/SKILL.md`;
  const interfaceFile = `${skillDirectory}/agents/openai.yaml`;

  for (const file of [skillFile, interfaceFile]) {
    if (!isFile(file)) {
      errors.push(`필수 Skill 파일이 없습니다: ${file}`);
    }
  }
  validateSkillFrontmatter(skillDirectory);
  if (!isFile(interfaceFile)) return;

  const content = fs
    .readFileSync(path.join(root, interfaceFile), "utf8")
    .replace(/\r\n?/g, "\n");
  const invalidYamlLines = new Set();
  let hasYamlContent = false;
  let hasDocumentStart = false;
  let yamlStack = [
    {
      indent: -1,
      acceptsChildren: true,
      childIndent: undefined,
    },
  ];
  for (const [index, line] of content.split("\n").entries()) {
    if (!line.trim() || /^[ \t]*#/.test(line)) {
      continue;
    }
    if (line === "---") {
      if (hasYamlContent || hasDocumentStart) {
        invalidYamlLines.add(index + 1);
      }
      hasDocumentStart = true;
      yamlStack = [
        {
          indent: -1,
          acceptsChildren: true,
          childIndent: undefined,
        },
      ];
      continue;
    }
    if (line === "...") {
      invalidYamlLines.add(index + 1);
      continue;
    }
    hasYamlContent = true;

    const mapping = line.match(
      /^( *)([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/,
    );
    if (!mapping) {
      invalidYamlLines.add(index + 1);
      continue;
    }

    const indent = mapping[1].length;
    while (
      yamlStack.length > 1 &&
      yamlStack[yamlStack.length - 1].indent >= indent
    ) {
      yamlStack.pop();
    }
    const parent = yamlStack[yamlStack.length - 1];
    if (
      !parent.acceptsChildren ||
      (parent.childIndent !== undefined && parent.childIndent !== indent)
    ) {
      invalidYamlLines.add(index + 1);
    } else if (parent.childIndent === undefined) {
      parent.childIndent = indent;
    }

    if (!isSupportedYamlScalarSyntax(mapping[3])) {
      invalidYamlLines.add(index + 1);
    }
    const trimmedValue = mapping[3].trim();
    yamlStack.push({
      indent,
      acceptsChildren: !trimmedValue || trimmedValue.startsWith("#"),
      childIndent: undefined,
    });
  }
  if (invalidYamlLines.size > 0) {
    errors.push(
      `${interfaceFile}: 지원하는 단일-document YAML block-mapping 구조가 아닙니다. (line ${[...invalidYamlLines].join(", ")})`,
    );
  }

  const interfaceMatches = [
    ...content.matchAll(/^interface:[ \t]*(?:#.*)?$/gm),
  ];
  if (interfaceMatches.length !== 1) {
    errors.push(
      `${interfaceFile}: top-level 'interface:' mapping이 정확히 하나 필요합니다.`,
    );
    return;
  }

  const interfaceStart =
    interfaceMatches[0].index + interfaceMatches[0][0].length;
  const afterInterface = content.slice(interfaceStart);
  const nextTopLevelKey = afterInterface.match(
    /^(?![ \t#\r\n])[^:\r\n]+:[^\r\n]*$/m,
  );
  const interfaceBlock = afterInterface.slice(
    0,
    nextTopLevelKey?.index ?? afterInterface.length,
  );
  const mappingEntries = [
    ...interfaceBlock.matchAll(/^( +)([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/gm),
  ];
  const directIndent = mappingEntries.reduce(
    (minimum, match) => Math.min(minimum, match[1].length),
    Number.POSITIVE_INFINITY,
  );

  for (const field of [
    "display_name",
    "short_description",
    "default_prompt",
  ]) {
    const matches = mappingEntries.filter(
      (match) =>
        match[1].length === directIndent && match[2] === field,
    );
    const value =
      matches.length === 1 ? parseSimpleYamlScalar(matches[0][3]) : null;
    if (matches.length !== 1 || value === null) {
      errors.push(
        `${interfaceFile}: interface.${field}에 비어 있지 않은 scalar 값이 정확히 하나 필요합니다.`,
      );
    }
  }
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

const architectureFiles = [
  "docs/architecture/README.md",
  "docs/architecture/01_system_context.md",
  "docs/architecture/02_peer_network_and_transport.md",
  "docs/architecture/03_communication_protocol.md",
  "docs/architecture/04_replication_consistency_and_recovery.md",
  "docs/architecture/05_storage_and_security.md",
];
const architectureDetailFiles = architectureFiles.slice(1);
const architectureIndexFile = architectureFiles[0];
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
const architectureIndexSections = [
  "빠른 선택",
  "추천 읽기 순서",
  "정본과의 경계",
  "입력 계약",
  "기술 검증 대기 지도",
];
const architectureQuickSelectionHeaders = [
  "궁금한 질문",
  "읽을 문서",
  "확정 계약",
  "논리 모델",
  "미결정 기술의 위치",
];

for (const file of architectureFiles) {
  if (!isFile(file)) {
    errors.push(`필수 아키텍처 문서가 없습니다: ${file}`);
  }
}

for (const file of developmentFiles) {
  if (!isFile(file)) {
    errors.push(`필수 개발 표준 문서가 없습니다: ${file}`);
  }
}

const unexpectedDevelopmentFiles = walk("docs/development")
  .filter((file) => !developmentFiles.includes(file))
  .sort();
for (const file of unexpectedDevelopmentFiles) {
  errors.push(
    `docs/development에는 지정된 두 문서만 둘 수 있습니다. 허용되지 않은 파일: ${file}`,
  );
}

for (const skillDirectory of skillDirectories) {
  validateSkillInterface(skillDirectory);
}

const architectureIndexPath = path.join(root, architectureIndexFile);
if (isFile(architectureIndexFile)) {
  const indexContent = fs.readFileSync(architectureIndexPath, "utf8");
  const sections = new Map();

  for (const heading of architectureIndexSections) {
    const section = readH2Section(indexContent, heading);
    if (section === null) {
      errors.push(
        `${architectureIndexFile}: 필수 H2 섹션이 없습니다: ${heading}`,
      );
    } else {
      sections.set(heading, section);
    }
  }

  const quickSelection = sections.get("빠른 선택");
  if (quickSelection !== undefined) {
    const rows = readTraceTableRows(quickSelection, {
      file: architectureIndexFile,
      label: "빠른 선택",
      headers: [architectureQuickSelectionHeaders],
    });
    if (rows.length !== architectureDetailFiles.length) {
      errors.push(
        `${architectureIndexFile}: 빠른 선택 표에는 상세 아키텍처 문서 행이 정확히 ${architectureDetailFiles.length}개 필요합니다.`,
      );
    }

    const expectedDetailTargets = new Set(
      architectureDetailFiles.map((detailFile) =>
        path.join(root, detailFile),
      ),
    );
    const linkedDetailFiles = [];
    for (const [rowIndex, cells] of rows.entries()) {
      const documentLinks = findVisibleMarkdownLinks(cells[1] ?? "");
      const resolvedLinks = documentLinks.map((target) =>
        resolveLocalMarkdownTarget(architectureIndexFile, target),
      );
      if (
        documentLinks.length !== 1 ||
        resolvedLinks[0] === null ||
        !expectedDetailTargets.has(resolvedLinks[0])
      ) {
        errors.push(
          `${architectureIndexFile}: 빠른 선택 표 ${rowIndex + 1}번째 행의 '읽을 문서'에는 허용된 상세 아키텍처 문서 링크가 정확히 하나 필요합니다.`,
        );
      }
      for (const resolved of resolvedLinks) {
        if (resolved !== null) linkedDetailFiles.push(resolved);
      }
    }
    for (const detailFile of architectureDetailFiles) {
      const expectedTarget = path.join(root, detailFile);
      const count = linkedDetailFiles.filter(
        (target) => target === expectedTarget,
      ).length;
      if (count !== 1) {
        errors.push(
          `${architectureIndexFile}: 빠른 선택 표의 문서 열은 ${detailFile} 링크를 정확히 한 번 포함해야 합니다.`,
        );
      }
    }
  }

  const recommendedOrder = sections.get("추천 읽기 순서");
  if (recommendedOrder !== undefined) {
    const recommendedLinks = findVisibleMarkdownLinks(recommendedOrder);
    if (recommendedLinks.length !== architectureDetailFiles.length) {
      errors.push(
        `${architectureIndexFile}: 추천 읽기 순서에는 visible Markdown link가 정확히 ${architectureDetailFiles.length}개 필요합니다.`,
      );
    }
    const linkedFiles = recommendedLinks
      .map((target) =>
        resolveLocalMarkdownTarget(architectureIndexFile, target),
      )
      .filter((target) => target !== null);
    const expectedLinkedFiles = architectureDetailFiles.map((detailFile) =>
      path.join(root, detailFile),
    );
    if (
      linkedFiles.length !== expectedLinkedFiles.length ||
      linkedFiles.some(
        (linkedFile, index) => linkedFile !== expectedLinkedFiles[index],
      )
    ) {
      errors.push(
        `${architectureIndexFile}: 추천 읽기 순서는 상세 아키텍처 문서를 지정된 순서대로 연결해야 합니다.`,
      );
    }
    for (const detailFile of architectureDetailFiles) {
      const expectedTarget = path.join(root, detailFile);
      const count = linkedFiles.filter(
        (target) => target === expectedTarget,
      ).length;
      if (count !== 1) {
        errors.push(
          `${architectureIndexFile}: 추천 읽기 순서는 ${detailFile} 링크를 정확히 한 번 포함해야 합니다.`,
        );
      }
    }
  }
}

for (const file of architectureDetailFiles) {
  validateOverviewDocument(file, {
    documentLabel: "상세 아키텍처 문서",
  });
}

for (const file of developmentFiles) {
  validateOverviewDocument(file, {
    documentLabel: "개발 표준 문서",
    requireFlowchart: true,
  });
}
validateHarnessSteps(developmentFiles[0]);

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

  for (const { target } of findVisibleMarkdownResources(content)) {
    const inspected = inspectLocalMarkdownTarget(file, target);
    if (inspected === null) continue;
    if (!inspected.isInsideRoot) {
      errors.push(
        `${file}: 저장소 루트 내부의 상대 링크만 허용됩니다 -> ${inspected.pathTarget}`,
      );
    } else if (!fs.existsSync(inspected.resolved)) {
      errors.push(`${file}: 깨진 링크 -> ${inspected.pathTarget}`);
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
const featureIds = new Set();
const decisionIds = new Set();
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
  const visibleInventory = maskInvisibleMarkdown(inventory);
  const definitions = [
    ...visibleInventory.matchAll(/^\| (F-\d{2,}) \|/gm),
  ].map((match) => match[1]);
  for (const id of definitions) featureIds.add(id);

  reportDuplicateIds(definitions, "기능 ID");

  for (const file of canonicalFiles) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    const visibleContent = maskInvisibleMarkdown(content);
    for (const match of visibleContent.matchAll(/\bF-(\d{2,})\b/g)) {
      const id = `F-${match[1]}`;
      if (!featureIds.has(id)) {
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
      if (!featureIds.has(id)) errors.push(`범위 분류의 미정의 ID: ${id}`);
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
  const visibleBacklog = maskInvisibleMarkdown(backlog);
  const decisions = [
    ...visibleBacklog.matchAll(/^\| (D-\d{2,}) \|/gm),
  ].map((match) => match[1]);
  for (const id of decisions) decisionIds.add(id);
  reportDuplicateIds(decisions, "결정 ID");

  for (const file of canonicalFiles) {
    const content = fs.readFileSync(path.join(root, file), "utf8");
    const visibleContent = maskInvisibleMarkdown(content);
    for (const id of expandIds(visibleContent, "D")) {
      if (!decisionIds.has(id)) {
        errors.push(`${file}: 정의되지 않은 결정 ID ${id}`);
      }
    }
  }
}

for (const file of architectureFiles) {
  const absolutePath = path.join(root, file);
  if (!isFile(file)) continue;
  const visibleContent = maskInvisibleMarkdown(
    fs.readFileSync(absolutePath, "utf8"),
  );

  for (const match of visibleContent.matchAll(
    /(?:^|[^A-Za-z0-9-])((?:FR|AC|SP|R)-\d{2,})\b/g,
  )) {
    errors.push(`${file}: 네임스페이스 없는 아키텍처 계약 ID ${match[1]}`);
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

  for (const match of visibleContent.matchAll(/\bD-\d{2,}\b/g)) {
    if (!decisionIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 결정 ID ${match[0]}`);
    }
  }

  for (const match of visibleContent.matchAll(/\bF-\d{2,}\b/g)) {
    if (!featureIds.has(match[0])) {
      errors.push(`${file}: 정의되지 않은 기능 ID ${match[0]}`);
    }
  }
}

const readmePath = path.join(root, "README.md");
const readme = fs.existsSync(readmePath)
  ? fs.readFileSync(readmePath, "utf8")
  : "";

const architectureIndexTarget = path.join(root, architectureIndexFile);
const hasArchitectureIndexLink = findVisibleMarkdownLinks(readme).some(
  (target) =>
    resolveLocalMarkdownTarget("README.md", target) === architectureIndexTarget,
);
if (!hasArchitectureIndexLink) {
  errors.push(
    `README.md: ${architectureIndexFile}를 가리키는 visible Markdown link가 필요합니다.`,
  );
}

for (const developmentFile of developmentFiles) {
  const developmentTarget = path.join(root, developmentFile);
  const hasDevelopmentLink = findVisibleMarkdownLinks(readme).some(
    (target) =>
      resolveLocalMarkdownTarget("README.md", target) === developmentTarget,
  );
  if (!hasDevelopmentLink) {
    errors.push(
      `README.md: ${developmentFile}를 가리키는 visible Markdown link가 필요합니다.`,
    );
  }
}

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
