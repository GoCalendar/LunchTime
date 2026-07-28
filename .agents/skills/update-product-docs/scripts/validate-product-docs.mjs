#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  definedProductContractIds,
  visibleContractMarkdown,
} from "./product-contract-ids.mjs";

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

function scanTopLevelFencedBlockRanges(text) {
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

function sliceAfterIndentColumns(line, requiredColumns) {
  let columns = 0;
  let index = 0;

  while (index < line.length && columns < requiredColumns) {
    if (line[index] === " ") {
      columns += 1;
    } else if (line[index] === "\t") {
      columns += 4 - (columns % 4);
    } else {
      return null;
    }
    index += 1;
  }

  return columns >= requiredColumns ? line.slice(index) : null;
}

function scanDirectListItemFencedBlockRanges(text) {
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(
    (match) => match[0],
  );
  const ranges = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const content = line[0].replace(/\n$/, "");
    const opening = content.match(
      /^ {0,3}(?:[-+*]|\d{1,9}[.)])([ \t]+)( {0,3})(`{3,}|~{3,})(.*)$/,
    );
    if (!opening) continue;

    const marker = opening[3];
    if (marker[0] === "`" && opening[4].includes("`")) continue;
    const contentIndent = listItemContentIndent(content, null);
    if (contentIndent === null) continue;

    let end = line.index + line[0].length;
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex];
      const nextContent = nextLine[0].replace(/\n$/, "");
      if (!nextContent.trim()) {
        end = nextLine.index + nextLine[0].length;
        nextIndex += 1;
        continue;
      }

      const continuation = sliceAfterIndentColumns(
        nextContent,
        contentIndent,
      );
      if (continuation === null) break;

      end = nextLine.index + nextLine[0].length;
      const closing = continuation.match(
        /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
      );
      nextIndex += 1;
      if (
        closing &&
        closing[1][0] === marker[0] &&
        closing[1].length >= marker.length
      ) {
        break;
      }
    }

    ranges.push({ start: line.index, end });
    index = nextIndex - 1;
  }

  return ranges;
}

function scanFencedBlockRanges(text) {
  const candidates = [
    ...scanTopLevelFencedBlockRanges(text),
    ...scanDirectListItemFencedBlockRanges(text),
  ].sort((left, right) => left.start - right.start || left.end - right.end);
  const ranges = [];

  for (const candidate of candidates) {
    const previous = ranges.at(-1);
    if (previous && candidate.start < previous.end) continue;
    ranges.push(candidate);
  }

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
    if (isEscapedMarkdownCharacter(text, cursor)) {
      cursor = openingEnd;
      continue;
    }
    const markerLength = openingEnd - cursor;
    let closingStart = openingEnd;
    let foundClosing = false;

    while (closingStart < text.length) {
      closingStart = text.indexOf("`", closingStart);
      if (closingStart < 0) break;

      let closingEnd = closingStart + 1;
      while (text[closingEnd] === "`") closingEnd += 1;
      if (isEscapedMarkdownCharacter(text, closingStart)) {
        closingStart = closingEnd;
        continue;
      }
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

function maskMarkdownStructureForLinkScan(text) {
  const withoutInvisibleBlocks = maskInvisibleMarkdown(text);
  const withoutIndentedCode =
    maskIndentedCodeLines(withoutInvisibleBlocks);
  return maskRanges(
    withoutIndentedCode,
    scanInlineCodeRanges(withoutIndentedCode),
  );
}

const finalSnapshotHtmlVoidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const finalSnapshotHtmlBlockElements = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

function finalSnapshotHtmlTagConceals(raw) {
  if (/(?:^|[\t\n\f\r ])hidden(?:[\t\n\f\r ]|=|\/?>|$)/i.test(raw)) {
    return true;
  }

  const styleAttributes =
    raw.matchAll(
      /(?:^|[\t\n\f\r ])style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
    );
  for (const match of styleAttributes) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(
        value,
      )
    ) {
      return true;
    }
  }
  return false;
}

function scanFinalSnapshotHtmlTags(text) {
  const tags = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) break;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let index = start + 1;
    if (text[index] === "/") index += 1;
    if (!/[A-Za-z]/.test(text[index] ?? "")) {
      cursor = start + 1;
      continue;
    }

    let quote = "";
    while (index < text.length) {
      const character = text[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      index += 1;
    }
    if (index >= text.length) {
      cursor = start + 1;
      continue;
    }

    const raw = text.slice(start, index + 1);
    const parsed = /^<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b/.exec(raw);
    if (parsed) {
      tags.push({
        start,
        end: index + 1,
        name: parsed[1].toLowerCase(),
        closing: /^<\//.test(raw),
        selfClosing: /\/\s*>$/.test(raw),
        concealing: finalSnapshotHtmlTagConceals(raw),
        blockOpening: /^ {0,3}$/.test(
          text.slice(lineStart, start),
        ),
      });
    }
    cursor = index + 1;
  }

  return tags;
}

function finalSnapshotRawHtmlBlockStart(line) {
  const typeOne = /^ {0,3}<(script|pre|style|textarea)(?=[\t >]|$)/i.exec(
    line,
  );
  if (typeOne) {
    return {
      kind: "terminated",
      closing: new RegExp(`</${typeOne[1]}>`, "i"),
    };
  }
  if (/^ {0,3}<\?/.test(line)) {
    return { kind: "terminated", closing: /\?>/ };
  }
  if (/^ {0,3}<![A-Z]/.test(line)) {
    return { kind: "terminated", closing: />/ };
  }
  if (/^ {0,3}<!\[CDATA\[/.test(line)) {
    return { kind: "terminated", closing: /\]\]>/ };
  }

  const namedTag =
    /^ {0,3}<(\/?)([A-Za-z][A-Za-z0-9-]*)(.*)$/.exec(line);
  if (namedTag) {
    const name = namedTag[2].toLowerCase();
    const suffix = namedTag[3];
    const validBoundary = namedTag[1]
      ? suffix === "" || /^[\t >]/.test(suffix)
      : suffix === "" || /^[\t >]/.test(suffix) || suffix.startsWith("/>");
    if (validBoundary && finalSnapshotHtmlBlockElements.has(name)) {
      return { kind: "blank-line" };
    }
  }

  const indentation = /^ {0,3}/.exec(line)?.[0].length ?? 0;
  const tags = scanFinalSnapshotHtmlTags(line);
  if (
    tags.length > 0 &&
    tags[0].start === indentation &&
    line.slice(tags[0].end).trim() === ""
  ) {
    return { kind: "blank-line" };
  }
  return null;
}

function finalSnapshotLogicalLineRecords(text) {
  const lines = commonMarkLineRecords(text);
  let activeContainers = [];
  let nextContainerId = 1;

  return lines.map((line) => {
    const matched = matchCommonMarkContainers(
      line.expanded,
      activeContainers,
      null,
      false,
    );
    const opened = openCommonMarkContainers(
      line.expanded,
      matched.cursor,
      nextContainerId,
    );
    nextContainerId = opened.nextContainerId;
    activeContainers = [
      ...matched.containers,
      ...opened.containers,
    ];
    return {
      ...line,
      containers: [...activeContainers],
      logical: line.expanded.slice(opened.cursor),
    };
  });
}

function finalSnapshotLineInContainers(line, containers) {
  const matched = matchCommonMarkContainers(
    line.expanded,
    containers,
    null,
    false,
  );
  if (matched.containers.length !== containers.length) return null;
  return line.expanded.slice(matched.cursor);
}

function scanFinalSnapshotRawHtmlBlockRanges(text) {
  const startSource = maskMarkdownStructureForLinkScan(text);
  const sourceLines = finalSnapshotLogicalLineRecords(startSource);
  const rawLines = finalSnapshotLogicalLineRecords(text);
  const ranges = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const sourceLine = sourceLines[index].logical;
    const start = finalSnapshotRawHtmlBlockStart(sourceLine);
    if (!start) continue;
    const startContainers = sourceLines[index].containers;

    let end = text.length;
    let endingLine = rawLines.length - 1;
    if (start.kind === "blank-line") {
      for (
        let cursor = index + 1;
        cursor < rawLines.length;
        cursor += 1
      ) {
        const logical = finalSnapshotLineInContainers(
          rawLines[cursor],
          startContainers,
        );
        if (logical === null) {
          end = rawLines[cursor].index;
          endingLine = cursor - 1;
          break;
        }
        if (logical.trim() !== "") continue;
        end = rawLines[cursor].index;
        endingLine = cursor - 1;
        break;
      }
    } else {
      for (let cursor = index; cursor < rawLines.length; cursor += 1) {
        const logical =
          cursor === index
            ? rawLines[cursor].logical
            : finalSnapshotLineInContainers(
                rawLines[cursor],
                startContainers,
              );
        if (logical === null) {
          end = rawLines[cursor].index;
          endingLine = cursor - 1;
          break;
        }
        if (!start.closing.test(logical)) continue;
        end = rawLines[cursor].index + rawLines[cursor].length;
        endingLine = cursor;
        break;
      }
    }

    ranges.push({ start: rawLines[index].index, end });
    index = Math.max(index, endingLine);
  }
  return ranges;
}

function maskPairedFinalSnapshotHtmlContainers(text) {
  const rawBlockRanges = scanFinalSnapshotRawHtmlBlockRanges(text);
  const tagSource = maskMarkdownStructureForLinkScan(text);
  const stack = [];
  const ranges = [...rawBlockRanges];

  for (const tag of scanFinalSnapshotHtmlTags(tagSource)) {
    if (tag.closing) {
      const openingIndex = stack
        .map((opening) => opening.name)
        .lastIndexOf(tag.name);
      if (openingIndex < 0) continue;
      const opening = stack[openingIndex];
      ranges.push({ start: opening.start, end: tag.end });
      stack.splice(openingIndex);
      continue;
    }
    if (
      !tag.selfClosing &&
      !finalSnapshotHtmlVoidElements.has(tag.name)
    ) {
      stack.push(tag);
    }
  }

  const unclosedContainer = stack.find(
    (opening) => opening.blockOpening || opening.concealing,
  );
  if (unclosedContainer) {
    ranges.push({
      start: unclosedContainer.start,
      end: text.length,
    });
  }

  ranges.sort((left, right) => left.start - right.start);
  const mergedRanges = [];
  for (const range of ranges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      mergedRanges.push({ ...range });
    }
  }
  return maskRanges(text, mergedRanges);
}

function maskInlineMarkdownLinkTails(text) {
  const linkSource = maskIndentedCodeLines(
    maskInvisibleMarkdown(text),
  );
  return maskRanges(
    text,
    scanInlineMarkdownLinks(linkSource).map((link) => ({
      start: link.tailStart + 1,
      end: link.end - 1,
    })),
  );
}

function visibleFinalSnapshotMarkdown(text) {
  const containerMasked =
    maskPairedFinalSnapshotHtmlContainers(text);
  const inlineCodeRanges = scanInlineCodeRanges(
    maskInvisibleMarkdown(containerMasked),
  );
  let result = "";
  let cursor = 0;

  for (const range of inlineCodeRanges) {
    result += containerMasked.slice(cursor, range.start);
    result += containerMasked
      .slice(range.start, range.end)
      .replace(/[<>]/g, " ");
    cursor = range.end;
  }
  const neutralized =
    result + containerMasked.slice(cursor);
  const projected = visibleContractMarkdown(
    maskInlineMarkdownLinkTails(neutralized),
  );
  result = "";
  cursor = 0;
  for (const range of inlineCodeRanges) {
    result += projected.slice(cursor, range.start);
    const projectedCode = projected.slice(range.start, range.end);
    result += /\S/.test(projectedCode)
      ? containerMasked.slice(range.start, range.end)
      : projectedCode;
    cursor = range.end;
  }
  return result + projected.slice(cursor);
}

function maskMarkdownForLinkScan(text) {
  return maskEscapedMarkdownPunctuation(
    maskMarkdownStructureForLinkScan(text),
  );
}

function maskEscapedMarkdownPunctuation(text) {
  const characters = [...text];

  for (let index = 0; index < characters.length; index += 1) {
    if (!/[!-/:-@[-`{-~]/.test(characters[index])) continue;

    let backslashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && characters[cursor] === "\\";
      cursor -= 1
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) characters[index] = " ";
  }

  return characters.join("");
}

function maskReferenceDefinitions(text) {
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(
    (match) => match[0],
  );
  const ranges = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const content = line[0].replace(/\n$/, "");
    const definition = /^ {0,3}\[[^\]\n]+]:[ \t]*(.*)$/.exec(content);
    if (!definition) continue;

    let end = line.index + line[0].length;
    let nextIndex = index + 1;
    if (
      definition[1].trim() === "" &&
      lines[nextIndex] &&
      lines[nextIndex][0].trim()
    ) {
      end = lines[nextIndex].index + lines[nextIndex][0].length;
      index = nextIndex;
      nextIndex += 1;
    }
    if (
      lines[nextIndex] &&
      /^ {0,3}(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))[ \t]*(?:\n|$)$/.test(
        lines[nextIndex][0],
      )
    ) {
      end = lines[nextIndex].index + lines[nextIndex][0].length;
      index = nextIndex;
    }
    ranges.push({ start: line.index, end });
  }

  return maskRanges(text, ranges);
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

function isMarkdownEscapableCharacter(character) {
  return /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(
    character ?? "",
  );
}

function unescapeMarkdownPunctuation(text) {
  return text.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}

function skipInlineLinkWhitespace(text, start) {
  let cursor = start;
  let lineEndings = 0;

  while (cursor < text.length) {
    if (text[cursor] === " " || text[cursor] === "\t") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "\n" && lineEndings === 0) {
      lineEndings += 1;
      cursor += 1;
      continue;
    }
    break;
  }

  return { cursor, lineEndings };
}

function scanInlineLinkTitle(text, start) {
  const opening = text[start];
  if (!['"', "'", "("].includes(opening)) return null;
  const closing = opening === "(" ? ")" : opening;
  let depth = 1;

  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      if (
        cursor + 1 >= text.length ||
        text[cursor + 1] === "\n"
      ) {
        return null;
      }
      if (isMarkdownEscapableCharacter(text[cursor + 1])) {
        cursor += 1;
      }
      continue;
    }
    if (text[cursor] === "\n") return null;
    if (opening === "(" && text[cursor] === opening) {
      depth += 1;
      continue;
    }
    if (text[cursor] !== closing) continue;
    depth -= 1;
    if (depth === 0) return cursor + 1;
  }

  return null;
}

function scanInlineLinkTail(text, openingParenthesis) {
  const leadingWhitespace = skipInlineLinkWhitespace(
    text,
    openingParenthesis + 1,
  );
  let cursor = leadingWhitespace.cursor;
  let target = "";

  if (
    leadingWhitespace.cursor > openingParenthesis + 1 &&
    ['"', "'", "("].includes(text[cursor])
  ) {
    const titleEnd = scanInlineLinkTitle(text, cursor);
    if (titleEnd !== null) {
      const afterTitle = skipInlineLinkWhitespace(text, titleEnd);
      if (text[afterTitle.cursor] === ")") {
        return {
          end: afterTitle.cursor + 1,
          target,
        };
      }
    }
  }

  if (text[cursor] === "<") {
    const targetStart = cursor + 1;
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") {
        if (
          cursor + 1 >= text.length ||
          text[cursor + 1] === "\n"
        ) {
          return null;
        }
        cursor += isMarkdownEscapableCharacter(text[cursor + 1])
          ? 2
          : 1;
        continue;
      }
      if (text[cursor] === "\n" || text[cursor] === "<") return null;
      if (text[cursor] === ">") break;
      cursor += 1;
    }
    if (text[cursor] !== ">") return null;
    target = text.slice(targetStart, cursor);
    cursor += 1;
  } else {
    const targetStart = cursor;
    let depth = 0;
    while (cursor < text.length) {
      const character = text[cursor];
      if (character === "\\") {
        if (
          cursor + 1 >= text.length ||
          text[cursor + 1] === "\n"
        ) {
          return null;
        }
        cursor += isMarkdownEscapableCharacter(text[cursor + 1])
          ? 2
          : 1;
        continue;
      }
      if (character === "\n" || character === " " || character === "\t") {
        break;
      }
      if (character === "(") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
        cursor += 1;
        continue;
      }
      cursor += 1;
    }
    if (depth !== 0) return null;
    target = text.slice(targetStart, cursor);
  }

  const afterTarget = skipInlineLinkWhitespace(text, cursor);
  if (text[afterTarget.cursor] === ")") {
    return {
      end: afterTarget.cursor + 1,
      target: unescapeMarkdownPunctuation(target),
    };
  }
  if (afterTarget.cursor === cursor) return null;

  const titleEnd = scanInlineLinkTitle(text, afterTarget.cursor);
  if (titleEnd === null) return null;
  const afterTitle = skipInlineLinkWhitespace(text, titleEnd);
  if (text[afterTitle.cursor] !== ")") return null;
  return {
    end: afterTitle.cursor + 1,
    target: unescapeMarkdownPunctuation(target),
  };
}

function isEscapedMarkdownCharacter(text, index) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function scanInlineMarkdownLinks(text) {
  const links = [];

  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const isImage =
      text[cursor] === "!" &&
      text[cursor + 1] === "[" &&
      !isEscapedMarkdownCharacter(text, cursor);
    const labelStart =
      isImage
        ? cursor + 1
        : text[cursor] === "[" &&
            !isEscapedMarkdownCharacter(text, cursor)
          ? cursor
          : -1;
    if (labelStart < 0) continue;

    const labelEnd = findBalancedMarkdownClosing(
      text,
      labelStart + 1,
      "[",
      "]",
    );
    if (labelEnd < 0 || text[labelEnd + 1] !== "(") continue;
    const tail = scanInlineLinkTail(text, labelEnd + 1);
    if (tail === null) continue;

    links.push({
      start: cursor,
      end: tail.end,
      tailStart: labelEnd + 1,
      isImage,
      label: text.slice(labelStart + 1, labelEnd),
      target: tail.target,
    });
    cursor = tail.end - 1;
  }

  return links;
}

function projectInlineMarkdownLinkLabels(
  text,
  { includeImageLabels = true } = {},
) {
  let result = "";
  let cursor = 0;

  for (const link of scanInlineMarkdownLinks(text)) {
    result += text.slice(cursor, link.start);
    if (!link.isImage || includeImageLabels) result += link.label;
    cursor = link.end;
  }

  return result + text.slice(cursor);
}

function findVisibleMarkdownResources(
  text,
  referenceDefinitionSource = text,
) {
  const visibleMarkdown = maskMarkdownStructureForLinkScan(text);
  const escapedVisibleMarkdown =
    maskEscapedMarkdownPunctuation(visibleMarkdown);
  const visibleReferenceDefinitions = maskMarkdownForLinkScan(
    referenceDefinitionSource,
  );
  const resources = scanInlineMarkdownLinks(visibleMarkdown).map(
    ({ isImage, label, target }) => ({
      isImage,
      label,
      target,
    }),
  );
  const referenceDefinitions = new Map();

  for (const match of visibleReferenceDefinitions.matchAll(
    /^ {0,3}\[([^\]\n]+)\]:[ \t]*(\S.*)$/gm,
  )) {
    const label = normalizeReferenceLabel(match[1]);
    const target = parseMarkdownLinkTarget(match[2]);
    if (label && target && !referenceDefinitions.has(label)) {
      referenceDefinitions.set(label, target);
    }
  }

  for (const match of escapedVisibleMarkdown.matchAll(
    /(!?)\[([^\]\n]+)]\[([^\]\n]*)]/g,
  )) {
    const target = referenceDefinitions.get(
      normalizeReferenceLabel(match[3] || match[2]),
    );
    if (!target) continue;
    resources.push({
      isImage: match[1] === "!",
      label: match[2],
      target,
    });
  }

  for (const match of escapedVisibleMarkdown.matchAll(
    /(!?)\[([^\]\n]+)](?![\[(]|:[ \t]*\S)/g,
  )) {
    const target = referenceDefinitions.get(
      normalizeReferenceLabel(match[2]),
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
    file: "docs/development/01_harness_guide.md",
    section: "규칙 소유와 링크",
  },
];
const harnessDetailOwners = [
  {
    label: "이슈·Project 상태 전이",
    name: "run-github-work-item",
    file: ".agents/skills/run-github-work-item/SKILL.md",
  },
  {
    label: "PR 쓰기·exact-head finalize·원격·로컬 정리",
    name: "open-pull-request",
    file: ".agents/skills/open-pull-request/SKILL.md",
  },
];
const finalSnapshotGateOrder = [
  {
    order: "1",
    stage: "빠른 행동 검증",
    contracts: [
      [
        "행동 테스트만 반복하고 고정 게이트 전체는 실행하지 않음",
        /행동 테스트[\s\S]*고정 게이트 전체[\s\S]*실행하지/,
      ],
    ],
  },
  {
    order: "2",
    stage: "정본 의미 영향",
    contracts: [
      [
        "리뷰 전 정본·경로 guard",
        /독립 리뷰 전[\s\S]*PRD·Policy·Architecture[\s\S]*이슈 경로[\s\S]*(?:누락|충돌|금지 경로)[\s\S]*중단/,
      ],
    ],
  },
  {
    order: "3",
    stage: "candidate 고정",
    contracts: [
      [
        "clean worktree의 명시적 staged candidate",
        /clean 독립 worktree[\s\S]*명시적으로 stage[\s\S]*cached diff·candidate tree[\s\S]*unstaged tracked[\s\S]*예상하지 않은 untracked/,
      ],
    ],
  },
  {
    order: "4",
    stage: "독립 리뷰",
    contracts: [
      [
        "동일 candidate 병렬 리뷰와 일괄 수정",
        /같은 cached diff·candidate tree[\s\S]*병렬[\s\S]*발견 사항[\s\S]*(?:합쳐|모아)[\s\S]*일괄 수정[\s\S]*새 snapshot[\s\S]*다시 리뷰/,
      ],
    ],
  },
  {
    order: "5",
    stage: "최종 저장소 게이트",
    contracts: [
      [
        "수정 종료 뒤 고정 게이트 전체 1회",
        /계획된 수정[\s\S]*없[\s\S]*AGENTS\.md[\s\S]*고정 게이트 전체[\s\S]*(?:한 번|1회)/,
      ],
      [
        "격리 명령만 병렬, 공유 명령은 순차·join",
        /독립[\s\S]*격리[\s\S]*병렬[\s\S]*index·working tree·외부 상태·공유 cache·자원[\s\S]*순차[\s\S]*모든 결과[\s\S]*join/,
      ],
      [
        "검증 전후 candidate tree·input 동일",
        /검증 전후 candidate tree[\s\S]*gate input[\s\S]*같/,
      ],
    ],
  },
  {
    order: "6",
    stage: "commit",
    contracts: [
      [
        "동일 tree의 완전한 로컬 증거 인계",
        /candidate tree[\s\S]*commit tree[\s\S]*같[\s\S]*증거[\s\S]*완전[\s\S]*로컬 게이트[\s\S]*반복하지[\s\S]*기존 증거[\s\S]*인계/,
      ],
    ],
  },
  {
    order: "7",
    stage: "PR·필수 CI",
    contracts: [
      [
        "동일 tree의 로컬 증거 재사용과 원격 CI 유지",
        /commit tree[\s\S]*PR head tree[\s\S]*같[\s\S]*로컬 증거[\s\S]*재사용[\s\S]*원격 required CI[\s\S]*생략하지/,
      ],
    ],
  },
];
const finalSnapshotRecoveryOrder = [
  {
    situation: "tracked content 변경",
    evidence: /review·gate 증거 모두 무효/,
    reentry:
      /새 candidate[\s\S]*행동 테스트[\s\S]*PRD·Policy·Architecture 의미 영향 판정[\s\S]*독립 리뷰[\s\S]*다시 시작/,
  },
  {
    situation: "환경 전용 실패·동일 tree·input",
    evidence: /review 증거 유지[\s\S]*실패 gate 미완료/,
    reentry:
      /원인[\s\S]*동일 tree·input 근거[\s\S]*기록[\s\S]*새 명령[\s\S]*한 번[\s\S]*자동 반복하지/,
  },
  {
    situation: "의미 영향·리뷰 증거 불완전·동일 tree·input",
    evidence: /review·gate 증거 재사용 거부/,
    reentry:
      /같은 candidate·input[\s\S]*PRD·Policy·Architecture 의미 영향 판정[\s\S]*새 독립 리뷰[\s\S]*최종 게이트/,
  },
  {
    situation: "최종 gate 증거 불완전·동일 tree·input",
    evidence: /gate 증거 재사용 거부/,
    reentry:
      /exact candidate·input[\s\S]*동일한 clean snapshot[\s\S]*AGENTS\.md[\s\S]*고정 게이트 전체[\s\S]*새로 실행/,
  },
  {
    situation: "candidate tree·input 불일치",
    evidence: /review·gate 증거 모두 무효/,
    reentry:
      /다른 tree나 input[\s\S]*gate만 실행하지 않고[\s\S]*새 candidate[\s\S]*행동 테스트·의미 영향 판정·독립 리뷰[\s\S]*다시 시작/,
  },
];
const finalSnapshotOwnerContracts = [
  {
    file: "AGENTS.md",
    section: "행동 시나리오와 독립 리뷰",
    label: "행동 테스트→정본 guard→staged candidate 리뷰·일괄 수정",
    pattern:
      /이슈별 빠른 테스트[\s\S]*고정 게이트 전체[\s\S]*리뷰 전에[\s\S]*PRD·Policy·Architecture[\s\S]*cached diff·candidate tree[\s\S]*독립 리뷰[\s\S]*일괄 수정[\s\S]*review-fix 사이[\s\S]*고정 게이트 전체[\s\S]*실행하지/,
  },
  {
    file: "AGENTS.md",
    section: "문서와 검증",
    label: "최종 gate 1회와 분리된 증거 복구",
    pattern:
      /계획된 변경[\s\S]*없는 staged\s+candidate[\s\S]*고정 게이트 전체[\s\S]*한 번[\s\S]*tracked\s+content[\s\S]*행동·리뷰·게이트 증거[\s\S]*모두 무효화[\s\S]*빠른 행동 테스트[\s\S]*의미 영향 판정[\s\S]*독립 리뷰[\s\S]*tree·input[\s\S]*환경 전용 실패[\s\S]*의미\s+영향·독립 리뷰 증거[\s\S]*최종 gate\s+증거만[\s\S]*candidate tree나 input[\s\S]*모든 로컬\s+증거[\s\S]*무효화[\s\S]*빠른 행동 테스트[\s\S]*영향 판정[\s\S]*독립 리뷰/,
  },
  {
    file: "CONTRIBUTING.md",
    section: "5. 테스트와 독립 리뷰",
    label: "review-fix 중 전체 gate 금지와 마지막 1회 실행",
    pattern:
      /(?:독립 리뷰 전에[\s\S]*PRD·Policy·Architecture|PRD·Policy·Architecture[\s\S]*독립 리뷰 전에)[\s\S]*cached diff·candidate tree[\s\S]*review-fix 사이[\s\S]*고정 게이트 전체[\s\S]*실행하지[\s\S]*계획된 수정[\s\S]*없[\s\S]*AGENTS\.md[\s\S]*고정\s+게이트 전체[\s\S]*한 번[\s\S]*tracked content[\s\S]*행동·리뷰·게이트 증거[\s\S]*폐기[\s\S]*빠른 행동 테스트[\s\S]*의미\s+영향 판정[\s\S]*독립 리뷰[\s\S]*tree·input[\s\S]*환경 전용 실패[\s\S]*의미 영향·리뷰 증거[\s\S]*최종\s+gate 증거만[\s\S]*candidate tree나 input[\s\S]*무효화[\s\S]*빠른 행동 테스트[\s\S]*영향 판정[\s\S]*독립 리뷰/,
  },
  {
    file: ".agents/skills/update-product-docs/SKILL.md",
    section: "품질 게이트 실행",
    label: "정본 의미 영향 판정 뒤 리뷰·최종 gate",
    pattern:
      /좁은 행동 테스트[\s\S]*최종 저장소 게이트[\s\S]*대신하지[\s\S]*PRD·Policy·Architecture[\s\S]*독립 리뷰 전에[\s\S]*candidate\s+tree[\s\S]*review-fix 사이[\s\S]*고정 게이트 전체[\s\S]*실행하지[\s\S]*계획된 수정[\s\S]*없[\s\S]*AGENTS\.md[\s\S]*고정 게이트 전체[\s\S]*한 번[\s\S]*tracked content[\s\S]*행동·의미 영향·리뷰·게이트 증거[\s\S]*무효화[\s\S]*빠른 행동 테스트[\s\S]*의미 영향 판정[\s\S]*tree·input[\s\S]*환경 전용\s+실패[\s\S]*의미\s+영향·독립 리뷰 증거[\s\S]*최종 gate 증거만[\s\S]*candidate tree나 input[\s\S]*다르면[\s\S]*빠른 행동 테스트[\s\S]*의미 영향/,
  },
  {
    file: ".agents/skills/run-github-work-item/SKILL.md",
    section: "구현 snapshot 검증",
    label: "행동 테스트→정본 영향→candidate 리뷰→최종 gate",
    pattern:
      /빠른 행동 테스트[\s\S]*PRD·Policy·Architecture[\s\S]*cached diff·candidate tree[\s\S]*같은 snapshot[\s\S]*발견 사항[\s\S]*한 번에 수정[\s\S]*새 candidate[\s\S]*계획된 수정[\s\S]*없[\s\S]*AGENTS\.md[\s\S]*고정 게이트 전체[\s\S]*한 번/,
  },
  {
    file: ".agents/skills/commit-work-item/SKILL.md",
    section: "3. Candidate staging과 독립 리뷰",
    label: "빠른 증거→정본 영향→staged candidate 리뷰",
    pattern:
      /빠른 행동 테스트[\s\S]*고정\s+게이트 전체[\s\S]*실행하지[\s\S]*PRD·Policy·Architecture[\s\S]*candidate tree[\s\S]*독립 리뷰[\s\S]*(?:일괄 수정|한 번에 수정)[\s\S]*review-fix 사이[\s\S]*고정 게이트 전체[\s\S]*실행하지/,
  },
  {
    file: ".agents/skills/commit-work-item/SKILL.md",
    section: "4. 최종 게이트와 snapshot 결속",
    label: "최종 gate 1회와 증거 유형별 복구",
    pattern:
      /계획된 수정[\s\S]*없[\s\S]*AGENTS\.md[\s\S]*고정\s+게이트[\s\S]*한 번[\s\S]*tracked content[\s\S]*행동·의미 영향·리뷰·게이트 증거[\s\S]*무효화[\s\S]*빠른 행동 테스트[\s\S]*새 candidate[\s\S]*tree·input[\s\S]*환경 전용 실패[\s\S]*의미 영향·독립 리뷰 증거[\s\S]*최종 gate 증거만[\s\S]*candidate tree나 input[\s\S]*모든 로컬 증거[\s\S]*빠른 행동 테스트[\s\S]*새 candidate/,
  },
  {
    file: ".agents/skills/commit-work-item/SKILL.md",
    section: "6. 커밋 후 검증과 보고",
    label: "commit 뒤 path gate 증거 재사용",
    pattern:
      /HEAD\^\{tree\}[\s\S]*candidate tree[\s\S]*commit path gate 증거[\s\S]*재사용[\s\S]*반복하지/,
  },
  {
    file: ".agents/skills/commit-work-item/references/commit-contract.md",
    section: "5. 검증 증거",
    label: "candidate→commit→PR tree 결속과 원격 CI",
    pattern:
      /이슈별 행동 테스트[\s\S]*PRD·Policy·Architecture[\s\S]*cached diff digest[\s\S]*candidate tree[\s\S]*독립 리뷰[\s\S]*고정 게이트 전체[\s\S]*한 번[\s\S]*commit tree[\s\S]*PR head tree[\s\S]*원격 required CI[\s\S]*생략하지[\s\S]*tracked content[\s\S]*행동 테스트·의미 영향·리뷰·게이트 증거[\s\S]*무효화[\s\S]*빠른 행동 테스트[\s\S]*의미\s+영향 판정[\s\S]*독립 리뷰[\s\S]*의미 영향·독립 리뷰 증거[\s\S]*최종 gate 증거만[\s\S]*candidate tree나 input[\s\S]*다르면[\s\S]*빠른 행동 테스트[\s\S]*의미 영향 판정[\s\S]*독립 리뷰/,
  },
  {
    file: ".agents/skills/commit-work-item/references/commit-contract.md",
    section: "9. 커밋 후 검증",
    label: "commit 뒤 path gate 증거 재사용",
    pattern:
      /HEAD\^\{tree\}[\s\S]*candidate tree[\s\S]*commit path gate 증거[\s\S]*재사용[\s\S]*다시 실행하지/,
  },
  {
    file: ".agents/skills/open-pull-request/SKILL.md",
    section: "2. 중복 PR과 문서 영향 확인",
    label: "증거 유형별 PR 복구",
    pattern:
      /commit tree[\s\S]*candidate[\s\S]*tree나 입력[\s\S]*새 candidate[\s\S]*빠른 행동 테스트[\s\S]*의미 영향 판정[\s\S]*독립 리뷰[\s\S]*의미 영향·독립 리뷰 증거[\s\S]*새 독립 리뷰[\s\S]*최종 gate\s+결과 증거만[\s\S]*recovery worktree[\s\S]*고정 게이트 전체[\s\S]*한 번/,
  },
  {
    file: ".agents/skills/open-pull-request/SKILL.md",
    section: "3. 제목과 본문 작성",
    label: "review→verification→commit→PR tree와 required CI",
    pattern:
      /review-tree=<40자리 tree OID>[\s\S]*verification-tree=<40자리 tree OID>[\s\S]*commit-tree=<40자리 tree OID>[\s\S]*pr-head-tree=<40자리 tree OID>[\s\S]*네 tree[\s\S]*같[\s\S]*고정 게이트 전체[\s\S]*한 번[\s\S]*required CI[\s\S]*항상 통과/,
  },
  {
    file: ".agents/skills/open-pull-request/references/pr-body-contract.md",
    section: "4. 검증",
    label: "로컬 증거 재사용과 원격 required CI 분리",
    pattern:
      /review-tree=<40자리 tree OID>[\s\S]*verification-tree=<40자리 tree OID>[\s\S]*commit-tree=<40자리 tree OID>[\s\S]*pr-head-tree=<40자리 tree OID>[\s\S]*candidate tree와 input[\s\S]*의미 영향·독립 리뷰\s+증거[\s\S]*새 독립 리뷰[\s\S]*최종 gate 결과 증거만[\s\S]*고정 게이트 전체[\s\S]*candidate\s+tree·input[\s\S]*다르면[\s\S]*빠른 행동 테스트[\s\S]*의미 영향 판정[\s\S]*독립 리뷰[\s\S]*GitHub required CI[\s\S]*대신하지/,
  },
];
const plannedIdDetailOwner = {
  label: "PRD·Policy planned ID 수명주기",
  name: "update-product-docs",
  file: ".agents/skills/update-product-docs/SKILL.md",
  section: "Planned ID 계약",
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
    file: "docs/development/01_harness_guide.md",
    section: "규칙 소유와 링크",
  },
];
const forbiddenPlannedIdDetailSignatures = [
  {
    label: "planned ID marker와 정본 정의 경계",
    fragments: [
      "planned ID",
      "GitHub 이슈",
      "계획 표식",
      "정본 정의",
      "아니다",
    ],
    maxSpan: 220,
  },
  {
    label: "planned ID의 구체적 정본 파일 소유",
    fragments: ["planned ID", "namespace", "NN_*.md"],
    maxSpan: 320,
  },
  {
    label: "README·재귀 glob의 정의 파일 소유 한계",
    fragments: ["README", "재귀 glob", "정의 파일"],
    maxSpan: 260,
  },
  {
    label: "planned ID의 실제 정의·validator·구현·테스트·PR 추적",
    fragments: [
      "planned ID",
      "실제",
      "정의",
      "validator",
      "구현",
      "테스트",
      "PR",
    ],
    maxSpan: 480,
  },
  {
    label: "exact-head 비가시 정의 제외",
    fragments: ["exact PR head Git tree", "image alt", "<details>"],
    maxSpan: 420,
  },
  {
    label: "exact-head 실제 정본 정의",
    fragments: ["exact head Git tree", "새 ID", "실제", "정본", "정의"],
    maxSpan: 260,
  },
  {
    label: "exact PR head 실제 정본 정의",
    fragments: [
      "exact PR head Git tree",
      "새 ID",
      "실제",
      "정본",
      "정의",
    ],
    maxSpan: 280,
  },
  {
    label: "Ready 전 planned ID 실제 정의",
    fragments: ["Ready", "planned ID", "실제", "정의"],
    maxSpan: 260,
  },
  {
    label: "planned ID 승인·경로 소유",
    fragments: [
      "새 ID",
      "승인",
      "planned ID",
      "변경 경로",
      "소유",
      "만든다",
    ],
    maxSpan: 420,
  },
  {
    label: "planned ID의 같은 branch·PR 동시 작업",
    fragments: ["planned ID", "같은", "branch", "PR"],
    maxSpan: 260,
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
const finalizeDetailOwnerFile =
  ".agents/skills/open-pull-request/SKILL.md";

function sourceLineNumber(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

function indentationColumns(line) {
  let columns = 0;
  let index = 0;

  while (index < line.length) {
    if (line[index] === " ") {
      columns += 1;
    } else if (line[index] === "\t") {
      columns += 4 - (columns % 4);
    } else {
      break;
    }
    index += 1;
  }

  return { columns, index };
}

function listItemContentIndent(line, activeListContentIndent) {
  const { columns, index } = indentationColumns(line);
  const isTopLevel = columns <= 3;
  const isNested =
    activeListContentIndent !== null &&
    columns >= activeListContentIndent &&
    columns <= activeListContentIndent + 3;
  if (!isTopLevel && !isNested) return null;

  const marker = /^(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(
    line.slice(index),
  );
  if (!marker) return null;

  const markerWidth = marker[0].length - marker[1].length;
  const padding = indentationColumns(marker[1]).columns;
  return columns + markerWidth + Math.min(Math.max(padding, 1), 4);
}

function maskIndentedCodeLines(text) {
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(
    (match) => match[0],
  );
  const ranges = [];
  let activeListContentIndent = null;

  for (const line of lines) {
    const content = line[0].replace(/\n$/, "");
    if (!content.trim()) continue;

    const listIndent = listItemContentIndent(
      content,
      activeListContentIndent,
    );
    if (listIndent !== null) {
      activeListContentIndent = listIndent;
      continue;
    }

    const { columns } = indentationColumns(content);
    const codeIndent =
      activeListContentIndent === null
        ? 4
        : activeListContentIndent + 4;
    if (columns >= codeIndent) {
      ranges.push({
        start: line.index,
        end: line.index + line[0].length,
      });
      continue;
    }

    if (
      activeListContentIndent !== null &&
      columns < activeListContentIndent
    ) {
      activeListContentIndent = null;
      if (columns >= 4) {
        ranges.push({
          start: line.index,
          end: line.index + line[0].length,
        });
      }
    }
  }

  return maskRanges(text, ranges);
}

function maskStrictHarnessCode(file, content) {
  const fencedRanges = [];
  let openFence;
  let offset = 0;

  for (const match of content.matchAll(/[^\n]*(?:\n|$)/g)) {
    const rawLine = match[0];
    if (!rawLine) break;
    const line = rawLine.replace(/\n$/, "");
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

    if (!openFence && fence) {
      const marker = fence[1];
      if (marker[0] === "`" && fence[2].includes("`")) {
        errors.push(
          `${file}:${sourceLineNumber(content, offset)}: backtick fence info에는 backtick을 둘 수 없습니다.`,
        );
        fencedRanges.push({
          start: offset,
          end: offset + rawLine.length,
        });
      } else {
        openFence = {
          character: marker[0],
          length: marker.length,
          start: offset,
          line: sourceLineNumber(content, offset),
        };
      }
    } else if (
      openFence &&
      fence &&
      fence[1][0] === openFence.character &&
      fence[1].length >= openFence.length &&
      fence[2].trim() === ""
    ) {
      fencedRanges.push({
        start: openFence.start,
        end: offset + rawLine.length,
      });
      openFence = undefined;
    }
    offset += rawLine.length;
  }

  if (openFence) {
    errors.push(
      `${file}:${openFence.line}: 하네스 라우팅 문서의 fenced code block이 종결되지 않았습니다.`,
    );
    fencedRanges.push({ start: openFence.start, end: content.length });
  }

  const withoutFences = maskRanges(content, fencedRanges);
  const escapedBacktick = withoutFences.indexOf("\\`");
  if (escapedBacktick >= 0) {
    errors.push(
      `${file}:${sourceLineNumber(content, escapedBacktick)}: 하네스 라우팅 문서에는 escaped backtick을 사용할 수 없습니다.`,
    );
  }
  const inlineCodeRanges = scanInlineCodeRanges(withoutFences);
  for (const range of inlineCodeRanges) {
    if (withoutFences.slice(range.start, range.end).includes("\n")) {
      errors.push(
        `${file}:${sourceLineNumber(content, range.start)}: 하네스 라우팅 문서의 inline code span은 한 줄 안에서 종결해야 합니다.`,
      );
    }
  }
  const withoutCode = maskRanges(withoutFences, inlineCodeRanges);
  const unmatchedBacktick = withoutCode.indexOf("`");
  if (unmatchedBacktick >= 0) {
    errors.push(
      `${file}:${sourceLineNumber(content, unmatchedBacktick)}: 하네스 라우팅 문서의 inline code span이 종결되지 않았습니다.`,
    );
  }
  const ambiguousFence = withoutCode.match(/`{3,}|~{3,}/);
  if (ambiguousFence) {
    errors.push(
      `${file}:${sourceLineNumber(content, ambiguousFence.index)}: 하네스 라우팅 문서에는 top-level fenced code만 사용할 수 있습니다.`,
    );
  }
  return withoutCode;
}

function firstPatternMatch(text, pattern) {
  pattern.lastIndex = 0;
  return pattern.exec(text);
}

function validateStrictHarnessSyntax(file, content) {
  for (const [needle, message] of [
    ["\r", "CR line ending"],
    ["\t", "tab"],
  ]) {
    const offset = content.indexOf(needle);
    if (offset >= 0) {
      errors.push(
        `${file}:${sourceLineNumber(content, offset)}: 하네스 라우팅 문서에는 ${message}을 사용할 수 없습니다.`,
      );
    }
  }

  const visible = maskStrictHarnessCode(file, content);
  const syntaxChecks = [
    {
      pattern: /[<>]/g,
      message:
        "code 밖의 raw HTML·autolink·blockquote 문법을 사용할 수 없습니다.",
    },
    {
      pattern: /\[[^\]\n]+\][ \t]*:/g,
      message: "reference 정의를 사용할 수 없습니다.",
    },
    {
      pattern: /!?\[[^\]\n]+\](?!\()/g,
      message:
        "reference-style·shortcut link를 사용할 수 없습니다. canonical inline link를 사용하세요.",
    },
    {
      pattern:
        /!?\[[^\]\n]*\]\((?![^()\s]+\))/g,
      message:
        "inline link는 공백·괄호·title이 없는 한 줄 canonical target만 사용할 수 있습니다.",
    },
    {
      pattern: /^ {0,3}(?:=+|-+)[ \t]*$/gm,
      message:
        "setext heading·thematic break를 사용할 수 없습니다. top-level ATX heading을 사용하세요.",
    },
    {
      pattern:
        /^\s*(?:[-+*]|\d+[.)])[ \t]+#{1,6}(?:[ \t]+|$)/gm,
      message:
        "list container 안에 heading을 둘 수 없습니다. top-level ATX heading을 사용하세요.",
    },
    {
      pattern: /^ {1,3}#{1,6}(?:[ \t]+|$)/gm,
      message:
        "들여쓴 ATX heading을 둘 수 없습니다. heading은 column 0에서 시작하세요.",
    },
    {
      pattern: /^#{1,6}[ \t]+.*[ \t]+#+[ \t]*$/gm,
      message:
        "ATX heading의 closing # sequence를 사용할 수 없습니다.",
    },
    {
      pattern: /^ {4,}#{1,6}(?:[ \t]+|$)/gm,
      message:
        "들여쓴 heading을 둘 수 없습니다. top-level ATX heading을 사용하세요.",
    },
  ];

  for (const { pattern, message } of syntaxChecks) {
    const match = firstPatternMatch(visible, pattern);
    if (match) {
      errors.push(
        `${file}:${sourceLineNumber(content, match.index)}: ${message}`,
      );
    }
  }
  return visible;
}

function readStrictH2Sections(content, visibleContent) {
  const matches = scanBoundedOwnerHeadingRecords(content).filter(
    (heading) =>
      heading.syntax === "atx" &&
      heading.strictHeading !== null,
  );
  return matches.map((match, index) => {
    const start = match.index;
    const contentStart = match.index + match.source.length;
    const end = matches[index + 1]?.index ?? content.length;
    return {
      heading: match.strictHeading,
      source: match.source,
      start,
      end,
      content: content.slice(contentStart, end),
      visibleContent: visibleContent.slice(contentStart, end),
    };
  });
}

function strictH2SourceIsVisible(visibleContent, section) {
  return (
    visibleContent.slice(
      section.start,
      section.start + section.source.length,
    ) === section.source
  );
}

function normalizeFinalizeDetailText(text) {
  const decoded = text
    .replace(
      /&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));/g,
      (match, decimal, hexadecimal) => {
        const value = Number.parseInt(
          decimal ?? hexadecimal,
          hexadecimal ? 16 : 10,
        );
        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value > 0x10ffff ||
          (value >= 0xd800 && value <= 0xdfff)
        ) {
          return match;
        }
        return String.fromCodePoint(value);
      },
    )
    .replace(
      /&(period|hyphen|lowbar|sol|tab|newline);/gi,
      (match, name) => {
        const entities = {
          period: ".",
          hyphen: "-",
          lowbar: "_",
          sol: "/",
          tab: " ",
          newline: " ",
        };
        return entities[name.toLowerCase()] ?? match;
      },
    )
    .replace(/&[A-Za-z][A-Za-z0-9]+;/g, "")
    .replace(
      /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
      "$1",
    );
  return decoded
    .replace(/[<>]/g, "")
    .replace(/[\s\p{Cf}`*_~]/gu, "")
    .toLowerCase();
}

function finalizeDetailTextVariants(text) {
  const visibleText = maskHtmlComments(text);
  return [
    normalizeFinalizeDetailText(visibleText),
    normalizeFinalizeDetailText(
      projectMarkdownHeadingText(visibleText),
    ),
    normalizeFinalizeDetailText(
      projectMarkdownHeadingText(
        visibleContractMarkdown(visibleText),
      ),
    ),
  ];
}

function visibleInlineLinkLabels(text) {
  return projectInlineMarkdownLinkLabels(text, {
    includeImageLabels: false,
  });
}

function findBalancedMarkdownClosing(
  text,
  start,
  openingCharacter,
  closingCharacter,
) {
  let depth = 1;

  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\n") return -1;
    if (text[index] === "\\") {
      if (
        index + 1 >= text.length ||
        text[index + 1] === "\n"
      ) {
        return -1;
      }
      if (isMarkdownEscapableCharacter(text[index + 1])) {
        index += 1;
      }
      continue;
    }
    if (text[index] === openingCharacter) depth += 1;
    if (text[index] !== closingCharacter) continue;
    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function projectMarkdownHeadingText(text) {
  const inlineProjected = projectInlineMarkdownLinkLabels(text);
  let result = "";
  let cursor = 0;

  while (cursor < inlineProjected.length) {
    const isImage =
      inlineProjected[cursor] === "!" &&
      inlineProjected[cursor + 1] === "[";
    const labelStart =
      isImage
        ? cursor + 1
        : inlineProjected[cursor] === "["
          ? cursor
          : -1;
    if (labelStart < 0) {
      result += inlineProjected[cursor];
      cursor += 1;
      continue;
    }

    const labelEnd = findBalancedMarkdownClosing(
      inlineProjected,
      labelStart + 1,
      "[",
      "]",
    );
    if (labelEnd < 0) {
      result += inlineProjected[cursor];
      cursor += 1;
      continue;
    }

    let syntaxEnd = labelEnd + 1;
    if (inlineProjected[syntaxEnd] === "[") {
      const referenceEnd = findBalancedMarkdownClosing(
        inlineProjected,
        syntaxEnd + 1,
        "[",
        "]",
      );
      if (referenceEnd < 0) {
        result += inlineProjected[cursor];
        cursor += 1;
        continue;
      }
      syntaxEnd = referenceEnd + 1;
    }

    result += inlineProjected.slice(labelStart + 1, labelEnd);
    cursor = syntaxEnd;
  }

  return result;
}

function expandCommonMarkTabs(line) {
  let expanded = "";
  let column = 0;

  for (const character of line) {
    if (character === "\t") {
      const width = 4 - (column % 4);
      expanded += " ".repeat(width);
      column += width;
      continue;
    }
    expanded += character;
    column += 1;
  }

  return expanded;
}

function commonMarkFenceMarker(content) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
  if (!match) return null;
  if (match[1][0] === "`" && match[2].includes("`")) {
    return null;
  }
  return {
    character: match[1][0],
    length: match[1].length,
    rest: match[2],
  };
}

const COMMONMARK_HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

const PROTECTED_HEADING_NAMED_ENTITIES = new Map([
  ["AMP", "&"],
  ["LT", "<"],
  ["GT", ">"],
  ["QUOT", '"'],
  ["amp", "&"],
  ["apos", "'"],
  ["colon", ":"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u00a0"],
  ["NewLine", "\n"],
  ["quot", '"'],
  ["Tab", "\t"],
]);

function commonMarkLineRecords(content) {
  return [...content.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0])
    .map((match) => {
      const source = match[0].replace(/\n$/, "");
      return {
        index: match.index,
        length: match[0].length,
        source,
        expanded: expandCommonMarkTabs(source),
      };
    });
}

function commonMarkFrontmatterEnd(lines) {
  if (
    lines.length < 2 ||
    lines[0].index !== 0 ||
    !/^---[ \t]*$/.test(lines[0].source)
  ) {
    return -1;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[index].source)) {
      return index;
    }
  }
  return -1;
}

function sameCommonMarkContainerPath(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (container, index) => container.id === right[index].id,
  );
}

function commonMarkHtmlBlockStart(content, paragraphIsOpen) {
  const logical = content.replace(/^ {0,3}/, "");
  for (const tag of ["pre", "script", "style", "textarea"]) {
    if (
      new RegExp(`^<${tag}(?:[\\t >]|$)`, "i").test(logical)
    ) {
      return {
        endPattern: new RegExp(`</${tag}>`, "i"),
        blankTerminated: false,
      };
    }
  }
  if (logical.startsWith("<!--")) {
    return { endPattern: /-->/, blankTerminated: false };
  }
  if (logical.startsWith("<?")) {
    return { endPattern: /\?>/, blankTerminated: false };
  }
  if (/^<![A-Z]/.test(logical)) {
    return { endPattern: />/, blankTerminated: false };
  }
  if (logical.startsWith("<![CDATA[")) {
    return { endPattern: /]]>/, blankTerminated: false };
  }

  const blockTag = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+|\/?>|$)/.exec(
    logical,
  );
  if (
    blockTag &&
    COMMONMARK_HTML_BLOCK_TAGS.has(blockTag[1].toLowerCase())
  ) {
    return { endPattern: null, blankTerminated: true };
  }

  if (paragraphIsOpen) return null;
  if (
    /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>[ \t]*$/.test(
      logical,
    )
  ) {
    return { endPattern: null, blankTerminated: true };
  }
  return null;
}

function commonMarkLineInterruptsParagraph(content) {
  if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(content)) return true;
  if (isCommonMarkThematicBreak(content)) return true;
  if (commonMarkFenceMarker(content)) return true;
  if (/^ {0,3}>/.test(content)) return true;
  if (
    /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(content)
  ) {
    return true;
  }
  return commonMarkHtmlBlockStart(content, true) !== null;
}

function matchCommonMarkContainers(
  expanded,
  activeContainers,
  paragraph,
  allowLazy,
) {
  let cursor = 0;
  let matchedCount = 0;
  const blank = expanded.trim() === "";

  for (const container of activeContainers) {
    if (container.type === "blockquote") {
      let indentation = 0;
      while (
        indentation < 4 &&
        expanded[cursor + indentation] === " "
      ) {
        indentation += 1;
      }
      if (
        indentation > 3 ||
        expanded[cursor + indentation] !== ">"
      ) {
        break;
      }
      cursor += indentation + 1;
      if (expanded[cursor] === " ") cursor += 1;
      matchedCount += 1;
      continue;
    }

    if (blank) {
      cursor = expanded.length;
      matchedCount += 1;
      continue;
    }
    let indentation = 0;
    while (
      indentation < container.continuationIndent &&
      expanded[cursor + indentation] === " "
    ) {
      indentation += 1;
    }
    if (indentation < container.continuationIndent) break;
    cursor += container.continuationIndent;
    matchedCount += 1;
  }

  let usedLazyContinuation = false;
  if (
    allowLazy &&
    !blank &&
    matchedCount < activeContainers.length &&
    paragraph &&
    sameCommonMarkContainerPath(
      paragraph.containers,
      activeContainers,
    ) &&
    !commonMarkLineInterruptsParagraph(expanded.slice(cursor))
  ) {
    matchedCount = activeContainers.length;
    usedLazyContinuation = true;
  }

  return {
    containers: activeContainers.slice(0, matchedCount),
    cursor,
    explicit:
      matchedCount === activeContainers.length &&
      !usedLazyContinuation,
    usedLazyContinuation,
  };
}

function openCommonMarkContainers(
  expanded,
  start,
  firstContainerId,
) {
  const containers = [];
  let cursor = start;
  let nextContainerId = firstContainerId;

  while (cursor < expanded.length) {
    const containerStart = cursor;
    let indentation = 0;
    while (
      indentation < 4 &&
      expanded[cursor + indentation] === " "
    ) {
      indentation += 1;
    }
    if (indentation > 3) break;

    const markerStart = cursor + indentation;
    if (expanded[markerStart] === ">") {
      cursor = markerStart + 1;
      if (expanded[cursor] === " ") cursor += 1;
      containers.push({
        id: nextContainerId,
        type: "blockquote",
      });
      nextContainerId += 1;
      continue;
    }

    if (
      isCommonMarkThematicBreak(
        expanded.slice(containerStart),
      )
    ) {
      break;
    }
    const listMarker = /^(?:[-+*]|\d{1,9}[.)])/.exec(
      expanded.slice(markerStart),
    );
    if (!listMarker) break;

    const afterMarker = markerStart + listMarker[0].length;
    if (
      afterMarker < expanded.length &&
      expanded[afterMarker] !== " "
    ) {
      break;
    }
    let whitespaceEnd = afterMarker;
    while (expanded[whitespaceEnd] === " ") whitespaceEnd += 1;
    const whitespaceWidth = whitespaceEnd - afterMarker;
    if (
      whitespaceWidth === 0 &&
      afterMarker < expanded.length
    ) {
      break;
    }
    const padding =
      whitespaceEnd === expanded.length
        ? Math.max(whitespaceWidth, 1)
        : whitespaceWidth <= 4
          ? whitespaceWidth
          : 1;
    cursor = Math.min(afterMarker + padding, expanded.length);
    containers.push({
      id: nextContainerId,
      type: "list",
      continuationIndent:
        indentation + listMarker[0].length + padding,
    });
    nextContainerId += 1;
  }

  return { containers, cursor, nextContainerId };
}

function commonMarkSetextH2Underline(content) {
  return /^ {0,3}-+[ \t]*$/.test(content);
}

function commonMarkAtxH2(content) {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(
    content,
  );
  if (!match || match[2].length !== 2) return null;

  let heading = match[3];
  const closing = /[ \t]+(#+)[ \t]*$/.exec(heading);
  if (
    closing &&
    !isEscapedMarkdownCharacter(
      heading,
      closing.index + closing[0].indexOf("#"),
    )
  ) {
    heading = heading.slice(0, closing.index);
  }
  return {
    heading: heading.trimEnd(),
  };
}

function commonMarkReferenceLabel(text) {
  if (text.length > 999) return null;
  return decodeProtectedHeadingEntities(
    unescapeMarkdownPunctuation(text),
  )
    .replace(/[ \t\n\r\f]+/g, " ")
    .trim()
    .toLowerCase();
}

function commonMarkReferenceDefinition(content) {
  const match =
    /^ {0,3}\[([^\]\n]{1,999})\]:[ \t]*(?:<[^>\n]+>|\S+)(?:[ \t]+.*)?$/.exec(
      content,
    );
  return match ? commonMarkReferenceLabel(match[1]) : null;
}

function decodeProtectedHeadingEntityAt(text, start) {
  const candidate = text.slice(start, start + 64);
  const numeric = /^&#(?:([0-9]{1,7})|[xX]([0-9A-Fa-f]{1,6}));/.exec(
    candidate,
  );
  if (numeric) {
    const value = Number.parseInt(
      numeric[1] ?? numeric[2],
      numeric[2] ? 16 : 10,
    );
    const valid =
      value !== 0 &&
      value <= 0x10ffff &&
      !(value >= 0xd800 && value <= 0xdfff);
    return {
      length: numeric[0].length,
      decoded: valid ? String.fromCodePoint(value) : "\ufffd",
    };
  }

  const named = /^&([A-Za-z][A-Za-z0-9]+);/.exec(
    candidate,
  );
  const decoded = named
    ? PROTECTED_HEADING_NAMED_ENTITIES.get(named[1])
    : undefined;
  return decoded === undefined
    ? null
    : { length: named[0].length, decoded };
}

function decodeProtectedHeadingEntities(text) {
  let result = "";
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    if (text[cursor] === "&") {
      const entity = decodeProtectedHeadingEntityAt(
        text,
        cursor,
      );
      if (entity) {
        result += entity.decoded;
        cursor += entity.length - 1;
        continue;
      }
    }
    result += text[cursor];
  }
  return result;
}

function scanBoundedOwnerHeadingRecords(content) {
  const lines = commonMarkLineRecords(content);
  const headings = [];
  const frontmatterEnd = commonMarkFrontmatterEnd(lines);
  let activeContainers = [];
  let nextContainerId = 1;
  let paragraph = null;
  let openFence = null;
  let openHtml = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (lineIndex <= frontmatterEnd) {
      activeContainers = [];
      paragraph = null;
      openFence = null;
      openHtml = null;
      continue;
    }

    let reprocess = true;
    while (reprocess) {
      reprocess = false;
      const stateContainers =
        openFence?.containers ?? openHtml?.containers;
      const matched = matchCommonMarkContainers(
        line.expanded,
        activeContainers,
        paragraph,
        stateContainers === undefined,
      );

      if (openFence) {
        if (
          !sameCommonMarkContainerPath(
            matched.containers,
            openFence.containers,
          )
        ) {
          openFence = null;
          activeContainers = matched.containers;
          reprocess = true;
          continue;
        }
        const logical = line.expanded.slice(matched.cursor);
        const closing = commonMarkFenceMarker(logical);
        if (
          closing &&
          closing.character === openFence.character &&
          closing.length >= openFence.length &&
          closing.rest.trim() === ""
        ) {
          openFence = null;
        }
        continue;
      }

      if (openHtml) {
        if (
          !sameCommonMarkContainerPath(
            matched.containers,
            openHtml.containers,
          )
        ) {
          openHtml = null;
          activeContainers = matched.containers;
          reprocess = true;
          continue;
        }
        const logical = line.expanded.slice(matched.cursor);
        if (openHtml.blankTerminated && !logical.trim()) {
          openHtml = null;
          reprocess = true;
          continue;
        }
        if (
          openHtml.endPattern &&
          openHtml.endPattern.test(logical)
        ) {
          openHtml = null;
        }
        continue;
      }

      activeContainers = matched.containers;
      const opened = openCommonMarkContainers(
        line.expanded,
        matched.cursor,
        nextContainerId,
      );
      nextContainerId = opened.nextContainerId;
      activeContainers = [
        ...activeContainers,
        ...opened.containers,
      ];
      const logical = line.expanded.slice(opened.cursor);

      if (!logical.trim()) {
        paragraph = null;
        continue;
      }

      if (
        paragraph &&
        sameCommonMarkContainerPath(
          paragraph.containers,
          activeContainers,
        ) &&
        matched.explicit &&
        commonMarkSetextH2Underline(logical)
      ) {
        headings.push({
          index: paragraph.index,
          syntax: "setext",
          source: content.slice(
            paragraph.index,
            line.index + line.length,
          ),
          heading: paragraph.lines.join("\n"),
          strictHeading: null,
        });
        paragraph = null;
        continue;
      }

      const atx = commonMarkAtxH2(logical);
      if (atx) {
        paragraph = null;
        const strict = /^## (?!#)(.+?)[ \t]*$/.exec(
          line.source,
        );
        headings.push({
          index: line.index,
          syntax: "atx",
          source: line.source,
          heading: atx.heading,
          strictHeading: strict?.[1] ?? null,
        });
        continue;
      }

      if (isCommonMarkThematicBreak(logical)) {
        paragraph = null;
        continue;
      }

      const fence = commonMarkFenceMarker(logical);
      if (fence) {
        paragraph = null;
        openFence = {
          character: fence.character,
          length: fence.length,
          containers: [...activeContainers],
        };
        continue;
      }

      const html = commonMarkHtmlBlockStart(
        logical,
        paragraph !== null,
      );
      if (html) {
        paragraph = null;
        if (!html.endPattern || !html.endPattern.test(logical)) {
          openHtml = {
            ...html,
            containers: [...activeContainers],
          };
        }
        continue;
      }

      const reference = commonMarkReferenceDefinition(logical);
      if (reference) {
        paragraph = null;
        continue;
      }

      if (
        !paragraph &&
        /^ {4}/.test(logical)
      ) {
        continue;
      }

      if (
        paragraph &&
        sameCommonMarkContainerPath(
          paragraph.containers,
          activeContainers,
        )
      ) {
        paragraph.lines.push(logical.trim());
      } else {
        paragraph = {
          index: line.index,
          containers: [...activeContainers],
          lines: [logical.trim()],
        };
      }
    }
  }

  return headings;
}

function stripProtectedHeadingComments(text) {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const opening = text.indexOf("<!--", cursor);
    if (opening < 0) {
      result += text.slice(cursor);
      break;
    }
    result += text.slice(cursor, opening);
    const closing = text.indexOf("-->", opening + 4);
    if (closing < 0) {
      result += text.slice(opening);
      break;
    }
    cursor = closing + 3;
  }
  return result;
}

function compactProtectedHeadingText(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function protectedHeadingTokens(text) {
  return (
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function containsProtectedTokenSequence(candidate, expected) {
  if (expected.length === 0) return false;
  let expectedIndex = 0;
  for (const token of candidate) {
    if (token !== expected[expectedIndex]) continue;
    expectedIndex += 1;
    if (expectedIndex === expected.length) return true;
  }
  return false;
}

function protectedHeadingSearchForms(text) {
  const withoutComments = stripProtectedHeadingComments(text);
  const withoutEntitySyntax = withoutComments.replace(
    /&(?:#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]+);/g,
    " ",
  );
  return [
    withoutComments,
    decodeProtectedHeadingEntities(withoutComments),
    withoutEntitySyntax,
  ];
}

function protectedHeadingRecordMatches(record, expectedHeading) {
  const expectedCompact =
    compactProtectedHeadingText(expectedHeading);
  const expectedTokens =
    protectedHeadingTokens(expectedHeading);

  for (const source of [record.heading, record.source]) {
    for (const form of protectedHeadingSearchForms(source)) {
      const compact = compactProtectedHeadingText(form);
      if (
        compact.includes(expectedCompact) ||
        containsProtectedTokenSequence(
          protectedHeadingTokens(form),
          expectedTokens,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function protectedH2Matches(content, expectedHeading) {
  return scanBoundedOwnerHeadingRecords(content).filter(
    (heading) =>
      protectedHeadingRecordMatches(
        heading,
        expectedHeading,
      ),
  );
}

function validateHarnessOwnerLinks(
  file,
  section,
  owners = harnessDetailOwners,
  referenceDefinitionSource = section.visibleContent,
) {
  const resources = findVisibleMarkdownResources(
    section.visibleContent,
    referenceDefinitionSource,
  );
  const visibleLinkSource = maskMarkdownForLinkScan(
    section.visibleContent,
  );

  for (const owner of owners) {
    const canonicalTarget = path
      .relative(path.dirname(file), owner.file)
      .split(path.sep)
      .join("/");
    const literal = `[${owner.name}](${canonicalTarget})`;
    const literalCount =
      visibleLinkSource.split(literal).length - 1;
    const labelCount = resources.filter(
      (resource) => resource.label === owner.name,
    ).length;
    const targetCount = resources.filter(
      (resource) => resource.target === canonicalTarget,
    ).length;
    const exactCount = resources.filter(
      (resource) =>
        !resource.isImage &&
        resource.label === owner.name &&
        resource.target === canonicalTarget,
    ).length;
    let ownerIdentity;
    try {
      ownerIdentity = fs.realpathSync(path.join(root, owner.file));
    } catch {
      ownerIdentity = null;
    }
    const physicalTargetCount = resources.filter((resource) => {
      if (ownerIdentity === null) return false;
      const resolved = resolveLocalMarkdownTarget(
        file,
        resource.target,
      );
      if (!resolved) return false;
      try {
        return fs.realpathSync(resolved) === ownerIdentity;
      } catch {
        return false;
      }
    }).length;

    if (
      literalCount !== 1 ||
      labelCount !== 1 ||
      targetCount !== 1 ||
      exactCount !== 1 ||
      physicalTargetCount !== 1
    ) {
      errors.push(
        `${file}: ${owner.label}의 canonical inline owner 링크 '${literal}'가 정확히 하나 필요합니다.`,
      );
    }
  }
}

function hasNearbyDetailSignature(
  normalizedText,
  fragments,
  maxSpan,
) {
  const normalizedFragments = fragments.map((fragment) =>
    normalizeFinalizeDetailText(fragment),
  );
  const events = normalizedFragments.flatMap((fragment, fragmentIndex) => {
    const matches = [];
    for (
      let index = normalizedText.indexOf(fragment);
      index >= 0;
      index = normalizedText.indexOf(fragment, index + 1)
    ) {
      matches.push({
        start: index,
        end: index + fragment.length,
        fragmentIndex,
      });
    }
    return matches;
  }).sort((left, right) => left.start - right.start);
  const counts = new Map();
  let covered = 0;
  let left = 0;

  for (let right = 0; right < events.length; right += 1) {
    const rightEvent = events[right];
    const previous = counts.get(rightEvent.fragmentIndex) ?? 0;
    counts.set(rightEvent.fragmentIndex, previous + 1);
    if (previous === 0) covered += 1;

    while (covered === normalizedFragments.length) {
      const leftEvent = events[left];
      if (rightEvent.end - leftEvent.start <= maxSpan) return true;
      const leftCount = counts.get(leftEvent.fragmentIndex);
      counts.set(leftEvent.fragmentIndex, leftCount - 1);
      if (leftCount === 1) covered -= 1;
      left += 1;
    }
  }

  return false;
}

function validatePlannedIdRoutingSectionSyntax(file, section) {
  const rawSection = maskHtmlComments(section.content);
  const sectionWithoutInlineCode = maskRanges(
    rawSection,
    scanInlineCodeRanges(rawSection),
  );
  const ambiguousPatterns = [
    {
      pattern: /^ {0,3}>/m,
      label: "blockquote",
    },
    {
      pattern: /^ {4,}\S/m,
      label: "top-level indented code",
    },
    {
      pattern:
        /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]{5,}\S/m,
      label: "list container code",
    },
    {
      pattern:
        /^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+(?:`{3,}|~{3,})/m,
      label: "list container fence",
    },
  ];
  for (const { pattern, label } of ambiguousPatterns) {
    if (pattern.test(rawSection)) {
      errors.push(
        `${file}: planned ID owner 라우팅 구역에는 ${label} 문법을 사용할 수 없습니다.`,
      );
    }
  }
  if (/(?<!\\)!\[/.test(sectionWithoutInlineCode)) {
    errors.push(
      `${file}: planned ID owner 라우팅 구역에는 image 문법을 사용할 수 없습니다.`,
    );
  }
  if (/^ {0,3}\[[^\n]*\]:/m.test(sectionWithoutInlineCode)) {
    errors.push(
      `${file}: planned ID owner 라우팅 구역에는 reference definition 문법을 사용할 수 없습니다.`,
    );
  }
  if (
    /[\t\\]/.test(rawSection) ||
    /[!>]/.test(sectionWithoutInlineCode) ||
    /\]:/.test(sectionWithoutInlineCode)
  ) {
    errors.push(
      `${file}: planned ID owner 라우팅 구역에는 tab·escape·nested container·reference metadata를 사용할 수 없습니다.`,
    );
  }

  const canonicalTarget = path
    .relative(path.dirname(file), plannedIdDetailOwner.file)
    .split(path.sep)
    .join("/");
  const literal = `[${plannedIdDetailOwner.name}](${canonicalTarget})`;
  const ownerLines = rawSection
    .split("\n")
    .filter((line) => line.includes(literal));
  if (ownerLines.length === 1) {
    const line = ownerLines[0];
    const leadingSpaces = line.match(/^ */)[0].length;
    const openingBrackets = [...line].filter(
      (character) => character === "[",
    ).length;
    const closingBrackets = [...line].filter(
      (character) => character === "]",
    ).length;
    if (
      leadingSpaces > 2 ||
      /[!<>\\`\t]/.test(line) ||
      line.includes("]:") ||
      openingBrackets !== 1 ||
      closingBrackets !== 1
    ) {
      errors.push(
        `${file}: planned ID canonical owner 링크는 plain paragraph·2칸 continuation·table row의 단일 inline link여야 합니다.`,
      );
    }
  }

  const visibleText = maskMarkdownForLinkScan(
    section.visibleContent,
  );
  const rawHtml = visibleText.match(/<[A-Za-z/!?][^\n]*/);
  if (rawHtml) {
    errors.push(
      `${file}: planned ID owner 라우팅 구역에는 raw HTML·autolink를 사용할 수 없습니다.`,
    );
  }
  const withoutReferenceDefinitions = visibleText.replace(
    /!?\[[^\]\n]+]:/g,
    "",
  );
  const hasFullOrCollapsedReference =
    /!?\[[^\]\n]+]\[[^\]\n]*]/.test(
      withoutReferenceDefinitions,
    );
  const withoutInlineLinks = withoutReferenceDefinitions.replace(
    /!?\[[^\]\n]+]\([^)\n]*\)/g,
    "",
  );
  const hasShortcutReference =
    /!?\[[^\]\n]+]/.test(withoutInlineLinks);
  if (hasFullOrCollapsedReference || hasShortcutReference) {
    errors.push(
      `${file}: planned ID owner 라우팅 구역에는 reference-style·collapsed·shortcut link usage를 사용할 수 없습니다. canonical inline link를 사용하세요.`,
    );
  }
}

function validatePlannedIdRoutingBoundaries() {
  for (const { file, section } of plannedIdRoutingDocuments) {
    if (!isFile(file)) {
      errors.push(`필수 planned ID 라우팅 문서가 없습니다: ${file}`);
      continue;
    }

    const rawContent = fs.readFileSync(path.join(root, file), "utf8");
    const content = rawContent.replaceAll("\r\n", "\n");
    if (content.includes("\r")) {
      errors.push(
        `${file}: planned ID 라우팅 문서에는 CRLF가 아닌 bare CR 줄바꿈을 사용할 수 없습니다.`,
      );
      continue;
    }
    const visibleDocumentProse = maskMarkdownForLinkScan(content);
    if (/<[A-Za-z/!?][^\n]*/.test(visibleDocumentProse)) {
      errors.push(
        `${file}: planned ID 라우팅 문서에는 code 밖의 raw HTML·autolink를 사용할 수 없습니다.`,
      );
    }
    const normalizedDetailTexts =
      finalizeDetailTextVariants(content);
    for (const signature of forbiddenPlannedIdDetailSignatures) {
      if (
        normalizedDetailTexts.some(
          (normalized) =>
            hasNearbyDetailSignature(
              normalized,
              signature.fragments,
              signature.maxSpan,
            ),
        )
      ) {
        errors.push(
          `${file}: planned ID 내부 상세 '${signature.label}'을 재복제할 수 없습니다. 상세 계약은 ${plannedIdDetailOwner.file}가 소유합니다.`,
        );
      }
    }

    const visibleContent = maskInvisibleMarkdown(content);
    const allSections = readStrictH2Sections(
      content,
      visibleContent,
    );
    const sections = allSections.filter(
      (candidate) =>
        candidate.source === `## ${section}`,
    );
    const protectedHeadingCount =
      protectedH2Matches(content, section).length;
    if (sections.length !== 1 || protectedHeadingCount !== 1) {
      errors.push(
        `${file}: planned ID owner 라우팅 구역은 exact plain-text top-level H2로 정확히 하나여야 합니다: ${section} (canonical ${sections.length}개, 보호 후보 ${protectedHeadingCount}개)`,
      );
      continue;
    }

    validatePlannedIdRoutingSectionSyntax(file, sections[0]);
    validateHarnessOwnerLinks(
      file,
      sections[0],
      [plannedIdDetailOwner],
      content,
    );
  }
}

function validatePlannedIdDetailOwnerBoundary() {
  const file = plannedIdDetailOwner.file;
  if (!isFile(file)) return;

  const rawContent = fs.readFileSync(path.join(root, file), "utf8");
  const content = rawContent.replaceAll("\r\n", "\n");
  if (content.includes("\r")) {
    errors.push(
      `${file}: planned ID 상세 owner에는 CRLF가 아닌 bare CR 줄바꿈을 사용할 수 없습니다.`,
    );
    return;
  }
  const visibleOwnerProse = maskMarkdownForLinkScan(content);
  if (/<[A-Za-z/!?][^\n]*/.test(visibleOwnerProse)) {
    errors.push(
      `${file}: planned ID 상세 owner에는 code 밖의 raw HTML·autolink를 사용할 수 없습니다.`,
    );
  }
  const visibleContent = maskInvisibleMarkdown(content);
  const plannedOwnerHeadingMatches = protectedH2Matches(
    content,
    plannedIdDetailOwner.section,
  );
  const canonicalOwnerHeadingSource =
    `## ${plannedIdDetailOwner.section}`;
  for (const match of plannedOwnerHeadingMatches) {
    if (
      match.syntax !== "atx" ||
      match.source !== canonicalOwnerHeadingSource
    ) {
      errors.push(
        `${file}:${sourceLineNumber(content, match.index)}: planned ID 상세 owner의 H2는 Markdown formatting·link가 없는 plain text여야 합니다. 보호 이름을 나타내거나 포함할 수 있는 다른 source skeleton은 허용하지 않습니다.`,
      );
    }
  }
  const allSections = readStrictH2Sections(
    content,
    visibleContent,
  );
  const sections = allSections.filter(
    (candidate) =>
      candidate.source === canonicalOwnerHeadingSource,
  );
  const protectedHeadingCount = [
    ...plannedOwnerHeadingMatches,
  ].length;
  if (sections.length !== 1 || protectedHeadingCount !== 1) {
    errors.push(
      `${file}: planned ID 상세 owner 구역은 exact plain-text top-level H2로 정확히 하나여야 합니다: ${plannedIdDetailOwner.section} (canonical ${sections.length}개, 보호 후보 ${protectedHeadingCount}개)`,
    );
    return;
  }

  const ownerSection = sections[0];
  const ownerSyntaxSource = ownerSection.content;
  const plannedIdMarkerBoundary =
    "- `planned ID`는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다.";
  const plannedIdMarkerBoundaryCount = ownerSyntaxSource
    .split("\n")
    .filter((line) => line === plannedIdMarkerBoundary).length;
  if (plannedIdMarkerBoundaryCount !== 1) {
    errors.push(
      `${file}: 하네스 수명주기 계약이 없습니다: planned ID marker는 정본 정의가 아님 (exact direct bullet ${plannedIdMarkerBoundaryCount}개)`,
    );
  }
  let inDirectBullet = false;
  for (const line of ownerSyntaxSource.split("\n")) {
    if (!line.trim()) continue;
    if (/^- \S/.test(line)) {
      inDirectBullet = true;
      continue;
    }
    if (
      /^ {2}\S/.test(line) &&
      !/^ {2}(?:[-+*]|\d{1,9}[.)])[ \t]/.test(line) &&
      inDirectBullet
    ) {
      continue;
    }
    errors.push(
      `${file}: planned ID 상세 owner 구역의 각 visible line은 '- ' direct bullet 또는 그 bullet의 정확히 2칸 continuation이어야 합니다.`,
    );
    inDirectBullet = false;
  }
  const ownerFenceLine = ownerSyntaxSource
    .split("\n")
    .find((line) => {
      const payload = line.startsWith("- ")
        ? line.slice(2)
        : line.startsWith("  ")
          ? line.slice(2)
          : null;
      if (payload === null) return false;
      const backtickFence = payload.match(/^(`{3,})(.*)$/);
      if (backtickFence && !backtickFence[2].includes("`")) {
        return true;
      }
      return /^~{3,}/.test(payload);
    });
  if (ownerFenceLine !== undefined) {
    errors.push(
      `${file}: planned ID 상세 owner 구역에는 direct bullet·2칸 continuation에 넣은 fenced code marker를 사용할 수 없습니다.`,
    );
  }
  if (/[\t\\]/.test(ownerSyntaxSource)) {
    errors.push(
      `${file}: planned ID 상세 owner 구역에는 tab과 backslash escape를 사용할 수 없습니다.`,
    );
  }
  const ownerWithoutInlineCode = maskRanges(
    ownerSyntaxSource,
    scanInlineCodeRanges(ownerSyntaxSource),
  );
  const unmatchedBacktick = ownerWithoutInlineCode.indexOf("`");
  if (
    unmatchedBacktick >= 0 ||
    /[[\]!<>|#*_~]/.test(ownerWithoutInlineCode)
  ) {
    errors.push(
      `${file}: planned ID 상세 owner 구역에는 inline code 밖의 Markdown formatting·link·image·reference·raw HTML을 사용할 수 없습니다.`,
    );
  }
  const outsideOwner = maskRanges(content, [
    { start: ownerSection.start, end: ownerSection.end },
  ]);
  const normalizedOutsideTexts =
    finalizeDetailTextVariants(outsideOwner);
  for (const signature of forbiddenPlannedIdDetailSignatures) {
    if (
      normalizedOutsideTexts.some(
        (normalized) =>
          hasNearbyDetailSignature(
            normalized,
            signature.fragments,
            signature.maxSpan,
          ),
      )
    ) {
      errors.push(
        `${file}: planned ID 내부 상세 '${signature.label}'은 '${plannedIdDetailOwner.section}' 구역에서만 정의해야 합니다.`,
      );
    }
  }
}

function validateApprovalZeroContract(file, section) {
  const normalized = visibleInlineLinkLabels(
    section.visibleContent,
  )
    .trim()
    .replace(/\s+/g, " ");
  const compactRaw = normalizeFinalizeDetailText(section.content);
  const approvalPhrase =
    "필수 승인 수는 1인 운영을 막지 않도록 0으로 유지합니다.";
  const threadPhrase =
    "승인 수와 무관하게 생성된 리뷰 대화는 모두 해결해야 합니다.";
  const approvalCount = normalized.split(approvalPhrase).length - 1;
  const threadCount = normalized.split(threadPhrase).length - 1;
  const approvalMentions =
    normalized.split("필수 승인 수").length - 1;
  const threadMentions =
    normalized.split("승인 수와 무관하게").length - 1;
  const rawApprovalMentions =
    compactRaw.split(
      normalizeFinalizeDetailText("필수 승인 수"),
    ).length - 1;
  const rawThreadMentions =
    compactRaw.split(
      normalizeFinalizeDetailText("승인 수와 무관하게"),
    ).length - 1;

  if (
    approvalCount !== 1 ||
    threadCount !== 1 ||
    approvalMentions !== 1 ||
    threadMentions !== 1 ||
    rawApprovalMentions !== 1 ||
    rawThreadMentions !== 1
  ) {
    errors.push(
      `${file}: 병합과 정리에는 필수 승인 수 0과 생성된 리뷰 대화 해결 계약이 각각 정확히 하나 필요합니다.`,
    );
  }
}

function validateHarnessRoutingBoundaries() {
  const ownerPath = path.join(root, finalizeDetailOwnerFile);
  const ownerContent = isFile(finalizeDetailOwnerFile)
    ? fs.readFileSync(ownerPath, "utf8")
    : "";
  for (const token of forbiddenFinalizeDetailTokens) {
    if (!ownerContent.includes(token)) {
      errors.push(
        `${finalizeDetailOwnerFile}: finalize 상세 owner 토큰 '${token}'이 없습니다.`,
      );
    }
  }

  for (const { file, section } of harnessRoutingDocuments) {
    if (!isFile(file)) {
      errors.push(`필수 하네스 라우팅 문서가 없습니다: ${file}`);
      continue;
    }

    const content = fs.readFileSync(path.join(root, file), "utf8");
    const visibleContent = validateStrictHarnessSyntax(file, content);
    const normalizedDetailTexts =
      finalizeDetailTextVariants(content);
    for (const token of forbiddenFinalizeDetailTokens) {
      if (
        !normalizedDetailTexts.some((normalized) =>
          normalized.includes(normalizeFinalizeDetailText(token)),
        )
      ) {
        continue;
      }
      const rawOffset = content
        .toLowerCase()
        .indexOf(token.toLowerCase());
      const location =
        rawOffset >= 0
          ? `:${sourceLineNumber(content, rawOffset)}`
          : "";
      errors.push(
        `${file}${location}: finalize 내부 토큰 '${token}'을 재복제할 수 없습니다. 상세 계약은 ${finalizeDetailOwnerFile}가 소유합니다.`,
      );
    }

    const allSections = readStrictH2Sections(
      content,
      visibleContent,
    );
    const sections = allSections.filter(
      (candidate) =>
        candidate.source === `## ${section}`,
    );
    const protectedHeadingCount =
      protectedH2Matches(content, section).length;
    if (sections.length !== 1 || protectedHeadingCount !== 1) {
      errors.push(
        `${file}: 하네스 owner 라우팅 구역은 exact plain-text top-level H2로 정확히 하나여야 합니다: ${section} (canonical ${sections.length}개, 보호 후보 ${protectedHeadingCount}개)`,
      );
      continue;
    }

    validateHarnessOwnerLinks(
      file,
      sections[0],
      harnessDetailOwners,
      content,
    );
    if (file === "CONTRIBUTING.md") {
      validateApprovalZeroContract(file, sections[0]);
    }
  }
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

function validateHarnessOrchestration(file) {
  if (!isFile(file)) return;

  const content = fs.readFileSync(path.join(root, file), "utf8");
  const visibleContent = visibleContractMarkdown(content);
  const sections = readVisibleH2Sections(content);

  if (
    !/Claude Code와\s+Codex/.test(visibleContent) ||
    !/단일\s+orchestrator\s+인덱스/.test(visibleContent)
  ) {
    errors.push(
      `${file}: Claude Code와 Codex가 공유하는 단일 orchestrator 인덱스임을 명시해야 합니다.`,
    );
  }

  const requiredSections = ["요청 라우팅", "규칙 소유와 링크"];
  for (const heading of requiredSections) {
    const count = sections.filter((section) => section.heading === heading).length;
    if (count !== 1) {
      errors.push(
        `${file}: '## ${heading}' 섹션이 정확히 하나 필요합니다. (현재 ${count}개)`,
      );
    }
  }

  for (const [number, status] of [
    ["02", "Todo"],
    ["03", "In Progress"],
  ]) {
    const section = sections.find((entry) =>
      entry.heading.startsWith(`STEP ${number}.`),
    );
    if (
      !section ||
      !new RegExp(
        `Project 관리 이슈인 경우[\\s\\S]{0,120}Project[^\\n]{0,80}${status}`,
      ).test(section.content)
    ) {
      errors.push(
        `${file}: STEP ${number}은 Project 상태 ${status}를 Project 관리 이슈에만 조건부로 요구해야 합니다.`,
      );
    }
  }

  const routingSection = readH2Section(content, "요청 라우팅");
  if (routingSection !== null) {
    const rows = readTraceTableRows(routingSection, {
      file,
      label: "요청 라우팅",
      headers: [
        [
          "요청 유형",
          "첫 정본 입력",
          "실행 Skill·소유자",
          "종료·인계 지점",
        ],
      ],
    });
    const requiredRoutes = [
      "새 이슈 작성·감사",
      "기존 이슈 구현·재개",
      "제품 문서 작성·변경",
      "commit 작성",
      "PR 생성·갱신만",
      "작업 완료·병합",
      "실패·부분 응답 복구",
    ];
    for (const route of requiredRoutes) {
      const count = rows.filter((row) => row[0] === route).length;
      if (count !== 1) {
        errors.push(
          `${file}: 요청 라우팅 표에 '${route}' 행이 정확히 하나 필요합니다. (현재 ${count}개)`,
        );
      }
    }
    if (rows.length !== requiredRoutes.length) {
      errors.push(
        `${file}: 요청 라우팅 표에는 지정된 ${requiredRoutes.length}개 요청 유형만 필요합니다. (현재 ${rows.length}개)`,
      );
    }

    const routeText = (name) =>
      rows.find((row) => row[0] === name)?.join(" ") ?? "";
    if (
      !/run-github-work-item/.test(routeText("새 이슈 작성·감사")) ||
      !/\bcreate\b/.test(routeText("새 이슈 작성·감사")) ||
      !/on-demand/i.test(routeText("새 이슈 작성·감사")) ||
      !/11단계 밖/.test(routeText("새 이슈 작성·감사"))
    ) {
      errors.push(
        `${file}: 새 이슈 작성·감사는 run-github-work-item create가 소유하는 on-demand 11단계 밖 작업이어야 합니다.`,
      );
    }
    if (
      !/open-pull-request/.test(routeText("PR 생성·갱신만")) ||
      !/멈추/.test(routeText("PR 생성·갱신만")) ||
      !/병합하지/.test(routeText("PR 생성·갱신만"))
    ) {
      errors.push(
        `${file}: PR 생성·갱신만 요청은 open-pull-request 재조회에서 멈추고 병합하지 않아야 합니다.`,
      );
    }
    if (
      !/open-pull-request/.test(routeText("작업 완료·병합")) ||
      !/run-github-work-item/.test(routeText("작업 완료·병합")) ||
      !/현재 head/.test(routeText("작업 완료·병합")) ||
      !/\bCI\b/.test(routeText("작업 완료·병합")) ||
      !/review snapshot/.test(routeText("작업 완료·병합")) ||
      !/squash merge/.test(routeText("작업 완료·병합")) ||
      !/\bcomplete\b/.test(routeText("작업 완료·병합"))
    ) {
      errors.push(
        `${file}: 작업 완료·병합 라우팅은 현재 head·CI·review snapshot에서 squash merge와 complete까지 두 Skill owner를 연결해야 합니다.`,
      );
    }
  }

  const ownershipSection = readH2Section(content, "규칙 소유와 링크");
  if (ownershipSection !== null) {
    if (!/한 규칙에는 세부 정본 소유자를 하나만 둔다/.test(ownershipSection)) {
      errors.push(
        `${file}: 규칙 소유와 링크에는 한 규칙의 세부 정본 소유자를 하나만 둔다는 원칙이 필요합니다.`,
      );
    }
    const rows = readTraceTableRows(ownershipSection, {
      file,
      label: "규칙 소유와 링크",
      headers: [["규칙", "단일 소유 정본", "이 인덱스의 역할"]],
    });
    const requiredOwners = [
      "사용자 결과·수용 동작",
      "상태·권한·실패·복구·보존·보안",
      "작업 범위·경로·행동 시나리오·검증 계획",
      "PRD·Policy planned ID 수명주기",
      "이슈·Project 상태 전이·재조회·복구",
      "PR 쓰기·exact-head finalize·원격·로컬 정리",
      "PR의 고정 필드",
      "CI의 결정적 증거",
    ];
    for (const owner of requiredOwners) {
      const count = rows.filter((row) => row[0] === owner).length;
      if (count !== 1) {
        errors.push(
          `${file}: 규칙 소유와 링크 표에 '${owner}' 행이 정확히 하나 필요합니다. (현재 ${count}개)`,
        );
      }
    }
    const plannedIdOwnerRow = rows.find(
      (row) => row[0] === plannedIdDetailOwner.label,
    );
    const issueContractOwnerRow = rows.find(
      (row) =>
        row[0] === "작업 범위·경로·행동 시나리오·검증 계획",
    );
    const plannedIdOwnerCell =
      "[update-product-docs](../../.agents/skills/update-product-docs/SKILL.md)";
    if (
      plannedIdOwnerRow?.[1] !== plannedIdOwnerCell ||
      plannedIdOwnerRow?.[2] !==
        "새 ID 요청을 단일 owner로 라우팅"
    ) {
      errors.push(
        `${file}: '${plannedIdDetailOwner.label}' 행은 canonical update-product-docs owner와 새 ID 단일 라우팅 역할에 결합되어야 합니다.`,
      );
    }
    if (
      issueContractOwnerRow?.[1] !==
        "[run-github-work-item 이슈 계약](../../.agents/skills/run-github-work-item/references/issue-contract.md)" ||
      issueContractOwnerRow?.[2] !==
        "이슈 양식·제품 추적 적용 경계·구현·리뷰 입력을 단일 계약으로 라우팅"
    ) {
      errors.push(
        `${file}: 작업 범위·경로·행동 시나리오·검증 계획 행은 canonical run-github-work-item 이슈 계약과 제품 추적 적용 경계에 결합되어야 합니다.`,
      );
    }
    if (rows.length !== requiredOwners.length) {
      errors.push(
        `${file}: 규칙 소유와 링크 표에는 지정된 ${requiredOwners.length}개 소유 규칙만 필요합니다. (현재 ${rows.length}개)`,
      );
    }
  }
}

function validateFinalSnapshotGateOrder(file) {
  if (!isFile(file)) return;

  const content = fs.readFileSync(path.join(root, file), "utf8");
  const visibleDocument = visibleFinalSnapshotMarkdown(content);
  const sections = readStrictH2Sections(content, content);
  const orderSections = sections.filter(
    (section) =>
      section.source === "## 최종 snapshot 검증 순서" &&
      strictH2SourceIsVisible(visibleDocument, section),
  );
  const recoverySections = sections.filter(
    (section) =>
      section.source === "## 실패와 증거 무효화" &&
      strictH2SourceIsVisible(visibleDocument, section),
  );
  const orderProtectedCount = protectedH2Matches(
    content,
    "최종 snapshot 검증 순서",
  ).length;
  const recoveryProtectedCount = protectedH2Matches(
    content,
    "실패와 증거 무효화",
  ).length;

  if (orderSections.length !== 1 || orderProtectedCount !== 1) {
    errors.push(
      `${file}: '## 최종 snapshot 검증 순서' exact plain-text top-level H2가 정확히 하나 필요합니다. (canonical ${orderSections.length}개, 보호 후보 ${orderProtectedCount}개)`,
    );
  } else {
    const rows = readTraceTableRows(orderSections[0].content, {
      file,
      label: "최종 snapshot 검증 순서",
      headers: [["순서", "단계", "필수 계약"]],
      visibleContracts: true,
    });
    const actualOrder = rows.map((row) => row.slice(0, 2));
    const expectedOrder = finalSnapshotGateOrder.map(({ order, stage }) => [
      order,
      stage,
    ]);
    if (
      actualOrder.length !== expectedOrder.length ||
      actualOrder.some(
        (row, index) => !sameCells(row, expectedOrder[index]),
      )
    ) {
      errors.push(
        `${file}: 최종 snapshot 검증 순서는 빠른 행동 검증→정본 의미 영향→candidate 고정→독립 리뷰→최종 저장소 게이트→commit→PR·필수 CI의 exact 7행이어야 합니다.`,
      );
    }

    for (const expected of finalSnapshotGateOrder) {
      const row = rows.find(
        (candidate) =>
          candidate[0] === expected.order &&
          candidate[1] === expected.stage,
      );
      if (!row) continue;
      for (const [label, pattern] of expected.contracts) {
        pattern.lastIndex = 0;
        if (!pattern.test(row[2])) {
          errors.push(
            `${file}: 최종 snapshot 검증 순서의 '${expected.stage}' 행에 필수 계약이 없습니다: ${label}`,
          );
        }
      }
    }
  }

  if (
    recoverySections.length !== 1 ||
    recoveryProtectedCount !== 1
  ) {
    errors.push(
      `${file}: '## 실패와 증거 무효화' exact plain-text top-level H2가 정확히 하나 필요합니다. (canonical ${recoverySections.length}개, 보호 후보 ${recoveryProtectedCount}개)`,
    );
  } else {
    const rows = readTraceTableRows(recoverySections[0].content, {
      file,
      label: "실패와 증거 무효화",
      headers: [["상황", "기존 증거", "재진입"]],
      visibleContracts: true,
    });
    const actualSituations = rows.map((row) => row[0]);
    const expectedSituations = finalSnapshotRecoveryOrder.map(
      ({ situation }) => situation,
    );
    if (
      actualSituations.length !== expectedSituations.length ||
      actualSituations.some(
        (situation, index) => situation !== expectedSituations[index],
      )
    ) {
      errors.push(
        `${file}: 실패와 증거 무효화는 tracked content 변경→환경 전용 실패·동일 tree·input→의미 영향·리뷰 증거 불완전·동일 tree·input→최종 gate 증거 불완전·동일 tree·input→candidate tree·input 불일치의 exact 5행이어야 합니다.`,
      );
    }

    for (const expected of finalSnapshotRecoveryOrder) {
      const row = rows.find(
        (candidate) => candidate[0] === expected.situation,
      );
      if (!row) continue;
      expected.evidence.lastIndex = 0;
      if (!expected.evidence.test(row[1])) {
        errors.push(
          `${file}: 실패와 증거 무효화의 '${expected.situation}' 기존 증거 계약이 불완전합니다.`,
        );
      }
      expected.reentry.lastIndex = 0;
      if (!expected.reentry.test(row[2])) {
        errors.push(
          `${file}: 실패와 증거 무효화의 '${expected.situation}' 재진입 계약이 불완전합니다.`,
        );
      }
    }
  }
}

function validateFinalSnapshotOwnerContracts() {
  const documents = new Map();

  for (const { file, section, label, pattern } of finalSnapshotOwnerContracts) {
    if (!isFile(file)) {
      errors.push(`최종 snapshot 계약 owner 파일이 없습니다: ${file}`);
      continue;
    }

    if (!documents.has(file)) {
      const source = fs
        .readFileSync(path.join(root, file), "utf8")
        .replaceAll("\r\n", "\n");
      const visibleDocument = visibleFinalSnapshotMarkdown(source);
      documents.set(file, {
        source,
        visibleDocument,
        sections: readStrictH2Sections(source, source),
      });
    }

    const { source, visibleDocument, sections } = documents.get(file);
    const matchingSections = sections.filter(
      (candidate) =>
        candidate.source === `## ${section}` &&
        strictH2SourceIsVisible(visibleDocument, candidate),
    );
    const protectedHeadingCount =
      protectedH2Matches(source, section).length;
    if (
      matchingSections.length !== 1 ||
      protectedHeadingCount !== 1
    ) {
      errors.push(
        `${file}: 최종 snapshot 계약 owner 구역은 exact plain-text top-level H2로 정확히 하나여야 합니다: ${section} (canonical ${matchingSections.length}개, 보호 후보 ${protectedHeadingCount}개)`,
      );
      continue;
    }

    const content = maskIndentedCodeLines(
      visibleFinalSnapshotMarkdown(matchingSections[0].content),
    );
    pattern.lastIndex = 0;
    if (!pattern.test(content)) {
      errors.push(
        `${file}: '${section}'에 최종 snapshot 검증 계약이 없습니다: ${label}`,
      );
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activeYamlJobBlock(source, jobId) {
  const lines = source.split("\n");
  const header = `  ${jobId}:`;
  const starts = lines.flatMap((line, index) =>
    line === header ? [index] : [],
  );
  if (starts.length !== 1) return "";

  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      !line.trimStart().startsWith("#") &&
      /^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line)
    ) {
      end = index;
      break;
    }
  }

  return lines
    .slice(start, end)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

function validateHarnessSkillContracts() {
  const requiredFiles = [
    ".github/workflows/validate-harness-paths.mjs",
    ".github/workflows/validate-harness-paths.test.mjs",
    ".agents/skills/update-product-docs/scripts/product-contract-ids.mjs",
    ".agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
    ".agents/skills/open-pull-request/scripts/validate-finalize.mjs",
    ".agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
    ".agents/skills/open-pull-request/scripts/finalize-merge.mjs",
    ".agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
  ];
  for (const file of requiredFiles) {
    if (!isFile(file)) {
      errors.push(`필수 하네스 검증 파일이 없습니다: ${file}`);
    }
  }

  const workflowFile = ".github/workflows/validate-harness.yml";
  if (isFile(workflowFile)) {
    const workflowSource = fs
      .readFileSync(path.join(root, workflowFile), "utf8")
      .replaceAll("\r\n", "\n");
    const validateBlock = activeYamlJobBlock(workflowSource, "validate");
    const aggregateTerms = [
      [
        "CI aggregate always 실행",
        /^    if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/m,
      ],
      ...[
        "classify",
        "harness",
        "product-docs",
        "patch-whitespace",
        "product-docs-regression",
        "work-item-regression",
        "commit-pr-regression",
        "finalize-regression",
      ].map((job) => [
        `CI aggregate direct needs: ${job}`,
        new RegExp(`^      - ${escapeRegExp(job)}\\s*$`, "m"),
      ]),
      ...[
        ["FULL_SELECTED", "classify.outputs.full"],
        ["PRODUCT_DOCS_SELECTED", "classify.outputs.product_docs"],
        ["WORK_ITEM_SELECTED", "classify.outputs.work_item"],
        ["COMMIT_PR_SELECTED", "classify.outputs.commit_pr"],
        ["FINALIZE_SELECTED", "classify.outputs.finalize"],
      ].map(([name, target]) => [
        `CI aggregate 선택값 결속: ${name}`,
        new RegExp(
          `^\\s+${name}:\\s*\\$\\{\\{\\s*needs\\.${escapeRegExp(target)}\\s*\\}\\}\\s*$`,
          "m",
        ),
      ]),
      ...[
        ["CLASSIFY_RESULT", "classify.result"],
        ["HARNESS_RESULT", "harness.result"],
        ["PRODUCT_DOCS_RESULT", "product-docs.result"],
        ["PATCH_WHITESPACE_RESULT", "patch-whitespace.result"],
        [
          "PRODUCT_DOCS_REGRESSION_RESULT",
          "product-docs-regression.result",
        ],
        ["WORK_ITEM_REGRESSION_RESULT", "work-item-regression.result"],
        ["COMMIT_PR_REGRESSION_RESULT", "commit-pr-regression.result"],
        ["FINALIZE_REGRESSION_RESULT", "finalize-regression.result"],
      ].map(([name, target]) => [
        `CI aggregate job 결과 결속: ${name}`,
        new RegExp(
          `^\\s+${name}:\\s*\\$\\{\\{\\s*needs\\.${escapeRegExp(target)}\\s*\\}\\}\\s*$`,
          "m",
        ),
      ]),
    ];

    for (const [label, pattern] of aggregateTerms) {
      if (!pattern.test(validateBlock)) {
        errors.push(
          `${workflowFile}: 하네스 수명주기 계약이 없습니다: ${label}`,
        );
      }
    }
  }

  const contracts = [
    {
      file: ".agents/skills/update-product-docs/SKILL.md",
      section: plannedIdDetailOwner.section,
      terms: [
        ["승인된 결정", /승인된 결정/],
        [
          "planned ID marker는 정본 정의가 아님",
          /는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다/,
        ],
        [
          "같은 이슈·branch·PR",
          /같은[\s\S]{0,160}이슈[\s\S]{0,160}branch[\s\S]{0,160}PR/,
        ],
        ["별도 문서 이슈 불필요", /별도 문서 이슈나 PR을 만들 필요는 없다/],
        ["Ready 전 실제 정의", /Ready 전[\s\S]{0,300}실제[\s\S]{0,80}정의/],
        ["README·인덱스", /README·(?:하위 )?인덱스/],
        [
          "concrete planned definition file",
          /namespace[\s\S]{0,180}`NN_\*\.md`[\s\S]{0,220}README[\s\S]{0,120}재귀 glob/,
        ],
        [
          "exact-head product definitions",
          /exact PR head Git tree[\s\S]{0,240}image alt[\s\S]{0,160}<details>/,
        ],
        ["validator", /validator/],
        ["구현·테스트 추적", /구현·테스트/],
        [
          "미결정 시 중단",
          /(?:미결정 제품 선택[\s\S]{0,160}중단|제품 결정이 승인되지 않았다면 중단)/,
        ],
        [
          "canonical owner grammar",
          /plain top-level H2[\s\S]{0,120}direct bullet[\s\S]{0,80}2칸 continuation[\s\S]{0,80}inline code[\s\S]{0,180}reference definition[\s\S]{0,160}fenced·indented code[\s\S]{0,100}raw HTML/,
        ],
        [
          "fail-closed owner H2 source grammar",
          /보호 이름[\s\S]{0,120}source가 정확히[\s\S]{0,80}`## <name>`[\s\S]{0,180}container[\s\S]{0,120}setext[\s\S]{0,180}reference·entity·hardbreak/,
        ],
        [
          "bounded owner H2 scanner",
          /임의의 CommonMark rendered 동등성을 보장하지 않는다[\s\S]{0,120}bounded[\s\S]{0,80}block scanner[\s\S]{0,160}fenced·indented code[\s\S]{0,120}숨겨진 raw HTML[\s\S]{0,180}visible\/source skeleton[\s\S]{0,160}token sequence[\s\S]{0,120}fail-closed/,
        ],
      ],
    },
    {
      file: ".agents/skills/run-github-work-item/SKILL.md",
      terms: [
        [
          "exact create labels",
          /요청·파생 label의 정확한 집합[\s\S]{0,180}요청하지 않은 label/,
        ],
        [
          "stale blocked bounded repair",
          /stale[\s\S]{0,80}`dependency:blocked`[\s\S]{0,180}live 의존 관계/,
        ],
      ],
    },
    {
      file: ".agents/skills/open-pull-request/SKILL.md",
      terms: [
        ["PR-only 중단", /PR 생성·갱신만[\s\S]{0,240}멈춘다/],
        ["명시적 finalize", /완료·병합·end-to-end/],
        ["finalize validator", /validate-finalize\.mjs/],
        [
          "exact-head guard",
          /finalize-merge\.mjs[\s\S]{0,900}--match-head-commit/,
        ],
        [
          "structured exact review head",
          /review-head=<40자리 SHA>[\s\S]{0,180}정확히 한 번[\s\S]{0,180}완전히 일치/,
        ],
        [
          "squash merge helper",
          /Exact-head squash merge[\s\S]{0,700}finalize-merge\.mjs/,
        ],
        [
          "argv-bound merge",
          /gh pr merge[\s\S]{0,100}shell 문자열[\s\S]{0,160}별도 argv/,
        ],
        ["merge branch 보존", /`--delete-branch`[\s\S]{0,160}사용하지 않는다/],
        [
          "exact remote OID 조회",
          /git ls-remote --heads origin refs\/heads\/<validated-branch>/,
        ],
        [
          "CAS remote 삭제",
          /--force-with-lease=refs\/heads\/<validated-branch>:<validated-head>/,
        ],
        ["required CI", /required check/],
        ["review thread", /review thread/],
        [
          "identity-bound required CI",
          /required check[\s\S]{0,220}`statusCheckRollup`[\s\S]{0,180}유일한 성공 run/,
        ],
        [
          "identity-bound review threads",
          /review thread 응답[\s\S]{0,180}repo·PR node·number·URL·`updatedAt`[\s\S]{0,160}base\/head/,
        ],
        [
          "exact-head product tree",
          /exact head Git tree[\s\S]{0,180}추적 ID/,
        ],
        ["종료 이슈 재검증", /closingIssuesReferences/],
        [
          "MERGED recovery",
          /--merged-recovery[\s\S]{0,500}`MERGED`[\s\S]{0,240}`mergedAt`[\s\S]{0,240}`mergeCommit\.oid`/,
        ],
        [
          "recovery merge 무반복",
          /merge 명령은[\s\S]{0,120}실행하지 않고[\s\S]{0,180}원격 ref 확인/,
        ],
        [
          "recovery OPEN gate 분리",
          /병합 전에만 의미가 있는 required check·review thread[\s\S]{0,120}(?:받거나[\s\S]{0,60})?다시 판정하지 않고/,
        ],
        [
          "recovery squash topology",
          /유일한 parent[\s\S]{0,120}`baseRefOid`[\s\S]{0,180}merge tree[\s\S]{0,120}exact head tree[\s\S]{0,240}first-parent/,
        ],
        [
          "recovery ownership dry-run",
          /complete <issue> --pr <pr> --head <validated-head>[\s\S]{0,80}--repo <validated-repository> --dry-run/,
        ],
        [
          "recovery main cwd",
          /issue worktree가[\s\S]{0,100}(?:이미 )?없[\s\S]{0,180}clean `main` worktree[\s\S]{0,120}재개/,
        ],
        [
          "Ready ID 정의 형식",
          /FR·AC·Policy visible heading[\s\S]{0,160}PRD\s+기술 스파이크[\s\S]{0,80}표의 첫 셀/,
        ],
        [
          "병합 뒤 remote 삭제",
          /재조회가 성공한 뒤에만 exact remote[\s\S]{0,200}(?:읽는다|삭제)/,
        ],
        [
          "complete 전 local 보존",
          /`complete` 성공[\s\S]{0,160}전에는 worktree나 local branch를 삭제하지 않는다/,
        ],
        [
          "exact local OID 조회",
          /git -C <issue-worktree> rev-parse HEAD[\s\S]{0,240}git -C <main-worktree> rev-parse refs\/heads\/<validated-branch>[\s\S]{0,160}<validated-head>/,
        ],
        [
          "local cleanup explicit repository",
          /finalize-local-cleanup\.mjs[\s\S]{0,360}--repo <validated-repository>[\s\S]{0,360}repository를 포함한 같은 일곱 identity/,
        ],
        [
          "local cleanup canonical origin identity",
          /각각 정확히 하나인[\s\S]{0,120}credential 없는 canonical GitHub URL[\s\S]{0,260}raw[\s\S]{0,8}URL은 출력하거나 plan·identity에 저장하지 않고[\s\S]{0,160}fingerprint[\s\S]{0,160}plan[\s\S]{0,8}token과 runtime canary에만/,
        ],
        [
          "local cleanup stable archive namespace",
          /archive key는[\s\S]{0,240}stable local locator[\s\S]{0,220}explicit repository만[\s\S]{0,180}durable core[\s\S]{0,220}repository 변경[\s\S]{0,180}core identity[\s\S]{0,240}같은 repository[\s\S]{0,180}URL 변경[\s\S]{0,220}새 dry-run[\s\S]{0,180}복구/,
        ],
        [
          "CAS local 삭제",
          /git -C <main-worktree> update-ref -d[\s\\]*refs\/heads\/<validated-branch> <validated-head>/,
        ],
        [
          "metadata-only worktree quarantine",
          /worktree root 전체[\s\S]{0,800}metadata directory 전체[\s\S]{0,400}atomic\s+no-replace[\s\S]{0,3000}`git worktree remove`[\s\S]{0,120}호출하지 않는다/,
        ],
        [
          "OMC sealed new-inode snapshot",
          /원본을 rename·삭제하지 않고[\s\S]{0,180}helper-owned 새 inode[\s\S]{0,100}sealed snapshot/,
        ],
        [
          "OMC sealed snapshot은 fallback 아님",
          /copy\s+fallback이 아니라[\s\S]{0,180}원본을 그대로 보존하는 primary snapshot/,
        ],
        [
          "OMC generation proof chain",
          /`generation\.json`[\s\S]{0,180}`intentDigest`[\s\S]{0,180}`payloadProof`[\s\S]{0,300}historic generation 전체/,
        ],
        [
          "OMC scratch ownership",
          /`snapshot-scratch\/`[\s\S]{0,180}root device\/inode[\s\S]{0,180}`snapshot-attempt\.json`[\s\S]{0,280}empty inert residue[\s\S]{0,180}payload 채택[\s\S]{0,80}하지 않는다/,
        ],
        [
          "OMC partial snapshot forward recovery",
          /helper-owned bound scratch[\s\S]{0,260}`snapshot-failed\.json`[\s\S]{0,260}`pending\.omc`,[\s\S]{0,80}`current\.omc`[\s\S]{0,260}nonempty[\s\S]{0,120}`partial` orphan receipt[\s\S]{0,420}다음 preserved[\s\S]{0,8}generation/,
        ],
        [
          "OMC failed-empty snapshot forward recovery",
          /첫 entry 전 실패한 exact owned empty root[\s\S]{0,160}`failed-empty` orphan receipt[\s\S]{0,220}attempt·root·failed proof[\s\S]{0,240}source가 있으면[\s\S]{0,120}preserved generation[\s\S]{0,180}사라졌으면[\s\S]{0,120}empty generation/,
        ],
        [
          "OMC absent-source exact candidate recovery",
          /receipt-less preserved intent[\s\S]{0,160}source가 사라져도[\s\S]{0,220}nonempty 실패 candidate[\s\S]{0,100}`partial` orphan[\s\S]{0,180}`failed-empty` orphan[\s\S]{0,220}complete candidate[\s\S]{0,140}preserved generation[\s\S]{0,220}truthful empty generation[\s\S]{0,420}source와 helper-owned candidate가 모두 없을 때만[\s\S]{0,100}fail-closed/,
        ],
        [
          "OMC mutable root와 drift 중단",
          /snapshot 뒤 원본[\s\S]{0,320}mutable quarantined root[\s\S]{0,260}receipt proof에서 drift[\s\S]{0,180}local ref CAS/,
        ],
        [
          "quarantine transition global canary",
          /quarantine transition canary[\s\S]{0,420}main worktree root·branch·HEAD·main·origin\/main ref·clean 상태·common dir·[\s\S]{0,120}registration/,
        ],
        [
          "quarantine Git plumbing byte proof",
          /root `\.git` marker[\s\S]{0,100}metadata의 `commondir`·`gitdir`·`HEAD`[\s\S]{0,140}device·inode·mode·size·byte digest[\s\S]{0,160}해석·재작성하지 않는다/,
        ],
        [
          "bounded pre-rename and post-move residue canary",
          /origin canary[\s\S]{0,220}마지막 bounded[\s\S]{0,80}pre-rename operation[\s\S]{0,320}`GIT_DIR`·`GIT_COMMON_DIR`[\s\S]{0,180}`GIT_WORK_TREE`[\s\S]{0,120}`GIT_INDEX_FILE`[\s\S]{0,300}ls-files --others --directory -z[\s\S]{0,360}root·metadata·receipt hook 뒤[\s\S]{0,120}local ref CAS 직전[\s\S]{0,700}사용자가 residue를 제거하거나 다른 곳으로[\s\S]{0,8}옮긴 뒤에만/,
        ],
        [
          "external writer no-freeze boundary",
          /외부 writer를 동결하는 filesystem lease[\s\S]{0,160}linearizable freeze를 보장하지 않는다[\s\S]{0,220}다음 post-move canary[\s\S]{0,120}fail-closed[\s\S]{0,160}`\.omc` 내부의 mutable write는 허용/,
        ],
        [
          "origin all durable-boundary canary",
          /repository와 canonical origin fetch·push fingerprint canary[\s\S]{0,180}identity와 published-pending cleanup[\s\S]{0,180}generation intent·container[\s\S]{0,180}snapshot[\s\S]{0,8}attempt[\s\S]{0,180}copy 시작·종료[\s\S]{0,180}scratch→pending[\s\S]{0,180}outcome[\s\S]{0,180}pending→current[\s\S]{0,180}generation[\s\S]{0,8}receipt[\s\S]{0,240}quarantine intent·root·metadata·receipt[\s\S]{0,180}local ref CAS[\s\S]{0,160}모든 durable boundary/,
        ],
        [
          "pre-CAS fresh full plan",
          /`beforeRefDelete` hook 뒤[\s\S]{0,140}fresh full plan과 plan token[\s\S]{0,300}확인한 뒤에만 CAS/,
        ],
        [
          "ignored worktree preflight",
          /status --porcelain=v1[\s\S]{0,180}--untracked-files=all[\s\S]{0,120}--ignored=matching[\s\S]{0,120}--ignore-submodules=none[\s\S]{0,220}ls-files --others --ignored/,
        ],
        ["dirty 변경 중단", /dirty·staged·untracked 사용자 변경/],
        ["불명확 응답 무재시도", /불명확한 응답[\s\S]{0,160}다시 실행하지 않는다/],
      ],
    },
    {
      file: ".github/workflows/validate-harness.yml",
      terms: [
        [
          "CI 경로 classifier 구문 검사",
          /node --check \.github\/workflows\/validate-harness-paths\.mjs/,
        ],
        [
          "CI 경로 classifier 테스트 구문 검사",
          /node --check \.github\/workflows\/validate-harness-paths\.test\.mjs/,
        ],
        [
          "CI 경로 classifier 회귀 테스트",
          /node --test \.github\/workflows\/validate-harness-paths\.test\.mjs/,
        ],
        [
          "CI base/head 경로 분류 실행",
          /node \.github\/workflows\/validate-harness-paths\.mjs\s+\\?\s*--event[\s\S]{0,240}--base[\s\S]{0,240}--head[\s\S]{0,240}--output/,
        ],
        [
          "CI schedule 전체 회귀 trigger",
          /\bschedule\s*:/,
        ],
        [
          "CI workflow_dispatch 전체 회귀 trigger",
          /\bworkflow_dispatch\s*:/,
        ],
        [
          "CI classifier full 선택 출력",
          /classify\s*:[\s\S]{0,240}outputs\s*:[\s\S]{0,240}full:\s*\$\{\{\s*steps\.paths\.outputs\.full\s*\}\}/,
        ],
        [
          "CI product docs 조건부 회귀군",
          /product-docs-regression\s*:[\s\S]{0,420}if:\s*\$\{\{\s*needs\.classify\.outputs\.product_docs\s*==\s*['"]true['"]\s*\}\}/,
        ],
        [
          "CI work item 조건부 회귀군",
          /work-item-regression\s*:[\s\S]{0,420}if:\s*\$\{\{\s*needs\.classify\.outputs\.work_item\s*==\s*['"]true['"]\s*\}\}/,
        ],
        [
          "CI commit PR 조건부 회귀군",
          /commit-pr-regression\s*:[\s\S]{0,420}if:\s*\$\{\{\s*needs\.classify\.outputs\.commit_pr\s*==\s*['"]true['"]\s*\}\}/,
        ],
        [
          "CI finalize 조건부 회귀군",
          /finalize-regression\s*:[\s\S]{0,420}if:\s*\$\{\{\s*needs\.classify\.outputs\.finalize\s*==\s*['"]true['"]\s*\}\}/,
        ],
        [
          "CI 선택 결과 aggregate",
          /node \.github\/workflows\/validate-harness-paths\.mjs\s+\\?\s*--verify-results/,
        ],
        [
          "CI product contract ID 구문 검사",
          /node --check \.agents\/skills\/update-product-docs\/scripts\/product-contract-ids\.mjs/,
        ],
        [
          "CI product contract ID 테스트 구문 검사",
          /node --check \.agents\/skills\/update-product-docs\/scripts\/product-contract-ids\.test\.mjs/,
        ],
        [
          "CI product contract ID 회귀 테스트",
          /node --test \.agents\/skills\/update-product-docs\/scripts\/product-contract-ids\.test\.mjs/,
        ],
        [
          "CI commit path 구문 검사",
          /node --check \.agents\/skills\/commit-work-item\/scripts\/validate-commit-paths\.mjs/,
        ],
        [
          "CI commit path 회귀 테스트",
          /node --test \.agents\/skills\/commit-work-item\/scripts\/validate-commit-paths\.test\.mjs/,
        ],
        [
          "CI commit path index gate",
          /node \.agents\/skills\/commit-work-item\/scripts\/validate-commit-paths\.mjs\s+\\?\s*--index/,
        ],
        [
          "CI finalize 구문 검사",
          /node --check \.agents\/skills\/open-pull-request\/scripts\/validate-finalize\.mjs/,
        ],
        [
          "CI finalize 회귀 테스트",
          /node --test \.agents\/skills\/open-pull-request\/scripts\/validate-finalize\.test\.mjs/,
        ],
        [
          "CI merge helper 구문 검사",
          /node --check \.agents\/skills\/open-pull-request\/scripts\/finalize-merge\.mjs/,
        ],
        [
          "CI merge helper 회귀 테스트",
          /node --test \.agents\/skills\/open-pull-request\/scripts\/finalize-merge\.test\.mjs/,
        ],
      ],
    },
  ];

  for (const { file, section, terms } of contracts) {
    if (!isFile(file)) continue;
    const source = fs
      .readFileSync(path.join(root, file), "utf8")
      .replaceAll("\r\n", "\n");
    let content = maskHtmlComments(source);
    if (section) {
      const matchingSections = readStrictH2Sections(
        source,
        maskInvisibleMarkdown(source),
      ).filter((candidate) => candidate.heading === section);
      content =
        matchingSections.length === 1
          ? visibleInlineLinkLabels(
              maskReferenceDefinitions(
                maskIndentedCodeLines(
                  maskInvisibleMarkdown(
                    matchingSections[0].content,
                  ),
                ),
              ),
            )
          : "";
    }
    for (const [label, pattern] of terms) {
      if (!pattern.test(content)) {
        errors.push(`${file}: 하네스 수명주기 계약이 없습니다: ${label}`);
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

function readTraceTableRows(
  section,
  {
    file,
    label,
    headers,
    visibleContracts = false,
  },
) {
  const projectedSection = visibleContracts
    ? maskIndentedCodeLines(visibleFinalSnapshotMarkdown(section))
    : maskInvisibleMarkdown(section);
  const lines = projectedSection.split("\n");
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
validateHarnessOrchestration(developmentFiles[0]);
validateFinalSnapshotGateOrder(developmentFiles[0]);
validateHarnessRoutingBoundaries();
validatePlannedIdRoutingBoundaries();
validatePlannedIdDetailOwnerBoundary();
validateHarnessSkillContracts();
validateFinalSnapshotOwnerContracts();

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
  const visibleContent = visibleContractMarkdown(content);
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
    /^\|\s*(PRD-\d{2,}-(SP)-\d{2,})\s+[^|\s][^|]*\|/gm,
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
  const visibleContent = visibleContractMarkdown(content);
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

try {
  const sharedDefinitionIds = definedProductContractIds(root);
  const canonicalDefinitionIds = new Set([
    ...requirementIds.keys(),
    ...policyRuleIds.keys(),
  ]);
  for (const id of [...canonicalDefinitionIds].sort()) {
    if (!sharedDefinitionIds.has(id)) {
      errors.push(
        `제품 계약 ID parser 불일치: 정본 validator만 정의로 인식한 ID ${id}`,
      );
    }
  }
  for (const id of [...sharedDefinitionIds].sort()) {
    if (!canonicalDefinitionIds.has(id)) {
      errors.push(
        `제품 계약 ID parser 불일치: Ready PR validator만 정의로 인식한 ID ${id}`,
      );
    }
  }
} catch (error) {
  errors.push(`제품 계약 ID parser를 실행할 수 없습니다: ${error.message}`);
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
