#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SECTIONS = [
  { heading: "연결된 이슈", marker: "issues" },
  { heading: "변경 요약", marker: "summary" },
  { heading: "추적성", marker: "traceability" },
  { heading: "검증", marker: "verification" },
  { heading: "문서 영향", marker: "docs-impact" },
];

const TITLE_PATTERN =
  /^(feat|fix|refactor|test|docs|chore|spike): (LT-[0-9]{3}|#[1-9][0-9]*) - \S(?:.*\S)?$/;
const BRANCH_PATTERN = /^work\/issue-([1-9][0-9]*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_PATH_PATTERN =
  /(?:^|[^A-Za-z0-9/])\/(?:Users|home|root|tmp|private|var\/folders)(?=\/|$|[^A-Za-z0-9._-])/;
const LOCAL_FILE_URI_PATTERN =
  /\bfile:\/\/\/(?:Users|home|root|tmp|private|var\/folders)(?=\/|$|[^A-Za-z0-9._-])/i;

function occurrences(text, pattern) {
  return [...text.matchAll(pattern)];
}

function sectionContent(body, marker) {
  const start = `<!-- pr:${marker}:start -->`;
  const end = `<!-- pr:${marker}:end -->`;
  const startIndex = body.indexOf(start);
  const endIndex = body.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return "";
  }
  return body.slice(startIndex + start.length, endIndex).trim();
}

function scanFencedBlocks(text) {
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

  if (open) {
    ranges.push({ start: open.start, end: text.length });
  }
  return { ranges, unmatched: Boolean(open) };
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

function visibleMarkdown(text) {
  const { ranges } = scanFencedBlocks(text);
  return maskRanges(text, ranges).replace(/<!--[\s\S]*?-->/g, "");
}

function maskInvisibleMarkdown(text) {
  const { ranges } = scanFencedBlocks(text);
  return maskRanges(text, ranges).replace(
    /<!--[\s\S]*?-->/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
}

function fencedRanges(text) {
  return scanFencedBlocks(text).ranges;
}

function isInsideRange(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function hasPlaceholder(text) {
  if (/\b(?:TODO|TBD|TBC)\b/i.test(text)) return true;

  for (const match of text.matchAll(/<([^>\n]+)>/g)) {
    const token = match[1].trim();
    if (/^https?:\/\//i.test(token)) continue;
    if (/^mailto:/i.test(token)) continue;
    if (/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(token)) continue;
    if (/^\/?(?:details|summary|br|sub|sup|kbd|code|em|strong)(?:\s|$)/i.test(token)) {
      continue;
    }
    return true;
  }
  return false;
}

function validateStructure(body) {
  const errors = [];
  const fenceScan = scanFencedBlocks(body);
  const fences = fenceScan.ranges;

  if (fenceScan.unmatched) {
    errors.push("닫히지 않은 Markdown code fence가 있습니다.");
  }

  const schemaToken = "<!-- lunchtime-pr:v1 -->";
  const escapedSchemaToken = schemaToken.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const rawSchemaMarkers = occurrences(
    body,
    new RegExp(escapedSchemaToken, "g"),
  );
  const schemaMarkers = occurrences(
    body,
    new RegExp(`^${escapedSchemaToken}$`, "gm"),
  );
  if (
    rawSchemaMarkers.length !== 1 ||
    schemaMarkers.length !== 1 ||
    rawSchemaMarkers[0]?.index !== schemaMarkers[0]?.index ||
    isInsideRange(schemaMarkers[0]?.index ?? -1, fences)
  ) {
    errors.push("`<!-- lunchtime-pr:v1 -->` marker가 정확히 하나 필요합니다.");
  }

  const visibleBody = maskInvisibleMarkdown(body);
  const headingMatches = occurrences(visibleBody, /^## (.+)$/gm);
  const headings = headingMatches.map((match) => match[1].trim());
  const expected = SECTIONS.map((section) => section.heading);
  if (
    headings.length !== expected.length ||
    headings.some((heading, index) => heading !== expected[index])
  ) {
    errors.push(`H2는 다음 다섯 개를 순서대로 사용해야 합니다: ${expected.join(", ")}`);
  }

  for (const { marker } of SECTIONS) {
    for (const edge of ["start", "end"]) {
      const token = `<!-- pr:${marker}:${edge} -->`;
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rawMatches = occurrences(body, new RegExp(escaped, "g"));
      const matches = occurrences(body, new RegExp(`^${escaped}$`, "gm"));
      if (
        rawMatches.length !== 1 ||
        matches.length !== 1 ||
        rawMatches[0]?.index !== matches[0]?.index ||
        isInsideRange(matches[0]?.index ?? -1, fences)
      ) {
        errors.push(
          `\`${token}\` marker가 fence 밖의 독립된 줄에 정확히 하나 필요합니다.`,
        );
      }
    }
    if (!sectionContent(body, marker)) {
      errors.push(`\`${marker}\` section 내용이 비어 있습니다.`);
    }
  }

  for (const [index, { marker }] of SECTIONS.entries()) {
    const headingIndex = headingMatches[index]?.index ?? -1;
    const startIndex = body.indexOf(`<!-- pr:${marker}:start -->`);
    const endIndex = body.indexOf(`<!-- pr:${marker}:end -->`);
    const nextHeadingIndex =
      headingMatches[index + 1]?.index ?? body.length;
    if (
      headingIndex < 0 ||
      startIndex <= headingIndex ||
      endIndex <= startIndex ||
      endIndex >= nextHeadingIndex
    ) {
      errors.push(
        `\`${marker}\` marker는 해당 H2와 다음 H2 사이에서 start → end 순서를 지켜야 합니다.`,
      );
    }
  }

  const prose = visibleMarkdown(body);
  if (
    /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[[ xX]\]/m.test(prose)
  ) {
    errors.push("PR 본문에는 자기 선언 checkbox를 사용하지 않습니다.");
  }

  return errors;
}

function validateNotApplicable(text, errors) {
  for (const line of visibleMarkdown(text).split("\n")) {
    if (
      /(?:^|[:|]\s*)(?:해당 없음|없음|N\/A|미적용)\s*(?:\||$)/i.test(line) &&
      !/(?:해당 없음|없음|N\/A|미적용)\s+[—-]\s+\S+/i.test(line)
    ) {
      errors.push("적용되지 않는 항목은 `해당 없음 — <구체적인 근거>`로 작성해야 합니다.");
      return;
    }
  }
}

function parseIssue(body, { template = false } = {}) {
  const visible = visibleMarkdown(body);
  const closes = occurrences(
    visible,
    template
      ? /^Closes #(?:<issue-number>|[1-9][0-9]*)\s*$/gm
      : /^Closes #([1-9][0-9]*)\s*$/gm,
  );
  const references = occurrences(
    visible,
    template
      ? /Closes\s+#(?:<issue-number>|[1-9][0-9]*)/gi
      : /\bCloses\s+#[1-9][0-9]*\b/gi,
  );
  return {
    matches: closes,
    references,
    issueNumber: closes.length === 1 ? Number(closes[0][1]) : undefined,
  };
}

function parseEndIssue(body) {
  const matches = occurrences(
    visibleMarkdown(sectionContent(body, "issues")),
    /^- 종료:\s*#([1-9][0-9]*)\s*$/gm,
  );
  return {
    matches,
    issueNumber: matches.length === 1 ? Number(matches[0][1]) : undefined,
  };
}

function parseWorkKey(body) {
  const issues = visibleMarkdown(sectionContent(body, "issues"));
  const match = issues.match(/^- 작업 키:\s*`?([^`\n]+)`?\s*$/m);
  return match?.[1]?.trim();
}

function validateIssues(content, errors, { template = false } = {}) {
  const visible = visibleMarkdown(content);
  const endFields = occurrences(
    visible,
    template
      ? /^- 종료:\s*#(?:<issue-number>|[1-9][0-9]*)\s*$/gm
      : /^- 종료:\s*#([1-9][0-9]*)\s*$/gm,
  );
  if (endFields.length !== 1) {
    errors.push("연결된 이슈에 `- 종료: #N` 메타데이터가 정확히 하나 필요합니다.");
  }

  const parsedIssue = parseIssue(content, { template });
  if (
    parsedIssue.matches.length !== 1 ||
    parsedIssue.references.length !== 1
  ) {
    errors.push(
      "연결된 이슈에 접두어 없는 독립된 줄 `Closes #N`이 정확히 하나 필요합니다.",
    );
  }
  if (
    !template &&
    endFields.length === 1 &&
    parsedIssue.issueNumber &&
    Number(endFields[0][1]) !== parsedIssue.issueNumber
  ) {
    errors.push("종료 메타데이터와 `Closes` 이슈 번호가 일치하지 않습니다.");
  }
  if (occurrences(visible, /^- 작업 키:\s*\S+/gm).length !== 1) {
    errors.push("연결된 이슈에 `작업 키` 필드가 정확히 하나 필요합니다.");
  }
}

function validateSummary(content, errors) {
  content = visibleMarkdown(content);
  for (const field of [
    "문제·목표",
    "결정·트레이드오프",
    "위험·복구",
    "리뷰 시작점",
    "제외·후속 작업",
  ]) {
    if (occurrences(content, new RegExp(`^- ${field}:\\s*\\S+`, "gm")).length !== 1) {
      errors.push(`변경 요약에 \`${field}\` 필드가 정확히 하나 필요합니다.`);
    }
  }

  const resultLabels = occurrences(content, /^- 결과:\s*$/gm);
  const resultBlock = content.match(
    /^- 결과:\s*\n((?:\s{2,}-\s+\S.*(?:\n|$))+)/m,
  );
  if (resultLabels.length !== 1 || !resultBlock) {
    errors.push("변경 요약의 `결과` 필드 하나에 실제 결과 bullet이 필요합니다.");
    return;
  }
  const count = occurrences(resultBlock[1], /^\s{2,}-\s+\S/gm).length;
  if (count > 5) {
    errors.push("변경 요약의 실제 결과는 1~5개로 제한합니다.");
  }
}

function validateTitle(title, { issueNumber, workKey } = {}) {
  const errors = [];
  const match = String(title ?? "").match(TITLE_PATTERN);
  if (!match) {
    errors.push(
      "PR 제목은 `<type>: LT-NNN - <결과>` 또는 `<type>: #<이슈 번호> - <결과>` 형식이어야 합니다.",
    );
    return errors;
  }
  if ([...title].length > 72) {
    errors.push("PR 제목은 72자 이하여야 합니다.");
  }

  const titleKey = match[2];
  if (titleKey.startsWith("#") && issueNumber && Number(titleKey.slice(1)) !== issueNumber) {
    errors.push("PR 제목의 이슈 번호가 `Closes` 이슈와 일치하지 않습니다.");
  }
  if (workKey && titleKey !== workKey) {
    errors.push("PR 제목의 작업 키가 본문의 작업 키와 일치하지 않습니다.");
  }
  return errors;
}

function validateTraceability(content, errors, { template }) {
  content = visibleMarkdown(content);
  for (const label of ["요구사항", "수용 기준", "정책 규칙", "기술 스파이크"]) {
    if (
      occurrences(
        content,
        new RegExp(`^\\|\\s*${label}\\s*\\|`, "gm"),
      ).length !== 1
    ) {
      errors.push(`추적성 표에 \`${label}\` 행이 정확히 하나 필요합니다.`);
    }
  }

  if (template) return;

  const rowRules = [
    ["요구사항", /\bPRD-[0-9]{2}-FR-[0-9]{2}\b/],
    ["수용 기준", /\bPRD-[0-9]{2}-AC-[0-9]{2}\b/],
    ["정책 규칙", /\bPOL-[0-9]{2}-R-[0-9]{2}\b/],
    ["기술 스파이크", /\bPRD-[0-9]{2}-SP-[0-9]{2}\b/],
  ];
  for (const [label, idPattern] of rowRules) {
    const row = content
      .split("\n")
      .find((line) => new RegExp(`^\\|\\s*${label}\\s*\\|`).test(line));
    if (
      row &&
      !idPattern.test(row) &&
      !/해당 없음\s+[—-]\s+\S+/.test(row)
    ) {
      errors.push(`추적성의 \`${label}\`에는 완전한 ID 또는 적용되지 않는 근거가 필요합니다.`);
    }
  }
}

function splitMarkdownRow(line) {
  const cells = [];
  let cell = "";
  let inCode = false;

  for (let index = 1; index < line.length - 1; index += 1) {
    const character = line[index];
    const escaped = line[index - 1] === "\\";
    if (character === "`" && !escaped) {
      inCode = !inCode;
      cell += character;
      continue;
    }
    if (character === "|" && !escaped && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function validateVerification(content, errors, { template, draft }) {
  content = visibleMarkdown(content);
  const lines = content.split("\n").map((line) => line.trim());
  const headerPattern =
    /^\|\s*대상\s*\|\s*명령·확인\s*\|\s*결과\s*\|\s*증거\s*\|$/;
  const headerIndexes = lines
    .map((line, index) => (headerPattern.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (headerIndexes.length !== 1) {
    errors.push("검증 표는 `대상 | 명령·확인 | 결과 | 증거` header를 정확히 하나 사용해야 합니다.");
  }
  const headerIndex = headerIndexes[0] ?? -1;
  const separatorCells =
    headerIndex >= 0 && lines[headerIndex + 1]
      ? splitMarkdownRow(lines[headerIndex + 1])
      : [];
  const invalidSeparator =
    separatorCells.length !== 4 ||
    !separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell));
  if (invalidSeparator) {
    errors.push("검증 표 header 바로 아래에 네 열의 Markdown 구분선이 필요합니다.");
  }

  const rows = [];
  if (headerIndex >= 0 && !invalidSeparator) {
    for (let index = headerIndex + 2; index < lines.length; index += 1) {
      if (!/^\|.*\|$/.test(lines[index])) break;
      rows.push(splitMarkdownRow(lines[index]));
    }
  }
  const independentReviewRows = rows.filter(
    (row) => row[0] === "독립 리뷰",
  );
  if (independentReviewRows.length !== 1) {
    errors.push(
      `검증 표에는 대상 cell이 정확히 \`독립 리뷰\`인 행이 하나 필요합니다. (현재 ${independentReviewRows.length}개)`,
    );
  }
  if (
    independentReviewRows.length === 1 &&
    independentReviewRows[0].length !== 4
  ) {
    errors.push("검증 표의 `독립 리뷰` 행은 네 열이어야 합니다.");
  }
  if (template) return;

  if (rows.length === 0) {
    errors.push("검증 표에 실제 결과 행이 하나 이상 필요합니다.");
    return;
  }
  for (const row of rows) {
    if (row.length !== 4) {
      errors.push("검증 표의 각 행은 네 열이어야 합니다.");
      continue;
    }
    const result = row[2].replace(/`/g, "");
    if (!["통과", "실패", "미실행"].includes(result)) {
      errors.push("검증 결과는 `통과`, `실패`, `미실행` 중 하나여야 합니다.");
    }
    if (!draft && result !== "통과") {
      if (row[0] === "독립 리뷰") {
        errors.push("Ready PR의 `독립 리뷰` 결과는 `통과`여야 합니다.");
      } else {
        errors.push("Ready PR에는 실패 또는 미실행 검증을 남길 수 없습니다.");
      }
    }
    if (row.some((cell) => !cell)) {
      errors.push("검증 표의 대상, 명령·확인, 결과와 증거를 모두 작성해야 합니다.");
    }
  }

  const independentReview = independentReviewRows[0];
  if (
    !draft &&
    independentReview?.length === 4 &&
    (!independentReview[3] || hasPlaceholder(independentReview[3]))
  ) {
    errors.push(
      "Ready PR의 `독립 리뷰`에는 placeholder가 아닌 증거가 필요합니다.",
    );
  }
}

function validateDocsImpact(content, errors, { template, draft }) {
  content = visibleMarkdown(content);
  for (const field of ["판정", "대상 파일·ID", "근거"]) {
    if (occurrences(content, new RegExp(`^- ${field}:\\s*\\S+`, "gm")).length !== 1) {
      errors.push(`문서 영향에 \`${field}\` 필드가 정확히 하나 필요합니다.`);
    }
  }
  if (template) return;

  const decision = content.match(/^- 판정:\s*(.+)$/m)?.[1]?.trim();
  if (!["변경", "변경 없음", "결정 필요"].includes(decision)) {
    errors.push("문서 영향 판정은 `변경`, `변경 없음`, `결정 필요` 중 하나여야 합니다.");
  }
  if (!draft && decision === "결정 필요") {
    errors.push("Ready PR에는 문서 영향의 `결정 필요`를 남길 수 없습니다.");
  }
}

export function validateTemplate(body) {
  const errors = validateStructure(body);
  validateIssues(sectionContent(body, "issues"), errors, { template: true });
  validateSummary(sectionContent(body, "summary"), errors);
  const traceability = sectionContent(body, "traceability");
  validateTraceability(traceability, errors, { template: true });
  validateVerification(sectionContent(body, "verification"), errors, {
    template: true,
  });
  validateDocsImpact(sectionContent(body, "docs-impact"), errors, {
    template: true,
  });
  return errors;
}

export function validatePullRequest({
  body,
  title,
  draft = false,
  issueNumber,
  branch,
  base = "main",
}) {
  const errors = validateStructure(body);
  const parsedIssue = parseIssue(body);

  if (
    parsedIssue.matches.length !== 1 ||
    parsedIssue.references.length !== 1
  ) {
    errors.push(
      "본문 전체에 접두어 없는 독립된 줄 `Closes #<이슈 번호>`가 정확히 하나 필요합니다.",
    );
  }
  const actualIssue = parsedIssue.issueNumber;
  if (issueNumber && actualIssue !== Number(issueNumber)) {
    errors.push("`Closes` 이슈 번호가 예상 이슈와 일치하지 않습니다.");
  }
  const endIssue = parseEndIssue(body);
  if (
    endIssue.issueNumber &&
    actualIssue &&
    endIssue.issueNumber !== actualIssue
  ) {
    errors.push("종료 메타데이터의 이슈 번호가 `Closes` 이슈와 일치하지 않습니다.");
  }

  const workKey = parseWorkKey(body);
  if (!workKey || !/^(?:LT-[0-9]{3}|#[1-9][0-9]*)$/.test(workKey)) {
    errors.push("작업 키는 실제 `LT-NNN` 또는 `#<이슈 번호>`여야 합니다.");
  }
  if (workKey?.startsWith("#") && actualIssue && Number(workKey.slice(1)) !== actualIssue) {
    errors.push("본문 작업 키의 이슈 번호가 `Closes` 이슈와 일치하지 않습니다.");
  }

  errors.push(...validateTitle(title, { issueNumber: actualIssue, workKey }));
  validateIssues(sectionContent(body, "issues"), errors);
  validateSummary(sectionContent(body, "summary"), errors);

  if (base !== "main") {
    errors.push("PR base는 `main`이어야 합니다.");
  }
  if (!branch) {
    errors.push("PR head 브랜치가 필요합니다.");
  } else {
    const match = branch.match(BRANCH_PATTERN);
    if (!match) {
      errors.push("PR head가 Trunk-Based Development 브랜치 계약과 맞지 않습니다.");
    } else if (branch.length > 120) {
      errors.push("PR head 브랜치명은 120자 이하여야 합니다.");
    } else if (actualIssue && Number(match[1]) !== actualIssue) {
      errors.push("PR head의 이슈 번호가 `Closes` 이슈와 일치하지 않습니다.");
    }
  }

  validateTraceability(sectionContent(body, "traceability"), errors, {
    template: false,
  });
  validateVerification(sectionContent(body, "verification"), errors, {
    template: false,
    draft,
  });
  validateDocsImpact(sectionContent(body, "docs-impact"), errors, {
    template: false,
    draft,
  });
  validateNotApplicable(body, errors);

  const visibleBody = visibleMarkdown(body);
  if (!draft && hasPlaceholder(visibleBody)) {
    errors.push("Ready PR에는 placeholder, TODO, TBD 또는 TBC를 남길 수 없습니다.");
  }
  if (LOCAL_PATH_PATTERN.test(body) || LOCAL_FILE_URI_PATTERN.test(body)) {
    errors.push("PR 본문에 로컬 절대 경로를 넣을 수 없습니다.");
  }

  return [...new Set(errors)];
}

function parseArguments(argv) {
  const parsed = { draft: false };
  const valueOptions = new Set([
    "--template",
    "--body",
    "--title",
    "--issue",
    "--branch",
    "--event",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--draft") {
      parsed.draft = true;
      continue;
    }
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} 값이 필요합니다.`);
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }

  const modes = [parsed.template, parsed.body, parsed.event].filter(Boolean);
  if (modes.length !== 1) {
    throw new Error("`--template`, `--body`, `--event` 중 하나만 지정해야 합니다.");
  }
  if (parsed.body && (!parsed.title || !parsed.issue || !parsed.branch)) {
    throw new Error("`--body` 모드에는 `--title`, `--issue`, `--branch`가 필요합니다.");
  }
  return parsed;
}

async function readText(path) {
  if (path === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path, "utf8");
}

export function pullRequestFromEvent(event) {
  const pullRequest = event?.pull_request;
  if (!pullRequest) {
    throw new Error("GitHub event에 `pull_request`가 없습니다.");
  }
  return {
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? "",
    draft: Boolean(pullRequest.draft),
    branch: pullRequest.head?.ref ?? "",
    base: pullRequest.base?.ref ?? "",
  };
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  try {
    let errors;
    if (args.template) {
      errors = validateTemplate(await readText(args.template));
    } else if (args.event) {
      const event = JSON.parse(await readText(args.event));
      errors = validatePullRequest(pullRequestFromEvent(event));
    } else {
      errors = validatePullRequest({
        body: await readText(args.body),
        title: args.title,
        draft: args.draft,
        issueNumber: args.issue,
        branch: args.branch,
      });
    }

    if (errors.length > 0) {
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("PR 계약을 충족합니다.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
