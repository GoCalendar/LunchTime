#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

export function classifyForbiddenCommitPath(path) {
  const normalized = String(path ?? "");
  const components = normalized.split("/");
  const lowercaseComponents = components.map((component) =>
    component.toLowerCase(),
  );
  const basename = components.at(-1) ?? "";
  const lowercaseBasename = basename.toLowerCase();

  if (lowercaseComponents.includes(".omc")) {
    return "OMC 로컬 실행 상태";
  }

  if (
    lowercaseBasename === ".ds_store" ||
    (basename.startsWith("._") && basename.length > 2)
  ) {
    return "macOS 메타데이터";
  }

  if (lowercaseBasename === "thumbs.db" || lowercaseBasename === "desktop.ini") {
    return "Windows 메타데이터";
  }

  if (
    /^\..+\.sw[pon]$/i.test(basename) ||
    (basename.length > 1 && basename.endsWith("~"))
  ) {
    return "편집기 임시 파일";
  }

  const ideaIndex = lowercaseComponents.lastIndexOf(".idea");
  if (ideaIndex >= 0) {
    const ideaPath = lowercaseComponents.slice(ideaIndex + 1);
    const ideaBasename = ideaPath.at(-1) ?? "";
    if (
      ideaBasename === "workspace.xml" ||
      ideaBasename === "tasks.xml" ||
      ideaBasename === "datasources.local.xml" ||
      ideaPath[0] === "shelf" ||
      ideaPath[0] === "httprequests"
    ) {
      return "JetBrains 개인 작업공간 상태";
    }
  }

  return null;
}

export function findForbiddenCommitPaths(paths) {
  const findings = [];

  for (const path of paths) {
    const reason = classifyForbiddenCommitPath(path);
    if (reason) {
      findings.push({ path, reason });
    }
  }

  return findings;
}

export function readIndexPaths(options = {}) {
  const result = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === "string" ? result.stderr.trim() : "";
    const detail = stderr || result.error?.message || "알 수 없는 Git 오류";
    throw new Error(`Git index를 읽지 못했습니다: ${detail}`);
  }

  return result.stdout.split("\0").filter(Boolean);
}

export function validateIndexPaths(options = {}) {
  return findForbiddenCommitPaths(readIndexPaths(options));
}

function usage() {
  return "사용법: validate-commit-paths.mjs --index";
}

function parseArguments(argv) {
  if (argv.length !== 1 || argv[0] !== "--index") {
    throw new Error("`--index` 하나만 지정해야 합니다.");
  }
}

async function main() {
  try {
    parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  try {
    const findings = validateIndexPaths();
    if (findings.length > 0) {
      console.error("Git index에 커밋할 수 없는 로컬 잔여물이 있습니다.");
      for (const finding of findings) {
        console.error(`- ${JSON.stringify(finding.path)}: ${finding.reason}`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("Git index에 금지된 로컬 잔여물이 없습니다.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
