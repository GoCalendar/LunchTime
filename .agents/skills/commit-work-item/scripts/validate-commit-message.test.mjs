import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  parseCommitLog,
  validateCommitMessage,
  validateCommitRange,
} from "./validate-commit-message.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("LT 작업 키 제목을 허용한다", () => {
  assert.deepEqual(
    validateCommitMessage(
      "feat: LT-017 - 메뉴 확인 상태를 저장한다\n\n- 누락 방지 상태를 추가합니다.",
    ),
    [],
  );
});

test("GitHub 이슈 번호 fallback을 허용한다", () => {
  assert.deepEqual(
    validateCommitMessage("docs: #41 - 개발 협약을 명확히 한다"),
    [],
  );
});

test("허용되지 않은 type과 모호한 제목을 거부한다", () => {
  assert.match(
    validateCommitMessage("update: LT-017 - 메뉴 상태")[0],
    /형식/,
  );
  assert.match(
    validateCommitMessage("feat: 메뉴 상태")[0],
    /형식/,
  );
});

test("72자를 넘는 제목을 거부한다", () => {
  const message = `feat: LT-017 - ${"긴".repeat(70)}`;
  assert.match(validateCommitMessage(message).join("\n"), /72자/);
});

test("Co-Authored-By 트레일러를 거부한다", () => {
  const errors = validateCommitMessage(
    "fix: LT-017 - 누락을 막는다\n\nCo-Authored-By: Example <example@example.com>",
  );
  assert.match(errors.join("\n"), /Co-Authored-By/);
});

test("Git 로그 레코드를 해석한다", () => {
  assert.deepEqual(
    parseCommitLog("abc\x00docs: #1 - 문서를 고친다\n\x00\x1e\n"),
    [{ hash: "abc", message: "docs: #1 - 문서를 고친다\n" }],
  );
});

test("Git 옵션처럼 해석될 수 있는 범위를 거부한다", () => {
  assert.throws(
    () => validateCommitRange("--all"),
    /안전한 Git ref/,
  );
  assert.throws(
    () => validateCommitRange("HEAD~1...HEAD"),
    /안전한 Git ref/,
  );
});

test("커밋 범위의 모든 메시지를 검증한다", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lunchtime-commit-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));

  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.name", "Test User"]);
  git(directory, ["config", "user.email", "test@example.com"]);
  await writeFile(join(directory, "one.txt"), "one\n");
  git(directory, ["add", "one.txt"]);
  git(directory, ["commit", "-q", "-m", "docs: #1 - 첫 문서를 추가한다"]);
  const base = git(directory, ["rev-parse", "HEAD"]);

  await writeFile(join(directory, "two.txt"), "two\n");
  git(directory, ["add", "two.txt"]);
  git(directory, ["commit", "-q", "-m", "feat: LT-002 - 두 번째 결과를 추가한다"]);

  assert.deepEqual(validateCommitRange(`${base}..HEAD`, { cwd: directory }), []);

  await writeFile(join(directory, "three.txt"), "three\n");
  git(directory, ["add", "three.txt"]);
  git(directory, ["commit", "-q", "-m", "잘못된 제목"]);
  assert.match(
    validateCommitRange(`${base}..HEAD`, { cwd: directory }).join("\n"),
    /형식/,
  );
});
