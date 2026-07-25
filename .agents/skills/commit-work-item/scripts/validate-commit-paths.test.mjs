import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  classifyForbiddenCommitPath,
  findForbiddenCommitPaths,
  readIndexPaths,
  validateIndexPaths,
} from "./validate-commit-paths.mjs";

const scriptPath = fileURLToPath(
  new URL("./validate-commit-paths.mjs", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function run(cwd, command, args, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function git(cwd, args, options = {}) {
  const result = run(cwd, "git", args, options);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function createRepository(context) {
  const directory = await mkdtemp(join(tmpdir(), "lunchtime-commit-paths-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.name", "Test User"]);
  git(directory, ["config", "user.email", "test@example.com"]);
  return directory;
}

async function writeRepositoryFile(directory, path, content = "fixture\n") {
  const absolutePath = join(directory, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

test("명백한 로컬 잔여물 경로를 분류한다", () => {
  const cases = [
    [".omc/project-memory.json", "OMC"],
    ["nested/.omc/session.json", "OMC"],
    [".OMC/session.json", "OMC"],
    [".DS_Store", "macOS"],
    ["docs/.ds_store", "macOS"],
    ["docs/.DS_Store", "macOS"],
    ["._index.md", "macOS"],
    ["Thumbs.db", "Windows"],
    ["assets/THUMBS.DB", "Windows"],
    ["Desktop.ini", "Windows"],
    [".notes.swp", "편집기"],
    ["draft~", "편집기"],
    [".idea/workspace.xml", "JetBrains"],
    [".IDEA/WORKSPACE.XML", "JetBrains"],
    [".idea/shelf/change.patch", "JetBrains"],
    ["module/.idea/httpRequests/request.http", "JetBrains"],
    [".idea/dataSources.local.xml", "JetBrains"],
    [".idea/DATASOURCES.LOCAL.XML", "JetBrains"],
  ];

  for (const [path, reason] of cases) {
    assert.match(classifyForbiddenCommitPath(path), new RegExp(reason), path);
  }
});

test("유사 이름과 공유 가능한 IDE 설정은 허용한다", () => {
  const allowed = [
    ".omc-config",
    "docs/.DS_Store.md",
    "fixtures/Thumbs.db.expected",
    "fixtures/Desktop.ini.sample",
    "notes.swp.test",
    "~roadmap.md",
    ".idea/codeStyles/Project.xml",
    ".idea/runConfigurations/app.xml",
    ".vscode/extensions.json",
    ".vscode/settings.json",
  ];

  assert.deepEqual(findForbiddenCommitPaths(allowed), []);
});

test("Git index 경로를 NUL 구분으로 읽어 개행 경로를 보존한다", async (context) => {
  const directory = await createRepository(context);
  const path = "line\nbreak.txt";
  await writeRepositoryFile(directory, path);
  git(directory, ["add", "--", path]);

  assert.deepEqual(readIndexPaths({ cwd: directory }), [path]);
  assert.deepEqual(validateIndexPaths({ cwd: directory }), []);
});

test("ignore를 강제 우회해 stage한 로컬 잔여물을 차단한다", async (context) => {
  const directory = await createRepository(context);
  const paths = [
    ".omc/session.json",
    ".DS_Store",
    ".idea/workspace.xml",
  ];
  for (const path of paths) {
    await writeRepositoryFile(directory, path);
  }
  git(directory, ["add", "-f", "--", ...paths]);

  const result = run(directory, process.execPath, [scriptPath, "--index"]);
  assert.equal(result.status, 1);
  for (const path of paths) {
    assert.ok(result.stderr.includes(JSON.stringify(path)), path);
  }
});

test("이전 commit의 잔여물도 막고 삭제를 stage하면 허용한다", async (context) => {
  const directory = await createRepository(context);
  await writeRepositoryFile(directory, ".DS_Store");
  git(directory, ["add", "-f", "--", ".DS_Store"]);
  git(directory, ["commit", "-q", "-m", "docs: #1 - fixture를 추가한다"]);

  await writeRepositoryFile(directory, "allowed.txt");
  git(directory, ["add", "--", "allowed.txt"]);
  git(directory, ["commit", "-q", "-m", "docs: #1 - 정상 파일을 추가한다"]);

  assert.equal(
    run(directory, process.execPath, [scriptPath, "--index"]).status,
    1,
  );

  await rm(join(directory, ".DS_Store"));
  git(directory, ["add", "-u", "--", ".DS_Store"]);
  const deletionResult = run(directory, process.execPath, [scriptPath, "--index"]);
  assert.equal(deletionResult.status, 0, deletionResult.stderr);
});

test("저장소 ignore는 로컬 잔여물만 숨기고 공유 설정은 노출한다", async (context) => {
  const directory = await createRepository(context);
  const ignore = await readFile(join(repositoryRoot, ".gitignore"), "utf8");
  await writeFile(join(directory, ".gitignore"), ignore);
  const environment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };

  const ignored = [
    ".omc/session.json",
    "nested/.DS_Store",
    "Thumbs.db",
    "Desktop.ini",
    ".draft.swp",
    "draft~",
    ".idea/workspace.xml",
    ".idea/shelf/change.patch",
    "module/.idea/httpRequests/request.http",
  ];
  for (const path of ignored) {
    const result = run(
      directory,
      "git",
      ["check-ignore", "--no-index", "--", path],
      { env: environment },
    );
    assert.equal(result.status, 0, path);
  }

  const visible = [
    ".vscode/settings.json",
    ".idea/codeStyles/Project.xml",
    "docs/.DS_Store.md",
  ];
  for (const path of visible) {
    const result = run(
      directory,
      "git",
      ["check-ignore", "--no-index", "--", path],
      { env: environment },
    );
    assert.equal(result.status, 1, path);
  }
});

test("잘못된 CLI 인자를 사용 오류로 보고한다", async (context) => {
  const directory = await createRepository(context);
  const result = run(directory, process.execPath, [scriptPath, "--range", "HEAD"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--index/);
});

test("Git index를 읽을 수 없으면 실행 오류로 보고한다", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lunchtime-no-git-index-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));

  const result = run(directory, process.execPath, [scriptPath, "--index"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Git index를 읽지 못했습니다/);
});
