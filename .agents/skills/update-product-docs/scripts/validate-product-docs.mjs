#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  definedProductContractIds,
  referencedContractIds,
  visibleContractMarkdown,
} from "./product-contract-ids.mjs";

const DEVELOPMENT_FILES = [
  "docs/development/01_harness_guide.md",
  "docs/development/02_testing_standard.md",
  "docs/development/03_validation_ci_flow.md",
];
const SKILL_DIRECTORIES = [
  ".agents/skills/update-product-docs",
  ".agents/skills/run-github-work-item",
  ".agents/skills/commit-work-item",
  ".agents/skills/open-pull-request",
];
const WORKFLOW_FILES = {
  harness: ".github/workflows/validate-harness.yml",
  app: ".github/workflows/app-ci.yml",
  metadata: ".github/workflows/validate-pr-metadata.yml",
};
function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isExcluded(relativePath, excludedPaths) {
  const normalized = normalizePath(path.normalize(relativePath));
  return excludedPaths.some(
    (excluded) =>
      normalized === excluded || normalized.startsWith(`${excluded}/`),
  );
}

function listFiles(root, relativeDirectory, excludedPaths = []) {
  if (isExcluded(relativeDirectory, excludedPaths)) return [];
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDirectory, {
    withFileTypes: true,
  })) {
    const relativePath = normalizePath(
      path.join(relativeDirectory, entry.name),
    );
    if (isExcluded(relativePath, excludedPaths)) continue;
    if (entry.isDirectory()) {
      files.push(...listFiles(root, relativePath, excludedPaths));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function isFile(root, relativePath) {
  try {
    return fs.lstatSync(path.join(root, relativePath)).isFile();
  } catch {
    return false;
  }
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function recordDefinition(definitions, id, file, errors) {
  const previous = definitions.get(id);
  if (previous) {
    errors.push(`${id} 중복 정의: ${previous}, ${file}`);
  } else {
    definitions.set(id, file);
  }
}

function readMetadata(content, file, label, errors) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*(.*?)\\s*\\|$`, "m"),
  );
  if (!match) {
    errors.push(`${file}: 메타데이터 '${label}' 누락`);
    return "";
  }
  const value = match[1].trim().replace(/^`([^`]*)`$/, "$1").trim();
  if (!value) errors.push(`${file}: 메타데이터 '${label}' 값 누락`);
  return value;
}

function validateMetadataValue(file, label, value, allowed, errors) {
  if (value && !allowed.includes(value)) {
    errors.push(
      `${file}: 메타데이터 '${label}' 값 오류: ${value} (허용: ${allowed.join(", ")})`,
    );
  }
}

function validateReviewDate(file, value, errors) {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${file}: 마지막 검토는 YYYY-MM-DD 형식이어야 합니다.`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${file}: 유효하지 않은 마지막 검토 날짜입니다: ${value}`);
  }
}

function sectionAfterHeading(content, pattern) {
  const match = pattern.exec(content);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tail = content.slice(start);
  const nextHeading = tail.search(/^#{1,3}\s+/m);
  return tail.slice(0, nextHeading < 0 ? tail.length : nextHeading);
}

function parseTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function tableRows(section, expectedHeaders, file, label, errors) {
  const lines = section.split("\n");
  const headerIndex = lines.findIndex((line) => {
    const cells = parseTableCells(line);
    return (
      cells?.length === expectedHeaders.length &&
      cells.every((cell, index) => cell === expectedHeaders[index])
    );
  });
  if (headerIndex < 0) {
    errors.push(`${file}: ${label} 표 header가 없습니다.`);
    return [];
  }
  const separator = parseTableCells(lines[headerIndex + 1] ?? "");
  if (
    !separator ||
    separator.length !== expectedHeaders.length ||
    separator.some((cell) => !/^:?-{3,}:?$/.test(cell))
  ) {
    errors.push(`${file}: ${label} 표 구분선이 올바르지 않습니다.`);
    return [];
  }
  const rows = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim()) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = parseTableCells(line);
    if (!cells) {
      if (rows.length > 0) break;
      continue;
    }
    if (cells.length !== expectedHeaders.length) {
      errors.push(`${file}: ${label} 표 열 수가 올바르지 않습니다.`);
      continue;
    }
    rows.push(cells);
  }
  if (rows.length === 0) {
    errors.push(`${file}: ${label} 표에 데이터 행이 필요합니다.`);
  }
  return rows;
}

function visibleLinkMarkdown(markdown) {
  let source = String(markdown ?? "");
  source = source.replace(/<!--[\s\S]*?(?:-->|$)/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
  const lines = source.split("\n");
  let fence = null;
  return lines
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!fence && marker) {
        fence = { character: marker[1][0], length: marker[1].length };
        return " ".repeat(line.length);
      }
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence.character &&
          marker[1].length >= fence.length &&
          line.slice(marker[0].length).trim() === ""
        ) {
          fence = null;
        }
        return " ".repeat(line.length);
      }
      return line;
    })
    .join("\n");
}

function markdownTargets(markdown) {
  const source = visibleLinkMarkdown(markdown);
  const targets = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] !== "]" || source[index + 1] !== "(") continue;
    let cursor = index + 2;
    let depth = 1;
    let quote = "";
    while (cursor < source.length && depth > 0) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }
      cursor += 1;
    }
    if (depth === 0) targets.push(source.slice(index + 2, cursor - 1));
    index = Math.max(index, cursor - 1);
  }
  for (const line of source.split("\n")) {
    const definition = line.match(
      /^ {0,3}\[[^\]\n]+]:\s*(?:<([^>\n]+)>|(\S+))/,
    );
    if (definition) targets.push(definition[1] ?? definition[2]);
  }
  return targets;
}

function normalizeLinkTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const closing = target.indexOf(">");
    target = closing < 0 ? target : target.slice(1, closing);
  } else {
    let cursor = 0;
    while (cursor < target.length && !/\s/.test(target[cursor])) {
      if (target[cursor] === "\\") cursor += 1;
      cursor += 1;
    }
    target = target.slice(0, cursor);
  }
  return target.replace(/\\([\\() ])/g, "$1");
}

function validateLocalLinks(root, file, content, errors) {
  for (const rawTarget of markdownTargets(content)) {
    const target = normalizeLinkTarget(rawTarget);
    if (
      !target ||
      target.startsWith("#") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) ||
      target.startsWith("//")
    ) {
      continue;
    }
    const pathTarget = target.split("#", 1)[0].split("?", 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(pathTarget);
    } catch {
      errors.push(`${file}: 인코딩이 잘못된 로컬 링크 -> ${target}`);
      continue;
    }
    if (path.isAbsolute(decoded)) {
      errors.push(`${file}: 저장소 상대 링크만 허용됩니다 -> ${target}`);
      continue;
    }
    const resolved = path.resolve(root, path.dirname(file), decoded);
    if (!isInsideRoot(root, resolved)) {
      errors.push(`${file}: 저장소 밖을 가리키는 링크 -> ${target}`);
    } else if (!fs.existsSync(resolved)) {
      errors.push(`${file}: 깨진 링크 -> ${target}`);
    }
  }
}

function topLevelYamlBlock(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return "";
  let end = start + 1;
  while (
    end < lines.length &&
    (!lines[end].trim() || /^\s/.test(lines[end]))
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function jobExists(source, id) {
  const jobs = topLevelYamlBlock(source, "jobs");
  return new RegExp(`^  ${id}:\\s*$`, "m").test(jobs);
}

function pullRequestTypes(source) {
  const trigger = topLevelYamlBlock(source, "on");
  const match = trigger.match(
    /^  pull_request:\s*\n(?: {4}.*\n)*? {4}types:\s*\n((?: {6}- .+\n?)+)/m,
  );
  if (!match) return [];
  return [...match[1].matchAll(/^ {6}- (.+)$/gm)].map((entry) =>
    entry[1].trim(),
  );
}

function hasExactCheckoutRefs(source, expectedRef) {
  const checkoutCount = (source.match(/uses: actions\/checkout@v6/g) ?? [])
    .length;
  const refCount = source
    .split("\n")
    .filter((line) => line.trim() === `ref: ${expectedRef}`).length;
  return checkoutCount > 0 && checkoutCount === refCount;
}

function validateCiContracts(root, errors) {
  const sources = {};
  for (const [name, file] of Object.entries(WORKFLOW_FILES)) {
    if (!isFile(root, file)) {
      errors.push(`필수 CI workflow가 없습니다: ${file}`);
      continue;
    }
    sources[name] = read(root, file).replaceAll("\r\n", "\n");
  }

  const harness = sources.harness;
  if (harness) {
    if (!jobExists(harness, "validate")) {
      errors.push(`${WORKFLOW_FILES.harness}: required job id validate 누락`);
    }
    if (
      JSON.stringify(pullRequestTypes(harness).sort()) !==
      JSON.stringify(["opened", "synchronize"])
    ) {
      errors.push(
        `${WORKFLOW_FILES.harness}: pull_request는 opened+synchronize만 사용해야 합니다.`,
      );
    }
    const trigger = topLevelYamlBlock(harness, "on");
    if (/^  (?:push|schedule):/m.test(trigger)) {
      errors.push(
        `${WORKFLOW_FILES.harness}: push·schedule 자동 재실행을 사용할 수 없습니다.`,
      );
    }
    if (
      /^  (?:classify|product-docs-regression|work-item-regression|commit-pr-regression|finalize-regression):$/m.test(
        topLevelYamlBlock(harness, "jobs"),
      )
    ) {
      errors.push(
        `${WORKFLOW_FILES.harness}: 고정 회귀군 job을 사용할 수 없습니다.`,
      );
    }
    if (!/--diff-filter=ACDMRT\b/.test(harness)) {
      errors.push(
        `${WORKFLOW_FILES.harness}: 삭제를 포함한 변경 경로 고정이 필요합니다.`,
      );
    }
    if (
      !/paired_test="\$\{changed_path%\.mjs\}\.test\.mjs"\s+if \[ -f "\$paired_test" \]; then/.test(
        harness,
      )
    ) {
      errors.push(
        `${WORKFLOW_FILES.harness}: 삭제된 source도 잔존 paired test를 먼저 실행해야 합니다.`,
      );
    }
    if (
      !/declare -A deleted_tools=\(\)/.test(harness) ||
      !/git grep -n -F -- "\$deleted_name"/.test(harness)
    ) {
      errors.push(
        `${WORKFLOW_FILES.harness}: 함께 삭제된 도구의 잔존 참조 검사가 필요합니다.`,
      );
    }
    if (
      !hasExactCheckoutRefs(
        harness,
        "${{ github.event.pull_request.head.sha || github.sha }}",
      )
    ) {
      errors.push(`${WORKFLOW_FILES.harness}: exact PR head checkout 누락`);
    }
  }

  const app = sources.app;
  if (app) {
    if (!jobExists(app, "app-test")) {
      errors.push(`${WORKFLOW_FILES.app}: required job id app-test 누락`);
    }
    if (
      JSON.stringify(pullRequestTypes(app).sort()) !==
      JSON.stringify(["opened", "synchronize"])
    ) {
      errors.push(
        `${WORKFLOW_FILES.app}: pull_request는 opened+synchronize만 사용해야 합니다.`,
      );
    }
    const trigger = topLevelYamlBlock(app, "on");
    if (/^  (?:push|schedule):/m.test(trigger)) {
      errors.push(
        `${WORKFLOW_FILES.app}: push·schedule 자동 재실행을 사용할 수 없습니다.`,
      );
    }
    if ((app.match(/^\s*xcodebuild test \\/gm) ?? []).length !== 1) {
      errors.push(`${WORKFLOW_FILES.app}: xcodebuild test는 한 번이어야 합니다.`);
    }
    if ((app.match(/^\s*xcodebuild build \\/gm) ?? []).length !== 0) {
      errors.push(`${WORKFLOW_FILES.app}: 별도 build를 중복 실행할 수 없습니다.`);
    }
    if (
      !hasExactCheckoutRefs(
        app,
        "${{ github.event.pull_request.head.sha || github.sha }}",
      )
    ) {
      errors.push(`${WORKFLOW_FILES.app}: exact PR head checkout 누락`);
    }
  }

  const metadata = sources.metadata;
  if (metadata) {
    if (!jobExists(metadata, "pr-metadata")) {
      errors.push(
        `${WORKFLOW_FILES.metadata}: required job id pr-metadata 누락`,
      );
    }
    if ((metadata.match(/^\s*gh api \\/gm) ?? []).length !== 1) {
      errors.push(`${WORKFLOW_FILES.metadata}: live PR API 조회는 한 번이어야 합니다.`);
    }
    if (
      !hasExactCheckoutRefs(
        metadata,
        "${{ github.event.pull_request.head.sha }}",
      )
    ) {
      errors.push(`${WORKFLOW_FILES.metadata}: exact PR head checkout 누락`);
    }
  }
}

function validateSymlinks(root, errors) {
  for (const [file, expected, label] of [
    ["CLAUDE.md", "AGENTS.md", "Claude 작업 협약"],
    [".claude/skills", "../.agents/skills", "Claude Skill"],
  ]) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${label} 연결이 없습니다: ${file}`);
      continue;
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isSymbolicLink() || fs.readlinkSync(absolute) !== expected) {
      errors.push(`${file}는 ${expected}를 가리키는 심볼릭 링크여야 합니다.`);
    }
  }
}

function validateSkillFiles(root, errors) {
  for (const directory of SKILL_DIRECTORIES) {
    for (const relative of ["SKILL.md", "agents/openai.yaml"]) {
      const file = `${directory}/${relative}`;
      if (!isFile(root, file)) errors.push(`필수 Skill interface가 없습니다: ${file}`);
    }
  }
}

function validatePrdDocuments(root, files, errors) {
  const prdIds = new Map();
  const definitions = new Map();
  const traceEdges = new Set();
  const approved = new Set();

  for (const file of files) {
    const content = visibleContractMarkdown(read(root, file));
    const firstLine = content.split("\n", 1)[0];
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
    recordDefinition(prdIds, prdId, file, errors);

    const decisionStatus = readMetadata(
      content,
      file,
      "의사결정 상태",
      errors,
    );
    const deliveryStatus = readMetadata(content, file, "전달 상태", errors);
    const owner = readMetadata(content, file, "책임자", errors);
    const reviewDate = readMetadata(content, file, "마지막 검토", errors);
    validateMetadataValue(
      file,
      "의사결정 상태",
      decisionStatus,
      ["draft", "approved", "superseded", "retired"],
      errors,
    );
    validateMetadataValue(
      file,
      "전달 상태",
      deliveryStatus,
      ["planned", "in-progress", "delivered"],
      errors,
    );
    if (!owner) errors.push(`${file}: 책임자를 지정해야 합니다.`);
    validateReviewDate(file, reviewDate, errors);
    if (decisionStatus === "approved") approved.add(file);

    const documentDefinitions = [];
    for (const match of content.matchAll(
      /^#{2,6}\s+(PRD-\d{2,}-(FR|AC)-\d{2,})\.\s+\S/gm,
    )) {
      documentDefinitions.push({ id: match[1], type: match[2] });
    }
    for (const match of content.matchAll(
      /^\|\s*(PRD-\d{2,}-(SP)-\d{2,})\s+[^|\s][^|]*\|/gm,
    )) {
      documentDefinitions.push({ id: match[1], type: match[2] });
    }
    for (const { id } of documentDefinitions) {
      if (!id.startsWith(`${prdId}-`)) {
        errors.push(`${file}: 다른 PRD namespace 정의 ${id}`);
      }
      recordDefinition(definitions, id, file, errors);
    }
    for (const type of ["FR", "AC"]) {
      if (!documentDefinitions.some((definition) => definition.type === type)) {
        errors.push(`${file}: ${type} 정의가 없습니다.`);
      }
    }

    if (decisionStatus !== "approved") continue;
    const traceSection = sectionAfterHeading(
      content,
      /^### 요구사항 추적 매트릭스\s*$/m,
    );
    if (traceSection === null) {
      errors.push(`${file}: 승인 PRD의 요구사항 추적 매트릭스가 없습니다.`);
    } else {
      const rows = tableRows(
        traceSection,
        ["요구사항", "수용 기준", "정책 규칙"],
        file,
        "요구사항 추적 매트릭스",
        errors,
      );
      const mappedRequirements = new Set();
      const mappedAcceptance = new Set();
      for (const [index, cells] of rows.entries()) {
        const requirements = cells[0].match(/\bPRD-\d{2,}-FR-\d{2,}\b/g) ?? [];
        const acceptance = cells[1].match(/\bPRD-\d{2,}-AC-\d{2,}\b/g) ?? [];
        const policies = cells[2].match(/\bPOL-\d{2,}-R-\d{2,}\b/g) ?? [];
        if (!requirements.length || !acceptance.length || !policies.length) {
          errors.push(
            `${file}: 요구사항 추적 매트릭스 ${index + 1}번째 행에는 FR·AC·POL이 모두 필요합니다.`,
          );
          continue;
        }
        requirements.forEach((id) => mappedRequirements.add(id));
        acceptance.forEach((id) => mappedAcceptance.add(id));
        for (const requirement of requirements) {
          for (const policy of policies) traceEdges.add(`${requirement}\0${policy}`);
        }
      }
      for (const { id, type } of documentDefinitions) {
        if (type === "FR" && !mappedRequirements.has(id)) {
          errors.push(`${file}: 추적 매트릭스의 요구사항 누락 ${id}`);
        }
        if (type === "AC" && !mappedAcceptance.has(id)) {
          errors.push(`${file}: 추적 매트릭스의 수용 기준 누락 ${id}`);
        }
      }
    }

    const successSection = sectionAfterHeading(
      content,
      /^## (?:\d+\.\s+)?성공 (?:기준|측정)\s*$/m,
    );
    if (successSection === null) {
      errors.push(`${file}: 승인 PRD의 성공 기준 섹션이 없습니다.`);
    } else {
      const rows = tableRows(
        successSection,
        ["지표", "기준선", "목표", "측정 기간", "출처", "가드레일"],
        file,
        "성공 기준",
        errors,
      );
      rows.forEach((cells, index) => {
        if (cells.some((cell) => !cell)) {
          errors.push(`${file}: 성공 기준 ${index + 1}번째 행에 빈 값이 있습니다.`);
        }
      });
    }
  }
  return { prdIds, definitions, traceEdges, approved };
}

function validatePolicyDocuments(root, files, errors) {
  const policyIds = new Map();
  const definitions = new Map();
  const traceEdges = new Set();
  const approved = new Set();

  for (const file of files) {
    const content = visibleContractMarkdown(read(root, file));
    const firstLine = content.split("\n", 1)[0];
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
    recordDefinition(policyIds, policyId, file, errors);

    const decisionStatus = readMetadata(
      content,
      file,
      "의사결정 상태",
      errors,
    );
    const owner = readMetadata(content, file, "책임자", errors);
    const reviewDate = readMetadata(content, file, "마지막 검토", errors);
    validateMetadataValue(
      file,
      "의사결정 상태",
      decisionStatus,
      ["draft", "approved", "superseded", "retired"],
      errors,
    );
    if (!owner) errors.push(`${file}: 책임자를 지정해야 합니다.`);
    validateReviewDate(file, reviewDate, errors);
    if (decisionStatus === "approved") approved.add(file);

    const rules = [
      ...content.matchAll(/^#{2,6}\s+(POL-\d{2,}-R-\d{2,})\.\s+\S/gm),
    ].map((match) => match[1]);
    if (rules.length === 0) errors.push(`${file}: 정책 규칙 정의가 없습니다.`);
    for (const id of rules) {
      if (!id.startsWith(`${policyId}-R-`)) {
        errors.push(`${file}: 다른 Policy namespace 정의 ${id}`);
      }
      recordDefinition(definitions, id, file, errors);
    }

    if (decisionStatus !== "approved") continue;
    const traceSection = sectionAfterHeading(
      content,
      /^## (?:\d+\.\s+)?추적성\s*$/m,
    );
    if (traceSection === null) {
      errors.push(`${file}: 승인 정책의 추적성 섹션이 없습니다.`);
      continue;
    }
    const policyRuleHeader = /^\|\s*Policy rule\s*\|/m.test(traceSection)
      ? "Policy rule"
      : "정책 규칙";
    const rows = tableRows(
      traceSection,
      [policyRuleHeader, "PRD 요구사항", "수용 기준", "관련 결정"],
      file,
      "정책 추적성",
      errors,
    );
    const tracedRules = new Map();
    for (const [index, cells] of rows.entries()) {
      const ruleIds = cells[0].match(/\bPOL-\d{2,}-R-\d{2,}\b/g) ?? [];
      const requirements = cells[1].match(/\bPRD-\d{2,}-FR-\d{2,}\b/g) ?? [];
      const acceptance = cells[2].match(/\bPRD-\d{2,}-AC-\d{2,}\b/g) ?? [];
      const decisions = cells[3].match(/\bD-\d{2,}\b/g) ?? [];
      if (
        !ruleIds.length ||
        !requirements.length ||
        !acceptance.length ||
        !decisions.length
      ) {
        errors.push(
          `${file}: 정책 추적성 ${index + 1}번째 행에는 R·FR·AC·D가 모두 필요합니다.`,
        );
        continue;
      }
      ruleIds.forEach((id) =>
        tracedRules.set(id, (tracedRules.get(id) ?? 0) + 1),
      );
      for (const requirement of requirements) {
        for (const rule of ruleIds) traceEdges.add(`${requirement}\0${rule}`);
      }
    }
    for (const rule of rules) {
      const count = tracedRules.get(rule) ?? 0;
      if (count === 0) errors.push(`${file}: 추적성 매트릭스의 규칙 누락 ${rule}`);
      if (count > 1) errors.push(`${file}: 추적성 매트릭스의 규칙 중복 ${rule}`);
    }
  }
  return { policyIds, definitions, traceEdges, approved };
}

function validateContractReferences(
  root,
  files,
  prd,
  policy,
  approvedFiles,
  errors,
) {
  const definitions = new Set([
    ...prd.definitions.keys(),
    ...policy.definitions.keys(),
  ]);
  for (const file of files) {
    const raw = read(root, file);
    const content = visibleContractMarkdown(raw);
    for (const id of referencedContractIds(content)) {
      if (!definitions.has(id)) {
        errors.push(`${file}: 정의되지 않은 제품 계약 ID ${id}`);
      }
    }
    for (const match of content.matchAll(/\bPRD-\d{2,}\b/g)) {
      if (!prd.prdIds.has(match[0])) errors.push(`${file}: 정의되지 않은 PRD ID ${match[0]}`);
    }
    for (const match of content.matchAll(/\bPOL-\d{2,}\b/g)) {
      if (!policy.policyIds.has(match[0])) {
        errors.push(`${file}: 정의되지 않은 Policy ID ${match[0]}`);
      }
    }
    for (const match of content.matchAll(
      /(?:^|[^A-Za-z0-9-])((?:FR|AC|SP|R)-\d{2,})\b/g,
    )) {
      errors.push(`${file}: namespace 없는 계약 ID ${match[1]}`);
    }
    if (approvedFiles.has(file) && /\b(?:TODO|TBD|FIXME)\b/i.test(content)) {
      errors.push(`${file}: 승인 문서에 TODO/TBD/FIXME가 남아 있습니다.`);
    }
    if (/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/.test(raw)) {
      errors.push(`${file}: 개인 머신 절대 경로가 포함되어 있습니다.`);
    }
    if (/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/.test(raw)) {
      errors.push(`${file}: credential로 보이는 값이 포함되어 있습니다.`);
    }
  }
}

function parseExcludeArguments(argv) {
  const excludedPaths = [];
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    let value;
    if (argv[index] === "--exclude") {
      value = argv[index + 1];
      index += 1;
    } else if (argv[index].startsWith("--exclude=")) {
      value = argv[index].slice("--exclude=".length);
    } else {
      errors.push(`알 수 없는 인자: ${argv[index]}`);
      continue;
    }
    const normalized = normalizePath(path.normalize(value ?? ""));
    if (
      !normalized ||
      normalized === "." ||
      normalized === ".." ||
      path.isAbsolute(normalized) ||
      normalized.startsWith("../")
    ) {
      errors.push(`제외 경로는 저장소 안의 상대 경로여야 합니다: ${value ?? ""}`);
    } else {
      excludedPaths.push(normalized);
    }
  }
  return { excludedPaths, errors };
}

export function validateRepository(
  repositoryRoot = process.cwd(),
  { excludedPaths = [] } = {},
) {
  const root = path.resolve(repositoryRoot);
  const errors = [];
  const requiredPaths = [
    "README.md",
    "AGENTS.md",
    "docs/prd",
    "docs/policies",
    "docs/architecture",
    "docs/development",
    ...DEVELOPMENT_FILES,
  ];
  for (const target of requiredPaths) {
    if (!fs.existsSync(path.join(root, target))) {
      errors.push(`필수 경로가 없습니다: ${target}`);
    }
  }

  validateSymlinks(root, errors);
  validateSkillFiles(root, errors);
  validateCiContracts(root, errors);

  const activeMarkdownFiles = [
    "README.md",
    ...["docs/prd", "docs/policies", "docs/architecture", "docs/development"]
      .flatMap((directory) => listFiles(root, directory, excludedPaths))
      .filter((file) => file.endsWith(".md")),
  ].filter((file) => !isExcluded(file, excludedPaths));

  for (const file of activeMarkdownFiles) {
    const content = read(root, file);
    if (!content.endsWith("\n")) errors.push(`${file}: EOF newline이 없습니다.`);
    content.split("\n").forEach((line, index) => {
      if (/[ \t]+$/.test(line)) {
        errors.push(`${file}:${index + 1}: trailing whitespace`);
      }
    });
    validateLocalLinks(root, file, content, errors);
  }

  const prdFiles = listFiles(root, "docs/prd", excludedPaths)
    .filter((file) => file.endsWith(".md") && path.basename(file) !== "README.md")
    .sort();
  const policyFiles = listFiles(root, "docs/policies", excludedPaths)
    .filter((file) => file.endsWith(".md") && path.basename(file) !== "README.md")
    .sort();
  const architectureFiles = listFiles(root, "docs/architecture", excludedPaths)
    .filter((file) => file.endsWith(".md"))
    .sort();

  const prd = validatePrdDocuments(root, prdFiles, errors);
  const policy = validatePolicyDocuments(root, policyFiles, errors);
  const approvedFiles = new Set([...prd.approved, ...policy.approved]);
  validateContractReferences(
    root,
    [...prdFiles, ...policyFiles, ...architectureFiles],
    prd,
    policy,
    approvedFiles,
    errors,
  );

  try {
    const sharedDefinitions = definedProductContractIds(root);
    const localDefinitions = new Set([
      ...prd.definitions.keys(),
      ...policy.definitions.keys(),
    ]);
    for (const id of localDefinitions) {
      if (!sharedDefinitions.has(id)) {
        errors.push(`제품 계약 ID parser 불일치: validator-only ${id}`);
      }
    }
    for (const id of sharedDefinitions) {
      if (!localDefinitions.has(id)) {
        errors.push(`제품 계약 ID parser 불일치: shared-parser-only ${id}`);
      }
    }
  } catch (error) {
    errors.push(`제품 계약 ID parser를 실행할 수 없습니다: ${error.message}`);
  }

  for (const edge of prd.traceEdges) {
    if (!policy.traceEdges.has(edge)) {
      errors.push(`추적성 불일치: PRD에만 있는 연결 ${edge.replace("\0", " → ")}`);
    }
  }
  for (const edge of policy.traceEdges) {
    if (!prd.traceEdges.has(edge)) {
      errors.push(`추적성 불일치: Policy에만 있는 연결 ${edge.replace("\0", " → ")}`);
    }
  }

  for (const [directory, indexFile] of [
    ["docs/prd", "docs/prd/README.md"],
    ["docs/policies", "docs/policies/README.md"],
  ]) {
    if (!isFile(root, indexFile)) {
      errors.push(`문서 인덱스가 없습니다: ${indexFile}`);
      continue;
    }
    const index = read(root, indexFile);
    for (const file of listFiles(root, directory, excludedPaths).filter(
      (entry) => entry.endsWith(".md") && path.basename(entry) !== "README.md",
    )) {
      if (!index.includes(path.basename(file))) {
        errors.push(`${indexFile} 인덱스 누락: ${file}`);
      }
    }
  }

  const readme = isFile(root, "README.md") ? read(root, "README.md") : "";
  for (const target of ["docs/architecture/README.md", ...DEVELOPMENT_FILES]) {
    if (!readme.includes(target)) {
      errors.push(`README 탐색 링크 누락: ${target}`);
    }
  }

  return {
    errors,
    counts: {
      markdown: activeMarkdownFiles.length,
      prd: prdFiles.length,
      policy: policyFiles.length,
      contracts: prd.definitions.size + policy.definitions.size,
    },
  };
}

async function main() {
  const parsed = parseExcludeArguments(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    console.error(parsed.errors.join("\n"));
    process.exitCode = 2;
    return;
  }
  const result = validateRepository(process.cwd(), parsed);
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `제품 문서 검증 통과: 활성 Markdown ${result.counts.markdown}개, PRD ${result.counts.prd}개, Policy ${result.counts.policy}개, 계약 ID ${result.counts.contracts}개, 오류 0개`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
