#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "test",
  "docs",
  "chore",
  "spike",
];

const TITLE_PATTERN = new RegExp(
  `^(?:${COMMIT_TYPES.join("|")}): (?:LT-[0-9]{3}|#[1-9][0-9]*) - \\S(?:.*\\S)?$`,
);

export function validateCommitMessage(message) {
  const errors = [];
  const normalized = String(message ?? "").replace(/\r\n/g, "\n").trimEnd();
  const [title = ""] = normalized.split("\n");

  if (!title) {
    errors.push("커밋 제목이 없습니다.");
    return errors;
  }

  if (!TITLE_PATTERN.test(title)) {
    errors.push(
      "커밋 제목은 `<type>: LT-NNN - <결과>` 또는 `<type>: #<이슈 번호> - <결과>` 형식이어야 합니다.",
    );
  }

  if ([...title].length > 72) {
    errors.push("커밋 제목은 72자 이하여야 합니다.");
  }

  if (/^Co-Authored-By:/im.test(normalized)) {
    errors.push("`Co-Authored-By` 트레일러를 사용할 수 없습니다.");
  }

  return errors;
}

export function parseCommitLog(output) {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\n+|\n+$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const separator = record.indexOf("\x00");
      if (separator < 1) {
        throw new Error("Git 로그 레코드를 해석할 수 없습니다.");
      }
      return {
        hash: record.slice(0, separator),
        message: record.slice(separator + 1).replace(/\x00$/, ""),
      };
    });
}

export function readCommitRange(range, options = {}) {
  const ref = "[A-Za-z0-9](?:[A-Za-z0-9._/~^-]*[A-Za-z0-9])?";
  if (
    !new RegExp(`^${ref}\\.\\.${ref}$`).test(String(range ?? ""))
  ) {
    throw new Error("커밋 범위는 `<base>..<head>` 형식의 안전한 Git ref여야 합니다.");
  }

  const cwd = options.cwd ?? process.cwd();
  const result = spawnSync(
    "git",
    ["log", "--format=%H%x00%B%x00%x1e", range],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    const detail = result.stderr.trim() || "알 수 없는 Git 오류";
    throw new Error(`커밋 범위를 읽지 못했습니다: ${detail}`);
  }

  return parseCommitLog(result.stdout);
}

export function validateCommitRange(range, options = {}) {
  const commits = readCommitRange(range, options);
  const errors = [];

  if (commits.length === 0) {
    errors.push(`범위 \`${range}\`에 검증할 커밋이 없습니다.`);
    return errors;
  }

  for (const commit of commits) {
    for (const error of validateCommitMessage(commit.message)) {
      errors.push(`${commit.hash.slice(0, 12)}: ${error}`);
    }
  }

  return errors;
}

function usage() {
  return [
    "사용법:",
    "  validate-commit-message.mjs --file <message-file|->",
    "  validate-commit-message.mjs --range <base..head>",
  ].join("\n");
}

function parseArguments(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--file" || argument === "--range") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} 값이 필요합니다.`);
      }
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`알 수 없는 인자입니다: ${argument}`);
  }

  if (Boolean(parsed.file) === Boolean(parsed.range)) {
    throw new Error("`--file`과 `--range` 중 하나만 지정해야 합니다.");
  }

  return parsed;
}

async function readMessage(path) {
  if (path === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(path, "utf8");
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    const errors = args.file
      ? validateCommitMessage(await readMessage(args.file))
      : validateCommitRange(args.range);

    if (errors.length > 0) {
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("커밋 메시지 계약을 충족합니다.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
