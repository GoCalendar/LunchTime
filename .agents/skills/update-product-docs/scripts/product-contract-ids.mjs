import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

const CONTRACT_ID_PATTERN =
  /(?<![A-Za-z0-9_-])(?:PRD-\d{2,}-(?:FR|AC|SP)-\d{2,}|POL-\d{2,}-R-\d{2,})(?![A-Za-z0-9_-])/g;
const PRD_HEADING_PATTERN =
  /^ {0,3}#{1,6}\s+(PRD-\d{2,}-(?:FR|AC)-\d{2,})(?=[.\s]|$)/gm;
const PRD_SPIKE_TABLE_PATTERN =
  /^\|\s*(PRD-\d{2,}-SP-\d{2,})\s+[^|\s][^|]*\|/gm;
const POLICY_HEADING_PATTERN =
  /^ {0,3}#{1,6}\s+(POL-\d{2,}-R-\d{2,})(?=[.\s]|$)/gm;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

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

function maskPattern(text, pattern) {
  return text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));
}

function maskImageLabels(text) {
  const ranges = [];
  let cursor = 0;

  while (cursor < text.length - 1) {
    const opening = text.indexOf("![", cursor);
    if (opening < 0) break;
    let backslashes = 0;
    for (
      let index = opening - 1;
      index >= 0 && text[index] === "\\";
      index -= 1
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) {
      cursor = opening + 2;
      continue;
    }

    let depth = 1;
    let index = opening + 2;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === "[") depth += 1;
      if (text[index] === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    if (depth === 0) {
      ranges.push({ start: opening, end: index + 1 });
    }
    cursor = Math.max(index + 1, opening + 2);
  }

  return maskRanges(text, ranges);
}

const HTML_VOID_ELEMENTS = new Set([
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
const HTML_CONTAINER_ELEMENTS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "html",
  "i",
  "iframe",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "map",
  "mark",
  "menu",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "u",
  "ul",
  "var",
  "video",
]);

function scanHtmlTags(text) {
  const tags = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("<", cursor);
    if (start < 0) break;
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
        raw,
        name: parsed[1].toLowerCase(),
        closing: /^<\//.test(raw),
        selfClosing: /\/\s*>$/.test(raw),
      });
    }
    cursor = index + 1;
  }
  return tags;
}

function maskNonSemanticHtmlContainers(text) {
  const ranges = [];
  const stack = [];

  for (const tag of scanHtmlTags(text)) {
    const { raw, name, closing, start, end } = tag;
    const selfClosing =
      tag.selfClosing || HTML_VOID_ELEMENTS.has(name);
    const standardContainer = HTML_CONTAINER_ELEMENTS.has(name);

    if (
      !closing &&
      !selfClosing &&
      (stack.length > 0 || standardContainer)
    ) {
      stack.push({
        name,
        start,
      });
      continue;
    }
    if (!closing || stack.length === 0) continue;

    const openingIndex = stack.map((entry) => entry.name).lastIndexOf(name);
    if (openingIndex < 0) continue;
    const [opening] = stack.splice(openingIndex, 1);
    if (openingIndex === 0) {
      ranges.push({
        start: opening.start,
        end,
      });
      stack.length = 0;
    }
  }

  for (const opening of stack) {
    if (opening === stack[0]) {
      ranges.push({ start: opening.start, end: text.length });
      break;
    }
  }
  return maskRanges(text, ranges);
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

function maskInlineLinkDestinations(text) {
  const ranges = [];
  let cursor = 0;

  while (cursor < text.length - 1) {
    const closingLabel = text.indexOf("](", cursor);
    if (closingLabel < 0) break;

    let depth = 1;
    let index = closingLabel + 2;
    while (index < text.length) {
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === "(") depth += 1;
      if (text[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start: closingLabel + 2, end: index });
          index += 1;
          break;
        }
      }
      index += 1;
    }
    if (depth > 0) {
      ranges.push({ start: closingLabel + 2, end: text.length });
    }
    cursor = Math.max(index, closingLabel + 2);
  }

  return maskRanges(text, ranges);
}

function maskReferenceLinkKeys(text) {
  return maskPattern(text, /(?<=])\[([^\]\n]*)]/g);
}

function maskRawHtmlAndAutolinks(text) {
  const withoutTags = maskRanges(
    text,
    scanHtmlTags(text).map(({ start, end }) => ({ start, end })),
  );
  return maskPattern(
    withoutTags,
    /<(?:https?:\/\/|mailto:|[^<>\s@]+@[^<>\s@]+\.)[^>\n]*>/gi,
  );
}

export function visibleContractMarkdown(text) {
  const source = String(text ?? "");
  const withoutBlocks = maskHtmlComments(
    maskRanges(source, scanFencedBlocks(source)),
  );
  const withoutContainers = maskNonSemanticHtmlContainers(withoutBlocks);
  const withoutImages = maskImageLabels(withoutContainers);
  const withoutDefinitions = maskReferenceDefinitions(withoutImages);
  const withoutDestinations =
    maskInlineLinkDestinations(withoutDefinitions);
  const withoutReferenceKeys =
    maskReferenceLinkKeys(withoutDestinations);
  return maskRawHtmlAndAutolinks(withoutReferenceKeys);
}

export function referencedContractIds(markdown) {
  return new Set(
    visibleContractMarkdown(markdown).match(CONTRACT_ID_PATTERN) ?? [],
  );
}

function markdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(target));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      basename(entry.name) !== "README.md" &&
      statSync(target).isFile()
    ) {
      files.push(target);
    }
  }
  return files;
}

function collectDefinedProductContractIds(documents) {
  const ids = new Set();
  for (const { path, content: rawContent } of documents) {
    const isPrdDocument = path.startsWith("docs/prd/");
    const content = visibleContractMarkdown(rawContent);
    const headingPattern = isPrdDocument
      ? PRD_HEADING_PATTERN
      : POLICY_HEADING_PATTERN;
    for (const match of content.matchAll(headingPattern)) {
      ids.add(match[1]);
    }
    if (isPrdDocument) {
      for (const match of content.matchAll(PRD_SPIKE_TABLE_PATTERN)) {
        ids.add(match[1]);
      }
    }
  }
  return ids;
}

export function definedProductContractIds(repositoryRoot = process.cwd()) {
  const root = resolve(repositoryRoot);
  const directories = ["docs/prd", "docs/policies"].map((directory) =>
    join(root, directory),
  );
  for (const directory of directories) {
    if (!existsSync(directory)) {
      throw new Error(
        `제품 정본 ID 디렉터리를 읽을 수 없습니다: ${directory}`,
      );
    }
  }

  const documents = [];
  for (const directory of directories) {
    for (const file of markdownFiles(directory)) {
      documents.push({
        path: file.slice(root.length + 1).replaceAll("\\", "/"),
        content: readFileSync(file, "utf8"),
      });
    }
  }
  return collectDefinedProductContractIds(documents);
}

function runGit(repositoryRoot, arguments_, { allowFailure = false } = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: resolve(repositoryRoot),
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFailure) {
    const detail =
      String(result.stderr ?? "").trim() ||
      result.error?.message ||
      "알 수 없는 Git 오류";
    throw new Error(`Git 제품 정본 snapshot을 읽지 못했습니다: ${detail}`);
  }
  return result;
}

export function definedProductContractIdsAtGitRef(
  ref,
  repositoryRoot = process.cwd(),
) {
  if (!GIT_OBJECT_PATTERN.test(String(ref ?? ""))) {
    throw new Error("제품 정본 Git ref는 40자리 commit OID여야 합니다.");
  }
  const normalizedRef = String(ref).toLowerCase();
  const listing = runGit(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    normalizedRef,
    "--",
    "docs/prd",
    "docs/policies",
  ]);
  const entries = listing.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^([0-7]{6}) ([^ ]+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(
        entry,
      );
      if (!match) {
        throw new Error("제품 정본 Git tree entry 형식을 해석할 수 없습니다.");
      }
      return {
        mode: match[1],
        type: match[2],
        oid: match[3],
        path: match[4],
      };
    })
    .filter(
      ({ path }) =>
        path.endsWith(".md") &&
        path.split("/").at(-1) !== "README.md" &&
        (path.startsWith("docs/prd/") ||
          path.startsWith("docs/policies/")),
    );
  for (const directory of ["docs/prd/", "docs/policies/"]) {
    if (!entries.some(({ path }) => path.startsWith(directory))) {
      throw new Error(`제품 정본 Git tree에 ${directory} 문서가 없습니다.`);
    }
  }
  for (const entry of entries) {
    if (entry.mode !== "100644" || entry.type !== "blob") {
      throw new Error(
        `제품 정본 Git tree의 일반 Markdown blob이 아닙니다: ${entry.path}`,
      );
    }
  }
  const documents = entries.map(({ path, oid }) => ({
    path,
    content: runGit(repositoryRoot, ["cat-file", "blob", oid]).stdout,
  }));
  return collectDefinedProductContractIds(documents);
}

export function undefinedProductContractIds(
  markdown,
  repositoryRoot = process.cwd(),
) {
  const defined = definedProductContractIds(repositoryRoot);
  return [...referencedContractIds(markdown)]
    .filter((id) => !defined.has(id))
    .sort();
}
