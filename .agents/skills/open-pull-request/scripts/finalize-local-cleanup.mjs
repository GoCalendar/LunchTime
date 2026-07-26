#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  constants as fsConstants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  FinalizeRemoteBranchError,
  canonicalRepository,
  readOriginRemoteConfiguration,
} from "./finalize-remote-branch.mjs";

const HEAD_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const ARCHIVE_SCHEMA = "lunchtime-finalize-local-cleanup:v2";
const GENERATION_SCHEMA = "lunchtime-finalize-local-cleanup-generation:v2";
const GENERATION_INTENT_SCHEMA =
  "lunchtime-finalize-local-cleanup-generation-intent:v1";
const SNAPSHOT_ATTEMPT_SCHEMA =
  "lunchtime-finalize-local-cleanup-snapshot-attempt:v1";
const SNAPSHOT_COMPLETE_SCHEMA =
  "lunchtime-finalize-local-cleanup-snapshot-complete:v1";
const SNAPSHOT_FAILED_SCHEMA =
  "lunchtime-finalize-local-cleanup-snapshot-failed:v1";
const QUARANTINE_INTENT_SCHEMA =
  "lunchtime-finalize-local-cleanup-quarantine-intent:v1";
const QUARANTINE_RECEIPT_SCHEMA =
  "lunchtime-finalize-local-cleanup-quarantine-receipt:v1";
const PLAN_SCHEMA = "lunchtime-finalize-local-cleanup-plan:v2";
const ARCHIVE_ROOT_NAME = "lunchtime-worktree-state";
const ARCHIVE_VERSION = "v2";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const PYTHON_EXECUTABLE = "/usr/bin/python3";
const ATOMIC_RENAME_NO_REPLACE_SCRIPT = String.raw`
import ctypes
import errno
import os
import sys

source = os.fsencode(sys.argv[1])
destination = os.fsencode(sys.argv[2])
libc = ctypes.CDLL(None, use_errno=True)

if sys.platform == "darwin":
    rename = libc.renamex_np
    rename.argtypes = [
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    rename.restype = ctypes.c_int
    result = rename(source, destination, 0x00000004)
elif sys.platform.startswith("linux"):
    try:
        rename = libc.renameat2
    except AttributeError:
        print(errno.ENOSYS)
        raise SystemExit(1)
    rename.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    rename.restype = ctypes.c_int
    result = rename(-100, source, -100, destination, 0x00000001)
else:
    print(errno.ENOSYS)
    raise SystemExit(1)

if result == 0:
    raise SystemExit(0)

print(ctypes.get_errno())
raise SystemExit(1)
`;

class UsageError extends Error {}
class CleanupContractError extends Error {}

function fail(message) {
  throw new CleanupContractError(message);
}

function pathState(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function canonicalPath(path) {
  const absolute = resolve(String(path ?? ""));
  if (pathState(absolute)) return realpathSync(absolute);

  const missing = [];
  let cursor = absolute;
  while (!pathState(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      fail(`경로의 기존 상위 디렉터리를 찾을 수 없습니다: ${absolute}`);
    }
    missing.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
  return join(realpathSync(cursor), ...missing);
}

function isPathInside(candidate, parent) {
  const difference = relative(parent, candidate);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function modeBits(stats) {
  return Number(stats.mode & 0o777n);
}

function runGit(cwd, arguments_, options = {}) {
  const allowedStatuses = options.allowedStatuses ?? [0];
  const result = spawnSync("git", arguments_, {
    cwd,
    env: options.environment,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowedStatuses.includes(result.status)) {
    const detail =
      String(result.stderr ?? "").trim() ||
      result.error?.message ||
      "알 수 없는 Git 오류";
    throw new CleanupContractError(
      `로컬 cleanup Git 명령이 실패했습니다: git ${arguments_.join(" ")}: ${detail}`,
    );
  }
  return result;
}

function isolatedGitEnvironment(overrides = {}) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("GIT_"),
    ),
  );
  return Object.assign(environment, overrides);
}

function gitOutput(cwd, arguments_) {
  return runGit(cwd, arguments_).stdout.replace(/\r?\n$/, "");
}

function readLocalRef(mainWorktree, reference) {
  const result = runGit(
    mainWorktree,
    ["rev-parse", "--verify", "--quiet", `${reference}^{commit}`],
    { allowedStatuses: [0, 1] },
  );
  if (result.status === 1) return null;
  const oid = result.stdout.trim().toLowerCase();
  if (!HEAD_PATTERN.test(oid)) {
    fail(`local ref ${reference}의 OID를 확정할 수 없습니다.`);
  }
  return oid;
}

function parseWorktreeList(raw) {
  const records = [];
  let current = null;
  for (const field of raw.split("\0")) {
    if (!field) {
      if (current) {
        records.push(current);
        current = null;
      }
      continue;
    }
    const separator = field.indexOf(" ");
    const key = separator < 0 ? field : field.slice(0, separator);
    const value = separator < 0 ? true : field.slice(separator + 1);
    if (key === "worktree") {
      if (current) records.push(current);
      current = { worktree: value };
    } else {
      if (!current) fail("Git worktree 목록 형식을 해석할 수 없습니다.");
      current[key] = value;
    }
  }
  if (current) records.push(current);
  return records;
}

function readWorktrees(mainWorktree) {
  return parseWorktreeList(
    runGit(mainWorktree, ["worktree", "list", "--porcelain", "-z"]).stdout,
  ).map((record) => ({
    ...record,
    canonicalPath: canonicalPath(record.worktree),
    HEAD:
      typeof record.HEAD === "string" ? record.HEAD.toLowerCase() : record.HEAD,
  }));
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function atomicRenameNoReplace(source, destination, label) {
  const result = spawnSync(
    PYTHON_EXECUTABLE,
    [
      "-c",
      ATOMIC_RENAME_NO_REPLACE_SCRIPT,
      source,
      destination,
    ],
    {
      encoding: "utf8",
      maxBuffer: 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) return "renamed";

  const errorNumber = Number(String(result.stdout ?? "").trim());
  if (errorNumber === 17) return "exists";
  if (errorNumber === 18) {
    fail(`${label} no-replace atomic rename이 EXDEV로 실패했습니다.`);
  }
  const detail =
    result.error?.code === "ENOENT"
      ? `${PYTHON_EXECUTABLE}을 실행할 수 없습니다.`
      : Number.isInteger(errorNumber) && errorNumber > 0
        ? `errno ${errorNumber}`
        : "지원되는 no-replace syscall을 확인할 수 없습니다.";
  fail(`${label} no-replace atomic rename을 실행하지 못했습니다: ${detail}`);
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(
      directory,
      fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0),
    );
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function pendingJsonPattern(finalName) {
  const escaped = finalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\.${escaped}\\.pending-[0-9a-f]{64}$`);
}

function validatePendingJson(path, expectedDevice, label) {
  const stats = lstatSync(path, { bigint: true });
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    modeBits(stats) !== PRIVATE_FILE_MODE ||
    stats.dev !== expectedDevice
  ) {
    fail(`${label} pending metadata는 같은 filesystem의 0600 일반 파일이어야 합니다.`);
  }
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
  };
}

function pendingJsonFiles(directory, finalName, expectedDevice, label) {
  const pattern = pendingJsonPattern(finalName);
  return readdirSync(directory)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => {
      const path = join(directory, name);
      return {
        name,
        path,
        proof: validatePendingJson(path, expectedDevice, label),
      };
    });
}

function hashPart(hash, value) {
  const buffer = Buffer.isBuffer(value)
    ? value
    : Buffer.from(String(value), "utf8");
  hash.update(String(buffer.length));
  hash.update(":");
  hash.update(buffer);
  hash.update("\0");
}

function sameStatIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function inodeTokenProof(stats) {
  if (!stats) return null;
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  };
}

function scanOmcDirectory(root, expectedDevice) {
  const rootStats = pathState(root);
  if (!rootStats) fail("보존할 `.omc` payload가 사라졌습니다.");
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("`.omc` payload는 symlink가 아닌 일반 디렉터리여야 합니다.");
  }
  if (rootStats.dev !== expectedDevice) {
    fail("`.omc`와 Git common dir가 같은 filesystem에 있지 않습니다.");
  }

  const snapshotHash = createHash("sha256");
  const treeHash = createHash("sha256");
  const contentHash = createHash("sha256");

  function visit(absolutePath, relativePath) {
    const before = lstatSync(absolutePath, { bigint: true });
    if (before.dev !== expectedDevice) {
      fail(`.omc 내부에 다른 filesystem 또는 mount가 있습니다: ${relativePath || "."}`);
    }
    if (before.isSymbolicLink()) {
      fail(`.omc 내부 symlink는 자동 보존 대상으로 허용하지 않습니다: ${relativePath || "."}`);
    }

    const proof = [
      relativePath,
      before.dev.toString(),
      before.ino.toString(),
      modeBits(before),
    ];
    if (before.isDirectory()) {
      hashPart(treeHash, "directory");
      hashPart(snapshotHash, "directory");
      hashPart(contentHash, "directory");
      for (const value of proof) {
        hashPart(treeHash, value);
        hashPart(snapshotHash, value);
      }
      hashPart(contentHash, relativePath);
      hashPart(contentHash, modeBits(before));
      hashPart(snapshotHash, before.mtimeNs.toString());
      hashPart(snapshotHash, before.ctimeNs.toString());
      const names = readdirSync(absolutePath).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      for (const name of names) {
        visit(
          join(absolutePath, name),
          relativePath ? `${relativePath}/${name}` : name,
        );
      }
      const after = lstatSync(absolutePath, { bigint: true });
      if (!sameStatIdentity(before, after)) {
        fail(`.omc 검사 중 디렉터리가 변경되었습니다: ${relativePath || "."}`);
      }
      return;
    }
    if (!before.isFile()) {
      fail(`.omc 내부 special file은 자동 보존 대상으로 허용하지 않습니다: ${relativePath || "."}`);
    }
    if (before.nlink !== 1n) {
      fail(`.omc 내부 hardlink file은 자동 보존 대상으로 허용하지 않습니다: ${relativePath}`);
    }

    let descriptor;
    try {
      descriptor = openSync(
        absolutePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const openedBefore = fstatSync(descriptor, { bigint: true });
      if (
        !openedBefore.isFile() ||
        openedBefore.dev !== before.dev ||
        openedBefore.ino !== before.ino
      ) {
        fail(`.omc 파일 identity가 검사 중 변경되었습니다: ${relativePath}`);
      }
      const content = readFileSync(descriptor);
      const openedAfter = fstatSync(descriptor, { bigint: true });
      if (
        !sameStatIdentity(openedBefore, openedAfter) ||
        BigInt(content.length) !== openedAfter.size
      ) {
        fail(`.omc 파일이 검사 중 변경되었습니다: ${relativePath}`);
      }
      hashPart(treeHash, "file");
      hashPart(snapshotHash, "file");
      hashPart(contentHash, "file");
      for (const value of proof) {
        hashPart(treeHash, value);
        hashPart(snapshotHash, value);
      }
      hashPart(treeHash, content);
      hashPart(contentHash, relativePath);
      hashPart(contentHash, modeBits(before));
      hashPart(contentHash, content);
      hashPart(snapshotHash, before.mtimeNs.toString());
      hashPart(snapshotHash, before.ctimeNs.toString());
      hashPart(snapshotHash, content);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    const after = lstatSync(absolutePath, { bigint: true });
    if (!sameStatIdentity(before, after)) {
      fail(`.omc 파일 path가 검사 중 변경되었습니다: ${relativePath}`);
    }
  }

  visit(root, "");
  return {
    device: rootStats.dev.toString(),
    inode: rootStats.ino.toString(),
    snapshotDigest: snapshotHash.digest("hex"),
    treeDigest: treeHash.digest("hex"),
    contentDigest: contentHash.digest("hex"),
  };
}

function copyOmcSnapshot(
  source,
  destination,
  expectedDevice,
  options = {},
) {
  if (pathState(destination) && !options.existingRoot) {
    fail("generation payload destination collision이 발생해 overwrite하지 않습니다.");
  }

  function copyEntry(sourcePath, destinationPath, relativePath) {
    const before = lstatSync(sourcePath, { bigint: true });
    if (before.dev !== expectedDevice) {
      fail(`.omc snapshot source에 다른 filesystem이 있습니다: ${relativePath || "."}`);
    }
    if (before.isSymbolicLink()) {
      fail(`.omc snapshot source symlink는 허용하지 않습니다: ${relativePath || "."}`);
    }

    if (before.isDirectory()) {
      let destinationStats;
      if (relativePath === "" && options.existingRoot) {
        destinationStats = lstatSync(destinationPath, {
          bigint: true,
        });
        if (
          options.expectedRoot &&
          (destinationStats.dev.toString() !==
            options.expectedRoot.device ||
            destinationStats.ino.toString() !==
              options.expectedRoot.inode)
        ) {
          fail(
            "copy 시작 직전 snapshot root가 durable attempt ownership과 다릅니다.",
          );
        }
        if (readdirSync(destinationPath).length !== 0) {
          fail("resume할 pending snapshot root가 exact empty가 아닙니다.");
        }
      } else {
        try {
          mkdirSync(destinationPath, { mode: PRIVATE_DIRECTORY_MODE });
        } catch (error) {
          if (error?.code === "EEXIST") {
            fail("generation payload destination collision이 발생해 overwrite하지 않습니다.");
          }
          throw error;
        }
        destinationStats = lstatSync(destinationPath, {
          bigint: true,
        });
      }
      if (
        !destinationStats.isDirectory() ||
        destinationStats.isSymbolicLink() ||
        destinationStats.dev !== expectedDevice ||
        destinationStats.ino === before.ino
      ) {
        fail("sealed snapshot directory가 helper-owned 새 inode가 아닙니다.");
      }
      syncDirectory(dirname(destinationPath));
      if (relativePath === "") {
        options.afterRootReady?.({ pendingPayload: destinationPath });
        if (options.expectedRoot) {
          const afterHook = lstatSync(destinationPath, {
            bigint: true,
          });
          if (
            afterHook.dev.toString() !==
              options.expectedRoot.device ||
            afterHook.ino.toString() !== options.expectedRoot.inode ||
            readdirSync(destinationPath).length !== 0
          ) {
            fail(
              "snapshot 시작 hook 뒤 root가 durable attempt ownership 또는 empty 상태와 다릅니다.",
            );
          }
        }
      }
      const names = readdirSync(sourcePath).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      for (const name of names) {
        copyEntry(
          join(sourcePath, name),
          join(destinationPath, name),
          relativePath ? `${relativePath}/${name}` : name,
        );
      }
      let descriptor;
      try {
        descriptor = openSync(
          destinationPath,
          fsConstants.O_RDONLY |
            (fsConstants.O_DIRECTORY ?? 0) |
            (fsConstants.O_NOFOLLOW ?? 0),
        );
        fchmodSync(descriptor, modeBits(before));
        fsyncSync(descriptor);
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      const after = lstatSync(sourcePath, { bigint: true });
      if (!sameStatIdentity(before, after)) {
        fail(`.omc snapshot 중 source directory가 변경되었습니다: ${relativePath || "."}`);
      }
      return;
    }
    if (!before.isFile()) {
      fail(`.omc snapshot source special file은 허용하지 않습니다: ${relativePath || "."}`);
    }
    if (before.nlink !== 1n) {
      fail(`.omc snapshot source hardlink file은 허용하지 않습니다: ${relativePath}`);
    }

    let sourceDescriptor;
    let destinationDescriptor;
    try {
      sourceDescriptor = openSync(
        sourcePath,
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
      );
      const openedBefore = fstatSync(sourceDescriptor, {
        bigint: true,
      });
      if (
        !openedBefore.isFile() ||
        openedBefore.dev !== before.dev ||
        openedBefore.ino !== before.ino ||
        openedBefore.nlink !== 1n
      ) {
        fail(`.omc snapshot source file identity가 변경되었습니다: ${relativePath}`);
      }
      const content = readFileSync(sourceDescriptor);
      const openedAfter = fstatSync(sourceDescriptor, {
        bigint: true,
      });
      if (
        !sameStatIdentity(openedBefore, openedAfter) ||
        BigInt(content.length) !== openedAfter.size
      ) {
        fail(`.omc snapshot 중 source file이 변경되었습니다: ${relativePath}`);
      }

      try {
        destinationDescriptor = openSync(
          destinationPath,
          fsConstants.O_WRONLY |
            fsConstants.O_CREAT |
            fsConstants.O_EXCL |
            (fsConstants.O_NOFOLLOW ?? 0),
          PRIVATE_FILE_MODE,
        );
      } catch (error) {
        if (error?.code === "EEXIST") {
          fail("generation payload destination collision이 발생해 overwrite하지 않습니다.");
        }
        throw error;
      }
      writeFileSync(destinationDescriptor, content);
      fchmodSync(destinationDescriptor, modeBits(before));
      fsyncSync(destinationDescriptor);
      const destinationStats = fstatSync(destinationDescriptor, {
        bigint: true,
      });
      if (
        !destinationStats.isFile() ||
        destinationStats.dev !== expectedDevice ||
        destinationStats.ino === before.ino ||
        destinationStats.nlink !== 1n ||
        destinationStats.size !== BigInt(content.length)
      ) {
        fail("sealed snapshot file이 helper-owned 새 inode가 아닙니다.");
      }
    } finally {
      if (destinationDescriptor !== undefined) {
        closeSync(destinationDescriptor);
      }
      if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    }
    syncDirectory(dirname(destinationPath));
    const after = lstatSync(sourcePath, { bigint: true });
    if (!sameStatIdentity(before, after)) {
      fail(`.omc snapshot 뒤 source file path가 변경되었습니다: ${relativePath}`);
    }
  }

  copyEntry(source, destination, "");
  return scanOmcDirectory(destination, expectedDevice);
}

function validatePrivateDirectory(path, expectedDevice) {
  const stats = pathState(path);
  if (!stats) return false;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    modeBits(stats) !== PRIVATE_DIRECTORY_MODE
  ) {
    fail(`archive 디렉터리는 symlink가 아닌 0700 디렉터리여야 합니다: ${path}`);
  }
  if (stats.dev !== expectedDevice) {
    fail("archive 디렉터리와 Git common dir의 filesystem이 다릅니다.");
  }
  return true;
}

function readPrivateJson(path, label) {
  const stats = pathState(path);
  if (!stats) return null;
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    modeBits(stats) !== PRIVATE_FILE_MODE
  ) {
    fail(`${label}은 symlink가 아닌 0600 일반 파일이어야 합니다.`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label}을 읽을 수 없습니다: ${error.message}`);
  }
}

function ensurePrivateDirectory(path, expectedDevice) {
  let created = false;
  try {
    mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  validatePrivateDirectory(path, expectedDevice);
  if (created) syncDirectory(dirname(path));
}

function writeExclusiveJson(path, value, label) {
  const directory = dirname(path);
  const expectedDevice = lstatSync(directory, { bigint: true }).dev;
  const finalName = basename(path);
  const existing = readPrivateJson(path, label);
  if (existing) {
    if (stableJson(existing) !== stableJson(value)) {
      fail(`${label} collision 또는 내용 불일치가 있습니다.`);
    }
    return;
  }

  const pendingPath = join(
    directory,
    `.${finalName}.pending-${randomBytes(32).toString("hex")}`,
  );
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    (fsConstants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(pendingPath, flags, PRIVATE_FILE_MODE);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  validatePendingJson(pendingPath, expectedDevice, label);

  const publication = atomicRenameNoReplace(pendingPath, path, label);
  if (publication === "exists") {
    const current = readPrivateJson(path, label);
    if (stableJson(current) !== stableJson(value)) {
      fail(`${label} collision 또는 내용 불일치가 있습니다.`);
    }
    if (pathState(pendingPath)) unlinkSync(pendingPath);
  }
  syncDirectory(directory);

  const written = readPrivateJson(path, label);
  if (stableJson(written) !== stableJson(value)) {
    fail(`${label}을 atomic no-replace publish 뒤 재검증하지 못했습니다.`);
  }
  for (const pending of pendingJsonFiles(
    directory,
    finalName,
    expectedDevice,
    label,
  )) {
    try {
      unlinkSync(pending.path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  syncDirectory(directory);
}

function normalizeInput(input) {
  const issue = String(input.issue ?? "");
  const pullRequest = String(input.pullRequest ?? input.pr ?? "");
  const branch = String(input.branch ?? "");
  const head = String(input.head ?? "").toLowerCase();
  let repository;
  try {
    repository = canonicalRepository(input.repo ?? input.repository);
  } catch {
    throw new UsageError(
      "`--repo`에는 credential이 없는 `OWNER/REPO` 저장소가 필요합니다.",
    );
  }
  if (!POSITIVE_INTEGER_PATTERN.test(issue)) {
    throw new UsageError("`--issue`에는 양의 정수가 필요합니다.");
  }
  if (!POSITIVE_INTEGER_PATTERN.test(pullRequest)) {
    throw new UsageError("`--pr`에는 양의 정수가 필요합니다.");
  }
  if (!HEAD_PATTERN.test(head)) {
    throw new UsageError("`--head`에는 40자리 Git OID가 필요합니다.");
  }
  const branchPattern = new RegExp(
    `^work/issue-${issue}-[a-z0-9]+(?:-[a-z0-9]+)*$`,
  );
  if (
    !branch ||
    branch.length > 120 ||
    /[\r\n]/.test(branch) ||
    !branchPattern.test(branch)
  ) {
    throw new UsageError(
      `\`--branch\`는 work/issue-${issue}-<short-slug> 형식으로 \`--issue\`와 결속되어야 합니다.`,
    );
  }
  if (!input.issueWorktree || !input.mainWorktree) {
    throw new UsageError("issue worktree와 main worktree 경로가 모두 필요합니다.");
  }
  return {
    issue: Number(issue),
    pullRequest: Number(pullRequest),
    branch,
    head,
    repository,
    issueWorktree: canonicalPath(input.issueWorktree),
    mainWorktree: canonicalPath(input.mainWorktree),
  };
}

function readExpectedOrigin(mainWorktree, repository) {
  let origin;
  try {
    origin = readOriginRemoteConfiguration((arguments_) =>
      runGit(mainWorktree, arguments_),
    );
  } catch (error) {
    if (error instanceof FinalizeRemoteBranchError) {
      fail(error.message);
    }
    fail("canonical origin fetch·push 설정을 안전하게 읽지 못했습니다.");
  }
  if (
    origin.fetchRepository !== repository ||
    origin.pushRepository !== repository
  ) {
    fail(
      "origin fetch와 push URL은 explicit same-repository cleanup 저장소에 귀속되어야 합니다.",
    );
  }
  return {
    remote: "origin",
    repository,
    fetchFingerprint: origin.fetchFingerprint,
    pushFingerprint: origin.pushFingerprint,
  };
}

function assertExactOrigin(plan) {
  const current = readExpectedOrigin(plan.mainWorktree, plan.repository);
  if (stableJson(current) !== stableJson(plan.originIdentity)) {
    fail(
      "canonical origin fetch·push URL fingerprint가 cleanup plan과 다릅니다.",
    );
  }
}

function buildCleanupPlanWithOriginCanary(rawInput, expectedPlan) {
  assertExactOrigin(expectedPlan);
  const current = buildCleanupPlan(rawInput);
  if (
    stableJson(current.originIdentity) !==
    stableJson(expectedPlan.originIdentity)
  ) {
    fail(
      "현재 cleanup execute 중 canonical origin fetch·push fingerprint가 변경되었습니다.",
    );
  }
  assertExactOrigin(current);
  return current;
}

function writeExclusiveJsonWithOrigin(
  plan,
  path,
  value,
  label,
) {
  assertExactOrigin(plan);
  writeExclusiveJson(path, value, label);
  assertExactOrigin(plan);
}

function ensurePrivateDirectoryWithOrigin(plan, path) {
  assertExactOrigin(plan);
  ensurePrivateDirectory(path, plan.commonDevice);
  assertExactOrigin(plan);
}

function validateIdentityArchive(paths, expectedIdentity, commonDevice) {
  const rootExists = validatePrivateDirectory(paths.archiveRoot, commonDevice);
  const versionExists = validatePrivateDirectory(paths.versionRoot, commonDevice);
  const archiveExists = validatePrivateDirectory(
    paths.archiveDirectory,
    commonDevice,
  );
  if ((!rootExists && (versionExists || archiveExists)) || (!versionExists && archiveExists)) {
    fail("archive hierarchy가 불완전합니다.");
  }
  const identity = readPrivateJson(paths.identityFile, "archive identity.json");
  if (identity && stableJson(identity) !== stableJson(expectedIdentity)) {
    fail("archive identity collision 또는 core identity 불일치가 있습니다.");
  }
  if (archiveExists) {
    const pendingIdentity = pendingJsonFiles(
      paths.archiveDirectory,
      "identity.json",
      commonDevice,
      "archive identity.json",
    );
    const allowed = new Set([
      "identity.json",
      "generations",
      "intents",
      "snapshot-scratch",
      "worktree-quarantine",
      ...pendingIdentity.map((entry) => entry.name),
    ]);
    const unexpected = readdirSync(paths.archiveDirectory).filter(
      (name) => !allowed.has(name),
    );
    if (unexpected.length > 0) {
      fail("archive identity 디렉터리에 알 수 없는 항목이 있습니다.");
    }
  }
  if (
    !identity &&
    (pathState(paths.generationsDirectory) ||
      pathState(paths.intentsDirectory) ||
      pathState(paths.snapshotScratchDirectory) ||
      pathState(paths.quarantineDirectory))
  ) {
    fail("identity.json 없는 generation archive 또는 intent는 사용할 수 없습니다.");
  }
  return {
    rootExists,
    versionExists,
    archiveExists,
    identityExists: Boolean(identity),
    pendingIdentity:
      archiveExists
        ? pendingJsonFiles(
            paths.archiveDirectory,
            "identity.json",
            commonDevice,
            "archive identity.json",
          )
        : [],
  };
}

function payloadProofShape(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = {
    device: value.device,
    inode: value.inode,
    snapshotDigest: value.snapshotDigest,
    treeDigest: value.treeDigest,
    contentDigest: value.contentDigest,
  };
  if (
    stableJson(value) !== stableJson(normalized) ||
    !/^[0-9]+$/.test(String(value.device)) ||
    !/^[0-9]+$/.test(String(value.inode)) ||
    !HASH_PATTERN.test(String(value.snapshotDigest)) ||
    !HASH_PATTERN.test(String(value.treeDigest)) ||
    !HASH_PATTERN.test(String(value.contentDigest))
  ) {
    return null;
  }
  return normalized;
}

function payloadSeal(proof) {
  return {
    device: proof.device,
    inode: proof.inode,
    treeDigest: proof.treeDigest,
    contentDigest: proof.contentDigest,
  };
}

function payloadSealShape(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = {
    device: value.device,
    inode: value.inode,
    treeDigest: value.treeDigest,
    contentDigest: value.contentDigest,
  };
  if (
    stableJson(value) !== stableJson(normalized) ||
    !/^[0-9]+$/.test(String(value.device)) ||
    !/^[0-9]+$/.test(String(value.inode)) ||
    !HASH_PATTERN.test(String(value.treeDigest)) ||
    !HASH_PATTERN.test(String(value.contentDigest))
  ) {
    return null;
  }
  return normalized;
}

function rootIdentity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  };
}

function rootIdentityShape(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = {
    device: value.device,
    inode: value.inode,
  };
  if (
    stableJson(value) !== stableJson(normalized) ||
    !/^[0-9]+$/.test(String(value.device)) ||
    !/^[0-9]+$/.test(String(value.inode))
  ) {
    return null;
  }
  return normalized;
}

function exactLocalFileProofShape(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = {
    path: value.path,
    device: value.device,
    inode: value.inode,
    mode: value.mode,
    size: value.size,
    contentDigest: value.contentDigest,
  };
  if (
    stableJson(value) !== stableJson(normalized) ||
    !isAbsolute(String(value.path)) ||
    !/^[0-9]+$/.test(String(value.device)) ||
    !/^[0-9]+$/.test(String(value.inode)) ||
    !Number.isInteger(value.mode) ||
    value.mode < 0 ||
    value.mode > 0o7777 ||
    !/^[0-9]+$/.test(String(value.size)) ||
    !HASH_PATTERN.test(String(value.contentDigest))
  ) {
    return null;
  }
  return normalized;
}

function readExactLocalFileProof(path, expectedDevice, label) {
  const before = pathState(path);
  if (
    !before ||
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.dev !== expectedDevice
  ) {
    fail(`${label}은 same-filesystem symlink가 아닌 일반 파일이어야 합니다.`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const openedBefore = fstatSync(descriptor, { bigint: true });
    if (
      !openedBefore.isFile() ||
      openedBefore.dev !== before.dev ||
      openedBefore.ino !== before.ino
    ) {
      fail(`${label}의 path와 open FD identity가 다릅니다.`);
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const after = pathState(path);
    if (
      !after ||
      !sameStatIdentity(openedBefore, openedAfter) ||
      !sameStatIdentity(before, after) ||
      BigInt(bytes.length) !== openedAfter.size
    ) {
      fail(`${label}을 읽는 동안 file identity 또는 bytes가 변경되었습니다.`);
    }
    return {
      path,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      mode: modeBits(before),
      size: before.size.toString(),
      contentDigest: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertExactLocalFileProof(path, expected, label) {
  if (!exactLocalFileProofShape(expected)) {
    fail(`${label}의 durable file proof 계약이 올바르지 않습니다.`);
  }
  const current = readExactLocalFileProof(
    path,
    BigInt(expected.device),
    label,
  );
  if (
    stableJson(current) !==
    stableJson({
      ...expected,
      path,
    })
  ) {
    fail(`${label}의 device·inode·mode·byte digest가 durable intent와 다릅니다.`);
  }
  return current;
}

function readSnapshotAttempt(
  path,
  archiveKey,
  generationId,
) {
  const value = readPrivateJson(path, "snapshot attempt");
  if (!value) return null;
  const required = {
    schema: SNAPSHOT_ATTEMPT_SCHEMA,
    archiveKey,
    generation: generationId,
    intentDigest: value.intentDigest,
    scratch: value.scratch,
    pending: "pending.omc",
    payload: "current.omc",
    root: value.root,
  };
  if (
    stableJson(value) !== stableJson(required) ||
    !HASH_PATTERN.test(String(value.intentDigest)) ||
    !/^[0-9a-f]{64}\.omc$/.test(String(value.scratch)) ||
    !rootIdentityShape(value.root)
  ) {
    fail("snapshot attempt 계약 또는 root ownership이 올바르지 않습니다.");
  }
  return value;
}

function readSnapshotMetadata(
  path,
  label,
  schema,
  archiveKey,
  generationId,
  withProof = false,
) {
  const value = readPrivateJson(path, label);
  if (!value) return null;
  const required = {
    schema,
    archiveKey,
    generation: generationId,
    intentDigest: value.intentDigest,
    attemptDigest: value.attemptDigest,
    pending: "pending.omc",
    payload: "current.omc",
    ...(withProof ? { payloadSeal: value.payloadSeal } : {}),
  };
  if (
    stableJson(value) !== stableJson(required) ||
    !HASH_PATTERN.test(String(value.intentDigest)) ||
    !HASH_PATTERN.test(String(value.attemptDigest)) ||
    (withProof && !payloadSealShape(value.payloadSeal))
  ) {
    fail(`${label} 계약 또는 identity가 올바르지 않습니다.`);
  }
  return value;
}

function readSnapshotScratchInventory(paths, commonDevice) {
  const directoryStats = pathState(paths.snapshotScratchDirectory);
  if (!directoryStats) return [];
  validatePrivateDirectory(
    paths.snapshotScratchDirectory,
    commonDevice,
  );
  return readdirSync(paths.snapshotScratchDirectory)
    .sort()
    .map((name) => {
      if (!/^[0-9a-f]{64}\.omc$/.test(name)) {
        fail("snapshot scratch에 strict nonce 형식이 아닌 항목이 있습니다.");
      }
      const path = join(paths.snapshotScratchDirectory, name);
      const stats = lstatSync(path, { bigint: true });
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.dev !== commonDevice
      ) {
        fail(
          "snapshot scratch root는 같은 filesystem의 0700 일반 디렉터리여야 합니다.",
        );
      }
      return {
        name,
        path,
        stats,
        proof: scanOmcDirectory(path, commonDevice),
      };
    });
}

function readGenerationArchive(paths, archiveKey, commonDevice) {
  const scratchInventory = readSnapshotScratchInventory(
    paths,
    commonDevice,
  );
  const scratchByName = new Map(
    scratchInventory.map((entry) => [entry.name, entry]),
  );
  const claimedScratchNames = new Set();
  const generationsStats = pathState(paths.generationsDirectory);
  if (!generationsStats) {
    return {
      generations: [],
      incomplete: [],
      head: null,
      unboundScratch: scratchInventory,
    };
  }
  validatePrivateDirectory(paths.generationsDirectory, commonDevice);

  const generations = [];
  const incomplete = [];
  for (const generationId of readdirSync(paths.generationsDirectory).sort()) {
    if (!HASH_PATTERN.test(generationId)) {
      fail("generation archive에 형식이 잘못된 항목이 있습니다.");
    }
    const directory = join(paths.generationsDirectory, generationId);
    validatePrivateDirectory(directory, commonDevice);
    const pendingReceipts = pendingJsonFiles(
      directory,
      "generation.json",
      commonDevice,
      "generation.json",
    );
    const pendingSnapshotAttempts = pendingJsonFiles(
      directory,
      "snapshot-attempt.json",
      commonDevice,
      "snapshot attempt",
    );
    const pendingSnapshotCompletes = pendingJsonFiles(
      directory,
      "snapshot-complete.json",
      commonDevice,
      "snapshot complete",
    );
    const pendingSnapshotFailures = pendingJsonFiles(
      directory,
      "snapshot-failed.json",
      commonDevice,
      "snapshot failed",
    );
    const receiptPath = join(directory, "generation.json");
    const payload = join(directory, "current.omc");
    const pendingPayload = join(directory, "pending.omc");
    const snapshotAttemptPath = join(
      directory,
      "snapshot-attempt.json",
    );
    const snapshotCompletePath = join(
      directory,
      "snapshot-complete.json",
    );
    const snapshotFailedPath = join(
      directory,
      "snapshot-failed.json",
    );
    const allowed = new Set([
      "generation.json",
      "current.omc",
      "pending.omc",
      "snapshot-attempt.json",
      "snapshot-complete.json",
      "snapshot-failed.json",
      ...pendingReceipts.map((entry) => entry.name),
      ...pendingSnapshotAttempts.map((entry) => entry.name),
      ...pendingSnapshotCompletes.map((entry) => entry.name),
      ...pendingSnapshotFailures.map((entry) => entry.name),
    ]);
    const unexpected = readdirSync(directory).filter(
      (name) => !allowed.has(name),
    );
    if (unexpected.length > 0) {
      fail("generation container에 알 수 없는 항목이 있습니다.");
    }
    const attempt = readSnapshotAttempt(
      snapshotAttemptPath,
      archiveKey,
      generationId,
    );
    let scratchEntry = null;
    if (attempt) {
      if (claimedScratchNames.has(attempt.scratch)) {
        fail("하나의 snapshot scratch root를 여러 attempt가 참조합니다.");
      }
      claimedScratchNames.add(attempt.scratch);
      scratchEntry = scratchByName.get(attempt.scratch) ?? null;
    }
    const completedSnapshot = readSnapshotMetadata(
      snapshotCompletePath,
      "snapshot complete",
      SNAPSHOT_COMPLETE_SCHEMA,
      archiveKey,
      generationId,
      true,
    );
    const failedSnapshot = readSnapshotMetadata(
      snapshotFailedPath,
      "snapshot failed",
      SNAPSHOT_FAILED_SCHEMA,
      archiveKey,
      generationId,
      true,
    );
    if (
      (completedSnapshot || failedSnapshot) &&
      !attempt
    ) {
      fail("snapshot outcome에 대응하는 durable attempt가 없습니다.");
    }
    if (completedSnapshot && failedSnapshot) {
      fail("snapshot complete와 failed outcome이 동시에 존재합니다.");
    }
    if (
      attempt &&
      [completedSnapshot, failedSnapshot]
        .filter(Boolean)
        .some(
          (outcome) =>
            outcome.intentDigest !== attempt.intentDigest ||
            outcome.attemptDigest !== hashJson(attempt),
        )
    ) {
      fail("snapshot outcome과 exact attempt digest가 다릅니다.");
    }
    const payloadStats = pathState(payload);
    const pendingPayloadStats = pathState(pendingPayload);
    const candidateLocations = [
      scratchEntry
        ? {
            location: "scratch",
            path: scratchEntry.path,
            stats: scratchEntry.stats,
            proof: scratchEntry.proof,
          }
        : null,
      pendingPayloadStats
        ? {
            location: "pending",
            path: pendingPayload,
            stats: pendingPayloadStats,
            proof: null,
          }
        : null,
      payloadStats
        ? {
            location: "current",
            path: payload,
            stats: payloadStats,
            proof: null,
          }
        : null,
    ].filter(Boolean);
    if (candidateLocations.length > 1) {
      fail(
        "snapshot root ownership collision: scratch·pending·current 후보가 동시에 존재합니다.",
      );
    }
    const readPayloadProof = (path, stats, label) => {
      if (!stats) return null;
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.dev !== commonDevice
      ) {
        fail(`${label}가 올바른 same-filesystem 디렉터리가 아닙니다.`);
      }
      return scanOmcDirectory(path, commonDevice);
    };
    const proof = readPayloadProof(
      payload,
      payloadStats,
      "generation payload",
    );
    const pendingProof = readPayloadProof(
      pendingPayload,
      pendingPayloadStats,
      "pending snapshot",
    );
    if (candidateLocations[0]?.location === "pending") {
      candidateLocations[0].proof = pendingProof;
    } else if (candidateLocations[0]?.location === "current") {
      candidateLocations[0].proof = proof;
    }
    const candidate = candidateLocations[0] ?? null;
    if (attempt) {
      if (!candidate) {
        fail("durable snapshot attempt의 owned root가 사라졌습니다.");
      }
      if (
        candidate.stats.dev.toString() !== attempt.root.device ||
        candidate.stats.ino.toString() !== attempt.root.inode
      ) {
        fail(
          "snapshot candidate root가 durable attempt의 exact ownership과 다릅니다.",
        );
      }
    }
    const outcome = completedSnapshot ?? failedSnapshot;
    const candidateProof = candidate?.proof ?? null;
    const outcomeLocationAllowed =
      failedSnapshot && !completedSnapshot
        ? ["scratch", "pending", "current"].includes(
            candidate?.location,
          )
        : ["pending", "current"].includes(candidate?.location);
    if (
      outcome &&
      (!attempt ||
        !outcomeLocationAllowed ||
        !candidateProof ||
        stableJson(payloadSeal(candidateProof)) !==
          stableJson(outcome.payloadSeal))
    ) {
      fail(
        "archived payload의 current proof가 snapshot outcome의 sealed payload proof와 다릅니다.",
      );
    }
    const receipt = readPrivateJson(receiptPath, "generation.json");
    if (!receipt) {
      const emptyCurrentWithoutAttempt =
        Boolean(payloadStats) &&
        !pendingPayloadStats &&
        readdirSync(payload).length === 0 &&
        !attempt;
      if (
        (payloadStats || pendingPayloadStats) &&
        !attempt &&
        !emptyCurrentWithoutAttempt
      ) {
        fail(
          "receipt 없는 snapshot payload에 durable helper attempt가 없습니다.",
        );
      }
      if (
        payloadStats &&
        !completedSnapshot &&
        !failedSnapshot &&
        !emptyCurrentWithoutAttempt
      ) {
        fail(
          "final receipt-less payload에 complete 또는 failed outcome이 없습니다.",
        );
      }
      if (
        !payloadStats &&
        (completedSnapshot || failedSnapshot) &&
        !pendingPayloadStats &&
        !scratchEntry
      ) {
        fail("snapshot outcome에 대응하는 payload가 없습니다.");
      }
      incomplete.push({
        id: generationId,
        directory,
        receiptPath,
        payload,
        pendingPayload,
        snapshotAttemptPath,
        snapshotCompletePath,
        snapshotFailedPath,
        attempt,
        completedSnapshot,
        failedSnapshot,
        payloadStats,
        pendingPayloadStats,
        scratchPayloadStats: scratchEntry?.stats ?? null,
        scratchPayload: scratchEntry?.path ?? null,
        candidateLocation: candidate?.location ?? null,
        candidatePath: candidate?.path ?? null,
        proof,
        pendingProof,
        scratchProof: scratchEntry?.proof ?? null,
        candidateProof,
        pendingReceipts,
        pendingSnapshotAttempts,
        pendingSnapshotCompletes,
        pendingSnapshotFailures,
      });
      continue;
    }
    const required = {
      schema: GENERATION_SCHEMA,
      archiveKey,
      generation: generationId,
      previous: receipt.previous,
      kind: receipt.kind,
      payload: "current.omc",
      payloadProof: receipt.payloadProof,
      intentDigest: receipt.intentDigest,
      attemptDigest: receipt.attemptDigest,
      snapshotDisposition: receipt.snapshotDisposition,
    };
    if (
      stableJson(receipt) !== stableJson(required) ||
      !["preserved", "empty", "orphan"].includes(receipt.kind) ||
      (receipt.previous !== null && !HASH_PATTERN.test(receipt.previous)) ||
      !payloadProofShape(receipt.payloadProof) ||
      !HASH_PATTERN.test(String(receipt.intentDigest)) ||
      !(
        receipt.attemptDigest === null ||
        HASH_PATTERN.test(String(receipt.attemptDigest))
      ) ||
      !["complete", "partial", "failed-empty", "empty"].includes(
        receipt.snapshotDisposition,
      ) ||
      (receipt.kind === "preserved" &&
        (receipt.snapshotDisposition !== "complete" ||
          receipt.attemptDigest === null)) ||
      (receipt.kind === "empty" &&
        (receipt.snapshotDisposition !== "empty" ||
          receipt.attemptDigest !== null)) ||
      (receipt.kind === "orphan" &&
        (!["partial", "failed-empty", "empty"].includes(
          receipt.snapshotDisposition,
        ) ||
          (["partial", "failed-empty"].includes(
            receipt.snapshotDisposition,
          ) &&
            receipt.attemptDigest === null) ||
          (receipt.snapshotDisposition === "empty" &&
            receipt.attemptDigest !== null)))
    ) {
      fail("generation.json 계약 또는 identity가 올바르지 않습니다.");
    }
    if (pendingPayloadStats) {
      fail("generation receipt와 pending snapshot이 동시에 존재합니다.");
    }
    if (scratchEntry) {
      fail("완료 generation에 bound snapshot scratch root가 남아 있습니다.");
    }
    if (payloadStats) {
      if (
        !payloadStats.isDirectory() ||
        payloadStats.isSymbolicLink() ||
        payloadStats.dev !== commonDevice ||
        payloadStats.dev.toString() !== receipt.payloadProof.device ||
        payloadStats.ino.toString() !== receipt.payloadProof.inode
      ) {
        fail("generation payload inode가 receipt와 일치하지 않습니다.");
      }
      if (
        stableJson(payloadSeal(proof)) !==
        stableJson(payloadSeal(receipt.payloadProof))
      ) {
        fail(
          "archived payload의 current proof가 generation receipt의 sealed payload proof와 다릅니다.",
        );
      }
    }
    if (
      receipt.snapshotDisposition === "complete" &&
      (!attempt ||
        receipt.attemptDigest !== hashJson(attempt) ||
        !completedSnapshot ||
        failedSnapshot ||
        pendingSnapshotFailures.length > 0 ||
        stableJson(completedSnapshot.payloadSeal) !==
          stableJson(payloadSeal(receipt.payloadProof)))
    ) {
      fail("complete generation receipt에 exact snapshot outcome이 없습니다.");
    }
    if (
      receipt.snapshotDisposition === "partial" &&
      (!attempt ||
        receipt.attemptDigest !== hashJson(attempt) ||
        completedSnapshot ||
        !failedSnapshot ||
        !payloadStats ||
        readdirSync(payload).length === 0 ||
        pendingSnapshotCompletes.length > 0 ||
        stableJson(failedSnapshot.payloadSeal) !==
          stableJson(payloadSeal(receipt.payloadProof)))
    ) {
      fail("partial orphan receipt에 exact failed snapshot outcome이 없습니다.");
    }
    if (
      receipt.snapshotDisposition === "failed-empty" &&
      (!attempt ||
        receipt.attemptDigest !== hashJson(attempt) ||
        completedSnapshot ||
        !failedSnapshot ||
        !payloadStats ||
        readdirSync(payload).length !== 0 ||
        pendingSnapshotCompletes.length > 0 ||
        stableJson(failedSnapshot.payloadSeal) !==
          stableJson(payloadSeal(receipt.payloadProof)))
    ) {
      fail("failed-empty orphan receipt에 exact empty failed outcome이 없습니다.");
    }
    if (
      receipt.snapshotDisposition === "empty" &&
      (attempt ||
        completedSnapshot ||
        failedSnapshot ||
        pendingSnapshotAttempts.length > 0 ||
        pendingSnapshotCompletes.length > 0 ||
        pendingSnapshotFailures.length > 0)
    ) {
      fail("empty generation에 snapshot attempt metadata가 존재합니다.");
    }
    generations.push({
      id: generationId,
      directory,
      receiptPath,
      payload,
      pendingPayload,
      snapshotAttemptPath,
      snapshotCompletePath,
      snapshotFailedPath,
      attempt,
      completedSnapshot,
      failedSnapshot,
      receipt,
      payloadStats,
      proof,
      pendingReceipts,
      pendingSnapshotAttempts,
      pendingSnapshotCompletes,
      pendingSnapshotFailures,
    });
  }

  if (incomplete.length > 1) {
    fail("receipt 없는 generation container가 둘 이상이라 복구 대상을 확정할 수 없습니다.");
  }
  const unboundScratch = scratchInventory.filter(
    (entry) => !claimedScratchNames.has(entry.name),
  );
  if (
    unboundScratch.some(
      (entry) =>
        modeBits(entry.stats) !== PRIVATE_DIRECTORY_MODE ||
        readdirSync(entry.path).length !== 0,
    )
  ) {
    fail("unpublished snapshot scratch root는 exact empty inert residue여야 합니다.");
  }
  if (generations.length === 0) {
    return { generations, incomplete, head: null, unboundScratch };
  }
  const byId = new Map(generations.map((entry) => [entry.id, entry]));
  const referenced = new Set();
  let roots = 0;
  for (const entry of generations) {
    if (entry.receipt.previous === null) {
      roots += 1;
      continue;
    }
    if (!byId.has(entry.receipt.previous)) {
      fail("generation chain의 previous receipt가 존재하지 않습니다.");
    }
    if (referenced.has(entry.receipt.previous)) {
      fail("generation chain이 fork되어 active head를 확정할 수 없습니다.");
    }
    referenced.add(entry.receipt.previous);
  }
  const heads = generations.filter((entry) => !referenced.has(entry.id));
  if (roots !== 1 || heads.length !== 1) {
    fail("generation chain의 root 또는 active head가 유일하지 않습니다.");
  }
  const visited = new Set();
  let cursor = heads[0];
  while (cursor) {
    if (visited.has(cursor.id)) fail("generation chain에 cycle이 있습니다.");
    visited.add(cursor.id);
    cursor =
      cursor.receipt.previous === null
        ? null
        : byId.get(cursor.receipt.previous);
  }
  if (visited.size !== generations.length) {
    fail("generation chain에 연결되지 않은 archive가 있습니다.");
  }
  for (const entry of generations) {
    if (!entry.payloadStats) {
      fail("generation receipt의 sealed payload가 사라졌습니다.");
    }
  }
  return {
    generations,
    incomplete,
    head: heads[0],
    unboundScratch,
  };
}

function readWorktreeResidue(
  issueWorktree,
  activeGeneration,
  gitRunner = (arguments_) =>
    runGit(issueWorktree, arguments_, {
      environment: isolatedGitEnvironment({
        GIT_OPTIONAL_LOCKS: "0",
      }),
    }),
) {
  const ordinary = gitRunner([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (ordinary.length > 0) {
    fail(
      "issue worktree에 tracked·staged 또는 unignored 변경이 있습니다. `.omc` bridge가 unignored이면 `.gitignore`의 root `.omc` 패턴을 확인하세요.",
    );
  }
  const trackedOmc = gitRunner([
    "ls-files",
    "-z",
    "--",
    ":(top).omc",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (trackedOmc.length > 0) {
    fail("`.omc`가 Git index에 추적되어 있어 로컬 상태로 보존할 수 없습니다.");
  }
  const ignored = gitRunner([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
    "--ignore-submodules=none",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (
    ignored.length > 1 ||
    ignored.some((record) => !["!! .omc", "!! .omc/"].includes(record))
  ) {
    fail("issue worktree의 ignored residue는 root `.omc` 하나만 허용합니다.");
  }
  const ignoredPaths = gitRunner([
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
  ]).stdout
    .split("\0")
    .filter(Boolean);
  if (
    ignoredPaths.some(
      (path) => path !== ".omc" && !path.startsWith(".omc/"),
    )
  ) {
    fail("issue worktree의 ignored residue는 root `.omc` 하나만 허용합니다.");
  }

  const source = join(issueWorktree, ".omc");
  const stats = pathState(source);
  if (!stats) {
    if (ignored.length > 0 || ignoredPaths.length > 0) {
      fail("`.omc`가 없는데 ignored residue가 남아 있습니다.");
    }
    return { source, kind: "absent", stats: null, proof: null };
  }
  if (ignored.length !== 1) {
    fail("`.omc`가 정확한 ignored root로 분류되지 않았습니다.");
  }
  if (stats.isSymbolicLink()) {
    if (
      !activeGeneration?.payloadStats ||
      readlinkSync(source) !== activeGeneration.payload
    ) {
      fail("source `.omc` symlink가 helper-owned active payload를 가리키지 않습니다.");
    }
    return {
      source,
      kind: "bridge",
      stats,
      proof: {
        target: activeGeneration.payload,
        device: activeGeneration.receipt.payloadProof.device,
        inode: activeGeneration.receipt.payloadProof.inode,
      },
    };
  }
  if (!stats.isDirectory()) {
    fail("source `.omc`는 일반 디렉터리 또는 exact helper bridge여야 합니다.");
  }
  return {
    source,
    kind: "directory",
    stats,
    proof: null,
  };
}

function readQuarantinedWorktreeResidue(plan) {
  const root = plan.quarantinePlan.rootDestination;
  const originalMetadata = plan.quarantinePlan.intent.metadata.path;
  const quarantinedMetadata =
    plan.quarantinePlan.metadataDestination;
  const originalMetadataStats = pathState(originalMetadata);
  const quarantinedMetadataStats = pathState(quarantinedMetadata);
  if (
    Number(Boolean(originalMetadataStats)) +
      Number(Boolean(quarantinedMetadataStats)) !==
    1
  ) {
    fail(
      "post-move residue canary의 exact current worktree metadata가 유일하지 않습니다.",
    );
  }
  const metadataPath = quarantinedMetadataStats
    ? quarantinedMetadata
    : originalMetadata;
  const indexPath = join(metadataPath, "index");
  const indexStats = pathState(indexPath);
  if (
    !indexStats ||
    !indexStats.isFile() ||
    indexStats.isSymbolicLink() ||
    indexStats.dev.toString() !==
      plan.quarantinePlan.intent.metadata.device
  ) {
    fail("post-move residue canary의 exact linked-worktree index가 없습니다.");
  }
  const indexProof = readExactLocalFileProof(
    indexPath,
    BigInt(plan.quarantinePlan.intent.metadata.device),
    "post-move residue canary의 linked-worktree index",
  );

  const environment = isolatedGitEnvironment({
    GIT_COMMON_DIR: plan.commonDir,
    GIT_DIR: plan.commonDir,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_WORK_TREE: root,
  });

  let rootDescriptor;
  let metadataDescriptor;
  const assertExactPlumbing = () => {
    assertQuarantineDirectoryIdentity(
      pathState(root),
      plan.quarantinePlan.intent.root,
      "post-move residue canary의 quarantined worktree root path",
    );
    assertQuarantineDirectoryIdentity(
      fstatSync(rootDescriptor, { bigint: true }),
      plan.quarantinePlan.intent.root,
      "post-move residue canary의 quarantined worktree root FD",
    );
    assertQuarantineDirectoryIdentity(
      pathState(metadataPath),
      plan.quarantinePlan.intent.metadata,
      "post-move residue canary의 current worktree metadata path",
    );
    assertQuarantineDirectoryIdentity(
      fstatSync(metadataDescriptor, { bigint: true }),
      plan.quarantinePlan.intent.metadata,
      "post-move residue canary의 current worktree metadata FD",
    );
    assertExactLocalFileProof(
      join(root, ".git"),
      plan.quarantinePlan.intent.gitMarker,
      "post-move residue canary의 `.git` marker",
    );
    assertExactLocalFileProof(
      join(metadataPath, "commondir"),
      plan.quarantinePlan.intent.metadataFiles.commondir,
      "post-move residue canary의 metadata `commondir`",
    );
    assertExactLocalFileProof(
      join(metadataPath, "gitdir"),
      plan.quarantinePlan.intent.metadataFiles.gitdir,
      "post-move residue canary의 metadata `gitdir`",
    );
    assertExactLocalFileProof(
      join(metadataPath, "HEAD"),
      plan.quarantinePlan.intent.metadataFiles.head,
      "post-move residue canary의 metadata `HEAD`",
    );
    const currentIndex = pathState(indexPath);
    if (
      !currentIndex ||
      !currentIndex.isFile() ||
      currentIndex.isSymbolicLink() ||
      !sameStatIdentity(indexStats, currentIndex)
    ) {
      fail("post-move residue canary 중 exact linked-worktree index가 변경되었습니다.");
    }
    assertExactLocalFileProof(
      indexPath,
      indexProof,
      "post-move residue canary의 linked-worktree index",
    );
  };
  const exactGit = (arguments_, options = {}) => {
    assertExactPlumbing();
    const result = runGit(root, arguments_, {
      ...options,
      environment,
    });
    assertExactPlumbing();
    return result;
  };

  try {
    rootDescriptor = openSync(
      root,
      fsConstants.O_RDONLY |
        (fsConstants.O_DIRECTORY ?? 0) |
        (fsConstants.O_NOFOLLOW ?? 0),
    );
    metadataDescriptor = openSync(
      metadataPath,
      fsConstants.O_RDONLY |
        (fsConstants.O_DIRECTORY ?? 0) |
        (fsConstants.O_NOFOLLOW ?? 0),
    );
    assertExactPlumbing();

    const probedIndex = exactGit([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    ]).stdout.trim();
    if (
      !probedIndex ||
      realpathSync(probedIndex) !== realpathSync(indexPath)
    ) {
      fail("post-move residue canary의 Git index plumbing이 exact metadata index와 다릅니다.");
    }

    const staged = exactGit(
      [
        "diff-index",
        "--cached",
        "--quiet",
        "--ignore-submodules=none",
        plan.head,
        "--",
      ],
      { allowedStatuses: [0, 1] },
    );
    const tracked = exactGit(
      [
        "diff-files",
        "--patch",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--ignore-submodules=none",
        "--",
      ],
    );
    if (staged.status !== 0 || tracked.stdout.length !== 0) {
      fail(
        "post-move residue canary가 tracked·staged 변경을 발견했습니다.",
      );
    }

    const trackedOmc = exactGit([
      "ls-files",
      "-z",
      "--",
      ":(top).omc",
    ]).stdout
      .split("\0")
      .filter(Boolean);
    if (trackedOmc.length > 0) {
      fail("post-move residue canary에서 `.omc`가 Git index에 추적되어 있습니다.");
    }
    const allUntracked = exactGit([
      "ls-files",
      "--others",
      "--directory",
      "-z",
    ]).stdout
      .split("\0")
      .filter(Boolean);
    if (
      allUntracked.some(
        (path) => ![".omc", ".omc/"].includes(path),
      )
    ) {
      fail(
        "post-move residue canary는 `.omc` 밖의 untracked·ignored residue를 허용하지 않습니다.",
      );
    }

    const source = join(root, ".omc");
    const stats = pathState(source);
    if (!stats) {
      if (allUntracked.length > 0) {
        fail("post-move residue canary에서 `.omc` 없는 residue가 남았습니다.");
      }
      return { source, kind: "absent", stats: null, proof: null };
    }
    const ignored = exactGit(
      ["check-ignore", "--quiet", "--", ".omc"],
      { allowedStatuses: [0, 1] },
    );
    if (ignored.status !== 0) {
      fail("post-move residue canary에서 `.omc`가 exact ignored root가 아닙니다.");
    }
    if (stats.isSymbolicLink()) {
      if (
        !plan.archive.head?.payloadStats ||
        readlinkSync(source) !== plan.archive.head.payload
      ) {
        fail(
          "post-move source `.omc` symlink가 helper-owned active payload를 가리키지 않습니다.",
        );
      }
      return {
        source,
        kind: "bridge",
        stats,
        proof: {
          target: plan.archive.head.payload,
          device:
            plan.archive.head.receipt.payloadProof.device,
          inode: plan.archive.head.receipt.payloadProof.inode,
        },
      };
    }
    if (!stats.isDirectory()) {
      fail("post-move source `.omc`는 일반 디렉터리 또는 exact helper bridge여야 합니다.");
    }
    assertExactPlumbing();
    return {
      source,
      kind: "directory",
      stats,
      proof: null,
    };
  } finally {
    if (metadataDescriptor !== undefined) closeSync(metadataDescriptor);
    if (rootDescriptor !== undefined) closeSync(rootDescriptor);
  }
}

function generationReceipt({
  archiveKey,
  generation,
  previous,
  kind,
  payloadProof,
  intentDigest,
  attemptDigest,
  snapshotDisposition,
}) {
  return {
    schema: GENERATION_SCHEMA,
    archiveKey,
    generation,
    previous,
    kind,
    payload: "current.omc",
    payloadProof,
    intentDigest,
    attemptDigest,
    snapshotDisposition,
  };
}

function plannedGeneration(paths, archiveKey, previous, kind, sourceProof) {
  const id = hashJson({
    schema: GENERATION_SCHEMA,
    archiveKey,
    previous,
    kind,
    source:
      kind === "preserved"
        ? {
            device: sourceProof.device,
            inode: sourceProof.inode,
            snapshotDigest: sourceProof.snapshotDigest,
            treeDigest: sourceProof.treeDigest,
            contentDigest: sourceProof.contentDigest,
          }
        : null,
  });
  const directory = join(paths.generationsDirectory, id);
  return {
    id,
    directory,
    receiptPath: join(directory, "generation.json"),
    payload: join(directory, "current.omc"),
    pendingPayload: join(directory, "pending.omc"),
    snapshotAttemptPath: join(directory, "snapshot-attempt.json"),
    snapshotCompletePath: join(directory, "snapshot-complete.json"),
    snapshotFailedPath: join(directory, "snapshot-failed.json"),
    intentPath: join(paths.intentsDirectory, `${id}.json`),
    previous,
    kind,
    sourceProof,
  };
}

function generationIntent(archiveKey, generation) {
  return {
    schema: GENERATION_INTENT_SCHEMA,
    archiveKey,
    generation: generation.id,
    previous: generation.previous,
    kind: generation.intentKind ?? generation.kind,
    sourceProof:
      generation.intentSourceProof ?? generation.sourceProof,
  };
}

function snapshotAttempt(archiveKey, generation, scratch, stats) {
  return {
    schema: SNAPSHOT_ATTEMPT_SCHEMA,
    archiveKey,
    generation: generation.id,
    intentDigest: hashJson(generationIntent(archiveKey, generation)),
    scratch,
    pending: "pending.omc",
    payload: "current.omc",
    root: rootIdentity(stats),
  };
}

function snapshotOutcome(
  schema,
  archiveKey,
  generation,
  proof,
  attempt,
) {
  return {
    schema,
    archiveKey,
    generation: generation.id,
    intentDigest: hashJson(generationIntent(archiveKey, generation)),
    attemptDigest: hashJson(attempt),
    pending: "pending.omc",
    payload: "current.omc",
    payloadSeal: payloadSeal(proof),
  };
}

function readGenerationIntents(paths, archiveKey, commonDevice) {
  const stats = pathState(paths.intentsDirectory);
  if (!stats) {
    return { intents: [], pendingMetadata: [] };
  }
  validatePrivateDirectory(paths.intentsDirectory, commonDevice);

  const intentNamePattern = /^([0-9a-f]{64})\.json$/;
  const pendingNamePattern =
    /^\.([0-9a-f]{64})\.json\.pending-[0-9a-f]{64}$/;
  const intents = [];
  const pendingMetadata = [];
  for (const name of readdirSync(paths.intentsDirectory).sort()) {
    const intentMatch = name.match(intentNamePattern);
    if (intentMatch) {
      const id = intentMatch[1];
      const path = join(paths.intentsDirectory, name);
      const intent = readPrivateJson(path, "generation intent");
      if (
        !intent ||
        intent.schema !== GENERATION_INTENT_SCHEMA ||
        intent.archiveKey !== archiveKey ||
        intent.generation !== id ||
        !["preserved", "empty"].includes(intent.kind) ||
        (intent.previous !== null && !HASH_PATTERN.test(intent.previous)) ||
        (intent.kind === "preserved" &&
          (!intent.sourceProof ||
            !/^[0-9]+$/.test(String(intent.sourceProof.device)) ||
            !/^[0-9]+$/.test(String(intent.sourceProof.inode)) ||
            !HASH_PATTERN.test(String(intent.sourceProof.snapshotDigest)) ||
            !HASH_PATTERN.test(String(intent.sourceProof.treeDigest)) ||
            !HASH_PATTERN.test(String(intent.sourceProof.contentDigest)))) ||
        (intent.kind === "empty" && intent.sourceProof !== null)
      ) {
        fail("generation intent 계약 또는 identity가 올바르지 않습니다.");
      }
      const planned = plannedGeneration(
        paths,
        archiveKey,
        intent.previous,
        intent.kind,
        intent.sourceProof,
      );
      const expected = generationIntent(archiveKey, planned);
      if (
        planned.id !== id ||
        stableJson(intent) !== stableJson(expected)
      ) {
        fail("generation intent가 deterministic generation identity와 다릅니다.");
      }
      intents.push({ id, path, intent, planned });
      continue;
    }

    const pendingMatch = name.match(pendingNamePattern);
    if (!pendingMatch) {
      fail("generation intent archive에 형식이 잘못된 항목이 있습니다.");
    }
    const path = join(paths.intentsDirectory, name);
    pendingMetadata.push({
      name,
      path,
      proof: validatePendingJson(
        path,
        commonDevice,
        "generation intent",
      ),
    });
  }
  return { intents, pendingMetadata };
}

function assertGenerationIntentBindings(
  archive,
  intentArchive,
  options = {},
) {
  const intentsById = new Map(
    intentArchive.intents.map((entry) => [entry.id, entry]),
  );
  const generationIds = new Set(
    archive.generations.map((entry) => entry.id),
  );
  for (const generation of archive.generations) {
    const intentEntry = intentsById.get(generation.id);
    if (!intentEntry) {
      fail("generation receipt에 대응하는 durable intent가 없습니다.");
    }
    const intent = intentEntry.intent;
    if (
      intent.previous !== generation.receipt.previous ||
      (generation.receipt.kind !== "orphan" &&
        intent.kind !== generation.receipt.kind) ||
      (generation.receipt.kind === "orphan" &&
        intent.kind !== "preserved")
    ) {
      fail("generation receipt와 durable intent의 chain 또는 kind가 다릅니다.");
    }
    if (generation.receipt.intentDigest !== hashJson(intent)) {
      fail(
        "generation receipt가 exact durable intent digest와 다릅니다.",
      );
    }
    if (
      generation.attempt &&
      generation.attempt.intentDigest !== hashJson(intent)
    ) {
      fail("snapshot attempt가 exact durable intent digest와 다릅니다.");
    }
    if (
      generation.receipt.kind === "preserved" &&
      generation.receipt.payloadProof.contentDigest !==
        intent.sourceProof.contentDigest
    ) {
      fail(
        "preserved generation receipt의 sealed contentDigest가 durable intent와 다릅니다.",
      );
    }
    if (
      generation.receipt.kind === "orphan" &&
      generation.receipt.snapshotDisposition === "empty" &&
      generation.payloadStats &&
      readdirSync(generation.payload).length !== 0
    ) {
      fail("orphan generation payload는 비어 있어야 합니다.");
    }
  }
  for (const incomplete of archive.incomplete) {
    const intentEntry = intentsById.get(incomplete.id);
    if (!intentEntry) {
      fail("receipt 없는 generation container에 durable intent가 없습니다.");
    }
    if (
      incomplete.attempt &&
      incomplete.attempt.intentDigest !== hashJson(intentEntry.intent)
    ) {
      fail("receipt 없는 snapshot attempt가 durable intent와 다릅니다.");
    }
    const hasCandidate = Boolean(
      incomplete.payloadStats ||
        incomplete.pendingPayloadStats ||
        incomplete.scratchPayloadStats,
    );
    if (
      intentEntry.intent.kind === "preserved" &&
      hasCandidate &&
      !incomplete.attempt
    ) {
      fail(
        "preserved intent의 snapshot candidate에 durable root ownership attempt가 없습니다.",
      );
    }
    if (
      intentEntry.intent.kind === "empty" &&
      (incomplete.attempt ||
        incomplete.pendingPayloadStats ||
        incomplete.scratchPayloadStats ||
        (incomplete.payloadStats &&
          readdirSync(incomplete.payload).length !== 0))
    ) {
      fail("empty intent recovery 후보가 exact empty current payload가 아닙니다.");
    }
  }
  const unresolvedIntents = intentArchive.intents.filter(
    (entry) => !generationIds.has(entry.id),
  );
  if (unresolvedIntents.length > 1) {
    fail("완료되지 않은 durable generation intent가 둘 이상입니다.");
  }
  if (
    archive.incomplete.length === 1 &&
    (unresolvedIntents.length !== 1 ||
      unresolvedIntents[0].id !== archive.incomplete[0].id)
  ) {
    fail("receipt 없는 generation container와 unresolved intent가 일치하지 않습니다.");
  }
  if (
    options.requireComplete &&
    (archive.incomplete.length > 0 || unresolvedIntents.length > 0)
  ) {
    fail("archive canary에는 완료되지 않은 generation이 없어야 합니다.");
  }
  return { intentsById, unresolvedIntents };
}

function plannedQuarantine({
  paths,
  archiveKey,
  issueWorktree,
  branch,
  head,
  rootStats,
  metadataPath,
  metadataStats,
  gitMarker,
  metadataCommondir,
  metadataGitdir,
  metadataHead,
}) {
  const identity = {
    schema: QUARANTINE_INTENT_SCHEMA,
    archiveKey,
    issueWorktree,
    branch,
    head,
    root: {
      path: issueWorktree,
      device: rootStats.dev.toString(),
      inode: rootStats.ino.toString(),
      mode: modeBits(rootStats),
    },
    metadata: {
      path: metadataPath,
      device: metadataStats.dev.toString(),
      inode: metadataStats.ino.toString(),
      mode: modeBits(metadataStats),
    },
    gitMarker,
    metadataFiles: {
      commondir: metadataCommondir,
      gitdir: metadataGitdir,
      head: metadataHead,
    },
  };
  const id = hashJson(identity);
  const rootDestination = join(paths.quarantineRootsDirectory, id);
  const metadataDestination = join(
    paths.quarantineMetadataDirectory,
    id,
  );
  const intent = {
    ...identity,
    quarantine: id,
    destinations: {
      root: rootDestination,
      metadata: metadataDestination,
    },
  };
  return {
    id,
    intent,
    intentPath: join(paths.quarantineIntentsDirectory, `${id}.json`),
    rootDestination,
    metadataDestination,
    receiptPath: join(
      paths.quarantineReceiptsDirectory,
      `${id}.json`,
    ),
  };
}

function validateMovedDirectory(
  path,
  expectedDevice,
  expectedInode,
  expectedMode,
  label,
) {
  const stats = pathState(path);
  if (!stats) return null;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.dev !== expectedDevice ||
    stats.ino.toString() !== expectedInode ||
    modeBits(stats) !== expectedMode
  ) {
    fail(`${label}이 expected directory inode와 다릅니다.`);
  }
  return stats;
}

function readQuarantineArchive(paths, archiveKey, commonDevice) {
  const rootState = pathState(paths.quarantineDirectory);
  if (!rootState) {
    return {
      intentEntry: null,
      receipt: null,
      rootDestinationStats: null,
      metadataDestinationStats: null,
      pendingIntentMetadata: [],
      pendingReceiptMetadata: [],
    };
  }
  validatePrivateDirectory(paths.quarantineDirectory, commonDevice);
  const allowedTop = new Set([
    "intents",
    "roots",
    "metadata",
    "receipts",
  ]);
  if (
    readdirSync(paths.quarantineDirectory).some(
      (name) => !allowedTop.has(name),
    )
  ) {
    fail("worktree quarantine archive에 알 수 없는 항목이 있습니다.");
  }
  for (const directory of [
    paths.quarantineIntentsDirectory,
    paths.quarantineRootsDirectory,
    paths.quarantineMetadataDirectory,
    paths.quarantineReceiptsDirectory,
  ]) {
    if (pathState(directory)) {
      validatePrivateDirectory(directory, commonDevice);
    }
  }

  const intentEntries = [];
  const pendingIntentMetadata = [];
  if (pathState(paths.quarantineIntentsDirectory)) {
    for (const name of readdirSync(paths.quarantineIntentsDirectory).sort()) {
      const match = name.match(/^([0-9a-f]{64})\.json$/);
      if (match) {
        const path = join(paths.quarantineIntentsDirectory, name);
        const intent = readPrivateJson(path, "quarantine intent");
        const id = match[1];
        if (
          !intent ||
          intent.schema !== QUARANTINE_INTENT_SCHEMA ||
          intent.archiveKey !== archiveKey ||
          intent.quarantine !== id ||
          intent.destinations?.root !==
            join(paths.quarantineRootsDirectory, id) ||
          intent.destinations?.metadata !==
            join(paths.quarantineMetadataDirectory, id) ||
          !HEAD_PATTERN.test(String(intent.head)) ||
          !/^[0-9]+$/.test(String(intent.root?.device)) ||
          !/^[0-9]+$/.test(String(intent.root?.inode)) ||
          !Number.isInteger(intent.root?.mode) ||
          intent.root.mode < 0 ||
          intent.root.mode > 0o7777 ||
          !/^[0-9]+$/.test(String(intent.metadata?.device)) ||
          !/^[0-9]+$/.test(String(intent.metadata?.inode)) ||
          !Number.isInteger(intent.metadata?.mode) ||
          intent.metadata.mode < 0 ||
          intent.metadata.mode > 0o7777 ||
          !exactLocalFileProofShape(intent.gitMarker) ||
          intent.gitMarker.path !==
            join(intent.issueWorktree, ".git") ||
          !exactLocalFileProofShape(
            intent.metadataFiles?.commondir,
          ) ||
          intent.metadataFiles.commondir.path !==
            join(intent.metadata.path, "commondir") ||
          !exactLocalFileProofShape(
            intent.metadataFiles?.gitdir,
          ) ||
          intent.metadataFiles.gitdir.path !==
            join(intent.metadata.path, "gitdir") ||
          !exactLocalFileProofShape(
            intent.metadataFiles?.head,
          ) ||
          intent.metadataFiles.head.path !==
            join(intent.metadata.path, "HEAD")
        ) {
          fail("quarantine intent 계약 또는 identity가 올바르지 않습니다.");
        }
        const identity = {
          schema: QUARANTINE_INTENT_SCHEMA,
          archiveKey,
          issueWorktree: intent.issueWorktree,
          branch: intent.branch,
          head: intent.head,
          root: intent.root,
          metadata: intent.metadata,
          gitMarker: intent.gitMarker,
          metadataFiles: intent.metadataFiles,
        };
        const expectedIntent = {
          ...identity,
          quarantine: id,
          destinations: {
            root: join(paths.quarantineRootsDirectory, id),
            metadata: join(paths.quarantineMetadataDirectory, id),
          },
        };
        if (
          hashJson(identity) !== id ||
          stableJson(intent) !== stableJson(expectedIntent)
        ) {
          fail("quarantine intent가 deterministic identity와 다릅니다.");
        }
        intentEntries.push({
          id,
          path,
          intent,
          rootDestination: intent.destinations.root,
          metadataDestination: intent.destinations.metadata,
          receiptPath: join(
            paths.quarantineReceiptsDirectory,
            `${id}.json`,
          ),
        });
        continue;
      }
      if (
        !/^\.([0-9a-f]{64})\.json\.pending-[0-9a-f]{64}$/.test(name)
      ) {
        fail("quarantine intent archive에 형식이 잘못된 항목이 있습니다.");
      }
      const path = join(paths.quarantineIntentsDirectory, name);
      pendingIntentMetadata.push({
        name,
        path,
        proof: validatePendingJson(
          path,
          commonDevice,
          "quarantine intent",
        ),
      });
    }
  }
  if (intentEntries.length > 1) {
    fail("quarantine intent가 둘 이상이라 primary worktree를 확정할 수 없습니다.");
  }
  const intentEntry = intentEntries[0] ?? null;

  const rootNames = pathState(paths.quarantineRootsDirectory)
    ? readdirSync(paths.quarantineRootsDirectory)
    : [];
  const metadataNames = pathState(paths.quarantineMetadataDirectory)
    ? readdirSync(paths.quarantineMetadataDirectory)
    : [];
  const receiptNames = pathState(paths.quarantineReceiptsDirectory)
    ? readdirSync(paths.quarantineReceiptsDirectory)
    : [];
  if (!intentEntry) {
    if (
      rootNames.length > 0 ||
      metadataNames.length > 0 ||
      receiptNames.length > 0
    ) {
      fail("durable intent 없는 quarantine payload 또는 receipt가 있습니다.");
    }
    return {
      intentEntry: null,
      receipt: null,
      rootDestinationStats: null,
      metadataDestinationStats: null,
      pendingIntentMetadata,
      pendingReceiptMetadata: [],
    };
  }
  if (
    rootNames.some((name) => name !== intentEntry.id) ||
    metadataNames.some((name) => name !== intentEntry.id)
  ) {
    fail("quarantine payload directory에 identity가 다른 항목이 있습니다.");
  }

  const rootDestinationStats = validateMovedDirectory(
    intentEntry.rootDestination,
    commonDevice,
    intentEntry.intent.root.inode,
    intentEntry.intent.root.mode,
    "quarantined worktree root",
  );
  const metadataDestinationStats = validateMovedDirectory(
    intentEntry.metadataDestination,
    commonDevice,
    intentEntry.intent.metadata.inode,
    intentEntry.intent.metadata.mode,
    "quarantined worktree metadata",
  );

  const pendingReceiptMetadata = [];
  let receipt = null;
  for (const name of receiptNames.sort()) {
    if (name === `${intentEntry.id}.json`) {
      receipt = readPrivateJson(
        join(paths.quarantineReceiptsDirectory, name),
        "quarantine receipt",
      );
      continue;
    }
    if (
      name.match(
        new RegExp(
          `^\\.${intentEntry.id}\\.json\\.pending-[0-9a-f]{64}$`,
        ),
      )
    ) {
      const path = join(paths.quarantineReceiptsDirectory, name);
      pendingReceiptMetadata.push({
        name,
        path,
        proof: validatePendingJson(
          path,
          commonDevice,
          "quarantine receipt",
        ),
      });
      continue;
    }
    fail("quarantine receipt archive에 형식이 잘못된 항목이 있습니다.");
  }

  if (receipt) {
    const expected = {
      schema: QUARANTINE_RECEIPT_SCHEMA,
      archiveKey,
      quarantine: intentEntry.id,
      root: {
        path: intentEntry.rootDestination,
        device: intentEntry.intent.root.device,
        inode: intentEntry.intent.root.inode,
        mode: intentEntry.intent.root.mode,
      },
      metadata: {
        path: intentEntry.metadataDestination,
        device: intentEntry.intent.metadata.device,
        inode: intentEntry.intent.metadata.inode,
        mode: intentEntry.intent.metadata.mode,
      },
    };
    if (stableJson(receipt) !== stableJson(expected)) {
      fail("quarantine receipt가 durable intent와 다릅니다.");
    }
    if (!rootDestinationStats || !metadataDestinationStats) {
      fail("quarantine receipt가 있는데 root 또는 metadata payload가 없습니다.");
    }
  }
  if (metadataDestinationStats && !rootDestinationStats) {
    fail("worktree root보다 metadata가 먼저 quarantine된 모순 상태입니다.");
  }
  return {
    intentEntry,
    receipt,
    rootDestinationStats,
    metadataDestinationStats,
    pendingIntentMetadata,
    pendingReceiptMetadata,
  };
}

function publicPlan(plan) {
  return {
    status: "planned",
    action: plan.action,
    planToken: plan.planToken,
    repository: plan.repository,
    origin: plan.originIdentity,
    archiveKey: plan.archiveKey,
    archiveDirectory: plan.paths.archiveDirectory,
    identityFile: plan.paths.identityFile,
    generationsDirectory: plan.paths.generationsDirectory,
    activeGeneration: plan.activeGeneration?.id ?? null,
    activePayload: plan.activeGeneration?.payload ?? null,
    plannedGeneration: plan.plannedGeneration?.id ?? null,
    plannedPayload: plan.plannedGeneration?.payload ?? null,
    recoveryGeneration: plan.recoveryGeneration?.id ?? null,
    quarantine: plan.quarantinePlan?.id ?? null,
    quarantineRoot: plan.quarantinePlan?.rootDestination ?? null,
    quarantineMetadata:
      plan.quarantinePlan?.metadataDestination ?? null,
    boundedResidue: Boolean(plan.quarantinePlan?.boundedResidue),
    issueRegistered: plan.issueRegistered,
    localRefPresent: Boolean(plan.localRef),
  };
}

export function buildCleanupPlan(rawInput) {
  const input = normalizeInput(rawInput);
  const mainStats = pathState(input.mainWorktree);
  if (!mainStats?.isDirectory() || mainStats.isSymbolicLink()) {
    fail("main worktree는 symlink가 아닌 기존 디렉터리여야 합니다.");
  }
  const originIdentity = readExpectedOrigin(
    input.mainWorktree,
    input.repository,
  );
  const issueStats = pathState(input.issueWorktree);
  if (issueStats && (!issueStats.isDirectory() || issueStats.isSymbolicLink())) {
    fail("issue worktree path는 symlink가 아닌 디렉터리이거나 없어야 합니다.");
  }
  if (input.issueWorktree === input.mainWorktree) {
    fail("issue worktree와 main worktree가 같을 수 없습니다.");
  }
  if (issueStats && isPathInside(canonicalPath(process.cwd()), input.issueWorktree)) {
    fail("cleanup 실행 cwd는 제거할 issue worktree 밖이어야 합니다.");
  }
  runGit(input.mainWorktree, ["check-ref-format", "--branch", input.branch]);

  const mainBranch = gitOutput(input.mainWorktree, ["branch", "--show-current"]);
  const mainHead = gitOutput(input.mainWorktree, ["rev-parse", "HEAD"]).toLowerCase();
  const mainWorktreeIdentity = {
    device: mainStats.dev.toString(),
    inode: mainStats.ino.toString(),
    mode: modeBits(mainStats),
  };
  const mainRef = gitOutput(
    input.mainWorktree,
    ["rev-parse", "refs/heads/main"],
  ).toLowerCase();
  const originMain = gitOutput(
    input.mainWorktree,
    ["rev-parse", "refs/remotes/origin/main"],
  ).toLowerCase();
  if (
    mainBranch !== "main" ||
    mainHead !== mainRef ||
    mainHead !== originMain
  ) {
    fail("main worktree의 branch·HEAD·refs/heads/main·origin/main이 일치해야 합니다.");
  }
  if (
    runGit(input.mainWorktree, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]).stdout
  ) {
    fail("main worktree에 tracked·staged 또는 unignored 변경이 있습니다.");
  }

  const commonDir = realpathSync(
    gitOutput(input.mainWorktree, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  const commonStats = lstatSync(commonDir, { bigint: true });
  if (!commonStats.isDirectory() || commonStats.isSymbolicLink()) {
    fail("Git common dir는 symlink가 아닌 일반 디렉터리여야 합니다.");
  }
  const worktrees = readWorktrees(input.mainWorktree);
  const mainRecords = worktrees.filter(
    (record) => record.canonicalPath === input.mainWorktree,
  );
  const mainBranchRecords = worktrees.filter(
    (record) => record.branch === "refs/heads/main",
  );
  if (
    mainRecords.length !== 1 ||
    mainBranchRecords.length !== 1 ||
    mainRecords[0] !== mainBranchRecords[0] ||
    mainRecords[0].HEAD !== mainHead ||
    mainRecords[0].locked ||
    mainRecords[0].prunable
  ) {
    fail("main worktree 등록 정보가 exact main identity와 일치하지 않습니다.");
  }

  const branchRef = `refs/heads/${input.branch}`;
  const branchRecords = worktrees.filter(
    (record) => record.branch === branchRef,
  );
  const pathRecords = worktrees.filter(
    (record) => record.canonicalPath === input.issueWorktree,
  );
  if (
    branchRecords.length > 1 ||
    pathRecords.length > 1 ||
    (branchRecords.length === 1 &&
      branchRecords[0].canonicalPath !== input.issueWorktree) ||
    (pathRecords.length === 1 && pathRecords[0].branch !== branchRef)
  ) {
    fail("issue worktree의 branch·path 소유권이 유일하지 않습니다.");
  }
  const issueRecord =
    branchRecords.length === 1 && pathRecords.length === 1
      ? branchRecords[0]
      : null;
  if (!issueRecord && (branchRecords.length > 0 || pathRecords.length > 0)) {
    fail("issue worktree 등록 정보가 모순됩니다.");
  }
  const localRef = readLocalRef(input.mainWorktree, branchRef);
  if (
    issueRecord &&
    issueRecord.HEAD !== input.head
  ) {
    fail("issue worktree 등록 정보가 exact head와 일치하지 않습니다.");
  }
  let issueGitIdentity = null;
  if (issueRecord) {
    if (localRef !== input.head) {
      fail("issue worktree local ref가 validated head와 일치하지 않습니다.");
    }
    const gitMarker = issueStats
      ? pathState(join(input.issueWorktree, ".git"))
      : null;
    if (
      issueStats &&
      gitMarker?.isFile() &&
      !gitMarker.isSymbolicLink()
    ) {
      if (issueRecord.locked || issueRecord.prunable) {
        fail("initial issue worktree registration은 unlocked·non-prunable이어야 합니다.");
      }
      if (
        gitOutput(input.issueWorktree, ["rev-parse", "HEAD"]).toLowerCase() !==
          input.head ||
        gitOutput(input.issueWorktree, ["branch", "--show-current"]) !==
          input.branch
      ) {
        fail("issue worktree HEAD·branch가 validated head와 일치하지 않습니다.");
      }
      const issueCommon = realpathSync(
        gitOutput(input.issueWorktree, [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ]),
      );
      if (issueCommon !== commonDir) {
        fail("issue worktree와 main worktree의 Git common dir가 다릅니다.");
      }
      const metadataPath = realpathSync(
        gitOutput(input.issueWorktree, [
          "rev-parse",
          "--path-format=absolute",
          "--git-dir",
        ]),
      );
      const worktreesAdmin = realpathSync(join(commonDir, "worktrees"));
      if (
        dirname(metadataPath) !== worktreesAdmin ||
        metadataPath === worktreesAdmin
      ) {
        fail("issue worktree metadata가 exact Git common worktrees 아래에 있지 않습니다.");
      }
      const metadataStats = lstatSync(metadataPath, { bigint: true });
      if (
        !metadataStats.isDirectory() ||
        metadataStats.isSymbolicLink() ||
        metadataStats.dev !== commonStats.dev
      ) {
        fail("issue worktree metadata가 같은 filesystem의 일반 디렉터리가 아닙니다.");
      }
      issueGitIdentity = {
        metadataPath,
        metadataStats,
        gitMarker: readExactLocalFileProof(
          join(input.issueWorktree, ".git"),
          commonStats.dev,
          "issue worktree `.git` marker",
        ),
        metadataCommondir: readExactLocalFileProof(
          join(metadataPath, "commondir"),
          commonStats.dev,
          "issue worktree metadata `commondir`",
        ),
        metadataGitdir: readExactLocalFileProof(
          join(metadataPath, "gitdir"),
          commonStats.dev,
          "issue worktree metadata `gitdir`",
        ),
        metadataHead: readExactLocalFileProof(
          join(metadataPath, "HEAD"),
          commonStats.dev,
          "issue worktree metadata `HEAD`",
        ),
      };
    }
  } else if (localRef && localRef !== input.head) {
    fail("남은 local branch OID가 validated head와 다릅니다.");
  }

  const archiveLocatorIdentity = {
    schema: ARCHIVE_SCHEMA,
    issue: input.issue,
    pullRequest: input.pullRequest,
    branch: input.branch,
    head: input.head,
    issueWorktree: input.issueWorktree,
    mainWorktree: input.mainWorktree,
    gitCommonDir: commonDir,
  };
  const archiveKey = hashJson(archiveLocatorIdentity);
  const coreIdentity = {
    ...archiveLocatorIdentity,
    repository: input.repository,
  };
  const expectedIdentity = { ...coreIdentity, archiveKey };
  const paths = {
    archiveRoot: join(commonDir, ARCHIVE_ROOT_NAME),
    versionRoot: join(commonDir, ARCHIVE_ROOT_NAME, ARCHIVE_VERSION),
    archiveDirectory: join(
      commonDir,
      ARCHIVE_ROOT_NAME,
      ARCHIVE_VERSION,
      archiveKey,
    ),
  };
  paths.identityFile = join(paths.archiveDirectory, "identity.json");
  paths.generationsDirectory = join(paths.archiveDirectory, "generations");
  paths.intentsDirectory = join(paths.archiveDirectory, "intents");
  paths.snapshotScratchDirectory = join(
    paths.archiveDirectory,
    "snapshot-scratch",
  );
  paths.quarantineDirectory = join(
    paths.archiveDirectory,
    "worktree-quarantine",
  );
  paths.quarantineIntentsDirectory = join(
    paths.quarantineDirectory,
    "intents",
  );
  paths.quarantineRootsDirectory = join(
    paths.quarantineDirectory,
    "roots",
  );
  paths.quarantineMetadataDirectory = join(
    paths.quarantineDirectory,
    "metadata",
  );
  paths.quarantineReceiptsDirectory = join(
    paths.quarantineDirectory,
    "receipts",
  );

  const identityState = validateIdentityArchive(
    paths,
    expectedIdentity,
    commonStats.dev,
  );
  const archive = readGenerationArchive(paths, archiveKey, commonStats.dev);
  const intentArchive = readGenerationIntents(
    paths,
    archiveKey,
    commonStats.dev,
  );
  const quarantineArchive = readQuarantineArchive(
    paths,
    archiveKey,
    commonStats.dev,
  );
  const { intentsById, unresolvedIntents } =
    assertGenerationIntentBindings(archive, intentArchive);
  let quarantinePlan = null;
  if (quarantineArchive.intentEntry) {
    const entry = quarantineArchive.intentEntry;
    if (
      entry.intent.issueWorktree !== input.issueWorktree ||
      entry.intent.branch !== input.branch ||
      entry.intent.head !== input.head ||
      dirname(entry.intent.metadata.path) !==
        join(commonDir, "worktrees") ||
      entry.intent.root.device !== commonStats.dev.toString() ||
      entry.intent.metadata.device !== commonStats.dev.toString()
    ) {
      fail("quarantine intent가 exact worktree·branch·head·metadata identity와 다릅니다.");
    }
    const originalRootStats = pathState(input.issueWorktree);
    const originalMetadataStats = pathState(entry.intent.metadata.path);
    if (!quarantineArchive.rootDestinationStats) {
      if (
        !originalRootStats ||
        originalRootStats.dev.toString() !== entry.intent.root.device ||
        originalRootStats.ino.toString() !== entry.intent.root.inode ||
        !issueGitIdentity
      ) {
        fail("quarantine 전 original worktree root identity를 재구성할 수 없습니다.");
      }
    }
    if (!quarantineArchive.metadataDestinationStats) {
      if (
        !originalMetadataStats ||
        originalMetadataStats.dev.toString() !==
          entry.intent.metadata.device ||
        originalMetadataStats.ino.toString() !==
          entry.intent.metadata.inode ||
        !issueRecord
      ) {
        fail("quarantine 전 exact worktree metadata identity를 재구성할 수 없습니다.");
      }
    } else if (originalMetadataStats) {
      fail("quarantined metadata와 original metadata path가 동시에 존재합니다.");
    }
    if (
      quarantineArchive.metadataDestinationStats &&
      issueRecord
    ) {
      fail("metadata quarantine 뒤 Git worktree registration이 남아 있습니다.");
    }
    if (
      !quarantineArchive.metadataDestinationStats &&
      !issueRecord
    ) {
      fail("metadata quarantine 전 Git worktree registration이 사라졌습니다.");
    }
    quarantinePlan = {
      ...entry,
      intentPath: entry.path,
      archive: quarantineArchive,
      originalRootStats,
      originalMetadataStats,
      boundedResidue:
        Boolean(quarantineArchive.rootDestinationStats) &&
        Boolean(originalRootStats),
    };
  } else if (issueGitIdentity && issueRecord && issueStats) {
    if (issueStats.dev !== commonStats.dev) {
      fail("issue worktree root와 Git common dir가 같은 filesystem에 있지 않습니다.");
    }
    quarantinePlan = {
      ...plannedQuarantine({
        paths,
        archiveKey,
        issueWorktree: input.issueWorktree,
        branch: input.branch,
        head: input.head,
        rootStats: issueStats,
        metadataPath: issueGitIdentity.metadataPath,
        metadataStats: issueGitIdentity.metadataStats,
        gitMarker: issueGitIdentity.gitMarker,
        metadataCommondir: issueGitIdentity.metadataCommondir,
        metadataGitdir: issueGitIdentity.metadataGitdir,
        metadataHead: issueGitIdentity.metadataHead,
      }),
      archive: quarantineArchive,
      originalRootStats: issueStats,
      originalMetadataStats: issueGitIdentity.metadataStats,
      boundedResidue: false,
    };
  } else {
    fail("exact worktree 또는 durable quarantine intent를 확정할 수 없습니다.");
  }
  assertQuarantinePlumbingFiles(
    quarantinePlan,
    Boolean(quarantineArchive.rootDestinationStats),
    Boolean(quarantineArchive.metadataDestinationStats),
  );
  if (quarantineArchive.rootDestinationStats) {
    readQuarantinedWorktreeResidue({
      archive,
      commonDir,
      head: input.head,
      quarantinePlan,
    });
  }
  if (!issueRecord && !identityState.identityExists) {
    fail("issue worktree가 없을 때는 exact archive identity receipt가 필요합니다.");
  }
  if (!issueRecord && archive.generations.length === 0) {
    fail("issue worktree가 없을 때는 보존된 generation receipt가 필요합니다.");
  }

  let residue = {
    source: join(input.issueWorktree, ".omc"),
    kind: "absent",
    stats: null,
    proof: null,
  };
  if (issueRecord && issueGitIdentity) {
    residue = readWorktreeResidue(input.issueWorktree, archive.head);
    if (residue.kind === "directory") {
      residue.proof = scanOmcDirectory(residue.source, commonStats.dev);
    }
  } else if (quarantineArchive.rootDestinationStats) {
    residue = {
      source: join(input.issueWorktree, ".omc"),
      kind: "quarantined",
      stats: null,
      proof: null,
    };
  }

  let action;
  let activeGeneration = archive.head;
  let nextGeneration = null;
  let recoveryGeneration = null;
  const incompleteGeneration = archive.incomplete[0] ?? null;
  const pendingIntent = unresolvedIntents[0] ?? null;
  if (quarantineArchive.intentEntry) {
    if (
      pendingIntent ||
      incompleteGeneration ||
      !archive.head?.payloadStats
    ) {
      fail("worktree quarantine는 complete active generation 뒤에만 재개할 수 있습니다.");
    }
    action =
      quarantineArchive.receipt && !issueRecord
        ? localRef
          ? "delete-ref-recovery"
          : "satisfied"
        : "quarantine-recovery";
  } else if (pendingIntent && !issueRecord) {
    fail("issue worktree 없이 unresolved generation intent를 복구할 수 없습니다.");
  } else if (pendingIntent) {
    const intended = pendingIntent.planned;
    const expectedPrevious = archive.head?.id ?? null;
    if (intended.previous !== expectedPrevious) {
      fail("unresolved generation intent의 previous가 current archive head와 다릅니다.");
    }
    const containerState =
      incompleteGeneration?.id === intended.id
        ? incompleteGeneration
        : null;
    const candidateProof = containerState?.candidateProof ?? null;
    const candidatePresent = Boolean(containerState?.candidateLocation);
    const candidateIsEmpty =
      candidatePresent &&
      readdirSync(containerState.candidatePath).length === 0;
    const resumableEmptySnapshot =
      intended.kind === "preserved" &&
      candidatePresent &&
      ["scratch", "pending"].includes(
        containerState.candidateLocation,
      ) &&
      !containerState.completedSnapshot &&
      !containerState.failedSnapshot &&
      candidateIsEmpty &&
      residue.kind === "directory" &&
      residue.proof.contentDigest ===
        intended.sourceProof.contentDigest;
    let partialSnapshot = false;
    let failedEmptySnapshot = false;
    if (candidatePresent) {
      if (
        intended.kind === "empty" &&
        (containerState.pendingPayloadStats ||
          containerState.scratchPayloadStats ||
          readdirSync(containerState.payload).length !== 0)
      ) {
        fail("unresolved empty intent의 payload는 비어 있어야 합니다.");
      }
      if (
        intended.kind === "preserved" &&
        (candidateProof.device !== intended.sourceProof.device ||
          candidateProof.inode === intended.sourceProof.inode)
      ) {
        fail(
          "unresolved snapshot candidate가 helper-owned 새 inode가 아닙니다.",
        );
      }
      if (
        intended.kind === "preserved" &&
        containerState.completedSnapshot &&
        candidateProof.contentDigest !==
          intended.sourceProof.contentDigest
      ) {
        fail("complete snapshot outcome이 durable intent contentDigest와 다릅니다.");
      }
      failedEmptySnapshot =
        intended.kind === "preserved" &&
        !containerState.completedSnapshot &&
        candidateIsEmpty &&
        (Boolean(containerState.failedSnapshot) ||
          !resumableEmptySnapshot);
      partialSnapshot =
        intended.kind === "preserved" &&
        !candidateIsEmpty &&
        (Boolean(containerState.failedSnapshot) ||
          (!containerState.completedSnapshot &&
            candidateProof.contentDigest !==
              intended.sourceProof.contentDigest));
    }

    let currentMatchesIntent = false;
    if (
      intended.kind === "preserved" &&
      candidatePresent &&
      !partialSnapshot &&
      !failedEmptySnapshot &&
      residue.kind === "directory" &&
      residue.proof.contentDigest ===
        intended.sourceProof.contentDigest
    ) {
      currentMatchesIntent = true;
    } else if (
      intended.kind === "preserved" &&
      !candidatePresent &&
      residue.kind === "directory"
    ) {
      const current = plannedGeneration(
        paths,
        archiveKey,
        intended.previous,
        "preserved",
        residue.proof,
      );
      currentMatchesIntent = current.id === intended.id;
    } else if (
      intended.kind === "empty" &&
      residue.kind === "absent"
    ) {
      currentMatchesIntent = true;
    }

    if (currentMatchesIntent) {
      action = "resume-generation";
      nextGeneration = {
        ...intended,
        existing: Boolean(containerState),
        existingPayload: Boolean(containerState?.payloadStats),
        existingPending: Boolean(containerState?.pendingPayloadStats),
        existingScratch: Boolean(containerState?.scratchPayloadStats),
        candidateLocation: containerState?.candidateLocation ?? null,
        existingCandidateProof: candidateProof,
        resumeSnapshotCopy: resumableEmptySnapshot,
        snapshotAttempt: containerState?.attempt ?? null,
        snapshotComplete: containerState?.completedSnapshot ?? null,
        snapshotFailed: containerState?.failedSnapshot ?? null,
        pendingReceipts: containerState?.pendingReceipts ?? [],
      };
    } else if (residue.kind === "directory") {
      action =
        intended.kind === "empty"
          ? "seal-empty-and-append"
          : failedEmptySnapshot
            ? "seal-failed-empty-and-append"
          : partialSnapshot
            ? "seal-partial-and-append"
            : candidatePresent
            ? "seal-preserved-and-append"
            : "seal-orphan-and-append";
      recoveryGeneration = {
        ...intended,
        kind:
          intended.kind === "empty"
            ? "empty"
            : failedEmptySnapshot
              ? "orphan"
            : partialSnapshot
              ? "orphan"
              : candidatePresent
              ? "preserved"
              : "orphan",
        sourceProof:
          candidatePresent
            ? intended.sourceProof
            : null,
        intentKind: intended.kind,
        intentSourceProof: intended.sourceProof,
        existing: Boolean(containerState),
        existingPayload: Boolean(containerState?.payloadStats),
        existingPending: Boolean(containerState?.pendingPayloadStats),
        existingScratch: Boolean(containerState?.scratchPayloadStats),
        candidateLocation: containerState?.candidateLocation ?? null,
        existingCandidateProof: candidateProof,
        partialPayload: partialSnapshot,
        failedEmptyPayload: failedEmptySnapshot,
        snapshotAttempt: containerState?.attempt ?? null,
        snapshotComplete: containerState?.completedSnapshot ?? null,
        snapshotFailed: containerState?.failedSnapshot ?? null,
        pendingReceipts: containerState?.pendingReceipts ?? [],
      };
      nextGeneration = plannedGeneration(
        paths,
        archiveKey,
        intended.id,
        "preserved",
        residue.proof,
      );
    } else if (
      intended.kind === "preserved" &&
      residue.kind === "absent" &&
      candidatePresent
    ) {
      const completeSnapshot =
        !partialSnapshot &&
        !failedEmptySnapshot &&
        candidateProof.contentDigest ===
          intended.sourceProof.contentDigest;
      if (!partialSnapshot && !failedEmptySnapshot && !completeSnapshot) {
        fail(
          "receipt 없는 snapshot candidate의 complete·partial·failed-empty disposition을 확정할 수 없습니다.",
        );
      }
      action = partialSnapshot
        ? "seal-partial-and-append"
        : failedEmptySnapshot
          ? "seal-failed-empty-and-append"
          : "seal-preserved-and-append";
      recoveryGeneration = {
        ...intended,
        kind: completeSnapshot ? "preserved" : "orphan",
        sourceProof: intended.sourceProof,
        intentKind: intended.kind,
        intentSourceProof: intended.sourceProof,
        existing: Boolean(containerState),
        existingPayload: Boolean(containerState?.payloadStats),
        existingPending: Boolean(containerState?.pendingPayloadStats),
        existingScratch: Boolean(containerState?.scratchPayloadStats),
        candidateLocation: containerState?.candidateLocation ?? null,
        existingCandidateProof: candidateProof,
        partialPayload: partialSnapshot,
        failedEmptyPayload: failedEmptySnapshot,
        snapshotAttempt: containerState?.attempt ?? null,
        snapshotComplete: containerState?.completedSnapshot ?? null,
        snapshotFailed: containerState?.failedSnapshot ?? null,
        pendingReceipts: containerState?.pendingReceipts ?? [],
      };
      nextGeneration = plannedGeneration(
        paths,
        archiveKey,
        intended.id,
        "empty",
        null,
      );
    } else {
      fail("unresolved generation intent와 현재 `.omc`를 안전하게 복구할 수 없습니다.");
    }
  } else if (!issueRecord) {
    action = localRef ? "delete-ref-recovery" : "satisfied";
  } else if (residue.kind === "bridge") {
    if (!archive.head?.payloadStats) {
      fail("helper bridge가 가리킬 active generation payload가 없습니다.");
    }
    action = "quarantine-ready";
  } else if (residue.kind === "directory") {
    if (archive.head && !archive.head.payloadStats) {
      if (
        archive.head.receipt.kind !== "preserved" ||
        archive.head.receipt.payloadProof.contentDigest !==
          residue.proof.contentDigest
      ) {
        fail(
          "pending generation과 source `.omc` immutable content proof가 일치하지 않습니다.",
        );
      }
      action = "resume-generation";
      nextGeneration = {
        ...intentsById.get(archive.head.id).planned,
        sourceProof: residue.proof,
        existing: true,
      };
    } else if (
      archive.head?.receipt.kind === "preserved" &&
      residue.proof.contentDigest ===
        intentsById.get(archive.head.id).intent.sourceProof.contentDigest
    ) {
      action = "quarantine-ready";
    } else {
      action = archive.head ? "append-generation" : "create-generation";
      nextGeneration = plannedGeneration(
        paths,
        archiveKey,
        archive.head?.id ?? null,
        "preserved",
        residue.proof,
      );
    }
  } else if (archive.head) {
    if (!archive.head.payloadStats) {
      fail("active generation payload와 source `.omc`가 모두 없습니다.");
    }
    if (archive.head.receipt.kind === "empty") {
      action = "quarantine-ready";
    } else {
      action = "append-generation";
      nextGeneration = plannedGeneration(
        paths,
        archiveKey,
        archive.head.id,
        "empty",
        null,
      );
    }
  } else {
    action = "create-empty-generation";
    nextGeneration = plannedGeneration(
      paths,
      archiveKey,
      null,
      "empty",
      null,
    );
  }

  const generationProof = archive.generations.map((entry) => ({
    id: entry.id,
    previous: entry.receipt.previous,
    kind: entry.receipt.kind,
    payloadProof: entry.receipt.payloadProof,
    intentDigest: entry.receipt.intentDigest,
    attemptDigest: entry.receipt.attemptDigest,
    payloadPresent: Boolean(entry.payloadStats),
    snapshotDigest: entry.proof?.snapshotDigest ?? null,
    snapshotAttempt: entry.attempt,
    snapshotComplete: entry.completedSnapshot,
    snapshotFailed: entry.failedSnapshot,
    pendingReceipts: entry.pendingReceipts.map((pending) => ({
      name: pending.name,
      proof: pending.proof,
    })),
    pendingSnapshotAttempts: entry.pendingSnapshotAttempts.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
    pendingSnapshotCompletes: entry.pendingSnapshotCompletes.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
    pendingSnapshotFailures: entry.pendingSnapshotFailures.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
  }));
  const incompleteGenerationProof = archive.incomplete.map((entry) => ({
    id: entry.id,
    payloadPresent: Boolean(entry.payloadStats),
    payloadProof: entry.proof,
    pendingPayloadPresent: Boolean(entry.pendingPayloadStats),
    pendingPayloadProof: entry.pendingProof,
    scratchPayloadPresent: Boolean(entry.scratchPayloadStats),
    scratchPayloadProof: entry.scratchProof,
    candidateLocation: entry.candidateLocation,
    snapshotAttempt: entry.attempt,
    snapshotComplete: entry.completedSnapshot,
    snapshotFailed: entry.failedSnapshot,
    pendingReceipts: entry.pendingReceipts.map((pending) => ({
      name: pending.name,
      proof: pending.proof,
    })),
    pendingSnapshotAttempts: entry.pendingSnapshotAttempts.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
    pendingSnapshotCompletes: entry.pendingSnapshotCompletes.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
    pendingSnapshotFailures: entry.pendingSnapshotFailures.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
  }));
  const tokenState = {
    schema: PLAN_SCHEMA,
    coreIdentity,
    originIdentity,
    archiveLocatorIdentity,
    archiveKey,
    action,
    mainHead,
    mainWorktreeIdentity,
    issueRegistered: Boolean(issueRecord),
    issueRecord: issueRecord
      ? {
          path: issueRecord.canonicalPath,
          head: issueRecord.HEAD,
          branch: issueRecord.branch,
        }
      : null,
    localRef,
    residue: {
      kind: residue.kind,
      proof: residue.proof,
    },
    generations: generationProof,
    incompleteGenerations: incompleteGenerationProof,
    unboundSnapshotScratch: archive.unboundScratch.map((entry) => ({
      name: entry.name,
      proof: entry.proof,
    })),
    intents: intentArchive.intents.map((entry) => entry.intent),
    pendingIntentMetadata: intentArchive.pendingMetadata.map((pending) => ({
      name: pending.name,
      proof: pending.proof,
    })),
    quarantine: {
      plannedIntent: quarantinePlan.intent,
      published: Boolean(quarantineArchive.intentEntry),
      receipt: quarantineArchive.receipt,
      originalRoot: inodeTokenProof(quarantinePlan.originalRootStats),
      originalMetadata: inodeTokenProof(
        quarantinePlan.originalMetadataStats,
      ),
      quarantinedRoot: inodeTokenProof(
        quarantineArchive.rootDestinationStats,
      ),
      quarantinedMetadata: inodeTokenProof(
        quarantineArchive.metadataDestinationStats,
      ),
      boundedResidue: quarantinePlan.boundedResidue,
      pendingIntentMetadata:
        quarantineArchive.pendingIntentMetadata.map((pending) => ({
          name: pending.name,
          proof: pending.proof,
        })),
      pendingReceiptMetadata:
        quarantineArchive.pendingReceiptMetadata.map((pending) => ({
          name: pending.name,
          proof: pending.proof,
        })),
    },
    plannedGeneration: nextGeneration
      ? {
          id: nextGeneration.id,
          previous: nextGeneration.previous,
          kind: nextGeneration.kind,
          sourceProof: nextGeneration.sourceProof,
          existing: Boolean(nextGeneration.existing),
          existingPayload: Boolean(nextGeneration.existingPayload),
          existingPending: Boolean(nextGeneration.existingPending),
          existingScratch: Boolean(nextGeneration.existingScratch),
          candidateLocation: nextGeneration.candidateLocation ?? null,
          existingCandidateProof:
            nextGeneration.existingCandidateProof ?? null,
          resumeSnapshotCopy: Boolean(
            nextGeneration.resumeSnapshotCopy,
          ),
          partialPayload: Boolean(nextGeneration.partialPayload),
          failedEmptyPayload: Boolean(
            nextGeneration.failedEmptyPayload,
          ),
        }
      : null,
    recoveryGeneration: recoveryGeneration
      ? {
          id: recoveryGeneration.id,
          previous: recoveryGeneration.previous,
          kind: recoveryGeneration.kind,
          intentKind: recoveryGeneration.intentKind,
          existing: Boolean(recoveryGeneration.existing),
          existingPayload: Boolean(recoveryGeneration.existingPayload),
          existingPending: Boolean(recoveryGeneration.existingPending),
          existingScratch: Boolean(recoveryGeneration.existingScratch),
          candidateLocation:
            recoveryGeneration.candidateLocation ?? null,
          existingCandidateProof:
            recoveryGeneration.existingCandidateProof ?? null,
          partialPayload: Boolean(recoveryGeneration.partialPayload),
          failedEmptyPayload: Boolean(
            recoveryGeneration.failedEmptyPayload,
          ),
        }
      : null,
    identityReceiptPresent: identityState.identityExists,
    pendingIdentity: identityState.pendingIdentity.map((pending) => ({
      name: pending.name,
      proof: pending.proof,
    })),
  };

  return {
    ...input,
    action,
    planToken: hashJson(tokenState),
    tokenState,
    branchRef,
    mainHead,
    mainWorktreeIdentity,
    originIdentity,
    commonDir,
    commonDevice: commonStats.dev,
    coreIdentity,
    archiveLocatorIdentity,
    archiveKey,
    expectedIdentity,
    paths,
    identityState,
    archive,
    intentArchive,
    quarantineArchive,
    quarantinePlan,
    residue,
    activeGeneration,
    recoveryGeneration,
    plannedGeneration: nextGeneration,
    issueRegistered: Boolean(issueRecord),
    localRef,
  };
}

function assertPlanToken(expected, actual) {
  if (!HASH_PATTERN.test(String(expected ?? ""))) {
    throw new UsageError("`--plan-token`에는 dry-run이 출력한 64자리 token이 필요합니다.");
  }
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    fail("dry-run plan token이 현재 cleanup snapshot과 일치하지 않습니다.");
  }
}

function ensureArchiveIdentity(plan) {
  assertExactOrigin(plan);
  ensurePrivateDirectoryWithOrigin(plan, plan.paths.archiveRoot);
  ensurePrivateDirectoryWithOrigin(plan, plan.paths.versionRoot);
  ensurePrivateDirectoryWithOrigin(plan, plan.paths.archiveDirectory);
  writeExclusiveJsonWithOrigin(
    plan,
    plan.paths.identityFile,
    plan.expectedIdentity,
    "archive identity.json",
  );
  ensurePrivateDirectoryWithOrigin(plan, plan.paths.generationsDirectory);
  ensurePrivateDirectoryWithOrigin(plan, plan.paths.intentsDirectory);
  ensurePrivateDirectoryWithOrigin(
    plan,
    plan.paths.snapshotScratchDirectory,
  );
  assertExactOrigin(plan);
}

function intentContentProof(generation) {
  const intentKind = generation.intentKind ?? generation.kind;
  const sourceProof =
    generation.intentSourceProof ?? generation.sourceProof;
  if (intentKind === "empty") {
    if (sourceProof !== null) {
      fail("empty generation intent에는 source content proof가 없어야 합니다.");
    }
    return null;
  }
  if (
    intentKind !== "preserved" ||
    !sourceProof ||
    !HASH_PATTERN.test(String(sourceProof.treeDigest)) ||
    !HASH_PATTERN.test(String(sourceProof.contentDigest))
  ) {
    fail("preserved generation intent의 immutable content proof가 없습니다.");
  }
  return sourceProof;
}

function assertPreparedPayloadProof(generation, proof, label) {
  const intentProof = intentContentProof(generation);
  if (generation.kind === "preserved") {
    if (
      proof.device !== intentProof.device ||
      proof.inode === intentProof.inode ||
      proof.contentDigest !== intentProof.contentDigest
    ) {
      fail(
        `${label} sealed snapshot이 durable intent의 contentDigest 또는 새 inode 계약과 다릅니다.`,
      );
    }
    return intentProof;
  }
  if (generation.kind === "orphan" && generation.partialPayload) {
    if (
      proof.device !== intentProof.device ||
      proof.inode === intentProof.inode
    ) {
      fail(
        `${label} partial orphan payload가 helper-owned 새 inode가 아닙니다.`,
      );
    }
    return intentProof;
  }
  if (generation.kind === "orphan" && generation.failedEmptyPayload) {
    if (
      proof.device !== intentProof.device ||
      proof.inode === intentProof.inode ||
      (pathState(generation.payload) &&
        readdirSync(generation.payload).length !== 0)
    ) {
      fail(
        `${label} failed-empty orphan payload가 exact owned empty 새 inode가 아닙니다.`,
      );
    }
    return intentProof;
  }
  if (!["empty", "orphan"].includes(generation.kind)) {
    fail(`${label} generation kind를 검증할 수 없습니다.`);
  }
  if (readdirSync(generation.payload).length !== 0) {
    fail(`${label} ${generation.kind} generation payload는 비어 있어야 합니다.`);
  }
  return intentProof;
}

function receiptForPayload(
  plan,
  generation,
  proof,
  label,
  attempt = null,
) {
  const intentProof = assertPreparedPayloadProof(
    generation,
    proof,
    label,
  );
  return generationReceipt({
    archiveKey: plan.archiveKey,
    generation: generation.id,
    previous: generation.previous,
    kind: generation.kind,
    payloadProof: proof,
    intentDigest: hashJson(generationIntent(plan.archiveKey, generation)),
    attemptDigest: attempt ? hashJson(attempt) : null,
    snapshotDisposition:
      generation.kind === "preserved"
        ? "complete"
        : generation.partialPayload
          ? "partial"
          : generation.failedEmptyPayload
            ? "failed-empty"
          : "empty",
  });
}

function assertReceiptPayloadStillExact(plan, generation, receipt, label) {
  const current = scanOmcDirectory(
    generation.payload,
    plan.commonDevice,
  );
  if (
    stableJson(current) !== stableJson(receipt.payloadProof)
  ) {
    fail(
      `${label} archived payload의 current immutable content proof가 generation receipt와 다릅니다.`,
    );
  }
  assertPreparedPayloadProof(generation, current, label);
  return current;
}

function assertAttemptRootIdentity(stats, attempt, label) {
  if (
    !stats ||
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.dev.toString() !== attempt.root.device ||
    stats.ino.toString() !== attempt.root.inode
  ) {
    fail(`${label}가 durable snapshot attempt의 exact root ownership과 다릅니다.`);
  }
}

function ensureOwnedSnapshotRoot(plan, generation, options) {
  assertExactOrigin(plan);
  let attempt = generation.snapshotAttempt ?? null;
  if (!attempt) {
    if (
      generation.existingPayload ||
      generation.existingPending ||
      generation.existingScratch
    ) {
      fail(
        "durable root ownership attempt 없는 snapshot candidate는 소급 채택하지 않습니다.",
      );
    }
    const scratch = `${randomBytes(32).toString("hex")}.omc`;
    const scratchRoot = join(
      plan.paths.snapshotScratchDirectory,
      scratch,
    );
    assertExactOrigin(plan);
    try {
      mkdirSync(scratchRoot, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("snapshot scratch nonce collision이 발생했습니다.");
      }
      throw error;
    }
    let descriptor;
    try {
      descriptor = openSync(
        scratchRoot,
        fsConstants.O_RDONLY |
          (fsConstants.O_DIRECTORY ?? 0) |
          (fsConstants.O_NOFOLLOW ?? 0),
      );
      const before = fstatSync(descriptor, { bigint: true });
      const pathBefore = lstatSync(scratchRoot, { bigint: true });
      if (!sameStatIdentity(before, pathBefore)) {
        fail("snapshot scratch root identity가 attempt 발행 전에 바뀌었습니다.");
      }
      syncDirectory(plan.paths.snapshotScratchDirectory);
      assertExactOrigin(plan);
      options.hooks?.afterUnboundSnapshotRootCreated?.({
        plan,
        generation,
        scratchRoot,
      });
      assertExactOrigin(plan);
      const afterHook = fstatSync(descriptor, { bigint: true });
      const pathAfterHook = lstatSync(scratchRoot, { bigint: true });
      if (
        !sameStatIdentity(before, afterHook) ||
        !sameStatIdentity(afterHook, pathAfterHook)
      ) {
        fail(
          "unbound snapshot hook 뒤 scratch root identity가 original inode와 다릅니다.",
        );
      }
      attempt = snapshotAttempt(
        plan.archiveKey,
        generation,
        scratch,
        before,
      );
      writeExclusiveJsonWithOrigin(
        plan,
        generation.snapshotAttemptPath,
        attempt,
        "snapshot attempt",
      );
      const after = fstatSync(descriptor, { bigint: true });
      const pathAfter = lstatSync(scratchRoot, { bigint: true });
      if (
        !sameStatIdentity(before, after) ||
        !sameStatIdentity(after, pathAfter)
      ) {
        fail(
          "snapshot scratch root identity가 durable attempt 발행 중 바뀌었습니다.",
        );
      }
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  } else {
    writeExclusiveJsonWithOrigin(
      plan,
      generation.snapshotAttemptPath,
      attempt,
      "snapshot attempt",
    );
  }

  options.hooks?.afterSnapshotAttemptPublished?.({
    plan,
    generation,
    attempt,
  });
  assertExactOrigin(plan);
  const scratchRoot = join(
    plan.paths.snapshotScratchDirectory,
    attempt.scratch,
  );
  let scratchStats = pathState(scratchRoot);
  let pendingStats = pathState(generation.pendingPayload);
  let payloadStats = pathState(generation.payload);
  const locationCount = [scratchStats, pendingStats, payloadStats].filter(
    Boolean,
  ).length;
  if (locationCount !== 1) {
    fail(
      "generation payload destination collision: bound scratch·pending·current가 정확히 하나가 아니므로 overwrite하지 않습니다.",
    );
  }

  if (scratchStats) {
    assertAttemptRootIdentity(
      scratchStats,
      attempt,
      "bound snapshot scratch root",
    );
  } else if (pendingStats) {
    assertAttemptRootIdentity(
      pendingStats,
      attempt,
      "recovered pending snapshot root",
    );
  } else {
    assertAttemptRootIdentity(
      payloadStats,
      attempt,
      "recovered current snapshot root",
    );
  }
  assertExactOrigin(plan);
  return attempt;
}

function publishSnapshotCandidate(
  plan,
  generation,
  proof,
  disposition,
  attempt,
  options = {},
) {
  assertExactOrigin(plan);
  const failureDisposition = ["partial", "failed-empty"].includes(
    disposition,
  );
  const outcomeSchema =
    failureDisposition
      ? SNAPSHOT_FAILED_SCHEMA
      : SNAPSHOT_COMPLETE_SCHEMA;
  const outcomePath =
    failureDisposition
      ? generation.snapshotFailedPath
      : generation.snapshotCompletePath;
  const scratchRoot = join(
    plan.paths.snapshotScratchDirectory,
    attempt.scratch,
  );
  let scratchStats = pathState(scratchRoot);
  let pendingStats = pathState(generation.pendingPayload);
  let payloadStats = pathState(generation.payload);
  if (
    [scratchStats, pendingStats, payloadStats].filter(Boolean).length !==
    1
  ) {
    fail(
      "snapshot publication ownership collision: scratch·pending·current가 정확히 하나여야 합니다.",
    );
  }
  if (scratchStats) {
    assertAttemptRootIdentity(
      scratchStats,
      attempt,
      "sealed snapshot scratch root",
    );
    options.hooks?.beforeNoReplaceRename?.({
      plan,
      generation,
      attempt,
    });
    assertExactOrigin(plan);
    scratchStats = pathState(scratchRoot);
    assertAttemptRootIdentity(
      scratchStats,
      attempt,
      "pending publish 직전 bound snapshot scratch root",
    );
    pendingStats = pathState(generation.pendingPayload);
    payloadStats = pathState(generation.payload);
    if (pendingStats || payloadStats) {
      fail(
        "snapshot payload destination collision이 있어 bound scratch를 overwrite하지 않습니다.",
      );
    }
    assertExactOrigin(plan);
    const pendingPublication = atomicRenameNoReplace(
      scratchRoot,
      generation.pendingPayload,
      "snapshot pending root publication",
    );
    if (pendingPublication === "exists") {
      fail(
        "snapshot pending root destination collision이 있어 overwrite하지 않습니다.",
      );
    }
    syncDirectory(plan.paths.snapshotScratchDirectory);
    syncDirectory(generation.directory);
    assertExactOrigin(plan);
    scratchStats = null;
    pendingStats = pathState(generation.pendingPayload);
    assertAttemptRootIdentity(
      pendingStats,
      attempt,
      "published pending snapshot root",
    );
    options.hooks?.afterPendingRootCreated?.({
      plan,
      generation,
      attempt,
      pendingPayload: generation.pendingPayload,
    });
    assertExactOrigin(plan);
    pendingStats = pathState(generation.pendingPayload);
    assertAttemptRootIdentity(
      pendingStats,
      attempt,
      "pending publication hook 뒤 snapshot root",
    );
    const pendingProof = scanOmcDirectory(
      generation.pendingPayload,
      plan.commonDevice,
    );
    if (
      stableJson(payloadSeal(pendingProof)) !==
      stableJson(payloadSeal(proof))
    ) {
      fail("pending publication 뒤 snapshot payload seal이 변경되었습니다.");
    }
    proof = pendingProof;
  }
  const ownedStats = pendingStats ?? payloadStats;
  assertAttemptRootIdentity(
    ownedStats,
    attempt,
    "snapshot outcome candidate root",
  );
  if (
    proof.device !== attempt.root.device ||
    proof.inode !== attempt.root.inode
  ) {
    fail("snapshot outcome proof가 durable attempt root ownership과 다릅니다.");
  }
  const outcomeCandidate = pendingStats
    ? generation.pendingPayload
    : generation.payload;
  const candidateIsEmpty =
    readdirSync(outcomeCandidate).length === 0;
  if (disposition === "partial" && candidateIsEmpty) {
    fail("partial snapshot outcome은 nonempty payload만 허용합니다.");
  }
  if (disposition === "failed-empty" && !candidateIsEmpty) {
    fail("failed-empty snapshot outcome은 exact empty payload만 허용합니다.");
  }
  writeExclusiveJsonWithOrigin(
    plan,
    outcomePath,
    snapshotOutcome(
      outcomeSchema,
      plan.archiveKey,
      generation,
      proof,
      attempt,
    ),
    failureDisposition
      ? "snapshot failed"
      : "snapshot complete",
  );
  options.hooks?.afterSnapshotOutcomePublished?.({
    plan,
    generation,
    attempt,
    disposition,
  });
  assertExactOrigin(plan);

  if (pendingStats) {
    assertExactOrigin(plan);
    const publication = atomicRenameNoReplace(
      generation.pendingPayload,
      generation.payload,
      "snapshot payload publication",
    );
    if (publication === "exists") {
      fail("snapshot final payload collision이 있어 overwrite하지 않습니다.");
    }
    syncDirectory(generation.directory);
    assertExactOrigin(plan);
    options.hooks?.afterSnapshotCurrentPublished?.({
      plan,
      generation,
      attempt,
      disposition,
    });
    assertExactOrigin(plan);
  } else if (!payloadStats) {
    fail("publish할 pending 또는 final snapshot payload가 없습니다.");
  }
  const current = scanOmcDirectory(
    generation.payload,
    plan.commonDevice,
  );
  if (stableJson(current) !== stableJson(proof)) {
    if (
      stableJson(payloadSeal(current)) !==
      stableJson(payloadSeal(proof))
    ) {
      fail("atomic publication 뒤 snapshot payload seal이 변경되었습니다.");
    }
  }
  assertExactOrigin(plan);
  return current;
}

function prepareGeneration(
  plan,
  options,
  generation = plan.plannedGeneration,
) {
  if (!generation) return plan.activeGeneration;
  assertExactOrigin(plan);

  writeExclusiveJsonWithOrigin(
    plan,
    generation.intentPath,
    generationIntent(plan.archiveKey, generation),
    "generation intent",
  );
  options.hooks?.afterGenerationIntentPublished?.({ plan, generation });
  assertExactOrigin(plan);

  if (!generation.existing) {
    assertExactOrigin(plan);
    try {
      mkdirSync(generation.directory, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (error?.code === "EEXIST") {
        fail("exclusive generation container collision이 발생했습니다.");
      }
      throw error;
    }
    validatePrivateDirectory(generation.directory, plan.commonDevice);
    syncDirectory(plan.paths.generationsDirectory);
    assertExactOrigin(plan);
    options.hooks?.afterGenerationContainerCreated?.({ plan, generation });
    assertExactOrigin(plan);
  } else {
    validatePrivateDirectory(generation.directory, plan.commonDevice);
    assertExactOrigin(plan);
  }

  if (
    generation.kind === "orphan" &&
    (generation.partialPayload || generation.failedEmptyPayload)
  ) {
    const failureDisposition = generation.failedEmptyPayload
      ? "failed-empty"
      : "partial";
    const attempt = ensureOwnedSnapshotRoot(
      plan,
      generation,
      options,
    );
    const scratchRoot = join(
      plan.paths.snapshotScratchDirectory,
      attempt.scratch,
    );
    const candidatePath = pathState(scratchRoot)
      ? scratchRoot
      : pathState(generation.pendingPayload)
        ? generation.pendingPayload
        : generation.payload;
    const failureProof = scanOmcDirectory(
      candidatePath,
      plan.commonDevice,
    );
    if (
      generation.existingCandidateProof &&
      stableJson(payloadSeal(failureProof)) !==
        stableJson(payloadSeal(generation.existingCandidateProof))
    ) {
      fail("failed snapshot candidate가 dry-run ownership proof 뒤 변경되었습니다.");
    }
    const candidateIsEmpty = readdirSync(candidatePath).length === 0;
    if (generation.partialPayload && candidateIsEmpty) {
      fail("partial orphan candidate는 nonempty payload여야 합니다.");
    }
    if (generation.failedEmptyPayload && !candidateIsEmpty) {
      fail("failed-empty orphan candidate는 exact empty payload여야 합니다.");
    }
    assertPreparedPayloadProof(
      generation,
      failureProof,
      `${failureDisposition} orphan 봉인 전`,
    );
    const archived = publishSnapshotCandidate(
      plan,
      generation,
      failureProof,
      failureDisposition,
      attempt,
      options,
    );
    const receipt = receiptForPayload(
      plan,
      generation,
      archived,
      `${failureDisposition} orphan receipt 발행 전`,
      attempt,
    );
    writeExclusiveJsonWithOrigin(
      plan,
      generation.receiptPath,
      receipt,
      "generation.json",
    );
    const current = assertReceiptPayloadStillExact(
      plan,
      generation,
      receipt,
      `${failureDisposition} orphan receipt 발행 후`,
    );
    assertExactOrigin(plan);
    return {
      ...generation,
      receipt,
      payloadStats: lstatSync(generation.payload, { bigint: true }),
      proof: current,
    };
  }

  if (["empty", "orphan"].includes(generation.kind)) {
    let payloadStats = pathState(generation.payload);
    if (payloadStats) {
      if (!generation.existingPayload) {
        fail("empty generation payload destination collision이 발생했습니다.");
      }
      if (
        !payloadStats.isDirectory() ||
        payloadStats.isSymbolicLink() ||
        payloadStats.dev !== plan.commonDevice ||
        modeBits(payloadStats) !== PRIVATE_DIRECTORY_MODE ||
        readdirSync(generation.payload).length !== 0
      ) {
        fail("복구할 empty generation payload가 exact empty 0700 디렉터리가 아닙니다.");
      }
    } else {
      options.hooks?.beforeEmptyPayloadCreate?.({ plan, generation });
      assertExactOrigin(plan);
      if (pathState(generation.payload)) {
        fail("empty generation payload destination collision이 발생했습니다.");
      }
      assertExactOrigin(plan);
      try {
        mkdirSync(generation.payload, { mode: PRIVATE_DIRECTORY_MODE });
      } catch (error) {
        if (error?.code === "EEXIST") {
          fail("empty generation payload destination collision이 발생했습니다.");
        }
        throw error;
      }
      syncDirectory(generation.directory);
      assertExactOrigin(plan);
      payloadStats = lstatSync(generation.payload, { bigint: true });
      options.hooks?.afterEmptyPayloadCreated?.({ plan, generation });
      assertExactOrigin(plan);
    }
    const archived = scanOmcDirectory(
      generation.payload,
      plan.commonDevice,
    );
    const receipt = receiptForPayload(
      plan,
      generation,
      archived,
      "receipt 발행 전",
    );
    writeExclusiveJsonWithOrigin(
      plan,
      generation.receiptPath,
      receipt,
      "generation.json",
    );
    const current = assertReceiptPayloadStillExact(
      plan,
      generation,
      receipt,
      "receipt 발행 후",
    );
    assertExactOrigin(plan);
    return {
      ...generation,
      receipt,
      payloadStats,
      proof: current,
    };
  }

  if (
    (generation.existingPayload ||
      generation.existingPending ||
      generation.existingScratch) &&
    !generation.resumeSnapshotCopy
  ) {
    const attempt = ensureOwnedSnapshotRoot(
      plan,
      generation,
      options,
    );
    const scratchRoot = join(
      plan.paths.snapshotScratchDirectory,
      attempt.scratch,
    );
    const candidatePath = pathState(scratchRoot)
      ? scratchRoot
      : pathState(generation.pendingPayload)
        ? generation.pendingPayload
        : generation.payload;
    const candidateProof = scanOmcDirectory(
      candidatePath,
      plan.commonDevice,
    );
    if (
      generation.existingCandidateProof &&
      stableJson(payloadSeal(candidateProof)) !==
        stableJson(payloadSeal(generation.existingCandidateProof))
    ) {
      fail("snapshot candidate가 dry-run ownership proof 뒤 변경되었습니다.");
    }
    assertPreparedPayloadProof(
      generation,
      candidateProof,
      "receipt 복구 전",
    );
    const archived = publishSnapshotCandidate(
      plan,
      generation,
      candidateProof,
      "complete",
      attempt,
      options,
    );
    const payloadStats = lstatSync(generation.payload, { bigint: true });
    const receipt = receiptForPayload(
      plan,
      generation,
      archived,
      "receipt 복구 전",
      attempt,
    );
    writeExclusiveJsonWithOrigin(
      plan,
      generation.receiptPath,
      receipt,
      "generation.json",
    );
    const current = assertReceiptPayloadStillExact(
      plan,
      generation,
      receipt,
      "receipt 복구 후",
    );
    assertExactOrigin(plan);
    return {
      ...generation,
      receipt,
      payloadStats,
      proof: current,
    };
  }

  const sourceBefore = scanOmcDirectory(
    plan.residue.source,
    plan.commonDevice,
  );
  if (
    sourceBefore.device !== generation.sourceProof.device ||
    sourceBefore.inode !== generation.sourceProof.inode ||
    sourceBefore.snapshotDigest !== generation.sourceProof.snapshotDigest ||
    sourceBefore.treeDigest !== generation.sourceProof.treeDigest ||
    sourceBefore.contentDigest !== generation.sourceProof.contentDigest
  ) {
    fail("dry-run 뒤 source `.omc` snapshot이 변경되었습니다.");
  }
  options.hooks?.beforeArchiveRename?.({ plan, generation });
  assertExactOrigin(plan);
  const sourceImmediatelyBefore = scanOmcDirectory(
    plan.residue.source,
    plan.commonDevice,
  );
  if (
    stableJson(sourceImmediatelyBefore) !== stableJson(sourceBefore)
  ) {
    fail("sealed snapshot 직전 source `.omc` snapshot이 변경되었습니다.");
  }
  const attempt = ensureOwnedSnapshotRoot(
    plan,
    generation,
    options,
  );
  const scratchRoot = join(
    plan.paths.snapshotScratchDirectory,
    attempt.scratch,
  );
  const snapshotRoot = pathState(scratchRoot)
    ? scratchRoot
    : generation.pendingPayload;
  let pendingProof;
  try {
    assertExactOrigin(plan);
    pendingProof = copyOmcSnapshot(
      plan.residue.source,
      snapshotRoot,
      plan.commonDevice,
      {
        existingRoot: true,
        expectedRoot: attempt.root,
        afterRootReady({ pendingPayload }) {
          options.hooks?.afterSnapshotPayloadStarted?.({
            plan,
            generation,
            pendingPayload,
          });
          assertExactOrigin(plan);
        },
      },
    );
    assertExactOrigin(plan);
  } catch (error) {
    assertExactOrigin(plan);
    const failedProof = scanOmcDirectory(
      snapshotRoot,
      plan.commonDevice,
    );
    assertAttemptRootIdentity(
      pathState(snapshotRoot),
      attempt,
      "failed snapshot root",
    );
    writeExclusiveJsonWithOrigin(
      plan,
      generation.snapshotFailedPath,
      snapshotOutcome(
        SNAPSHOT_FAILED_SCHEMA,
        plan.archiveKey,
        generation,
        failedProof,
        attempt,
      ),
      "snapshot failed",
    );
    options.hooks?.afterSnapshotOutcomePublished?.({
      plan,
      generation,
      attempt,
      disposition:
        readdirSync(snapshotRoot).length === 0
          ? "failed-empty"
          : "partial",
    });
    assertExactOrigin(plan);
    throw error;
  }
  syncDirectory(generation.directory);
  assertExactOrigin(plan);
  const sourceAfterSnapshot = scanOmcDirectory(
    plan.residue.source,
    plan.commonDevice,
  );
  if (
    stableJson(sourceAfterSnapshot) !== stableJson(sourceBefore) ||
    pendingProof.device !== sourceBefore.device ||
    pendingProof.inode === sourceBefore.inode ||
    pendingProof.contentDigest !== sourceBefore.contentDigest
  ) {
    fail(
      "sealed snapshot 전후 source 안정성 또는 새 inode contentDigest 증거가 다릅니다.",
    );
  }
  const archived = publishSnapshotCandidate(
    plan,
    generation,
    pendingProof,
    "complete",
    attempt,
    options,
  );
  options.hooks?.afterPayloadRelocated?.({
    plan,
    generation,
    archived,
  });
  assertExactOrigin(plan);
  const beforeReceipt = scanOmcDirectory(
    generation.payload,
    plan.commonDevice,
  );
  const receipt = receiptForPayload(
    plan,
    generation,
    beforeReceipt,
    "receipt 발행 전",
    attempt,
  );
  writeExclusiveJsonWithOrigin(
    plan,
    generation.receiptPath,
    receipt,
    "generation.json",
  );
  const afterReceipt = assertReceiptPayloadStillExact(
    plan,
    generation,
    receipt,
    "receipt 발행 후",
  );
  assertExactOrigin(plan);
  return {
    ...generation,
    receipt,
    payloadStats: lstatSync(generation.payload, { bigint: true }),
    proof: afterReceipt,
  };
}

function archiveCanaryState(archive, intentArchive) {
  return {
    generations: archive.generations.map((entry) => ({
      id: entry.id,
      receipt: entry.receipt,
      proof: entry.proof,
      attempt: entry.attempt,
      completedSnapshot: entry.completedSnapshot,
      failedSnapshot: entry.failedSnapshot,
      pendingReceipts: entry.pendingReceipts.map((pending) => ({
        name: pending.name,
        proof: pending.proof,
      })),
      pendingSnapshotAttempts: entry.pendingSnapshotAttempts.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
      pendingSnapshotCompletes: entry.pendingSnapshotCompletes.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
      pendingSnapshotFailures: entry.pendingSnapshotFailures.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
    })),
    incomplete: archive.incomplete.map((entry) => ({
      id: entry.id,
      proof: entry.proof,
      pendingProof: entry.pendingProof,
      scratchProof: entry.scratchProof,
      candidateLocation: entry.candidateLocation,
      attempt: entry.attempt,
      completedSnapshot: entry.completedSnapshot,
      failedSnapshot: entry.failedSnapshot,
      pendingReceipts: entry.pendingReceipts.map((pending) => ({
        name: pending.name,
        proof: pending.proof,
      })),
      pendingSnapshotAttempts: entry.pendingSnapshotAttempts.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
      pendingSnapshotCompletes: entry.pendingSnapshotCompletes.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
      pendingSnapshotFailures: entry.pendingSnapshotFailures.map(
        (pending) => ({
          name: pending.name,
          proof: pending.proof,
        }),
      ),
    })),
    unboundSnapshotScratch: archive.unboundScratch.map((entry) => ({
      name: entry.name,
      proof: entry.proof,
    })),
    intents: intentArchive.intents.map((entry) => entry.intent),
    pendingIntentMetadata: intentArchive.pendingMetadata.map(
      (pending) => ({
        name: pending.name,
        proof: pending.proof,
      }),
    ),
  };
}

function verifyArchiveCanary(plan) {
  assertExactOrigin(plan);
  validatePrivateDirectory(plan.paths.archiveRoot, plan.commonDevice);
  validatePrivateDirectory(plan.paths.versionRoot, plan.commonDevice);
  validatePrivateDirectory(plan.paths.archiveDirectory, plan.commonDevice);
  validatePrivateDirectory(plan.paths.generationsDirectory, plan.commonDevice);
  const identity = readPrivateJson(
    plan.paths.identityFile,
    "archive identity.json",
  );
  if (stableJson(identity) !== stableJson(plan.expectedIdentity)) {
    fail("archive identity canary가 exact cleanup identity와 다릅니다.");
  }
  const archive = readGenerationArchive(
    plan.paths,
    plan.archiveKey,
    plan.commonDevice,
  );
  const intentArchive = readGenerationIntents(
    plan.paths,
    plan.archiveKey,
    plan.commonDevice,
  );
  assertGenerationIntentBindings(archive, intentArchive, {
    requireComplete: true,
  });
  if (!archive.head?.payloadStats) {
    fail("active generation payload canary가 없습니다.");
  }
  if (
    stableJson(archiveCanaryState(archive, intentArchive)) !==
    stableJson(archiveCanaryState(plan.archive, plan.intentArchive))
  ) {
    fail("archive canary가 검증한 generation snapshot과 다릅니다.");
  }
  return archive;
}

function ensureQuarantineDirectories(plan) {
  for (const directory of [
    plan.paths.quarantineDirectory,
    plan.paths.quarantineIntentsDirectory,
    plan.paths.quarantineRootsDirectory,
    plan.paths.quarantineMetadataDirectory,
    plan.paths.quarantineReceiptsDirectory,
  ]) {
    ensurePrivateDirectoryWithOrigin(plan, directory);
  }
}

function quarantineReceipt(plan) {
  return {
    schema: QUARANTINE_RECEIPT_SCHEMA,
    archiveKey: plan.archiveKey,
    quarantine: plan.quarantinePlan.id,
    root: {
      path: plan.quarantinePlan.rootDestination,
      device: plan.quarantinePlan.intent.root.device,
      inode: plan.quarantinePlan.intent.root.inode,
      mode: plan.quarantinePlan.intent.root.mode,
    },
    metadata: {
      path: plan.quarantinePlan.metadataDestination,
      device: plan.quarantinePlan.intent.metadata.device,
      inode: plan.quarantinePlan.intent.metadata.inode,
      mode: plan.quarantinePlan.intent.metadata.mode,
    },
  };
}

function assertQuarantineDirectoryIdentity(stats, expected, label) {
  if (
    !stats ||
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.dev.toString() !== expected.device ||
    stats.ino.toString() !== expected.inode ||
    modeBits(stats) !== expected.mode
  ) {
    fail(`${label}의 type·device·inode·mode가 durable intent와 다릅니다.`);
  }
}

function assertQuarantinePlumbingFiles(
  quarantinePlan,
  rootMoved,
  metadataMoved,
) {
  const root = rootMoved
    ? quarantinePlan.rootDestination
    : quarantinePlan.intent.root.path;
  const metadata = metadataMoved
    ? quarantinePlan.metadataDestination
    : quarantinePlan.intent.metadata.path;
  assertExactLocalFileProof(
    join(root, ".git"),
    quarantinePlan.intent.gitMarker,
    "quarantine worktree `.git` marker",
  );
  assertExactLocalFileProof(
    join(metadata, "commondir"),
    quarantinePlan.intent.metadataFiles.commondir,
    "quarantine metadata `commondir`",
  );
  assertExactLocalFileProof(
    join(metadata, "gitdir"),
    quarantinePlan.intent.metadataFiles.gitdir,
    "quarantine metadata `gitdir`",
  );
  assertExactLocalFileProof(
    join(metadata, "HEAD"),
    quarantinePlan.intent.metadataFiles.head,
    "quarantine metadata `HEAD`",
  );
}

function assertExactMainWorktree(plan) {
  const rootStats = pathState(plan.mainWorktree);
  if (
    !rootStats ||
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    rootStats.dev.toString() !== plan.mainWorktreeIdentity.device ||
    rootStats.ino.toString() !== plan.mainWorktreeIdentity.inode ||
    modeBits(rootStats) !== plan.mainWorktreeIdentity.mode
  ) {
    fail("quarantine canary의 main worktree root identity가 다릅니다.");
  }

  const mainBranch = gitOutput(plan.mainWorktree, [
    "branch",
    "--show-current",
  ]);
  const mainHead = readLocalRef(plan.mainWorktree, "HEAD");
  const mainRef = readLocalRef(plan.mainWorktree, "refs/heads/main");
  const originMain = readLocalRef(
    plan.mainWorktree,
    "refs/remotes/origin/main",
  );
  if (
    mainBranch !== "main" ||
    mainHead !== plan.mainHead ||
    mainRef !== plan.mainHead ||
    originMain !== plan.mainHead
  ) {
    fail(
      "quarantine canary의 main branch·HEAD·refs/heads/main·origin/main identity가 다릅니다.",
    );
  }

  if (
    runGit(plan.mainWorktree, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]).stdout
  ) {
    fail("quarantine canary의 main worktree가 clean 상태가 아닙니다.");
  }

  const currentCommonDir = realpathSync(
    gitOutput(plan.mainWorktree, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
  );
  const commonStats = pathState(currentCommonDir);
  if (
    currentCommonDir !== plan.commonDir ||
    !commonStats ||
    !commonStats.isDirectory() ||
    commonStats.isSymbolicLink() ||
    commonStats.dev !== plan.commonDevice
  ) {
    fail("quarantine canary의 Git common dir identity가 다릅니다.");
  }

  const records = readWorktrees(plan.mainWorktree);
  const mainRecords = records.filter(
    (record) => record.canonicalPath === plan.mainWorktree,
  );
  const mainBranchRecords = records.filter(
    (record) => record.branch === "refs/heads/main",
  );
  if (
    mainRecords.length !== 1 ||
    mainBranchRecords.length !== 1 ||
    mainRecords[0] !== mainBranchRecords[0] ||
    mainRecords[0].HEAD !== plan.mainHead ||
    mainRecords[0].locked ||
    mainRecords[0].prunable
  ) {
    fail("quarantine canary의 exact main worktree registration이 다릅니다.");
  }
}

function assertExactRegisteredMetadata(plan, rootQuarantined = false) {
  const records = readWorktrees(plan.mainWorktree);
  const branchRef = `refs/heads/${plan.branch}`;
  const matches = records.filter(
    (record) =>
      record.canonicalPath === plan.issueWorktree ||
      record.branch === branchRef,
  );
  if (
    matches.length !== 1 ||
    matches[0].canonicalPath !== plan.issueWorktree ||
    matches[0].branch !== branchRef ||
    matches[0].HEAD !== plan.head ||
    matches[0].locked ||
    (!rootQuarantined && matches[0].prunable)
  ) {
    fail("quarantine 직전 exact worktree registration을 재확인하지 못했습니다.");
  }
  const metadataStats = pathState(plan.quarantinePlan.intent.metadata.path);
  assertQuarantineDirectoryIdentity(
    metadataStats,
    plan.quarantinePlan.intent.metadata,
    "quarantine 직전 exact worktree metadata",
  );
}

function verifyQuarantineCanary(plan, stage) {
  assertExactMainWorktree(plan);
  if (readLocalRef(plan.mainWorktree, plan.branchRef) !== plan.head) {
    fail("quarantine canary의 issue local ref identity가 다릅니다.");
  }
  verifyArchiveCanary(plan);
  const state = readQuarantineArchive(
    plan.paths,
    plan.archiveKey,
    plan.commonDevice,
  );
  if (
    !state.intentEntry ||
    state.intentEntry.id !== plan.quarantinePlan.id ||
    stableJson(state.intentEntry.intent) !==
      stableJson(plan.quarantinePlan.intent)
  ) {
    fail("quarantine canary의 durable intent가 exact plan과 다릅니다.");
  }
  if (
    state.pendingIntentMetadata.length > 0 ||
    state.pendingReceiptMetadata.length > 0
  ) {
    fail("quarantine canary에 pending metadata가 남아 있습니다.");
  }

  const expectRoot = ["root", "metadata", "complete"].includes(stage);
  const expectMetadata = ["metadata", "complete"].includes(stage);
  const expectReceipt = stage === "complete";
  if (
    Boolean(state.rootDestinationStats) !== expectRoot ||
    Boolean(state.metadataDestinationStats) !== expectMetadata ||
    Boolean(state.receipt) !== expectReceipt
  ) {
    fail(`quarantine canary의 ${stage} transition 상태가 다릅니다.`);
  }
  if (
    expectReceipt &&
    stableJson(state.receipt) !== stableJson(quarantineReceipt(plan))
  ) {
    fail("quarantine canary의 receipt가 exact intent와 다릅니다.");
  }

  if (stage === "intent") {
    assertQuarantineDirectoryIdentity(
      pathState(plan.issueWorktree),
      plan.quarantinePlan.intent.root,
      "quarantine intent stage worktree root",
    );
    assertExactRegisteredMetadata(plan);
  } else if (stage === "root") {
    assertExactRegisteredMetadata(plan, true);
  } else {
    const remaining = readWorktrees(plan.mainWorktree).filter(
      (record) =>
        record.canonicalPath === plan.issueWorktree ||
        record.branch === plan.branchRef,
    );
    if (remaining.length > 0) {
      fail("quarantine metadata stage에 worktree registration이 남아 있습니다.");
    }
  }
  assertQuarantinePlumbingFiles(
    plan.quarantinePlan,
    expectRoot,
    expectMetadata,
  );
  if (expectRoot) {
    readQuarantinedWorktreeResidue(plan);
  }
  return state;
}

function performWorktreeQuarantine(plan, options) {
  verifyArchiveCanary(plan);
  ensureQuarantineDirectories(plan);
  verifyArchiveCanary(plan);
  writeExclusiveJsonWithOrigin(
    plan,
    plan.quarantinePlan.intentPath,
    plan.quarantinePlan.intent,
    "quarantine intent",
  );
  options.hooks?.afterQuarantineIntentPublished?.({ plan });
  const initialStage = pathState(plan.quarantinePlan.receiptPath)
    ? "complete"
    : pathState(plan.quarantinePlan.metadataDestination)
      ? "metadata"
      : pathState(plan.quarantinePlan.rootDestination)
        ? "root"
        : "intent";
  const initialState = verifyQuarantineCanary(plan, initialStage);
  let rootDestinationStats = initialState.rootDestinationStats;
  let metadataDestinationStats =
    initialState.metadataDestinationStats;
  if (initialStage === "complete") {
    return {
      rootDestinationStats,
      metadataDestinationStats,
      boundedResidue: Boolean(pathState(plan.issueWorktree)),
    };
  }

  if (!rootDestinationStats) {
    const originalRoot = pathState(plan.issueWorktree);
    assertQuarantineDirectoryIdentity(
      originalRoot,
      plan.quarantinePlan.intent.root,
      "worktree root quarantine 직전 original",
    );
    assertExactRegisteredMetadata(plan);
    let rootDescriptor;
    try {
      rootDescriptor = openSync(
        plan.issueWorktree,
        fsConstants.O_RDONLY |
          (fsConstants.O_DIRECTORY ?? 0) |
          (fsConstants.O_NOFOLLOW ?? 0),
      );
      assertQuarantineDirectoryIdentity(
        fstatSync(rootDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.root,
        "worktree root quarantine FD",
      );
      verifyQuarantineCanary(plan, "intent");
      options.hooks?.beforeWorktreeQuarantine?.({ plan });
      if (pathState(plan.quarantinePlan.rootDestination)) {
        fail("worktree root quarantine destination collision이 있습니다.");
      }
      assertQuarantineDirectoryIdentity(
        fstatSync(rootDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.root,
        "worktree root quarantine hook 뒤 FD",
      );
      assertQuarantineDirectoryIdentity(
        pathState(plan.issueWorktree),
        plan.quarantinePlan.intent.root,
        "worktree root quarantine hook 뒤 original",
      );
      assertExactRegisteredMetadata(plan);
      verifyQuarantineCanary(plan, "intent");
      assertQuarantineDirectoryIdentity(
        fstatSync(rootDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.root,
        "worktree root quarantine canary 뒤 FD",
      );
      assertQuarantineDirectoryIdentity(
        pathState(plan.issueWorktree),
        plan.quarantinePlan.intent.root,
        "worktree root quarantine canary 뒤 original",
      );
      assertExactRegisteredMetadata(plan);
      assertExactOrigin(plan);
      options.hooks?.afterRootOriginCanary?.({ plan });
      readWorktreeResidue(plan.issueWorktree, plan.archive.head);
      const rootMove = atomicRenameNoReplace(
        plan.issueWorktree,
        plan.quarantinePlan.rootDestination,
        "worktree root quarantine",
      );
      if (rootMove === "exists") {
        fail("worktree root quarantine destination collision이 있습니다.");
      }
      syncDirectory(dirname(plan.issueWorktree));
      syncDirectory(plan.paths.quarantineRootsDirectory);
      rootDestinationStats = validateMovedDirectory(
        plan.quarantinePlan.rootDestination,
        plan.commonDevice,
        plan.quarantinePlan.intent.root.inode,
        plan.quarantinePlan.intent.root.mode,
        "quarantined worktree root",
      );
      verifyQuarantineCanary(plan, "root");
    } finally {
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
    }
    options.hooks?.afterWorktreeQuarantine?.({ plan });
    verifyQuarantineCanary(plan, "root");
  } else {
    validateMovedDirectory(
      plan.quarantinePlan.rootDestination,
      plan.commonDevice,
      plan.quarantinePlan.intent.root.inode,
      plan.quarantinePlan.intent.root.mode,
      "quarantined worktree root",
    );
    verifyQuarantineCanary(
      plan,
      metadataDestinationStats ? "metadata" : "root",
    );
  }

  if (!metadataDestinationStats) {
    assertExactRegisteredMetadata(plan, true);
    let metadataDescriptor;
    try {
      metadataDescriptor = openSync(
        plan.quarantinePlan.intent.metadata.path,
        fsConstants.O_RDONLY |
          (fsConstants.O_DIRECTORY ?? 0) |
          (fsConstants.O_NOFOLLOW ?? 0),
      );
      assertQuarantineDirectoryIdentity(
        fstatSync(metadataDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.metadata,
        "worktree metadata quarantine FD",
      );
      verifyQuarantineCanary(plan, "root");
      options.hooks?.beforeMetadataQuarantine?.({ plan });
      if (pathState(plan.quarantinePlan.metadataDestination)) {
        fail("worktree metadata quarantine destination collision이 있습니다.");
      }
      assertQuarantineDirectoryIdentity(
        fstatSync(metadataDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.metadata,
        "worktree metadata quarantine hook 뒤 FD",
      );
      assertQuarantineDirectoryIdentity(
        pathState(plan.quarantinePlan.intent.metadata.path),
        plan.quarantinePlan.intent.metadata,
        "worktree metadata quarantine hook 뒤 original",
      );
      assertExactRegisteredMetadata(plan, true);
      verifyQuarantineCanary(plan, "root");
      assertQuarantineDirectoryIdentity(
        fstatSync(metadataDescriptor, { bigint: true }),
        plan.quarantinePlan.intent.metadata,
        "worktree metadata quarantine canary 뒤 FD",
      );
      assertQuarantineDirectoryIdentity(
        pathState(plan.quarantinePlan.intent.metadata.path),
        plan.quarantinePlan.intent.metadata,
        "worktree metadata quarantine canary 뒤 original",
      );
      assertExactRegisteredMetadata(plan, true);
      assertExactOrigin(plan);
      const metadataMove = atomicRenameNoReplace(
        plan.quarantinePlan.intent.metadata.path,
        plan.quarantinePlan.metadataDestination,
        "worktree metadata quarantine",
      );
      if (metadataMove === "exists") {
        fail("worktree metadata quarantine destination collision이 있습니다.");
      }
      syncDirectory(dirname(plan.quarantinePlan.intent.metadata.path));
      syncDirectory(plan.paths.quarantineMetadataDirectory);
      metadataDestinationStats = validateMovedDirectory(
        plan.quarantinePlan.metadataDestination,
        plan.commonDevice,
        plan.quarantinePlan.intent.metadata.inode,
        plan.quarantinePlan.intent.metadata.mode,
        "quarantined worktree metadata",
      );
      verifyQuarantineCanary(plan, "metadata");
    } finally {
      if (metadataDescriptor !== undefined) closeSync(metadataDescriptor);
    }
    options.hooks?.afterMetadataQuarantine?.({ plan });
    verifyQuarantineCanary(plan, "metadata");
  } else {
    validateMovedDirectory(
      plan.quarantinePlan.metadataDestination,
      plan.commonDevice,
      plan.quarantinePlan.intent.metadata.inode,
      plan.quarantinePlan.intent.metadata.mode,
      "quarantined worktree metadata",
    );
    verifyQuarantineCanary(plan, "metadata");
  }

  const remaining = readWorktrees(plan.mainWorktree).filter(
    (record) =>
      record.canonicalPath === plan.issueWorktree ||
      record.branch === plan.branchRef,
  );
  if (remaining.length > 0) {
    fail("metadata quarantine 뒤 worktree registration이 남아 있습니다.");
  }
  verifyQuarantineCanary(plan, "metadata");
  writeExclusiveJsonWithOrigin(
    plan,
    plan.quarantinePlan.receiptPath,
    quarantineReceipt(plan),
    "quarantine receipt",
  );
  verifyQuarantineCanary(plan, "complete");
  options.hooks?.afterQuarantineReceiptPublished?.({ plan });
  verifyQuarantineCanary(plan, "complete");
  return {
    rootDestinationStats,
    metadataDestinationStats,
    boundedResidue: Boolean(pathState(plan.issueWorktree)),
  };
}

function removeExactPendingMetadata(
  plan,
  entries,
  directory,
  commonDevice,
  label,
) {
  if (entries.length === 0) return false;
  for (const entry of entries) {
    const currentProof = validatePendingJson(
      entry.path,
      commonDevice,
      label,
    );
    if (stableJson(currentProof) !== stableJson(entry.proof)) {
      fail(`${label} pending metadata가 dry-run snapshot 뒤 변경되었습니다.`);
    }
    assertExactOrigin(plan);
    try {
      unlinkSync(entry.path);
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail(`${label} pending metadata가 cleanup 직전에 사라졌습니다.`);
      }
      throw error;
    }
    assertExactOrigin(plan);
  }
  syncDirectory(directory);
  assertExactOrigin(plan);
  return true;
}

function cleanupPublishedPendingMetadata(plan) {
  assertExactOrigin(plan);
  let changed = false;
  if (plan.identityState.identityExists) {
    changed =
      removeExactPendingMetadata(
        plan,
        plan.identityState.pendingIdentity,
        plan.paths.archiveDirectory,
        plan.commonDevice,
        "archive identity.json",
      ) || changed;
  }
  for (const generation of plan.archive.generations) {
    changed =
      removeExactPendingMetadata(
        plan,
        generation.pendingReceipts,
        generation.directory,
        plan.commonDevice,
        "generation.json",
      ) || changed;
  }
  for (const generation of [
    ...plan.archive.generations,
    ...plan.archive.incomplete,
  ]) {
    for (const [entries, finalPath, label] of [
      [
        generation.pendingSnapshotAttempts,
        generation.snapshotAttemptPath,
        "snapshot attempt",
      ],
      [
        generation.pendingSnapshotCompletes,
        generation.snapshotCompletePath,
        "snapshot complete",
      ],
      [
        generation.pendingSnapshotFailures,
        generation.snapshotFailedPath,
        "snapshot failed",
      ],
    ]) {
      if (!pathState(finalPath)) continue;
      changed =
        removeExactPendingMetadata(
          plan,
          entries,
          generation.directory,
          plan.commonDevice,
          label,
        ) || changed;
    }
  }
  const publishedIntentIds = new Set(
    plan.intentArchive.intents.map((entry) => entry.id),
  );
  const publishedIntentPending = plan.intentArchive.pendingMetadata.filter(
    (entry) => {
      const match = entry.name.match(
        /^\.([0-9a-f]{64})\.json\.pending-[0-9a-f]{64}$/,
      );
      return match && publishedIntentIds.has(match[1]);
    },
  );
  changed =
    removeExactPendingMetadata(
      plan,
      publishedIntentPending,
      plan.paths.intentsDirectory,
      plan.commonDevice,
      "generation intent",
    ) || changed;
  if (plan.quarantineArchive.intentEntry) {
    changed =
      removeExactPendingMetadata(
        plan,
        plan.quarantineArchive.pendingIntentMetadata,
        plan.paths.quarantineIntentsDirectory,
        plan.commonDevice,
        "quarantine intent",
      ) || changed;
  }
  if (plan.quarantineArchive.receipt) {
    changed =
      removeExactPendingMetadata(
        plan,
        plan.quarantineArchive.pendingReceiptMetadata,
        plan.paths.quarantineReceiptsDirectory,
        plan.commonDevice,
        "quarantine receipt",
      ) || changed;
  }
  assertExactOrigin(plan);
  return changed;
}

function deleteLocalRefWithCanary(plan, rawInput, options) {
  verifyArchiveCanary(plan);
  options.hooks?.beforeRefDelete?.({ plan });
  verifyArchiveCanary(plan);
  const fresh = buildCleanupPlanWithOriginCanary(rawInput, plan);
  if (
    fresh.planToken !== plan.planToken ||
    fresh.action !== "delete-ref-recovery" ||
    fresh.localRef !== plan.head ||
    fresh.issueRegistered ||
    fresh.archive.head?.id !== plan.archive.head?.id ||
    fresh.quarantinePlan.id !== plan.quarantinePlan.id ||
    stableJson(fresh.quarantineArchive.receipt) !==
      stableJson(plan.quarantineArchive.receipt)
  ) {
    fail(
      "local ref CAS 직전 exact quarantine receipt·payload·registration snapshot이 다릅니다.",
    );
  }
  verifyArchiveCanary(fresh);
  assertExactOrigin(fresh);
  readQuarantinedWorktreeResidue(fresh);
  runGit(fresh.mainWorktree, [
    "update-ref",
    "-d",
    fresh.branchRef,
    fresh.head,
  ]);
  verifyArchiveCanary(fresh);
  return fresh;
}

export function executeLocalCleanup(rawInput, options = {}) {
  let plan = buildCleanupPlan(rawInput);
  assertPlanToken(rawInput.planToken ?? options.planToken, plan.planToken);
  const originalAction = plan.action;
  const originalPlannedGeneration = plan.plannedGeneration?.id ?? null;
  const originalRecoveryGeneration = plan.recoveryGeneration?.id ?? null;
  if (cleanupPublishedPendingMetadata(plan)) {
    plan = buildCleanupPlanWithOriginCanary(rawInput, plan);
    if (
      plan.action !== originalAction ||
      (plan.plannedGeneration?.id ?? null) !== originalPlannedGeneration ||
      (plan.recoveryGeneration?.id ?? null) !== originalRecoveryGeneration
    ) {
      fail("published pending metadata cleanup 뒤 semantic plan이 변경되었습니다.");
    }
  }

  if (plan.action === "satisfied") {
    verifyArchiveCanary(plan);
    return {
      status: "satisfied",
      action: plan.action,
      archiveKey: plan.archiveKey,
      branch: plan.branch,
      head: plan.head,
      boundedResidue: plan.quarantinePlan.boundedResidue,
    };
  }
  if (plan.action === "delete-ref-recovery") {
    const deletedPlan = deleteLocalRefWithCanary(
      plan,
      rawInput,
      options,
    );
    const finalPlan = buildCleanupPlanWithOriginCanary(
      rawInput,
      deletedPlan,
    );
    if (finalPlan.action !== "satisfied") {
      fail("local branch CAS 뒤 cleanup 완료 상태를 재확인하지 못했습니다.");
    }
    verifyArchiveCanary(finalPlan);
    return {
      status: "completed",
      action: plan.action,
      archiveKey: plan.archiveKey,
      branch: plan.branch,
      head: plan.head,
      boundedResidue: finalPlan.quarantinePlan.boundedResidue,
    };
  }
  if (plan.action === "quarantine-recovery") {
    ensureArchiveIdentity(plan);
    performWorktreeQuarantine(plan, options);
    options.hooks?.afterWorktreeRemove?.({ plan });
    const afterQuarantine = buildCleanupPlanWithOriginCanary(
      rawInput,
      plan,
    );
    if (afterQuarantine.action !== "delete-ref-recovery") {
      fail("worktree quarantine 뒤 metadata-only registration 제거를 재확인하지 못했습니다.");
    }
    verifyArchiveCanary(afterQuarantine);
    const deletedPlan = deleteLocalRefWithCanary(
      afterQuarantine,
      rawInput,
      options,
    );
    const finalPlan = buildCleanupPlanWithOriginCanary(
      rawInput,
      deletedPlan,
    );
    if (finalPlan.action !== "satisfied") {
      fail("quarantine recovery의 local ref CAS 뒤 완료 상태가 아닙니다.");
    }
    verifyArchiveCanary(finalPlan);
    return {
      status: "completed",
      action: plan.action,
      archiveKey: plan.archiveKey,
      branch: plan.branch,
      head: plan.head,
      boundedResidue: finalPlan.quarantinePlan.boundedResidue,
    };
  }

  ensureArchiveIdentity(plan);
  let activeGeneration = plan.activeGeneration;
  if (plan.recoveryGeneration) {
    activeGeneration = prepareGeneration(
      plan,
      options,
      plan.recoveryGeneration,
    );
    options.hooks?.afterRecoveryGenerationSealed?.({
      plan,
      activeGeneration,
    });
  }
  if (plan.plannedGeneration) {
    activeGeneration = prepareGeneration(
      plan,
      options,
      plan.plannedGeneration,
    );
    options.hooks?.afterGenerationPrepared?.({ plan, activeGeneration });
  }
  if (!activeGeneration) {
    const refreshed = buildCleanupPlanWithOriginCanary(
      rawInput,
      plan,
    );
    activeGeneration = refreshed.archive.head;
  }
  options.hooks?.afterArchiveReady?.({ plan, activeGeneration });

  const beforeRemove = buildCleanupPlanWithOriginCanary(rawInput, plan);
  if (
    beforeRemove.action === "append-generation" ||
    beforeRemove.action.startsWith("seal-")
  ) {
    fail(
      "sealed snapshot 이후 source `.omc`가 변경되었습니다. 이후 mutation 없이 새 dry-run으로 다음 generation을 준비해야 합니다.",
    );
  }
  if (
    beforeRemove.action !== "quarantine-ready" ||
    beforeRemove.archive.head?.id !== activeGeneration.id ||
    beforeRemove.localRef !== plan.head
  ) {
    fail("worktree 제거 직전 exact bridge·generation·local ref가 일치하지 않습니다.");
  }
  verifyArchiveCanary(beforeRemove);
  options.hooks?.beforeRemove?.({ plan: beforeRemove, activeGeneration });

  const finalBridgePlan = buildCleanupPlanWithOriginCanary(
    rawInput,
    beforeRemove,
  );
  if (
    finalBridgePlan.action !== "quarantine-ready" ||
    finalBridgePlan.archive.head?.id !== activeGeneration.id
  ) {
    fail("worktree quarantine 직전 archive 또는 `.omc` 상태가 변경되었습니다.");
  }
  performWorktreeQuarantine(finalBridgePlan, options);
  options.hooks?.afterWorktreeRemove?.({
    plan: finalBridgePlan,
    activeGeneration,
  });

  const afterRemove = buildCleanupPlanWithOriginCanary(
    rawInput,
    finalBridgePlan,
  );
  if (afterRemove.action !== "delete-ref-recovery") {
    fail("worktree root·metadata quarantine 결과를 exact receipt로 확인하지 못했습니다.");
  }
  verifyArchiveCanary(afterRemove);
  const deletedPlan = deleteLocalRefWithCanary(
    afterRemove,
    rawInput,
    options,
  );
  const finalPlan = buildCleanupPlanWithOriginCanary(
    rawInput,
    deletedPlan,
  );
  if (finalPlan.action !== "satisfied") {
    fail("local ref old-OID CAS 뒤 cleanup 완료 상태를 재확인하지 못했습니다.");
  }
  verifyArchiveCanary(finalPlan);
  return {
    status: "completed",
    action: plan.action,
    archiveKey: plan.archiveKey,
    branch: plan.branch,
    head: plan.head,
    boundedResidue: finalPlan.quarantinePlan.boundedResidue,
  };
}

function usage() {
  return [
    "사용법:",
    "  finalize-local-cleanup.mjs --issue-worktree <path> --main-worktree <path> --branch <branch> --head <40-sha> --repo <owner/repo> --issue <number> --pr <number> --dry-run",
    "  finalize-local-cleanup.mjs --issue-worktree <path> --main-worktree <path> --branch <branch> --head <40-sha> --repo <owner/repo> --issue <number> --pr <number> --execute --plan-token <64-sha>",
  ].join("\n");
}

export function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  const valueOptions = new Set([
    "--issue-worktree",
    "--main-worktree",
    "--branch",
    "--head",
    "--repo",
    "--issue",
    "--pr",
    "--plan-token",
  ]);
  const flagOptions = new Set(["--dry-run", "--execute"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flagOptions.has(argument)) {
      if (flags.has(argument)) throw new UsageError(`중복 인자: ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new UsageError(`알 수 없는 인자: ${argument}`);
    }
    if (values.has(argument)) throw new UsageError(`중복 인자: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || valueOptions.has(value) || flagOptions.has(value)) {
      throw new UsageError(`${argument} 값이 필요합니다.`);
    }
    values.set(argument, value);
    index += 1;
  }
  for (const option of [
    "--issue-worktree",
    "--main-worktree",
    "--branch",
    "--head",
    "--repo",
    "--issue",
    "--pr",
  ]) {
    if (!values.has(option)) throw new UsageError(`필수 인자가 없습니다: ${option}`);
  }
  if (flags.size !== 1) {
    throw new UsageError("`--dry-run`과 `--execute` 중 하나만 지정해야 합니다.");
  }
  if (flags.has("--execute") && !values.has("--plan-token")) {
    throw new UsageError("mutation 전에 dry-run의 `--plan-token`이 필요합니다.");
  }
  if (flags.has("--dry-run") && values.has("--plan-token")) {
    throw new UsageError("`--dry-run`에는 `--plan-token`을 지정하지 않습니다.");
  }
  return {
    mode: flags.has("--dry-run") ? "dry-run" : "execute",
    issueWorktree: values.get("--issue-worktree"),
    mainWorktree: values.get("--main-worktree"),
    branch: values.get("--branch"),
    head: values.get("--head"),
    repo: values.get("--repo"),
    issue: values.get("--issue"),
    pullRequest: values.get("--pr"),
    planToken: values.get("--plan-token"),
  };
}

async function main() {
  let input;
  try {
    input = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  try {
    if (input.mode === "dry-run") {
      console.log(JSON.stringify(publicPlan(buildCleanupPlan(input))));
    } else {
      console.log(JSON.stringify(executeLocalCleanup(input)));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
