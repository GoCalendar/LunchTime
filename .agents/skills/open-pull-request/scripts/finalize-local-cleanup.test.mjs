import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildCleanupPlan,
  executeLocalCleanup,
  parseArguments,
} from "./finalize-local-cleanup.mjs";

const scriptPath = fileURLToPath(
  new URL("./finalize-local-cleanup.mjs", import.meta.url),
);
const fixtureBranch = "work/issue-51-cleanup-fixture";
const fixtureRepository = "thumbsup-studio/lunchtime";
const fixtureFetchUrl =
  "https://github.com/thumbsup-studio/lunchtime.git";
const fixturePushUrl =
  "git@github.com:thumbsup-studio/lunchtime.git";
const alternateFixturePushUrl =
  "ssh://git@github.com/thumbsup-studio/lunchtime.git";

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const allowedStatuses = options.allowedStatuses ?? [0];
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(
      `${command} ${arguments_.join(" ")} failed: ${
        result.stderr.trim() || result.error?.message || result.status
      }`,
    );
  }
  return result;
}

function git(cwd, arguments_, options = {}) {
  return run("git", arguments_, { cwd, ...options });
}

function gitOutput(cwd, arguments_) {
  return git(cwd, arguments_).stdout.replace(/\r?\n$/, "");
}

function quarantinedGit(plan, arguments_) {
  const metadataPath = existsSync(
    plan.quarantinePlan.metadataDestination,
  )
    ? plan.quarantinePlan.metadataDestination
    : plan.quarantinePlan.intent.metadata.path;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_COMMON_DIR: plan.commonDir,
    GIT_DIR: plan.commonDir,
    GIT_INDEX_FILE: join(metadataPath, "index"),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_WORK_TREE: plan.quarantinePlan.rootDestination,
  });
  return git(plan.quarantinePlan.rootDestination, arguments_, { env });
}

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "lunchtime-local-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const origin = join(root, "origin.git");
  const mainWorktree = join(root, "main");
  const issueWorktree = join(root, "issue worktree");

  git(root, ["init", "--bare", origin]);
  git(root, ["init", "--initial-branch=main", mainWorktree]);
  git(mainWorktree, ["config", "user.name", "Fixture User"]);
  git(mainWorktree, ["config", "user.email", "fixture@example.com"]);

  writeFileSync(join(mainWorktree, "README.md"), "fixture v1\n");
  writeFileSync(
    join(mainWorktree, ".gitignore"),
    [
      options.omcIgnore ?? ".omc",
      ".DS_Store",
      "**/.idea/workspace.xml",
      "",
    ].join("\n"),
  );
  git(mainWorktree, ["add", "--", "README.md", ".gitignore"]);
  git(mainWorktree, ["commit", "-m", "chore: #51 - fixture 기반을 만든다"]);

  writeFileSync(join(mainWorktree, "README.md"), "fixture v2\n");
  git(mainWorktree, ["add", "--", "README.md"]);
  git(mainWorktree, ["commit", "-m", "chore: #51 - fixture head를 만든다"]);

  git(mainWorktree, ["remote", "add", "origin", origin]);
  git(mainWorktree, ["push", "-u", "origin", "main"]);
  git(mainWorktree, ["remote", "set-url", "origin", fixtureFetchUrl]);
  git(mainWorktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    fixturePushUrl,
  ]);
  git(mainWorktree, ["branch", fixtureBranch]);
  git(mainWorktree, [
    "worktree",
    "add",
    "--",
    issueWorktree,
    fixtureBranch,
  ]);

  const head = gitOutput(mainWorktree, ["rev-parse", "HEAD"]).toLowerCase();
  const parent = gitOutput(mainWorktree, ["rev-parse", "HEAD^"]).toLowerCase();
  return {
    root,
    origin,
    mainWorktree,
    issueWorktree,
    branch: fixtureBranch,
    head,
    parent,
    repo: fixtureRepository,
    issue: 51,
    pullRequest: 51,
  };
}

function cliArguments(fixture) {
  return [
    "--issue-worktree",
    fixture.issueWorktree,
    "--main-worktree",
    fixture.mainWorktree,
    "--branch",
    fixture.branch,
    "--head",
    fixture.head,
    "--repo",
    fixture.repo,
    "--issue",
    String(fixture.issue),
    "--pr",
    String(fixture.pullRequest),
  ];
}

function localRef(fixture) {
  const result = git(
    fixture.mainWorktree,
    [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${fixture.branch}^{commit}`,
    ],
    { allowedStatuses: [0, 1] },
  );
  return result.status === 0 ? result.stdout.trim().toLowerCase() : null;
}

function recoveryCandidatePath(plan, generation) {
  if (generation.candidateLocation === "scratch") {
    return join(
      plan.paths.snapshotScratchDirectory,
      generation.snapshotAttempt.scratch,
    );
  }
  if (generation.candidateLocation === "pending") {
    return generation.pendingPayload;
  }
  if (generation.candidateLocation === "current") {
    return generation.payload;
  }
  throw new Error("recovery candidate location is not available");
}

function failBeforeFirstSnapshotEntry(fixture) {
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "state.json"), '{"state":"initial"}\n');
  const initial = buildCleanupPlan(fixture);
  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterSnapshotPayloadStarted() {
              throw new Error("fail before first snapshot entry");
            },
          },
        },
      ),
    /fail before first snapshot entry/,
  );
  assert.equal(
    existsSync(initial.plannedGeneration.snapshotFailedPath),
    true,
  );
  const attempt = JSON.parse(
    readFileSync(
      initial.plannedGeneration.snapshotAttemptPath,
      "utf8",
    ),
  );
  const scratchRoot = join(
    initial.paths.snapshotScratchDirectory,
    attempt.scratch,
  );
  assert.deepEqual(readdirSync(scratchRoot), []);
  return { initial, source, scratchRoot, attempt };
}

function replaceThroughOpenDescriptor(descriptor, content) {
  ftruncateSync(descriptor, 0);
  writeSync(descriptor, content, 0, "utf8");
  fsyncSync(descriptor);
}

function assertWorktreeAbsent(fixture) {
  const list = git(
    fixture.mainWorktree,
    ["worktree", "list", "--porcelain"],
  ).stdout;
  assert.doesNotMatch(list, new RegExp(fixture.issueWorktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(existsSync(fixture.issueWorktree), false);
}

test("CLI는 dry-run token 뒤 clean worktree를 atomic quarantine하고 ref를 CAS 삭제한다", (t) => {
  const fixture = createFixture(t);
  const dryRun = run(
    process.execPath,
    [scriptPath, ...cliArguments(fixture), "--dry-run"],
    { cwd: fixture.mainWorktree },
  );
  const plan = JSON.parse(dryRun.stdout);

  assert.equal(plan.status, "planned");
  assert.equal(plan.action, "create-empty-generation");
  assert.match(plan.planToken, /^[0-9a-f]{64}$/);
  assert.equal(plan.repository, fixtureRepository);
  assert.equal(plan.origin.remote, "origin");
  assert.match(plan.origin.fetchFingerprint, /^[0-9a-f]{64}$/);
  assert.match(plan.origin.pushFingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(dryRun.stdout, /github\.com/);
  assert.equal(existsSync(plan.archiveDirectory), false);

  const execution = run(
    process.execPath,
    [
      scriptPath,
      ...cliArguments(fixture),
      "--execute",
      "--plan-token",
      plan.planToken,
    ],
    { cwd: fixture.mainWorktree },
  );
  const result = JSON.parse(execution.stdout);

  assert.equal(result.status, "completed");
  assert.doesNotMatch(execution.stdout, /github\.com/);
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
  assert.equal(existsSync(plan.identityFile), true);
  assert.equal(lstatSync(plan.archiveDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(plan.identityFile).mode & 0o777, 0o600);
  assert.equal(existsSync(plan.plannedPayload), true);
});

test("old head의 `.omc/` ignore에서도 directory 유무와 무관하게 quarantine한다", async (t) => {
  for (const withDirectory of [true, false]) {
    await t.test(withDirectory ? "directory present" : "directory absent", (child) => {
      const fixture = createFixture(child, { omcIgnore: ".omc/" });
      const source = join(fixture.issueWorktree, ".omc");
      if (withDirectory) {
        mkdirSync(source);
        writeFileSync(join(source, "old-head.json"), '{"oldHead":true}\n');
      }
      const plan = buildCleanupPlan(fixture);
      assert.equal(
        plan.action,
        withDirectory ? "create-generation" : "create-empty-generation",
      );

      const result = executeLocalCleanup({
        ...fixture,
        planToken: plan.planToken,
      });
      assert.equal(result.status, "completed");
      assertWorktreeAbsent(fixture);
      assert.equal(localRef(fixture), null);
      assert.equal(
        existsSync(plan.quarantinePlan.rootDestination),
        true,
      );
      if (withDirectory) {
        assert.equal(
          readFileSync(
            join(plan.plannedGeneration.payload, "old-head.json"),
            "utf8",
          ),
          '{"oldHead":true}\n',
        );
      }
    });
  }
});

test("`.omc`를 새 inode sealed snapshot으로 복제하고 mutable 원본은 root quarantine에 보존한다", (t) => {
  const fixture = createFixture(t);
  const omc = join(fixture.issueWorktree, ".omc");
  mkdirSync(join(omc, "state", "sessions"), { recursive: true });
  writeFileSync(join(omc, "state", "sessions", "one.json"), '{"ok":true}\n');
  writeFileSync(join(omc, "notepad.md"), "local runtime state\n");
  const sourceInode = lstatSync(omc).ino;

  const plan = buildCleanupPlan(fixture);
  assert.equal(plan.action, "create-generation");
  const payload = plan.plannedGeneration.payload;
  const result = executeLocalCleanup({
    ...fixture,
    planToken: plan.planToken,
  });

  assert.equal(result.status, "completed");
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
  assert.notEqual(lstatSync(payload).ino, sourceInode);
  assert.equal(
    lstatSync(
      join(plan.quarantinePlan.rootDestination, ".omc"),
    ).ino,
    sourceInode,
  );
  assert.equal(
    readFileSync(
      join(payload, "state", "sessions", "one.json"),
      "utf8",
    ),
    '{"ok":true}\n',
  );
  assert.equal(
    readFileSync(join(payload, "notepad.md"), "utf8"),
    "local runtime state\n",
  );
  const generationReceipt = JSON.parse(
    readFileSync(plan.plannedGeneration.receiptPath, "utf8"),
  );
  assert.equal(
    generationReceipt.payloadProof.inode,
    String(lstatSync(payload).ino),
  );
  assert.equal(
    generationReceipt.payloadProof.contentDigest,
    plan.plannedGeneration.sourceProof.contentDigest,
  );
  assert.match(generationReceipt.intentDigest, /^[0-9a-f]{64}$/);
  assert.equal(lstatSync(plan.paths.archiveDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(plan.paths.identityFile).mode & 0o777, 0o600);
});

test("sealed snapshot publication 뒤 archived content가 변경되면 receipt·quarantine·ref CAS 전에 차단한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "state.json"), '{"phase":"before"}\n');
  const plan = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: plan.planToken },
        {
          hooks: {
            afterPayloadRelocated({ generation }) {
              writeFileSync(
                join(generation.payload, "state.json"),
                '{"phase":"concurrent-writer"}\n',
              );
            },
          },
        },
      ),
    /sealed snapshot.*contentDigest/,
  );

  assert.equal(existsSync(plan.plannedGeneration.receiptPath), false);
  assert.equal(existsSync(plan.quarantinePlan.rootDestination), false);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
  assert.match(
    git(fixture.mainWorktree, ["worktree", "list", "--porcelain"]).stdout,
    new RegExp(
      fixture.issueWorktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
});

test("sealed snapshot 도중 open FD source writer가 변경하면 현재 실행은 fail-closed하고 새 snapshot으로 복구한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  const sourceFile = join(source, "state.json");
  mkdirSync(source);
  writeFileSync(sourceFile, '{"phase":"before"}\n');
  const descriptor = openSync(sourceFile, "r+");
  const initial = buildCleanupPlan(fixture);

  try {
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterPayloadRelocated() {
                replaceThroughOpenDescriptor(
                  descriptor,
                  '{"phase":"open-fd-writer"}\n',
                );
              },
            },
          },
        ),
      /sealed snapshot 이후 source.*변경/,
    );
  } finally {
    closeSync(descriptor);
  }

  assert.equal(localRef(fixture), fixture.head);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(
    readFileSync(
      join(initial.plannedGeneration.payload, "state.json"),
      "utf8",
    ),
    '{"phase":"before"}\n',
  );
  assert.equal(
    readFileSync(sourceFile, "utf8"),
    '{"phase":"open-fd-writer"}\n',
  );

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "append-generation");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(
    readFileSync(
      join(recovery.plannedGeneration.payload, "state.json"),
      "utf8",
    ),
    '{"phase":"open-fd-writer"}\n',
  );
  assert.equal(
    readFileSync(
      join(
        recovery.quarantinePlan.rootDestination,
        ".omc",
        "state.json",
      ),
      "utf8",
    ),
    '{"phase":"open-fd-writer"}\n',
  );
});

test("partial sealed snapshot은 append-only orphan으로 봉인하고 현재 source를 새 generation에 보존한다", async (t) => {
  for (const sourceDrift of [false, true]) {
    await t.test(sourceDrift ? "source drift" : "stable source", (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(join(source, "state"), { recursive: true });
      writeFileSync(join(source, "a.json"), '{"a":"source"}\n');
      writeFileSync(
        join(source, "state", "b.json"),
        '{"b":"source"}\n',
      );
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterSnapshotPayloadStarted({ pendingPayload }) {
                  mkdirSync(join(pendingPayload, "state"));
                  writeFileSync(
                    join(pendingPayload, "a.json"),
                    '{"a":"partial"}\n',
                  );
                  throw new Error("simulated ENOSPC during snapshot");
                },
              },
            },
          ),
        /simulated ENOSPC during snapshot/,
      );
      assert.equal(
        existsSync(initial.plannedGeneration.receiptPath),
        false,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        readFileSync(join(source, "a.json"), "utf8"),
        '{"a":"source"}\n',
      );
      assert.equal(
        readFileSync(join(source, "state", "b.json"), "utf8"),
        '{"b":"source"}\n',
      );

      if (sourceDrift) {
        writeFileSync(
          join(source, "state", "b.json"),
          '{"b":"drifted"}\n',
        );
        writeFileSync(join(source, "c.json"), '{"c":"new"}\n');
      }

      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, "seal-partial-and-append");
      assert.equal(
        recovery.recoveryGeneration.id,
        initial.plannedGeneration.id,
      );
      assert.equal(recovery.recoveryGeneration.partialPayload, true);
      assert.equal(
        recovery.plannedGeneration.previous,
        initial.plannedGeneration.id,
      );
      const result = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(result.status, "completed");
      assert.equal(localRef(fixture), null);

      const finalPlan = buildCleanupPlan(fixture);
      const partial = finalPlan.archive.generations.find(
        (generation) =>
          generation.id === initial.plannedGeneration.id,
      );
      assert.equal(partial.receipt.kind, "orphan");
      assert.equal(partial.receipt.snapshotDisposition, "partial");
      const attempt = JSON.parse(
        readFileSync(partial.snapshotAttemptPath, "utf8"),
      );
      const failedSnapshot = JSON.parse(
        readFileSync(partial.snapshotFailedPath, "utf8"),
      );
      assert.equal(attempt.intentDigest, partial.receipt.intentDigest);
      assert.equal(
        failedSnapshot.intentDigest,
        partial.receipt.intentDigest,
      );
      assert.equal(
        failedSnapshot.attemptDigest,
        partial.receipt.attemptDigest,
      );
      assert.match(partial.receipt.attemptDigest, /^[0-9a-f]{64}$/);
      assert.deepEqual(failedSnapshot.payloadSeal, {
        device: partial.receipt.payloadProof.device,
        inode: partial.receipt.payloadProof.inode,
        treeDigest: partial.receipt.payloadProof.treeDigest,
        contentDigest: partial.receipt.payloadProof.contentDigest,
      });
      assert.equal(existsSync(partial.snapshotCompletePath), false);
      assert.equal(
        readFileSync(join(partial.payload, "a.json"), "utf8"),
        '{"a":"partial"}\n',
      );
      assert.equal(
        existsSync(join(partial.payload, "state", "b.json")),
        false,
      );
      assert.equal(
        readFileSync(
          join(recovery.plannedGeneration.payload, "a.json"),
          "utf8",
        ),
        '{"a":"source"}\n',
      );
      assert.equal(
        readFileSync(
          join(
            recovery.plannedGeneration.payload,
            "state",
            "b.json",
          ),
          "utf8",
        ),
        sourceDrift ? '{"b":"drifted"}\n' : '{"b":"source"}\n',
      );
      assert.equal(
        existsSync(
          join(recovery.plannedGeneration.payload, "c.json"),
        ),
        sourceDrift,
      );
      assert.equal(
        readFileSync(
          join(
            recovery.quarantinePlan.rootDestination,
            ".omc",
            "state",
            "b.json",
          ),
          "utf8",
        ),
        sourceDrift ? '{"b":"drifted"}\n' : '{"b":"source"}\n',
      );
      assert.equal(
        existsSync(
          join(
            recovery.quarantinePlan.rootDestination,
            ".omc",
            "c.json",
          ),
        ),
        sourceDrift,
      );
    });
  }
});

test("첫 entry 전 실패한 owned empty snapshot은 failed-empty로 봉인하고 최신 source를 append한다", async (t) => {
  for (const sourceState of ["drift", "absent"]) {
    await t.test(sourceState, (child) => {
      const fixture = createFixture(child);
      const { initial, source, attempt } =
        failBeforeFirstSnapshotEntry(fixture);

      if (sourceState === "drift") {
        writeFileSync(
          join(source, "state.json"),
          '{"state":"drifted"}\n',
        );
        writeFileSync(join(source, "new.json"), '{"new":true}\n');
      } else {
        rmSync(source, { recursive: true });
      }

      const recovery = buildCleanupPlan(fixture);
      assert.equal(
        recovery.action,
        "seal-failed-empty-and-append",
      );
      assert.equal(recovery.recoveryGeneration.partialPayload, false);
      assert.equal(
        recovery.recoveryGeneration.failedEmptyPayload,
        true,
      );
      assert.equal(
        recovery.plannedGeneration.kind,
        sourceState === "drift" ? "preserved" : "empty",
      );

      const result = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(result.status, "completed");
      assert.equal(localRef(fixture), null);

      const finalPlan = buildCleanupPlan(fixture);
      const failedEmpty = finalPlan.archive.generations.find(
        (generation) =>
          generation.id === initial.plannedGeneration.id,
      );
      assert.equal(failedEmpty.receipt.kind, "orphan");
      assert.equal(
        failedEmpty.receipt.snapshotDisposition,
        "failed-empty",
      );
      assert.equal(
        failedEmpty.receipt.attemptDigest,
        failedEmpty.failedSnapshot.attemptDigest,
      );
      assert.match(
        failedEmpty.receipt.attemptDigest,
        /^[0-9a-f]{64}$/,
      );
      assert.equal(
        failedEmpty.failedSnapshot.intentDigest,
        attempt.intentDigest,
      );
      assert.deepEqual(readdirSync(failedEmpty.payload), []);
      assert.equal(existsSync(failedEmpty.snapshotCompletePath), false);
      assert.equal(
        finalPlan.archive.generations.some(
          (generation) =>
            generation.receipt.snapshotDisposition === "partial" &&
            readdirSync(generation.payload).length === 0,
        ),
        false,
      );

      const latest = finalPlan.archive.head;
      assert.equal(
        latest.receipt.kind,
        sourceState === "drift" ? "preserved" : "empty",
      );
      if (sourceState === "drift") {
        assert.equal(
          readFileSync(join(latest.payload, "state.json"), "utf8"),
          '{"state":"drifted"}\n',
        );
        assert.equal(
          readFileSync(join(latest.payload, "new.json"), "utf8"),
          '{"new":true}\n',
        );
      } else {
        assert.deepEqual(readdirSync(latest.payload), []);
      }

      const malformed = JSON.parse(
        readFileSync(failedEmpty.receiptPath, "utf8"),
      );
      malformed.snapshotDisposition = "partial";
      writeFileSync(
        failedEmpty.receiptPath,
        `${JSON.stringify(malformed, null, 2)}\n`,
      );
      assert.throws(
        () => buildCleanupPlan(fixture),
        /partial orphan receipt|generation\.json 계약/,
      );
    });
  }
});

test("failed-empty recovery는 scratch·pending·outcome·current·receipt 경계에서 forward resume한다", async (t) => {
  const cases = [
    {
      name: "before pending",
      hook: "beforeNoReplaceRename",
    },
    {
      name: "pending",
      hook: "afterPendingRootCreated",
    },
    {
      name: "outcome",
      hook: "afterSnapshotOutcomePublished",
    },
    {
      name: "current",
      hook: "afterSnapshotCurrentPublished",
    },
    {
      name: "receipt",
      hook: "afterRecoveryGenerationSealed",
    },
  ];

  for (const recoveryCase of cases) {
    await t.test(recoveryCase.name, (child) => {
      const fixture = createFixture(child);
      const { source } = failBeforeFirstSnapshotEntry(fixture);
      writeFileSync(
        join(source, "state.json"),
        `{"state":"${recoveryCase.name}"}\n`,
      );
      const recovery = buildCleanupPlan(fixture);
      assert.equal(
        recovery.action,
        "seal-failed-empty-and-append",
      );

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: recovery.planToken },
            {
              hooks: {
                [recoveryCase.hook]() {
                  throw new Error(
                    `stop failed-empty ${recoveryCase.name}`,
                  );
                },
              },
            },
          ),
        new RegExp(`stop failed-empty ${recoveryCase.name}`),
      );
      assert.equal(localRef(fixture), fixture.head);

      const restart = buildCleanupPlan(fixture);
      assert.ok(
        [
          "seal-failed-empty-and-append",
          "append-generation",
        ].includes(restart.action),
      );
      const result = executeLocalCleanup({
        ...fixture,
        planToken: restart.planToken,
      });
      assert.equal(result.status, "completed");
      assert.equal(localRef(fixture), null);
      const finalPlan = buildCleanupPlan(fixture);
      const failedEmpty = finalPlan.archive.generations.find(
        (generation) =>
          generation.receipt.snapshotDisposition === "failed-empty",
      );
      assert.ok(failedEmpty);
      assert.deepEqual(readdirSync(failedEmpty.payload), []);
      assert.equal(
        readFileSync(
          join(finalPlan.archive.head.payload, "state.json"),
          "utf8",
        ),
        `{"state":"${recoveryCase.name}"}\n`,
      );
    });
  }
});

test("source가 사라진 nonempty partial candidate는 모든 publication 경계에서 overwrite 없이 orphan+empty chain으로 복구한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "source.json"), '{"source":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterSnapshotPayloadStarted({ pendingPayload }) {
              writeFileSync(
                join(pendingPayload, "partial.json"),
                '{"partial":"owned"}\n',
              );
              throw new Error("stop with owned nonempty partial");
            },
          },
        },
      ),
    /stop with owned nonempty partial/,
  );
  rmSync(source, { recursive: true });

  const firstRecovery = buildCleanupPlan(fixture);
  assert.equal(firstRecovery.action, "seal-partial-and-append");
  assert.equal(firstRecovery.recoveryGeneration.partialPayload, true);
  assert.equal(firstRecovery.plannedGeneration.kind, "empty");
  const candidateInode = lstatSync(
    recoveryCandidatePath(
      firstRecovery,
      firstRecovery.recoveryGeneration,
    ),
    { bigint: true },
  ).ino;

  for (const hook of [
    "beforeNoReplaceRename",
    "afterPendingRootCreated",
    "afterSnapshotOutcomePublished",
    "afterSnapshotCurrentPublished",
    "afterRecoveryGenerationSealed",
  ]) {
    const recovery = buildCleanupPlan(fixture);
    assert.equal(
      recovery.action,
      "seal-partial-and-append",
      `unexpected action before ${hook}`,
    );
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: recovery.planToken },
          {
            hooks: {
              [hook]() {
                throw new Error(`stop partial at ${hook}`);
              },
            },
          },
        ),
      new RegExp(`stop partial at ${hook}`),
    );
    assert.equal(localRef(fixture), fixture.head);
    const candidate = existsSync(initial.plannedGeneration.payload)
      ? initial.plannedGeneration.payload
      : recoveryCandidatePath(
          buildCleanupPlan(fixture),
          buildCleanupPlan(fixture).recoveryGeneration,
        );
    assert.equal(
      lstatSync(candidate, { bigint: true }).ino,
      candidateInode,
    );
    assert.equal(
      readFileSync(join(candidate, "partial.json"), "utf8"),
      '{"partial":"owned"}\n',
    );
    assert.deepEqual(readdirSync(candidate), ["partial.json"]);
  }

  for (const hook of [
    "afterGenerationIntentPublished",
    "afterGenerationContainerCreated",
    "afterEmptyPayloadCreated",
    "afterGenerationPrepared",
  ]) {
    const emptyRecovery = buildCleanupPlan(fixture);
    assert.ok(
      ["append-generation", "resume-generation"].includes(
        emptyRecovery.action,
      ),
      `unexpected empty recovery action before ${hook}`,
    );
    assert.equal(emptyRecovery.plannedGeneration.kind, "empty");
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: emptyRecovery.planToken },
          {
            hooks: {
              [hook]() {
                throw new Error(`stop partial empty at ${hook}`);
              },
            },
          },
        ),
      new RegExp(`stop partial empty at ${hook}`),
    );
    assert.equal(localRef(fixture), fixture.head);
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "partial.json"),
        "utf8",
      ),
      '{"partial":"owned"}\n',
    );
  }

  const ready = buildCleanupPlan(fixture);
  assert.equal(ready.action, "quarantine-ready");
  assert.equal(ready.archive.head.receipt.kind, "empty");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: ready.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(localRef(fixture), null);

  const finalPlan = buildCleanupPlan(fixture);
  const partial = finalPlan.archive.generations.find(
    (generation) =>
      generation.id === initial.plannedGeneration.id,
  );
  assert.equal(partial.receipt.kind, "orphan");
  assert.equal(partial.receipt.snapshotDisposition, "partial");
  assert.equal(
    lstatSync(partial.payload, { bigint: true }).ino,
    candidateInode,
  );
  assert.equal(
    readFileSync(join(partial.payload, "partial.json"), "utf8"),
    '{"partial":"owned"}\n',
  );
  assert.equal(finalPlan.archive.head.receipt.kind, "empty");
  assert.deepEqual(readdirSync(finalPlan.archive.head.payload), []);
});

test("source가 사라진 exact complete candidate는 모든 publication 경계에서 overwrite 없이 preserved+empty chain으로 복구한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "complete.json"), '{"complete":"owned"}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            beforeNoReplaceRename() {
              throw new Error("stop with owned exact complete");
            },
          },
        },
      ),
    /stop with owned exact complete/,
  );
  rmSync(source, { recursive: true });

  const firstRecovery = buildCleanupPlan(fixture);
  assert.equal(firstRecovery.action, "seal-preserved-and-append");
  assert.equal(firstRecovery.recoveryGeneration.kind, "preserved");
  assert.equal(firstRecovery.plannedGeneration.kind, "empty");
  const candidateInode = lstatSync(
    recoveryCandidatePath(
      firstRecovery,
      firstRecovery.recoveryGeneration,
    ),
    { bigint: true },
  ).ino;

  for (const hook of [
    "beforeNoReplaceRename",
    "afterPendingRootCreated",
    "afterSnapshotOutcomePublished",
    "afterSnapshotCurrentPublished",
    "afterRecoveryGenerationSealed",
  ]) {
    const recovery = buildCleanupPlan(fixture);
    assert.equal(
      recovery.action,
      "seal-preserved-and-append",
      `unexpected action before ${hook}`,
    );
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: recovery.planToken },
          {
            hooks: {
              [hook]() {
                throw new Error(`stop complete at ${hook}`);
              },
            },
          },
        ),
      new RegExp(`stop complete at ${hook}`),
    );
    assert.equal(localRef(fixture), fixture.head);
    const restart = buildCleanupPlan(fixture);
    const candidate = existsSync(initial.plannedGeneration.payload)
      ? initial.plannedGeneration.payload
      : recoveryCandidatePath(
          restart,
          restart.recoveryGeneration,
        );
    assert.equal(
      lstatSync(candidate, { bigint: true }).ino,
      candidateInode,
    );
    assert.equal(
      readFileSync(join(candidate, "complete.json"), "utf8"),
      '{"complete":"owned"}\n',
    );
    assert.deepEqual(readdirSync(candidate), ["complete.json"]);
  }

  for (const hook of [
    "afterGenerationIntentPublished",
    "afterGenerationContainerCreated",
    "afterEmptyPayloadCreated",
    "afterGenerationPrepared",
  ]) {
    const emptyRecovery = buildCleanupPlan(fixture);
    assert.ok(
      ["append-generation", "resume-generation"].includes(
        emptyRecovery.action,
      ),
      `unexpected empty recovery action before ${hook}`,
    );
    assert.equal(emptyRecovery.plannedGeneration.kind, "empty");
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: emptyRecovery.planToken },
          {
            hooks: {
              [hook]() {
                throw new Error(`stop complete empty at ${hook}`);
              },
            },
          },
        ),
      new RegExp(`stop complete empty at ${hook}`),
    );
    assert.equal(localRef(fixture), fixture.head);
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "complete.json"),
        "utf8",
      ),
      '{"complete":"owned"}\n',
    );
  }

  const ready = buildCleanupPlan(fixture);
  assert.equal(ready.action, "quarantine-ready");
  assert.equal(ready.archive.head.receipt.kind, "empty");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: ready.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(localRef(fixture), null);

  const finalPlan = buildCleanupPlan(fixture);
  const preserved = finalPlan.archive.generations.find(
    (generation) =>
      generation.id === initial.plannedGeneration.id,
  );
  assert.equal(preserved.receipt.kind, "preserved");
  assert.equal(preserved.receipt.snapshotDisposition, "complete");
  assert.equal(
    lstatSync(preserved.payload, { bigint: true }).ino,
    candidateInode,
  );
  assert.equal(
    readFileSync(join(preserved.payload, "complete.json"), "utf8"),
    '{"complete":"owned"}\n',
  );
  assert.equal(finalPlan.archive.head.receipt.kind, "empty");
  assert.deepEqual(readdirSync(finalPlan.archive.head.payload), []);
});

test("source와 helper-owned candidate가 모두 없으면 receipt-less intent를 fail-closed한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "state.json"), '{"state":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationContainerCreated() {
              throw new Error("stop before helper-owned candidate");
            },
          },
        },
      ),
    /stop before helper-owned candidate/,
  );
  rmSync(source, { recursive: true });

  assert.throws(
    () => buildCleanupPlan(fixture),
    /unresolved generation intent.*안전하게 복구/,
  );
  assert.equal(existsSync(initial.plannedGeneration.receiptPath), false);
  assert.equal(localRef(fixture), fixture.head);
});

test("pending root ownership은 crash recovery와 foreign collision을 구분한다", async (t) => {
  await t.test(
    "ownership receipt 전 unbound empty scratch crash는 새 root로 forward recovery한다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);
      let unboundScratch;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterUnboundSnapshotRootCreated({ scratchRoot }) {
                  unboundScratch = scratchRoot;
                  throw new Error("crash before ownership receipt");
                },
              },
            },
          ),
        /crash before ownership receipt/,
      );
      assert.equal(existsSync(unboundScratch), true);
      assert.deepEqual(readdirSync(unboundScratch), []);
      assert.equal(localRef(fixture), fixture.head);

      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, "resume-generation");
      const result = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(result.status, "completed");
      assert.equal(localRef(fixture), null);
      assert.equal(existsSync(unboundScratch), true);
      assert.deepEqual(readdirSync(unboundScratch), []);
    },
  );

  await t.test(
    "unbound hook의 empty root replacement는 ownership으로 서명하지 않는다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);
      let replacementRoot;
      let retainedOriginalRoot;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterUnboundSnapshotRootCreated({
                  plan,
                  scratchRoot,
                }) {
                  retainedOriginalRoot = join(
                    plan.paths.snapshotScratchDirectory,
                    `${"f".repeat(64)}.omc`,
                  );
                  renameSync(scratchRoot, retainedOriginalRoot);
                  mkdirSync(scratchRoot, { mode: 0o700 });
                  replacementRoot = scratchRoot;
                },
              },
            },
          ),
        /original inode|identity/,
      );
      assert.deepEqual(readdirSync(replacementRoot), []);
      assert.deepEqual(readdirSync(retainedOriginalRoot), []);
      assert.equal(existsSync(retainedOriginalRoot), true);
      assert.equal(
        existsSync(
          join(replacementRoot, "state.json"),
        ),
        false,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, "resume-generation");
    },
  );

  for (const hookName of [
    "afterSnapshotAttemptPublished",
    "afterPendingRootCreated",
  ]) {
    await t.test(`${hookName} crash는 exact owned root에서 재개한다`, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [hookName]() {
                  throw new Error(`${hookName} crash`);
                },
              },
            },
          ),
        new RegExp(`${hookName} crash`),
      );
      assert.equal(localRef(fixture), fixture.head);
      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, "resume-generation");
      const result = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(result.status, "completed");
      assert.equal(localRef(fixture), null);
    });
  }

  await t.test(
    "unbound scratch가 nonempty로 바뀌면 inert residue로 무시하지 않는다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterUnboundSnapshotRootCreated({ scratchRoot }) {
                  writeFileSync(
                    join(scratchRoot, "foreign.json"),
                    '{"owner":"foreign"}\n',
                  );
                  throw new Error("nonempty unbound crash");
                },
              },
            },
          ),
        /nonempty unbound crash/,
      );
      assert.throws(
        () => buildCleanupPlan(fixture),
        /unpublished snapshot scratch root.*empty inert/,
      );
      assert.equal(localRef(fixture), fixture.head);
    },
  );

  for (const phase of [
    "before-pending",
    "during-copy",
    "after-pending",
  ]) {
    await t.test(`${phase} root inode swap은 restart에서도 채택하지 않는다`, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);
      let replacementRoot;
      let displacedRootDescriptor;

      const replaceRootWithoutInodeReuse = (root) => {
        displacedRootDescriptor = openSync(root, "r");
        rmSync(root, { recursive: true });
        mkdirSync(root, { mode: 0o700 });
        replacementRoot = root;
      };

      try {
        assert.throws(
          () =>
            executeLocalCleanup(
              { ...fixture, planToken: initial.planToken },
              {
                hooks:
                  phase === "before-pending"
                    ? {
                        afterSnapshotAttemptPublished({ plan, attempt }) {
                          replaceRootWithoutInodeReuse(
                            join(
                              plan.paths.snapshotScratchDirectory,
                              attempt.scratch,
                            ),
                          );
                        },
                      }
                    : phase === "during-copy"
                      ? {
                          afterSnapshotPayloadStarted({
                            pendingPayload,
                          }) {
                            replaceRootWithoutInodeReuse(pendingPayload);
                          },
                        }
                      : {
                          afterPendingRootCreated({ pendingPayload }) {
                            replaceRootWithoutInodeReuse(pendingPayload);
                          },
                        },
              },
            ),
          /ownership|identity/,
        );
      } finally {
        if (displacedRootDescriptor !== undefined) {
          closeSync(displacedRootDescriptor);
        }
      }
      assert.throws(
        () => buildCleanupPlan(fixture),
        /root ownership|ownership|exact/,
      );
      assert.deepEqual(readdirSync(replacementRoot), []);
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
    });
  }

  await t.test(
    "pending publication 직전 swap은 original과 replacement를 이동하지 않는다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);
      let originalRoot;
      let replacementRoot;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                beforeNoReplaceRename({ plan, attempt }) {
                  replacementRoot = join(
                    plan.paths.snapshotScratchDirectory,
                    attempt.scratch,
                  );
                  originalRoot = join(
                    plan.paths.snapshotScratchDirectory,
                    `${"e".repeat(64)}.omc`,
                  );
                  renameSync(replacementRoot, originalRoot);
                  mkdirSync(replacementRoot, { mode: 0o700 });
                },
              },
            },
          ),
        /publish 직전.*ownership/,
      );
      assert.equal(
        readFileSync(join(originalRoot, "state.json"), "utf8"),
        '{"state":"source"}\n',
      );
      assert.deepEqual(readdirSync(replacementRoot), []);
      assert.equal(existsSync(originalRoot), true);
      assert.equal(existsSync(replacementRoot), true);
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
    },
  );

  await t.test(
    "attempt 뒤 foreign pending collision은 restart에서도 봉인하지 않는다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                beforeNoReplaceRename({ generation }) {
                  mkdirSync(generation.pendingPayload);
                  writeFileSync(
                    join(generation.pendingPayload, "foreign.json"),
                    '{"owner":"foreign"}\n',
                  );
                },
              },
            },
          ),
        /collision|overwrite/,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        readFileSync(
          join(initial.plannedGeneration.pendingPayload, "foreign.json"),
          "utf8",
        ),
        '{"owner":"foreign"}\n',
      );
      assert.throws(
        () => buildCleanupPlan(fixture),
        /ownership|소유|foreign|collision/,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
    },
  );

  await t.test(
    "preserved intent의 no-attempt foreign current는 empty여도 채택하지 않는다",
    (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"source"}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterGenerationContainerCreated() {
                  throw new Error("crash before snapshot attempt");
                },
              },
            },
          ),
        /crash before snapshot attempt/,
      );
      mkdirSync(initial.plannedGeneration.payload);

      assert.throws(
        () => buildCleanupPlan(fixture),
        /ownership|소유|durable helper attempt/,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
    },
  );
});

test("snapshot 시작 전 open FD source drift는 payload publication 없이 fail-closed한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  const sourceFile = join(source, "state.json");
  mkdirSync(source);
  writeFileSync(sourceFile, '{"phase":"dry-run"}\n');
  const descriptor = openSync(sourceFile, "r+");
  const plan = buildCleanupPlan(fixture);

  try {
    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: plan.planToken },
          {
            hooks: {
              beforeArchiveRename() {
                replaceThroughOpenDescriptor(
                  descriptor,
                  '{"phase":"active-writer"}\n',
                );
              },
            },
          },
        ),
      /sealed snapshot 직전 source.*변경/,
    );
  } finally {
    closeSync(descriptor);
  }

  assert.equal(existsSync(plan.plannedGeneration.payload), false);
  assert.equal(existsSync(plan.plannedGeneration.receiptPath), false);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
});

test("root quarantine 뒤 preexisting open FD write는 sealed snapshot과 분리해 mutable 원본에 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  const sourceFile = join(source, "state.json");
  mkdirSync(source);
  writeFileSync(sourceFile, '{"phase":"snapshot"}\n');
  const descriptor = openSync(sourceFile, "r+");
  const plan = buildCleanupPlan(fixture);

  let result;
  try {
    result = executeLocalCleanup(
      { ...fixture, planToken: plan.planToken },
      {
        hooks: {
          afterWorktreeQuarantine() {
            replaceThroughOpenDescriptor(
              descriptor,
              '{"phase":"after-root-quarantine"}\n',
            );
          },
        },
      },
    );
  } finally {
    closeSync(descriptor);
  }

  assert.equal(result.status, "completed");
  assert.equal(localRef(fixture), null);
  assert.equal(
    readFileSync(
      join(plan.plannedGeneration.payload, "state.json"),
      "utf8",
    ),
    '{"phase":"snapshot"}\n',
  );
  assert.equal(
    readFileSync(
      join(
        plan.quarantinePlan.rootDestination,
        ".omc",
        "state.json",
      ),
      "utf8",
    ),
    '{"phase":"after-root-quarantine"}\n',
  );
});

test("quarantine 직전 OMC write는 worktree root와 함께 보존된다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "before.json"), '{"before":true}\n');
  const plan = buildCleanupPlan(fixture);
  const payload = plan.plannedGeneration.payload;
  const quarantinedRoot = plan.quarantinePlan.rootDestination;

  const result = executeLocalCleanup(
    { ...fixture, planToken: plan.planToken },
    {
      hooks: {
        beforeWorktreeQuarantine() {
          assert.equal(existsSync(source), true);
          writeFileSync(join(source, "during.json"), '{"during":true}\n');
        },
      },
    },
  );

  assert.equal(result.status, "completed");
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
  assert.equal(
    readFileSync(join(payload, "before.json"), "utf8"),
    '{"before":true}\n',
  );
  assert.equal(
    readFileSync(
      join(quarantinedRoot, ".omc", "during.json"),
      "utf8",
    ),
    '{"during":true}\n',
  );
});

test("root quarantine 직전 새 일반 residue는 어떤 이동·ref CAS보다 먼저 차단한다", async (t) => {
  const cases = [
    {
      name: "untracked",
      mutate(fixture) {
        writeFileSync(
          join(fixture.issueWorktree, "late-untracked.txt"),
          "keep untracked\n",
        );
      },
      retainedPath(fixture) {
        return join(fixture.issueWorktree, "late-untracked.txt");
      },
    },
    {
      name: "staged",
      mutate(fixture) {
        const path = join(fixture.issueWorktree, "late-staged.txt");
        writeFileSync(path, "keep staged\n");
        git(fixture.issueWorktree, ["add", "--", "late-staged.txt"]);
      },
      retainedPath(fixture) {
        return join(fixture.issueWorktree, "late-staged.txt");
      },
    },
    {
      name: "tracked",
      mutate(fixture) {
        writeFileSync(
          join(fixture.issueWorktree, "README.md"),
          "late tracked mutation\n",
        );
      },
      retainedPath(fixture) {
        return join(fixture.issueWorktree, "README.md");
      },
    },
    {
      name: "additional ignored",
      mutate(fixture) {
        writeFileSync(
          join(fixture.issueWorktree, ".DS_Store"),
          "keep ignored\n",
        );
      },
      retainedPath(fixture) {
        return join(fixture.issueWorktree, ".DS_Store");
      },
    },
  ];

  for (const residueCase of cases) {
    await t.test(residueCase.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                beforeWorktreeQuarantine() {
                  residueCase.mutate(fixture);
                },
              },
            },
          ),
        /tracked·staged|ignored residue/,
      );

      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        false,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        false,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        false,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(residueCase.retainedPath(fixture)), true);
    });
  }
});

test("exclusive generation payload collision은 directory와 symlink를 덮어쓰지 않는다", async (t) => {
  for (const kind of ["directory", "symlink"]) {
    await t.test(kind, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      const foreignTarget = join(fixture.root, "foreign-target");
      mkdirSync(source);
      writeFileSync(join(source, "source.json"), '{"source":true}\n');
      mkdirSync(foreignTarget);
      writeFileSync(join(foreignTarget, "foreign.json"), '{"foreign":true}\n');
      const plan = buildCleanupPlan(fixture);
      const payload = plan.plannedGeneration.payload;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: plan.planToken },
            {
              hooks: {
                beforeArchiveRename({ generation }) {
                  assert.equal(generation.payload, payload);
                  if (kind === "directory") {
                    mkdirSync(payload);
                    writeFileSync(
                      join(payload, "collision.json"),
                      '{"collision":true}\n',
                    );
                  } else {
                    symlinkSync(foreignTarget, payload, "dir");
                  }
                },
              },
            },
          ),
        /payload destination collision.*overwrite하지 않습니다/,
      );

      assert.equal(
        readFileSync(join(source, "source.json"), "utf8"),
        '{"source":true}\n',
      );
      if (kind === "directory") {
        assert.equal(
          readFileSync(join(payload, "collision.json"), "utf8"),
          '{"collision":true}\n',
        );
      } else {
        assert.equal(lstatSync(payload).isSymbolicLink(), true);
        assert.equal(
          readFileSync(join(foreignTarget, "foreign.json"), "utf8"),
          '{"foreign":true}\n',
        );
      }
      assert.equal(localRef(fixture), fixture.head);
      assert.match(
        git(fixture.mainWorktree, ["worktree", "list", "--porcelain"]).stdout,
        new RegExp(
          fixture.issueWorktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
      );
    });
  }
});

test("source 검사 뒤 생긴 payload collision도 exclusive snapshot create로 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "source.json"), '{"source":true}\n');
  const plan = buildCleanupPlan(fixture);
  const payload = plan.plannedGeneration.payload;
  let collisionInode;

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: plan.planToken },
        {
          hooks: {
            beforeNoReplaceRename() {
              mkdirSync(payload);
              collisionInode = lstatSync(payload).ino;
              writeFileSync(
                join(payload, "collision.json"),
                '{"collision":true}\n',
              );
            },
          },
        },
      ),
    /payload destination collision.*overwrite하지 않습니다/,
  );

  assert.equal(lstatSync(payload).ino, collisionInode);
  assert.equal(
    readFileSync(join(payload, "collision.json"), "utf8"),
    '{"collision":true}\n',
  );
  assert.equal(
    readFileSync(join(source, "source.json"), "utf8"),
    '{"source":true}\n',
  );
  assert.equal(localRef(fixture), fixture.head);
});

test("extra ignored·unignored·staged residue를 각각 차단한다", async (t) => {
  await t.test("extra ignored", (child) => {
    const fixture = createFixture(child);
    writeFileSync(join(fixture.issueWorktree, ".DS_Store"), "metadata");
    assert.throws(
      () => buildCleanupPlan(fixture),
      /ignored residue.*root `\.omc` 하나만/,
    );
    assert.equal(localRef(fixture), fixture.head);
  });

  await t.test("unignored", (child) => {
    const fixture = createFixture(child);
    writeFileSync(join(fixture.issueWorktree, "stray.txt"), "user state");
    assert.throws(
      () => buildCleanupPlan(fixture),
      /tracked·staged 또는 unignored 변경/,
    );
    assert.equal(localRef(fixture), fixture.head);
  });

  await t.test("staged", (child) => {
    const fixture = createFixture(child);
    writeFileSync(join(fixture.issueWorktree, "README.md"), "staged change\n");
    git(fixture.issueWorktree, ["add", "--", "README.md"]);
    assert.throws(
      () => buildCleanupPlan(fixture),
      /tracked·staged 또는 unignored 변경/,
    );
    assert.equal(localRef(fixture), fixture.head);
  });
});

test("`.omc` 안의 symlink는 target을 읽거나 제거하지 않고 차단한다", (t) => {
  const fixture = createFixture(t);
  const target = join(fixture.root, "user-owned-target.txt");
  const omc = join(fixture.issueWorktree, ".omc");
  mkdirSync(omc);
  writeFileSync(target, "keep me\n");
  symlinkSync(target, join(omc, "external-link"));

  assert.throws(
    () => buildCleanupPlan(fixture),
    /\.omc 내부 symlink는.*허용하지 않습니다/,
  );
  assert.equal(readFileSync(target, "utf8"), "keep me\n");
  assert.equal(localRef(fixture), fixture.head);
});

test("`.omc` 안의 external hardlink file은 sealed snapshot 대상에서 차단한다", (t) => {
  const fixture = createFixture(t);
  const external = join(fixture.root, "external-hardlink.json");
  const omc = join(fixture.issueWorktree, ".omc");
  mkdirSync(omc);
  writeFileSync(external, '{"external":true}\n');
  linkSync(external, join(omc, "linked.json"));

  assert.throws(
    () => buildCleanupPlan(fixture),
    /\.omc 내부 hardlink file은.*허용하지 않습니다/,
  );
  assert.equal(readFileSync(external, "utf8"), '{"external":true}\n');
  assert.equal(localRef(fixture), fixture.head);
});

test("archive identity collision과 manifest 불일치를 덮어쓰지 않는다", (t) => {
  const fixture = createFixture(t);
  const plan = buildCleanupPlan(fixture);
  mkdirSync(plan.paths.archiveDirectory, {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(
    plan.paths.identityFile,
    `${JSON.stringify({ schema: "foreign-state" })}\n`,
    { mode: 0o600 },
  );
  chmodSync(plan.paths.identityFile, 0o600);

  assert.throws(
    () => buildCleanupPlan(fixture),
    /archive identity collision|core identity 불일치/,
  );
  assert.equal(
    JSON.parse(readFileSync(plan.paths.identityFile, "utf8")).schema,
    "foreign-state",
  );
  assert.equal(localRef(fixture), fixture.head);
});

test("generation intent·payload·receipt·quarantine 사이 각 중단 지점에서 forward recovery한다", async (t) => {
  await t.test("intent와 container 뒤 sealed snapshot 생성 전", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "pending.json"), '{"pending":true}\n');
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              beforeArchiveRename() {
                throw new Error("stop before payload relocation");
              },
            },
          },
        ),
      /stop before payload relocation/,
    );
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(initial.plannedGeneration.receiptPath), false);
    assert.equal(existsSync(initial.plannedGeneration.payload), false);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "pending.json"),
        "utf8",
      ),
      '{"pending":true}\n',
    );
  });

  await t.test("sealed snapshot 뒤 receipt 발행 전", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "relocated.json"), '{"relocated":true}\n');
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterPayloadRelocated() {
                throw new Error("stop before generation receipt");
              },
            },
          },
        ),
      /stop before generation receipt/,
    );
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(initial.plannedGeneration.receiptPath), false);
    assert.equal(existsSync(initial.plannedGeneration.payload), true);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "relocated.json"),
        "utf8",
      ),
      '{"relocated":true}\n',
    );
  });

  await t.test("generation receipt 뒤 quarantine 전", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "payload.json"), '{"payload":true}\n');
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterGenerationPrepared() {
                throw new Error("stop before quarantine");
              },
            },
          },
        ),
      /stop before quarantine/,
    );
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(initial.plannedGeneration.payload), true);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "quarantine-ready");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "payload.json"),
        "utf8",
      ),
      '{"payload":true}\n',
    );
  });
});

test("generation container와 atomic receipt publication 이전 중단을 forward recovery한다", async (t) => {
  await t.test("durable intent 발행 직후", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "intent.json"), '{"intent":true}\n');
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterGenerationIntentPublished() {
                throw new Error("stop after durable intent");
              },
            },
          },
        ),
      /stop after durable intent/,
    );
    assert.equal(existsSync(initial.plannedGeneration.intentPath), true);
    assert.equal(existsSync(initial.plannedGeneration.directory), false);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "intent.json"),
        "utf8",
      ),
      '{"intent":true}\n',
    );
  });

  await t.test("preserved container 생성 직후", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "container.json"), '{"container":true}\n');
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterGenerationContainerCreated() {
                throw new Error("stop before generation receipt");
              },
            },
          },
        ),
      /stop before generation receipt/,
    );
    assert.equal(existsSync(initial.plannedGeneration.receiptPath), false);
    assert.equal(existsSync(initial.plannedGeneration.payload), false);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(
      readFileSync(
        join(initial.plannedGeneration.payload, "container.json"),
        "utf8",
      ),
      '{"container":true}\n',
    );
  });

  await t.test("partial pending receipt", (child) => {
    const fixture = createFixture(child);
    const source = join(fixture.issueWorktree, ".omc");
    mkdirSync(source);
    writeFileSync(join(source, "pending.json"), '{"pending":true}\n');
    const initial = buildCleanupPlan(fixture);
    const pendingReceipt = join(
      initial.plannedGeneration.directory,
      `.generation.json.pending-${"a".repeat(64)}`,
    );

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterGenerationContainerCreated() {
                writeFileSync(pendingReceipt, '{"schema":', { mode: 0o600 });
                throw new Error("stop during pending receipt");
              },
            },
          },
        ),
      /stop during pending receipt/,
    );

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assert.equal(existsSync(pendingReceipt), false);
    assert.doesNotThrow(() =>
      JSON.parse(
        readFileSync(initial.plannedGeneration.receiptPath, "utf8"),
      ),
    );
  });

  await t.test("empty payload 생성 직후", (child) => {
    const fixture = createFixture(child);
    const initial = buildCleanupPlan(fixture);

    assert.throws(
      () =>
        executeLocalCleanup(
          { ...fixture, planToken: initial.planToken },
          {
            hooks: {
              afterEmptyPayloadCreated() {
                throw new Error("stop before empty receipt");
              },
            },
          },
        ),
      /stop before empty receipt/,
    );
    assert.equal(existsSync(initial.plannedGeneration.receiptPath), false);
    assert.equal(existsSync(initial.plannedGeneration.payload), true);

    const recovery = buildCleanupPlan(fixture);
    assert.equal(recovery.action, "resume-generation");
    const result = executeLocalCleanup({
      ...fixture,
      planToken: recovery.planToken,
    });
    assert.equal(result.status, "completed");
    assertWorktreeAbsent(fixture);
    assert.equal(localRef(fixture), null);
  });
});

test("pre-receipt crash 뒤 OMC 변경도 orphan 봉인과 append로 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "old.json"), '{"old":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationContainerCreated() {
              throw new Error("stop before old receipt");
            },
          },
        },
      ),
    /stop before old receipt/,
  );
  writeFileSync(join(source, "new.json"), '{"new":true}\n');

  const sealPlan = buildCleanupPlan(fixture);
  assert.equal(sealPlan.action, "seal-orphan-and-append");
  assert.equal(sealPlan.recoveryGeneration.id, initial.plannedGeneration.id);
  assert.equal(
    sealPlan.plannedGeneration.previous,
    initial.plannedGeneration.id,
  );
  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: sealPlan.planToken },
        {
          hooks: {
            afterRecoveryGenerationSealed() {
              throw new Error("stop after orphan seal");
            },
          },
        },
      ),
    /stop after orphan seal/,
  );

  const appendPlan = buildCleanupPlan(fixture);
  assert.equal(appendPlan.action, "append-generation");
  assert.equal(
    appendPlan.plannedGeneration.previous,
    initial.plannedGeneration.id,
  );
  const result = executeLocalCleanup({
    ...fixture,
    planToken: appendPlan.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(
    readFileSync(
      join(appendPlan.plannedGeneration.payload, "old.json"),
      "utf8",
    ),
    '{"old":true}\n',
  );
  assert.equal(
    readFileSync(
      join(appendPlan.plannedGeneration.payload, "new.json"),
      "utf8",
    ),
    '{"new":true}\n',
  );
  assert.deepEqual(
    readdirSync(initial.plannedGeneration.payload),
    [],
  );
  const finalPlan = buildCleanupPlan(fixture);
  assert.equal(finalPlan.archive.generations.length, 2);
  assert.equal(
    finalPlan.archive.generations.find(
      (generation) => generation.id === initial.plannedGeneration.id,
    ).receipt.kind,
    "orphan",
  );
});

test("sealed snapshot 뒤 receipt 전 OMC 변경도 두 generation에 모두 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "old.json"), '{"old":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterPayloadRelocated() {
              throw new Error("stop after old payload relocation");
            },
          },
        },
      ),
    /stop after old payload relocation/,
  );
  writeFileSync(join(source, "new.json"), '{"new":true}\n');

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "seal-preserved-and-append");
  assert.equal(recovery.recoveryGeneration.id, initial.plannedGeneration.id);
  assert.equal(
    recovery.plannedGeneration.previous,
    initial.plannedGeneration.id,
  );
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(
    readFileSync(
      join(initial.plannedGeneration.payload, "old.json"),
      "utf8",
    ),
    '{"old":true}\n',
  );
  assert.equal(
    readFileSync(
      join(recovery.plannedGeneration.payload, "new.json"),
      "utf8",
    ),
    '{"new":true}\n',
  );
  const finalPlan = buildCleanupPlan(fixture);
  assert.equal(finalPlan.archive.generations.length, 2);
  assert.equal(
    finalPlan.archive.generations.find(
      (generation) => generation.id === initial.plannedGeneration.id,
    ).receipt.kind,
    "preserved",
  );
});

test("historic sealed generation이 변조되면 current head가 정상이어도 quarantine 전에 차단한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "old.json"), '{"old":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after first sealed generation");
            },
          },
        },
      ),
    /stop after first sealed generation/,
  );
  writeFileSync(join(source, "new.json"), '{"new":true}\n');
  const append = buildCleanupPlan(fixture);
  assert.equal(append.action, "append-generation");
  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: append.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after second sealed generation");
            },
          },
        },
      ),
    /stop after second sealed generation/,
  );

  writeFileSync(
    join(initial.plannedGeneration.payload, "old.json"),
    '{"old":"tampered"}\n',
  );
  assert.throws(
    () => buildCleanupPlan(fixture),
    /archived payload.*sealed payload proof/,
  );
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
  assert.equal(existsSync(initial.quarantinePlan.rootDestination), false);
});

test("historic 완료 generation payload가 사라지면 current head가 정상이어도 quarantine 전에 차단한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "old.json"), '{"old":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after first completed generation");
            },
          },
        },
      ),
    /stop after first completed generation/,
  );
  writeFileSync(join(source, "new.json"), '{"new":true}\n');
  const append = buildCleanupPlan(fixture);
  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: append.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after current completed generation");
            },
          },
        },
      ),
    /stop after current completed generation/,
  );

  renameSync(
    initial.plannedGeneration.payload,
    join(fixture.root, "missing-historic-payload"),
  );
  assert.throws(
    () => buildCleanupPlan(fixture),
    /durable snapshot attempt의 owned root가 사라졌습니다/,
  );
  assert.equal(existsSync(append.plannedGeneration.payload), true);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
  assert.equal(existsSync(initial.quarantinePlan.rootDestination), false);
});

test("완료 generation의 timestamp-only drift는 새 full proof로 재계획하되 stale token은 거부한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "state.json"), '{"state":"sealed"}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after timestamp fixture receipt");
            },
          },
        },
      ),
    /stop after timestamp fixture receipt/,
  );

  const payload = initial.plannedGeneration.payload;
  const receipt = JSON.parse(
    readFileSync(initial.plannedGeneration.receiptPath, "utf8"),
  );
  const firstStats = lstatSync(payload);
  utimesSync(
    payload,
    firstStats.atime,
    new Date(firstStats.mtimeMs - 10_000),
  );

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "quarantine-ready");
  assert.notEqual(
    recovery.archive.head.proof.snapshotDigest,
    receipt.payloadProof.snapshotDigest,
  );
  assert.equal(
    recovery.archive.head.proof.treeDigest,
    receipt.payloadProof.treeDigest,
  );
  assert.equal(
    recovery.archive.head.proof.contentDigest,
    receipt.payloadProof.contentDigest,
  );
  assert.equal(
    recovery.archive.head.proof.inode,
    receipt.payloadProof.inode,
  );
  assert.equal(
    recovery.archive.head.proof.device,
    receipt.payloadProof.device,
  );
  assert.equal(
    recovery.tokenState.generations[0].snapshotDigest,
    recovery.archive.head.proof.snapshotDigest,
  );

  const secondStats = lstatSync(payload);
  utimesSync(
    payload,
    secondStats.atime,
    new Date(secondStats.mtimeMs - 10_000),
  );
  assert.throws(
    () =>
      executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      }),
    /plan token.*일치하지 않습니다/,
  );

  const fresh = buildCleanupPlan(fixture);
  assert.notEqual(fresh.planToken, recovery.planToken);
  const result = executeLocalCleanup({
    ...fixture,
    planToken: fresh.planToken,
  });
  assert.equal(result.status, "completed");
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
});

test("완료 generation의 path·type·inode·mode·bytes drift는 계속 차단한다", async (t) => {
  const cases = [
    {
      name: "path",
      expected:
        /durable snapshot attempt의 owned root가 사라졌습니다/,
      mutate({ fixture, payload }) {
        renameSync(payload, join(fixture.root, "moved-payload"));
      },
    },
    {
      name: "type",
      expected:
        /archived payload.*sealed payload proof/,
      mutate({ payload }) {
        const path = join(payload, "state.json");
        unlinkSync(path);
        mkdirSync(path);
      },
    },
    {
      name: "inode",
      expected:
        /snapshot candidate root가 durable attempt의 exact ownership과 다릅니다/,
      mutate({ fixture, payload }) {
        renameSync(payload, join(fixture.root, "old-payload"));
        mkdirSync(payload, { mode: 0o700 });
        writeFileSync(join(payload, "state.json"), '{"state":"sealed"}\n');
      },
    },
    {
      name: "mode",
      expected:
        /archived payload.*sealed payload proof/,
      mutate({ payload }) {
        const path = join(payload, "state.json");
        const before = lstatSync(path).mode & 0o777;
        chmodSync(path, before ^ 0o100);
        assert.notEqual(lstatSync(path).mode & 0o777, before);
      },
    },
    {
      name: "special-mode",
      expected:
        /setuid·setgid·sticky mode/,
      mutate({ payload }) {
        const before = lstatSync(payload).mode & 0o7777;
        chmodSync(payload, before | 0o2000);
        assert.notEqual(lstatSync(payload).mode & 0o7000, 0);
      },
    },
    {
      name: "bytes",
      expected:
        /archived payload.*sealed payload proof/,
      mutate({ payload }) {
        writeFileSync(join(payload, "state.json"), '{"state":"changed"}\n');
      },
    },
  ];

  for (const driftCase of cases) {
    await t.test(driftCase.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":"sealed"}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterGenerationPrepared() {
                  throw new Error(`stop before ${driftCase.name} drift`);
                },
              },
            },
          ),
        new RegExp(`stop before ${driftCase.name} drift`),
      );

      driftCase.mutate({
        fixture,
        payload: initial.plannedGeneration.payload,
      });
      assert.throws(
        () => buildCleanupPlan(fixture),
        driftCase.expected,
      );
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        false,
      );
    });
  }
});

test("sealed payload drift는 generation·quarantine·ref CAS 각 안전 경계에서 이후 mutation을 차단한다", async (t) => {
  const cases = [
    {
      name: "after generation receipt",
      hook: "afterGenerationPrepared",
      rootMoved: false,
    },
    {
      name: "before root quarantine",
      hook: "beforeWorktreeQuarantine",
      rootMoved: false,
    },
    {
      name: "after root quarantine",
      hook: "afterWorktreeQuarantine",
      rootMoved: true,
    },
    {
      name: "after metadata quarantine",
      hook: "afterMetadataQuarantine",
      rootMoved: true,
    },
    {
      name: "before local ref CAS",
      hook: "beforeRefDelete",
      rootMoved: true,
    },
  ];

  for (const boundary of cases) {
    await t.test(boundary.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"sealed":true}\n');
      const plan = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: plan.planToken },
            {
              hooks: {
                [boundary.hook]() {
                  writeFileSync(
                    join(plan.plannedGeneration.payload, "state.json"),
                    `{"tamperedAt":"${boundary.hook}"}\n`,
                  );
                },
              },
            },
          ),
        /archived payload.*sealed payload proof/,
      );

      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        existsSync(plan.quarantinePlan.rootDestination),
        boundary.rootMoved,
      );
      if (!boundary.rootMoved) {
        assert.equal(existsSync(fixture.issueWorktree), true);
      }
    });
  }
});

test("empty payload pre-receipt crash 뒤 OMC 재생성도 empty 봉인과 append로 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterEmptyPayloadCreated() {
              throw new Error("stop after old empty payload");
            },
          },
        },
      ),
    /stop after old empty payload/,
  );
  mkdirSync(source);
  writeFileSync(join(source, "recreated.json"), '{"recreated":true}\n');

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "seal-empty-and-append");
  assert.equal(recovery.recoveryGeneration.id, initial.plannedGeneration.id);
  assert.equal(
    recovery.plannedGeneration.previous,
    initial.plannedGeneration.id,
  );
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(
    readFileSync(
      join(recovery.plannedGeneration.payload, "recreated.json"),
      "utf8",
    ),
    '{"recreated":true}\n',
  );
  assert.deepEqual(readdirSync(initial.plannedGeneration.payload), []);
  const finalPlan = buildCleanupPlan(fixture);
  assert.equal(finalPlan.archive.generations.length, 2);
});

test("durable intent 없는 receipt-less 64hex container는 봉인하지 않는다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "source.json"), '{"source":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationIntentPublished() {
              throw new Error("stop after known intent");
            },
          },
        },
      ),
    /stop after known intent/,
  );
  const unknown = join(
    initial.paths.generationsDirectory,
    "f".repeat(64),
  );
  mkdirSync(unknown, { mode: 0o700 });

  assert.throws(
    () => buildCleanupPlan(fixture),
    /receipt 없는 generation container에 durable intent가 없습니다/,
  );
  assert.equal(
    readFileSync(join(source, "source.json"), "utf8"),
    '{"source":true}\n',
  );
  assert.equal(existsSync(unknown), true);
  assert.equal(localRef(fixture), fixture.head);
});

test("partial pending identity receipt도 atomic publication으로 복구한다", (t) => {
  const fixture = createFixture(t);
  const initial = buildCleanupPlan(fixture);
  mkdirSync(initial.paths.archiveDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const pendingIdentity = join(
    initial.paths.archiveDirectory,
    `.identity.json.pending-${"b".repeat(64)}`,
  );
  writeFileSync(pendingIdentity, '{"schema":', { mode: 0o600 });

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "create-empty-generation");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(pendingIdentity), false);
  assert.doesNotThrow(() =>
    JSON.parse(readFileSync(recovery.paths.identityFile, "utf8")),
  );
});

test("완료 generation의 pending receipt는 plan token에 결속하고 execute에서 정리한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "state.json"), '{"state":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterGenerationPrepared() {
              throw new Error("stop after published receipt");
            },
          },
        },
      ),
    /stop after published receipt/,
  );
  const pending = join(
    initial.plannedGeneration.directory,
    `.generation.json.pending-${"d".repeat(64)}`,
  );
  writeFileSync(pending, '{"partial":1', { mode: 0o600 });
  const stale = buildCleanupPlan(fixture);
  assert.equal(stale.action, "quarantine-ready");
  writeFileSync(pending, '{"partial":22', { mode: 0o600 });

  assert.throws(
    () =>
      executeLocalCleanup({
        ...fixture,
        planToken: stale.planToken,
      }),
    /plan token.*일치하지 않습니다/,
  );
  assert.equal(existsSync(pending), true);

  const recovery = buildCleanupPlan(fixture);
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(pending), false);
  assert.equal(
    readFileSync(
      join(initial.plannedGeneration.payload, "state.json"),
      "utf8",
    ),
    '{"state":true}\n',
  );
});

test("sealed snapshot 뒤 중단된 실행은 exact archive에서 forward recovery한다", (t) => {
  const fixture = createFixture(t);
  const omc = join(fixture.issueWorktree, ".omc");
  mkdirSync(omc);
  writeFileSync(join(omc, "state.json"), '{"phase":"before"}\n');
  const firstPlan = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: firstPlan.planToken },
        {
          hooks: {
            beforeRemove() {
              throw new Error("fixture interruption after archive");
            },
          },
        },
      ),
    /fixture interruption after archive/,
  );
  const payload = firstPlan.plannedGeneration.payload;
  assert.equal(existsSync(payload), true);
  assert.equal(existsSync(omc), true);
  assert.equal(localRef(fixture), fixture.head);

  const recoveryPlan = buildCleanupPlan(fixture);
  assert.equal(recoveryPlan.action, "quarantine-ready");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recoveryPlan.planToken,
  });
  assert.equal(result.status, "completed");
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
  assert.equal(
    readFileSync(join(payload, "state.json"), "utf8"),
    '{"phase":"before"}\n',
  );
});

test("최종 검증 뒤 변경된 mutable `.omc`도 atomic root quarantine으로 보존한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "old.json"), '{"old":true}\n');
  const plan = buildCleanupPlan(fixture);
  const oldPayload = plan.plannedGeneration.payload;
  const quarantinedRoot = plan.quarantinePlan.rootDestination;

  const result = executeLocalCleanup(
    { ...fixture, planToken: plan.planToken },
    {
      hooks: {
        beforeWorktreeQuarantine() {
          assert.equal(existsSync(source), true);
          writeFileSync(join(source, "new.json"), '{"new":true}\n');
        },
      },
    },
  );

  assert.equal(result.status, "completed");
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
  assert.equal(
    readFileSync(join(oldPayload, "old.json"), "utf8"),
    '{"old":true}\n',
  );
  assert.equal(
    readFileSync(
      join(quarantinedRoot, ".omc", "new.json"),
      "utf8",
    ),
    '{"new":true}\n',
  );
  const finalPlan = buildCleanupPlan(fixture);
  assert.equal(finalPlan.archive.generations.length, 1);
  assert.equal(
    finalPlan.quarantinePlan.rootDestination,
    quarantinedRoot,
  );
});

test("worktree root·metadata가 quarantine됐으면 exact receipt로 local ref CAS만 재개한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "recovery.json"), '{"recovery":true}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterWorktreeRemove() {
              throw new Error("stop after worktree quarantine");
            },
          },
        },
      ),
    /stop after worktree quarantine/,
  );
  assertWorktreeAbsent(fixture);

  const casPlan = buildCleanupPlan(fixture);
  assert.equal(casPlan.action, "delete-ref-recovery");
  const casResult = executeLocalCleanup({
    ...fixture,
    planToken: casPlan.planToken,
  });
  assert.equal(casResult.status, "completed");
  assert.equal(localRef(fixture), null);

  const satisfiedPlan = buildCleanupPlan(fixture);
  assert.equal(satisfiedPlan.action, "satisfied");
  const satisfied = executeLocalCleanup({
    ...fixture,
    planToken: satisfiedPlan.planToken,
  });
  assert.equal(satisfied.status, "satisfied");
  assert.equal(
    readFileSync(
      join(initial.plannedGeneration.payload, "recovery.json"),
      "utf8",
    ),
    '{"recovery":true}\n',
  );
});

test("recovery 경로도 beforeRefDelete sealed drift에서 local ref를 유지한다", async (t) => {
  for (const recoveryCase of [
    {
      name: "quarantine-recovery",
      stopHook: "afterWorktreeQuarantine",
      expectedAction: "quarantine-recovery",
    },
    {
      name: "delete-ref-recovery",
      stopHook: "afterWorktreeRemove",
      expectedAction: "delete-ref-recovery",
    },
  ]) {
    await t.test(recoveryCase.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [recoveryCase.stopHook]() {
                  throw new Error(`stop for ${recoveryCase.name}`);
                },
              },
            },
          ),
        new RegExp(`stop for ${recoveryCase.name}`),
      );

      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, recoveryCase.expectedAction);
      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: recovery.planToken },
            {
              hooks: {
                beforeRefDelete() {
                  writeFileSync(
                    join(
                      initial.plannedGeneration.payload,
                      "state.json",
                    ),
                    `{"tampered":"${recoveryCase.name}"}\n`,
                  );
                },
              },
            },
          ),
        /archived payload.*sealed payload proof/,
      );
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("beforeRefDelete 뒤 exact quarantine evidence가 바뀌면 ref CAS를 실행하지 않는다", async (t) => {
  for (const target of [
    "root",
    "metadata",
    "intent",
    "receipt",
    "unbound-scratch",
  ]) {
    await t.test(target, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      let retained;
      let changedPath;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                beforeRefDelete({ plan }) {
                  if (target === "root" || target === "metadata") {
                    changedPath =
                      target === "root"
                        ? plan.quarantinePlan.rootDestination
                        : plan.quarantinePlan.metadataDestination;
                    retained = `${changedPath}-retained`;
                    renameSync(changedPath, retained);
                    mkdirSync(changedPath, { mode: 0o700 });
                    writeFileSync(
                      join(changedPath, "foreign.txt"),
                      "FOREIGN\n",
                    );
                    return;
                  }
                  if (target === "unbound-scratch") {
                    changedPath = join(
                      plan.paths.snapshotScratchDirectory,
                      `${"f".repeat(64)}.omc`,
                    );
                    mkdirSync(changedPath, { mode: 0o700 });
                    return;
                  }
                  changedPath =
                    target === "intent"
                      ? plan.quarantinePlan.intentPath
                      : plan.quarantinePlan.receiptPath;
                  const value = JSON.parse(
                    readFileSync(changedPath, "utf8"),
                  );
                  value.quarantine = "0".repeat(64);
                  writeFileSync(
                    changedPath,
                    `${JSON.stringify(value, null, 2)}\n`,
                  );
                },
              },
            },
          ),
        /quarantine|intent|receipt|archive canary|expected directory inode/,
      );

      assert.equal(localRef(fixture), fixture.head);
      if (target === "root" || target === "metadata") {
        assert.equal(
          readFileSync(join(changedPath, "foreign.txt"), "utf8"),
          "FOREIGN\n",
        );
        assert.equal(existsSync(retained), true);
      } else if (target === "unbound-scratch") {
        assert.equal(existsSync(changedPath), true);
        assert.deepEqual(readdirSync(changedPath), []);
      } else {
        assert.equal(
          JSON.parse(readFileSync(changedPath, "utf8")).quarantine,
          "0".repeat(64),
        );
      }
    });
  }
});

test("quarantine transition hook 변조는 다음 durable mutation 전에 중단한다", async (t) => {
  const cases = [
    {
      name: "intent hook",
      hook: "afterQuarantineIntentPublished",
      tamper({ plan }) {
        const intent = JSON.parse(
          readFileSync(plan.quarantinePlan.intentPath, "utf8"),
        );
        intent.quarantine = "0".repeat(64);
        writeFileSync(
          plan.quarantinePlan.intentPath,
          `${JSON.stringify(intent, null, 2)}\n`,
        );
      },
      expectedRootMoved: false,
      expectedMetadataMoved: false,
    },
    {
      name: "root hook",
      hook: "afterWorktreeQuarantine",
      tamper({ plan }) {
        const destination = plan.quarantinePlan.rootDestination;
        const retained = `${destination}-retained`;
        renameSync(destination, retained);
        mkdirSync(destination, { mode: 0o700 });
        writeFileSync(join(destination, "foreign.txt"), "FOREIGN ROOT\n");
        return { destination, retained };
      },
      expectedRootMoved: true,
      expectedMetadataMoved: false,
    },
    {
      name: "metadata hook",
      hook: "afterMetadataQuarantine",
      tamper({ plan }) {
        const destination = plan.quarantinePlan.metadataDestination;
        const retained = `${destination}-retained`;
        renameSync(destination, retained);
        mkdirSync(destination, { mode: 0o700 });
        writeFileSync(
          join(destination, "foreign.txt"),
          "FOREIGN METADATA\n",
        );
        return { destination, retained };
      },
      expectedRootMoved: true,
      expectedMetadataMoved: true,
    },
  ];

  for (const transitionCase of cases) {
    await t.test(transitionCase.name, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      let tampered;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [transitionCase.hook]({ plan }) {
                  tampered = transitionCase.tamper({ plan });
                },
              },
            },
          ),
        /quarantine|intent|expected directory inode/,
      );

      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        transitionCase.expectedRootMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        transitionCase.expectedMetadataMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        false,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.intent.metadata.path),
        !transitionCase.expectedMetadataMoved,
      );
      if (!transitionCase.expectedRootMoved) {
        assert.equal(existsSync(fixture.issueWorktree), true);
      }
      if (tampered) {
        assert.equal(
          readFileSync(join(tampered.destination, "foreign.txt"), "utf8"),
          transitionCase.name === "root hook"
            ? "FOREIGN ROOT\n"
            : "FOREIGN METADATA\n",
        );
        assert.equal(existsSync(tampered.retained), true);
      }
    });
  }
});

test("quarantine Git plumbing file의 byte·inode 변조는 root·metadata·receipt·ref 경계에서 이후 mutation을 차단한다", async (t) => {
  const cases = [
    {
      name: "root marker bytes",
      hook: "afterWorktreeQuarantine",
      receiptPublished: false,
      target({ plan }) {
        return join(plan.quarantinePlan.rootDestination, ".git");
      },
      mutate(path) {
        writeFileSync(path, "gitdir: /foreign/metadata\n");
      },
    },
    {
      name: "commondir bytes",
      hook: "afterWorktreeQuarantine",
      receiptPublished: false,
      target({ plan }) {
        return join(
          plan.quarantinePlan.intent.metadata.path,
          "commondir",
        );
      },
      mutate(path) {
        writeFileSync(path, "../../../../foreign-common\n");
      },
    },
    {
      name: "moved gitdir inode",
      hook: "afterMetadataQuarantine",
      receiptPublished: false,
      target({ plan }) {
        return join(
          plan.quarantinePlan.metadataDestination,
          "gitdir",
        );
      },
      mutate(path) {
        const retained = `${path}.retained`;
        const bytes = readFileSync(path);
        renameSync(path, retained);
        writeFileSync(path, bytes);
        return retained;
      },
    },
    {
      name: "receipt 뒤 HEAD bytes",
      hook: "afterQuarantineReceiptPublished",
      receiptPublished: true,
      target({ plan }) {
        return join(
          plan.quarantinePlan.metadataDestination,
          "HEAD",
        );
      },
      mutate(path) {
        writeFileSync(path, "ref: refs/heads/foreign\n");
      },
    },
    {
      name: "ref CAS 직전 index bytes",
      hook: "beforeRefDelete",
      receiptPublished: true,
      target({ plan }) {
        return join(
          plan.quarantinePlan.metadataDestination,
          "index",
        );
      },
      mutate(path) {
        writeFileSync(path, "corrupt linked-worktree index\n");
      },
    },
  ];

  for (const plumbingCase of cases) {
    await t.test(plumbingCase.name, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      let target;
      let retained;

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [plumbingCase.hook]({ plan }) {
                  target = plumbingCase.target({ plan });
                  retained = plumbingCase.mutate(target);
                },
              },
            },
          ),
        /quarantine|metadata|Git index|index file|durable intent|byte digest|로컬 cleanup Git/,
      );

      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(target), true);
      if (retained) {
        assert.equal(existsSync(retained), true);
      }
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        plumbingCase.receiptPublished,
      );
    });
  }
});

test("quarantine transition hook의 main identity drift는 다음 mutation 전에 중단한다", async (t) => {
  const cases = [
    {
      name: "intent hook",
      hook: "afterQuarantineIntentPublished",
      expectedRootMoved: false,
      expectedMetadataMoved: false,
    },
    {
      name: "root hook",
      hook: "afterWorktreeQuarantine",
      expectedRootMoved: true,
      expectedMetadataMoved: false,
    },
    {
      name: "metadata hook",
      hook: "afterMetadataQuarantine",
      expectedRootMoved: true,
      expectedMetadataMoved: true,
    },
  ];

  for (const transitionCase of cases) {
    await t.test(transitionCase.name, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [transitionCase.hook]() {
                  git(fixture.mainWorktree, [
                    "update-ref",
                    "refs/heads/main",
                    fixture.parent,
                    fixture.head,
                  ]);
                },
              },
            },
          ),
        /main branch·HEAD|main worktree/,
      );

      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        gitOutput(fixture.mainWorktree, [
          "rev-parse",
          "refs/heads/main",
        ]),
        fixture.parent,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        transitionCase.expectedRootMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        transitionCase.expectedMetadataMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        false,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.intent.metadata.path),
        !transitionCase.expectedMetadataMoved,
      );
    });
  }
});

test("cleanup plan은 explicit repository와 canonical origin fetch·push에 결속된다", async (t) => {
  const cases = [
    {
      name: "multiple fetch",
      mutate(fixture) {
        git(fixture.mainWorktree, [
          "remote",
          "set-url",
          "--add",
          "origin",
          "https://github.com/thumbsup-studio/other.git",
        ]);
      },
    },
    {
      name: "multiple push",
      mutate(fixture) {
        git(fixture.mainWorktree, [
          "remote",
          "set-url",
          "--add",
          "--push",
          "origin",
          "https://github.com/thumbsup-studio/other.git",
        ]);
      },
    },
    {
      name: "credentialed fetch",
      mutate(fixture) {
        git(fixture.mainWorktree, [
          "remote",
          "set-url",
          "origin",
          "https://fixture-user:fixture-secret@github.com/thumbsup-studio/lunchtime.git",
        ]);
      },
    },
    {
      name: "unparseable fetch",
      mutate(fixture) {
        git(fixture.mainWorktree, [
          "remote",
          "set-url",
          "origin",
          "/tmp/not-a-canonical-github-origin",
        ]);
      },
    },
    {
      name: "cross-repository push",
      mutate(fixture) {
        git(fixture.mainWorktree, [
          "remote",
          "set-url",
          "--push",
          "origin",
          "git@github.com:thumbsup-studio/other.git",
        ]);
      },
    },
    {
      name: "wrong explicit repository",
      mutate() {},
      input(fixture) {
        return { ...fixture, repo: "thumbsup-studio/other" };
      },
    },
  ];

  for (const repositoryCase of cases) {
    await t.test(repositoryCase.name, (child) => {
      const fixture = createFixture(child);
      repositoryCase.mutate(fixture);
      let error;
      try {
        buildCleanupPlan(
          repositoryCase.input?.(fixture) ?? fixture,
        );
      } catch (caught) {
        error = caught;
      }

      assert.ok(error);
      assert.match(
        error.message,
        /origin|repository|저장소|URL/,
      );
      assert.doesNotMatch(error.message, /fixture-secret/);
      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("dry-run 뒤 canonical origin fingerprint가 바뀌면 execute mutation 전에 중단한다", (t) => {
  const fixture = createFixture(t);
  const initial = buildCleanupPlan(fixture);
  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    alternateFixturePushUrl,
  ]);
  const changed = buildCleanupPlan(fixture);
  assert.equal(changed.archiveKey, initial.archiveKey);
  assert.equal(
    changed.paths.archiveDirectory,
    initial.paths.archiveDirectory,
  );
  assert.notEqual(changed.planToken, initial.planToken);
  assert.deepEqual(changed.coreIdentity, initial.coreIdentity);
  assert.notDeepEqual(changed.originIdentity, initial.originIdentity);

  assert.throws(
    () =>
      executeLocalCleanup({
        ...fixture,
        planToken: initial.planToken,
      }),
    /plan token|origin|archive identity/,
  );
  assert.equal(existsSync(initial.paths.archiveDirectory), false);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
});

test("same-repository origin 변경은 old token을 거부하고 fresh dry-run으로 partial state를 복구한다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(join(source, "state"), { recursive: true });
  writeFileSync(join(source, "a.json"), '{"a":"source"}\n');
  writeFileSync(join(source, "state", "b.json"), '{"b":"source"}\n');
  const initial = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterSnapshotPayloadStarted({ pendingPayload }) {
              writeFileSync(
                join(pendingPayload, "a.json"),
                '{"a":"partial"}\n',
              );
              throw new Error("stop after partial payload");
            },
          },
        },
      ),
    /stop after partial payload/,
  );
  assert.equal(existsSync(initial.paths.identityFile), true);
  const durableIdentity = JSON.parse(
    readFileSync(initial.paths.identityFile, "utf8"),
  );
  assert.equal(durableIdentity.repository, fixtureRepository);
  assert.equal("origin" in durableIdentity, false);
  assert.doesNotMatch(
    JSON.stringify(durableIdentity),
    /github\.com|fetchFingerprint|pushFingerprint/,
  );

  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    alternateFixturePushUrl,
  ]);
  assert.throws(
    () =>
      executeLocalCleanup({
        ...fixture,
        planToken: initial.planToken,
      }),
    /plan token/,
  );

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.archiveKey, initial.archiveKey);
  assert.equal(
    recovery.paths.archiveDirectory,
    initial.paths.archiveDirectory,
  );
  assert.equal(recovery.action, "seal-partial-and-append");
  assert.equal(recovery.recoveryGeneration.partialPayload, true);
  assert.equal(recovery.originIdentity.repository, fixtureRepository);

  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "origin",
    "https://github.com/thumbsup-studio/other.git",
  ]);
  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    "git@github.com:thumbsup-studio/other.git",
  ]);
  assert.throws(
    () =>
      buildCleanupPlan({
        ...fixture,
        repo: "thumbsup-studio/other",
      }),
    /archive identity collision|core identity/,
  );
  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "origin",
    fixtureFetchUrl,
  ]);
  git(fixture.mainWorktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    alternateFixturePushUrl,
  ]);

  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(localRef(fixture), null);
  assert.deepEqual(
    readdirSync(initial.paths.versionRoot),
    [initial.archiveKey],
  );
});

test("generation의 모든 exposed durable boundary는 changed origin fingerprint 뒤 다음 mutation을 차단한다", async (t) => {
  for (const boundary of [
    "afterGenerationIntentPublished",
    "afterGenerationContainerCreated",
    "afterUnboundSnapshotRootCreated",
    "afterSnapshotAttemptPublished",
    "afterSnapshotPayloadStarted",
    "beforeNoReplaceRename",
    "afterPendingRootCreated",
    "afterSnapshotOutcomePublished",
    "afterSnapshotCurrentPublished",
    "afterGenerationPrepared",
    "afterArchiveReady",
  ]) {
    await t.test(boundary, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [boundary]() {
                  git(fixture.mainWorktree, [
                    "remote",
                    "set-url",
                    "--push",
                    "origin",
                    alternateFixturePushUrl,
                  ]);
                },
              },
            },
          ),
        /origin|repository|저장소|archive identity/,
      );
      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        false,
      );
    });
  }

  for (const boundary of [
    "beforeEmptyPayloadCreate",
    "afterEmptyPayloadCreated",
  ]) {
    await t.test(boundary, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [boundary]() {
                  git(fixture.mainWorktree, [
                    "remote",
                    "set-url",
                    "--push",
                    "origin",
                    alternateFixturePushUrl,
                  ]);
                },
              },
            },
          ),
        /origin|repository|저장소|archive identity/,
      );
      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("quarantine transition과 ref CAS canary는 changed origin fingerprint를 거부한다", async (t) => {
  for (const canaryCase of [
    {
      name: "after intent",
      hook: "afterQuarantineIntentPublished",
      expectRoot: false,
      expectMetadata: false,
      expectReceipt: false,
    },
    {
      name: "before root",
      hook: "beforeWorktreeQuarantine",
      expectRoot: false,
      expectMetadata: false,
      expectReceipt: false,
    },
    {
      name: "after root",
      hook: "afterWorktreeQuarantine",
      expectRoot: true,
      expectMetadata: false,
      expectReceipt: false,
    },
    {
      name: "before metadata",
      hook: "beforeMetadataQuarantine",
      expectRoot: true,
      expectMetadata: false,
      expectReceipt: false,
    },
    {
      name: "after metadata",
      hook: "afterMetadataQuarantine",
      expectRoot: true,
      expectMetadata: true,
      expectReceipt: false,
    },
    {
      name: "before ref CAS",
      hook: "beforeRefDelete",
      expectRoot: true,
      expectMetadata: true,
      expectReceipt: true,
    },
  ]) {
    await t.test(canaryCase.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [canaryCase.hook]() {
                  git(fixture.mainWorktree, [
                    "remote",
                    "set-url",
                    "--push",
                    "origin",
                    alternateFixturePushUrl,
                  ]);
                },
              },
            },
          ),
        /origin|repository|저장소|archive identity/,
      );

      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        canaryCase.expectRoot,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        canaryCase.expectMetadata,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        canaryCase.expectReceipt,
      );
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("quarantine intent·root·metadata 각 crash 지점에서 metadata-only cleanup을 재개한다", async (t) => {
  const cases = [
    {
      name: "intent published",
      hook: "afterQuarantineIntentPublished",
      error: "stop after quarantine intent",
    },
    {
      name: "root moved",
      hook: "afterWorktreeQuarantine",
      error: "stop after root quarantine",
    },
    {
      name: "metadata moved",
      hook: "afterMetadataQuarantine",
      error: "stop after metadata quarantine",
    },
  ];
  for (const crashCase of cases) {
    await t.test(crashCase.name, (child) => {
      const fixture = createFixture(child);
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [crashCase.hook]() {
                  throw new Error(crashCase.error);
                },
              },
            },
          ),
        new RegExp(crashCase.error),
      );

      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, "quarantine-recovery");
      const result = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(result.status, "completed");
      assertWorktreeAbsent(fixture);
      assert.equal(localRef(fixture), null);
      assert.equal(
        readFileSync(
          join(initial.plannedGeneration.payload, "state.json"),
          "utf8",
        ),
        '{"state":true}\n',
      );
      assert.equal(
        existsSync(recovery.quarantinePlan.rootDestination),
        true,
      );
      assert.equal(
        existsSync(recovery.quarantinePlan.metadataDestination),
        true,
      );
      git(fixture.mainWorktree, ["fsck", "--no-progress"]);
    });
  }
});

test("stat-cache-only drift는 post-move canary가 index bytes를 바꾸지 않고 root 단계에서 재개한다", (t) => {
  const fixture = createFixture(t);
  const initial = buildCleanupPlan(fixture);
  const indexPath = gitOutput(fixture.issueWorktree, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const indexBefore = readFileSync(indexPath);
  const trackedBefore = readFileSync(
    join(fixture.issueWorktree, "README.md"),
  );
  const indexEntryBefore = gitOutput(fixture.issueWorktree, [
    "ls-files",
    "--stage",
    "--",
    "README.md",
  ]);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: initial.planToken },
        {
          hooks: {
            afterWorktreeQuarantine({ plan }) {
              const tracked = join(
                plan.quarantinePlan.rootDestination,
                "README.md",
              );
              const stats = lstatSync(tracked);
              utimesSync(
                tracked,
                stats.atime,
                new Date(stats.mtimeMs - 10_000),
              );
            },
            beforeMetadataQuarantine({ plan }) {
              assert.deepEqual(
                readFileSync(
                  join(
                    plan.quarantinePlan.intent.metadata.path,
                    "index",
                  ),
                ),
                indexBefore,
              );
              assert.deepEqual(
                readFileSync(
                  join(
                    plan.quarantinePlan.rootDestination,
                    "README.md",
                  ),
                ),
                trackedBefore,
              );
              assert.equal(
                quarantinedGit(plan, [
                  "ls-files",
                  "--stage",
                  "--",
                  "README.md",
                ]).stdout.trim(),
                indexEntryBefore,
              );
              throw new Error("stop after stat-only root canary");
            },
          },
        },
      ),
    /stop after stat-only root canary/,
  );

  assert.equal(
    existsSync(initial.quarantinePlan.rootDestination),
    true,
  );
  assert.equal(
    existsSync(initial.quarantinePlan.metadataDestination),
    false,
  );
  assert.equal(localRef(fixture), fixture.head);

  const recovery = buildCleanupPlan(fixture);
  assert.equal(recovery.action, "quarantine-recovery");
  const result = executeLocalCleanup({
    ...fixture,
    planToken: recovery.planToken,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(
    readFileSync(
      join(recovery.quarantinePlan.metadataDestination, "index"),
    ),
    indexBefore,
  );
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
});

test("tracked 변경을 숨기는 index flag는 post-move canary에서 fail-closed한다", async (t) => {
  const cases = [
    {
      name: "assume-unchanged",
      options: ["--assume-unchanged"],
      expected: /assume-unchanged flag/,
    },
    {
      name: "skip-worktree",
      options: ["--skip-worktree"],
      expected: /skip-worktree flag.*sparse checkout/,
    },
    {
      name: "skip-worktree and assume-unchanged",
      options: ["--assume-unchanged", "--skip-worktree"],
      expected: /skip-worktree flag.*sparse checkout/,
    },
  ];

  for (const flagCase of cases) {
    await t.test(flagCase.name, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      const changed = join(
        initial.quarantinePlan.rootDestination,
        "README.md",
      );

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                afterWorktreeQuarantine({ plan }) {
                  for (const option of flagCase.options) {
                    quarantinedGit(plan, [
                      "update-index",
                      option,
                      "--",
                      "README.md",
                    ]);
                  }
                  writeFileSync(
                    changed,
                    `hidden by ${flagCase.name}\n`,
                  );
                },
              },
            },
          ),
        flagCase.expected,
      );

      assert.equal(
        readFileSync(changed, "utf8"),
        `hidden by ${flagCase.name}\n`,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        true,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        false,
      );
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("preexisting issue index flag는 quarantine 전에 fail-closed한다", async (t) => {
  for (const flagCase of [
    {
      name: "assume-unchanged",
      options: ["--assume-unchanged"],
      expected: /assume-unchanged flag/,
    },
    {
      name: "skip-worktree",
      options: ["--skip-worktree"],
      expected: /skip-worktree flag.*sparse checkout/,
    },
    {
      name: "skip-worktree and assume-unchanged",
      options: ["--assume-unchanged", "--skip-worktree"],
      expected: /skip-worktree flag.*sparse checkout/,
    },
  ]) {
    await t.test(flagCase.name, (child) => {
      const fixture = createFixture(child);
      for (const option of flagCase.options) {
        git(fixture.issueWorktree, [
          "update-index",
          option,
          "--",
          "README.md",
        ]);
      }
      writeFileSync(
        join(fixture.issueWorktree, "README.md"),
        `preexisting ${flagCase.name} drift\n`,
      );

      assert.throws(
        () => buildCleanupPlan(fixture),
        flagCase.expected,
      );
      assert.equal(existsSync(fixture.issueWorktree), true);
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("main index flag는 clean gate 전에 fail-closed한다", (t) => {
  const fixture = createFixture(t);
  git(fixture.mainWorktree, [
    "update-index",
    "--assume-unchanged",
    "--",
    "README.md",
  ]);
  writeFileSync(
    join(fixture.mainWorktree, "README.md"),
    "hidden main drift\n",
  );

  assert.throws(
    () => buildCleanupPlan(fixture),
    /main worktree Git index의 .*flag는 로컬 cleanup에서 허용하지 않습니다/,
  );
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
});

test("ambient fsmonitor hook은 residue 검사에서 실행하지 않는다", (t) => {
  const fixture = createFixture(t);
  const invoked = join(fixture.root, "fsmonitor-invoked");
  const hook = join(fixture.root, "fsmonitor-hook.sh");
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      `printf invoked > "${invoked}"`,
      "printf '\\n'",
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o700);
  git(fixture.mainWorktree, [
    "config",
    "core.fsmonitor",
    hook,
  ]);

  const plan = buildCleanupPlan(fixture);
  assert.equal(existsSync(invoked), false);
  const result = executeLocalCleanup({
    ...fixture,
    planToken: plan.planToken,
  });
  assert.equal(result.status, "completed");
  assert.equal(existsSync(invoked), false);
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
});

test("fsmonitor-valid hint는 tracked drift를 숨기거나 issue index를 다시 쓰지 못한다", (t) => {
  const fixture = createFixture(t);
  const invoked = join(fixture.root, "issue-fsmonitor-invoked");
  const hook = join(fixture.root, "issue-fsmonitor-hook.sh");
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      `printf invoked > "${invoked}"`,
      "printf 'fixture-token\\n'",
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o700);
  git(fixture.issueWorktree, [
    "config",
    "core.fsmonitor",
    hook,
  ]);
  git(fixture.issueWorktree, [
    "update-index",
    "--fsmonitor-valid",
    "--",
    "README.md",
  ]);
  assert.match(
    gitOutput(fixture.issueWorktree, [
      "ls-files",
      "-f",
      "--",
      "README.md",
    ]),
    /^[a-z] /,
  );
  if (existsSync(invoked)) unlinkSync(invoked);

  const indexPath = gitOutput(fixture.issueWorktree, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const indexBefore = readFileSync(indexPath);
  writeFileSync(
    join(fixture.issueWorktree, "README.md"),
    "hidden by fsmonitor-valid\n",
  );

  assert.throws(
    () => buildCleanupPlan(fixture),
    /issue worktree에 tracked·staged 또는 unignored 변경/,
  );
  assert.deepEqual(readFileSync(indexPath), indexBefore);
  assert.equal(existsSync(invoked), false);
  assert.equal(existsSync(fixture.issueWorktree), true);
  assert.equal(localRef(fixture), fixture.head);
});

test("main dry-run과 execute는 untracked-cache·fsmonitor index bytes를 바꾸지 않는다", (t) => {
  const fixture = createFixture(t);
  const invoked = join(fixture.root, "main-fsmonitor-invoked");
  const hook = join(fixture.root, "main-fsmonitor-hook.sh");
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      `printf invoked > "${invoked}"`,
      "printf 'fixture-token\\n'",
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o700);
  git(fixture.mainWorktree, [
    "config",
    "core.untrackedCache",
    "true",
  ]);
  git(fixture.mainWorktree, [
    "config",
    "core.fsmonitor",
    hook,
  ]);
  git(fixture.mainWorktree, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  assert.equal(existsSync(invoked), true);
  unlinkSync(invoked);

  const indexPath = gitOutput(fixture.mainWorktree, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "index",
  ]);
  const indexBefore = readFileSync(indexPath);
  if (
    !indexBefore.includes(Buffer.from("UNTR")) ||
    !indexBefore.includes(Buffer.from("FSMN"))
  ) {
    t.skip("Git이 UNTR·FSMN index extension을 유지하지 않습니다.");
    return;
  }

  const plan = buildCleanupPlan(fixture);
  assert.deepEqual(readFileSync(indexPath), indexBefore);
  assert.equal(existsSync(invoked), false);

  const result = executeLocalCleanup({
    ...fixture,
    planToken: plan.planToken,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(readFileSync(indexPath), indexBefore);
  assert.equal(existsSync(invoked), false);
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
});

test("setgid parent 아래 helper-owned archive directory는 exact 0700으로 봉인한다", (t) => {
  const fixture = createFixture(t);
  const commonDir = gitOutput(fixture.mainWorktree, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  const originalMode = lstatSync(commonDir).mode & 0o7777;
  chmodSync(commonDir, originalMode | 0o2000);
  if ((lstatSync(commonDir).mode & 0o2000) === 0) {
    t.skip("filesystem이 directory setgid mode를 지원하지 않습니다.");
    return;
  }

  const plan = buildCleanupPlan(fixture);
  const result = executeLocalCleanup({
    ...fixture,
    planToken: plan.planToken,
  });
  assert.equal(result.status, "completed");
  for (const directory of [
    plan.paths.archiveRoot,
    plan.paths.versionRoot,
    plan.paths.archiveDirectory,
    plan.paths.generationsDirectory,
    plan.paths.intentsDirectory,
    plan.paths.snapshotScratchDirectory,
    plan.plannedGeneration.directory,
    plan.plannedGeneration.payload,
    plan.paths.quarantineDirectory,
    plan.paths.quarantineIntentsDirectory,
    plan.paths.quarantineRootsDirectory,
    plan.paths.quarantineMetadataDirectory,
    plan.paths.quarantineReceiptsDirectory,
  ]) {
    assert.equal(
      lstatSync(directory).mode & 0o7777,
      0o700,
      directory,
    );
  }
  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), null);
});

test("late ordinary residue는 final pre-scan과 post-move root·metadata·receipt·ref canary에서 fail-closed하고 사용자 정리 뒤에만 재개한다", async (t) => {
  const cases = [
    {
      name: "origin canary 뒤 untracked",
      hook: "afterRootOriginCanary",
      rootMoved: false,
      metadataMoved: false,
      receiptPublished: false,
      expectedRecovery: "quarantine-recovery",
      mutate({ fixture }) {
        const path = join(
          fixture.issueWorktree,
          "late-origin-untracked.txt",
        );
        writeFileSync(path, "late origin untracked\n");
        return {
          path,
          remediate() {
            unlinkSync(path);
          },
        };
      },
    },
    {
      name: "root move 뒤 tracked",
      hook: "afterWorktreeQuarantine",
      rootMoved: true,
      metadataMoved: false,
      receiptPublished: false,
      expectedRecovery: "quarantine-recovery",
      remainsAfterRemediation: true,
      mutate({ plan }) {
        const path = join(
          plan.quarantinePlan.rootDestination,
          "README.md",
        );
        writeFileSync(path, "late tracked mutation\n");
        return {
          path,
          remediate() {
            quarantinedGit(plan, [
              "checkout-index",
              "--force",
              "--",
              "README.md",
            ]);
            quarantinedGit(plan, ["update-index", "--refresh"]);
          },
        };
      },
    },
    {
      name: "root move 뒤 mode with core.fileMode false",
      hook: "afterWorktreeQuarantine",
      rootMoved: true,
      metadataMoved: false,
      receiptPublished: false,
      expectedRecovery: "quarantine-recovery",
      remainsAfterRemediation: true,
      configure({ fixture }) {
        git(fixture.mainWorktree, [
          "config",
          "core.fileMode",
          "false",
        ]);
      },
      mutate({ plan }) {
        const path = join(
          plan.quarantinePlan.rootDestination,
          "README.md",
        );
        const before = lstatSync(path).mode & 0o777;
        chmodSync(path, before ^ 0o100);
        return {
          path,
          remediate() {
            chmodSync(path, before);
          },
        };
      },
    },
    {
      name: "metadata move 뒤 staged",
      hook: "afterMetadataQuarantine",
      rootMoved: true,
      metadataMoved: true,
      receiptPublished: false,
      expectedRecovery: "quarantine-recovery",
      mutate({ plan }) {
        const path = join(
          plan.quarantinePlan.rootDestination,
          "late-staged.txt",
        );
        writeFileSync(path, "late staged\n");
        quarantinedGit(plan, ["add", "--", "late-staged.txt"]);
        return {
          path,
          remediate() {
            quarantinedGit(plan, [
              "reset",
              "--mixed",
              plan.head,
              "--",
              "late-staged.txt",
            ]);
            unlinkSync(path);
          },
        };
      },
    },
    {
      name: "receipt hook 뒤 additional ignored",
      hook: "afterQuarantineReceiptPublished",
      rootMoved: true,
      metadataMoved: true,
      receiptPublished: true,
      expectedRecovery: "delete-ref-recovery",
      mutate({ plan }) {
        const path = join(
          plan.quarantinePlan.rootDestination,
          ".DS_Store",
        );
        writeFileSync(path, "late ignored\n");
        return {
          path,
          remediate() {
            unlinkSync(path);
          },
        };
      },
    },
    {
      name: "ref CAS hook 뒤 untracked",
      hook: "beforeRefDelete",
      rootMoved: true,
      metadataMoved: true,
      receiptPublished: true,
      expectedRecovery: "delete-ref-recovery",
      mutate({ plan }) {
        const path = join(
          plan.quarantinePlan.rootDestination,
          "late-ref-untracked.txt",
        );
        writeFileSync(path, "late ref untracked\n");
        return {
          path,
          remediate() {
            unlinkSync(path);
          },
        };
      },
    },
  ];

  for (const residueCase of cases) {
    await t.test(residueCase.name, (child) => {
      const fixture = createFixture(child);
      residueCase.configure?.({ fixture });
      const source = join(fixture.issueWorktree, ".omc");
      mkdirSync(source);
      writeFileSync(join(source, "state.json"), '{"state":true}\n');
      const initial = buildCleanupPlan(fixture);
      let residue;
      let result;

      assert.throws(
        () => {
          result = executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [residueCase.hook]({ plan }) {
                  residue = residueCase.mutate({
                    fixture,
                    plan,
                  });
                },
              },
            },
          );
        },
        /tracked·staged|unignored|ignored residue|post-move residue canary/,
      );

      assert.equal(result, undefined);
      assert.equal(localRef(fixture), fixture.head);
      assert.equal(existsSync(residue.path), true);
      assert.equal(
        existsSync(initial.quarantinePlan.rootDestination),
        residueCase.rootMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.metadataDestination),
        residueCase.metadataMoved,
      );
      assert.equal(
        existsSync(initial.quarantinePlan.receiptPath),
        residueCase.receiptPublished,
      );
      assert.throws(
        () => buildCleanupPlan(fixture),
        /tracked·staged|unignored|ignored residue|post-move residue canary/,
      );

      residue.remediate();
      assert.equal(
        existsSync(residue.path),
        Boolean(residueCase.remainsAfterRemediation),
      );
      const recovery = buildCleanupPlan(fixture);
      assert.equal(recovery.action, residueCase.expectedRecovery);
      const completed = executeLocalCleanup({
        ...fixture,
        planToken: recovery.planToken,
      });
      assert.equal(completed.status, "completed");
      assert.equal(localRef(fixture), null);
    });
  }
});

test("root quarantine 직후 original path 재생성은 삭제하지 않고 bounded residue로 남긴다", (t) => {
  const fixture = createFixture(t);
  const initial = buildCleanupPlan(fixture);
  const recreated = join(fixture.issueWorktree, ".omc");

  const result = executeLocalCleanup(
    { ...fixture, planToken: initial.planToken },
    {
      hooks: {
        afterWorktreeQuarantine() {
          mkdirSync(recreated, { recursive: true });
          writeFileSync(
            join(recreated, "late.json"),
            '{"late":true}\n',
          );
        },
      },
    },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.boundedResidue, true);
  assert.equal(
    readFileSync(join(recreated, "late.json"), "utf8"),
    '{"late":true}\n',
  );
  assert.equal(
    existsSync(initial.quarantinePlan.rootDestination),
    true,
  );
  assert.equal(localRef(fixture), null);
  const worktrees = git(
    fixture.mainWorktree,
    ["worktree", "list", "--porcelain"],
  ).stdout;
  assert.doesNotMatch(
    worktrees,
    new RegExp(
      fixture.issueWorktree.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
  const satisfied = buildCleanupPlan(fixture);
  assert.equal(satisfied.action, "satisfied");
  assert.equal(satisfied.quarantinePlan.boundedResidue, true);
});

test("worktree root·metadata quarantine collision은 어느 쪽도 덮어쓰지 않는다", async (t) => {
  for (const target of ["root", "metadata"]) {
    await t.test(target, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      const destination =
        target === "root"
          ? initial.quarantinePlan.rootDestination
          : initial.quarantinePlan.metadataDestination;
      let collisionInode;
      const hook =
        target === "root"
          ? "beforeWorktreeQuarantine"
          : "beforeMetadataQuarantine";

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [hook]() {
                  mkdirSync(destination);
                  collisionInode = lstatSync(destination).ino;
                  writeFileSync(
                    join(destination, "collision.txt"),
                    "keep\n",
                  );
                },
              },
            },
          ),
        /quarantine destination collision/,
      );

      assert.equal(lstatSync(destination).ino, collisionInode);
      assert.equal(
        readFileSync(join(destination, "collision.txt"), "utf8"),
        "keep\n",
      );
      if (target === "root") {
        assert.equal(existsSync(fixture.issueWorktree), true);
      } else {
        assert.equal(
          existsSync(initial.quarantinePlan.rootDestination),
          true,
        );
      }
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("quarantine hook의 source inode swap은 replacement를 이동하지 않는다", async (t) => {
  for (const target of ["root", "metadata"]) {
    await t.test(target, (child) => {
      const fixture = createFixture(child);
      const initial = buildCleanupPlan(fixture);
      const source =
        target === "root"
          ? fixture.issueWorktree
          : initial.quarantinePlan.intent.metadata.path;
      const retained = `${source}-retained`;
      const destination =
        target === "root"
          ? initial.quarantinePlan.rootDestination
          : initial.quarantinePlan.metadataDestination;
      const hook =
        target === "root"
          ? "beforeWorktreeQuarantine"
          : "beforeMetadataQuarantine";

      assert.throws(
        () =>
          executeLocalCleanup(
            { ...fixture, planToken: initial.planToken },
            {
              hooks: {
                [hook]() {
                  renameSync(source, retained);
                  mkdirSync(source, { mode: 0o700 });
                  writeFileSync(
                    join(source, "foreign.txt"),
                    "FOREIGN\n",
                  );
                },
              },
            },
          ),
        /original.*inode|metadata.*inode|registration/,
      );

      assert.equal(existsSync(destination), false);
      assert.equal(
        readFileSync(join(source, "foreign.txt"), "utf8"),
        "FOREIGN\n",
      );
      assert.equal(existsSync(retained), true);
      if (target === "root") {
        assert.equal(existsSync(join(retained, ".git")), true);
      }
      assert.equal(localRef(fixture), fixture.head);
    });
  }
});

test("metadata quarantine 뒤 branch가 이동하면 old-OID CAS가 실패하고 강제 삭제하지 않는다", (t) => {
  const fixture = createFixture(t);
  const source = join(fixture.issueWorktree, ".omc");
  mkdirSync(source);
  writeFileSync(join(source, "cas.json"), '{"cas":true}\n');
  const plan = buildCleanupPlan(fixture);

  assert.throws(
    () =>
      executeLocalCleanup(
        { ...fixture, planToken: plan.planToken },
        {
          hooks: {
            beforeRefDelete() {
              git(fixture.mainWorktree, [
                "update-ref",
                `refs/heads/${fixture.branch}`,
                fixture.parent,
                fixture.head,
              ]);
            },
          },
        },
      ),
    /update-ref.*cannot lock ref|local cleanup Git 명령이 실패|남은 local branch OID/,
  );

  assertWorktreeAbsent(fixture);
  assert.equal(localRef(fixture), fixture.parent);
  assert.equal(
    readFileSync(join(plan.plannedGeneration.payload, "cas.json"), "utf8"),
    '{"cas":true}\n',
  );
});

test("branch 형식은 `--issue` 번호와 exact work branch로 결속된다", (t) => {
  const fixture = createFixture(t);

  assert.throws(
    () => buildCleanupPlan({ ...fixture, issue: 52 }),
    /work\/issue-52-<short-slug>.*`--issue`와 결속/,
  );
  assert.throws(
    () =>
      buildCleanupPlan({
        ...fixture,
        branch: "work/issue-51-Cleanup",
      }),
    /work\/issue-51-<short-slug>.*`--issue`와 결속/,
  );
  assert.throws(
    () =>
      buildCleanupPlan({
        ...fixture,
        branch: "work/issue-51-cleanup--fixture",
      }),
    /work\/issue-51-<short-slug>.*`--issue`와 결속/,
  );
  assert.equal(localRef(fixture), fixture.head);
});

test("이미 제거된 worktree는 exact archive receipt 없이는 fail-closed한다", (t) => {
  const fixture = createFixture(t);
  git(fixture.mainWorktree, [
    "worktree",
    "remove",
    "--",
    fixture.issueWorktree,
  ]);

  assert.equal(localRef(fixture), fixture.head);
  assert.throws(
    () => buildCleanupPlan(fixture),
    /exact worktree 또는 durable quarantine intent를 확정할 수 없습니다/,
  );
});

test("CLI parser는 repository를 포함한 일곱 identity와 dry-run token 순서를 강제한다", () => {
  const base = [
    "--issue-worktree",
    "/tmp/issue",
    "--main-worktree",
    "/tmp/main",
    "--branch",
    fixtureBranch,
    "--head",
    "a".repeat(40),
    "--repo",
    fixtureRepository,
    "--issue",
    "51",
    "--pr",
    "51",
  ];
  assert.equal(parseArguments([...base, "--dry-run"]).mode, "dry-run");
  assert.throws(
    () =>
      parseArguments([
        ...base.slice(0, base.indexOf("--repo")),
        ...base.slice(base.indexOf("--repo") + 2),
        "--dry-run",
      ]),
    /필수 인자가 없습니다: --repo/,
  );
  assert.throws(
    () => parseArguments([...base, "--execute"]),
    /dry-run의 `--plan-token`/,
  );
  assert.throws(
    () =>
      parseArguments([
        ...base,
        "--dry-run",
        "--plan-token",
        "b".repeat(64),
      ]),
    /`--dry-run`에는 `--plan-token`/,
  );
  assert.equal(
    parseArguments([
      ...base,
      "--execute",
      "--plan-token",
      "b".repeat(64),
    ]).mode,
    "execute",
  );
});
