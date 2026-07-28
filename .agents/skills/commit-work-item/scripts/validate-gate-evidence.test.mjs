import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_SCHEMA,
  EVIDENCE_VERSION,
  GROUP_COMMAND_MANIFESTS,
  canonicalOid,
  commandManifestDigest,
  evaluateCurrentWorkspace,
  evaluateGateEvidence,
  parseArguments,
  parseEvidenceJson,
  parseLsTreeOutput,
  projectGroupInput,
  readChangedTreePaths,
  validatePreviousEvidence,
} from "./validate-gate-evidence.mjs";

const SCRIPT = fileURLToPath(
  new URL("./validate-gate-evidence.mjs", import.meta.url),
);
const GROUPS = [
  "productDocsRegression",
  "workItemRegression",
  "commitPrRegression",
  "finalizeRegression",
];

const BASE_FILES = Object.freeze({
  ".gitignore": "*.tmp\n",
  "README.md": "readme\n",
  "AGENTS.md": "agents\n",
  "docs/meetings/review.md": "meeting\n",
  ".github/ISSUE_TEMPLATE/work-item.yml": "name: work\n",
  ".github/PULL_REQUEST_TEMPLATE.md": "template\n",
  ".github/mvp-work-items.json": "{}\n",
  ".github/work-management.json": "{}\n",
  ".github/workflows/validate-harness-paths.mjs": "classifier\n",
  ".agents/skills/update-product-docs/scripts/validate-product-docs.mjs":
    "product docs\n",
  ".agents/skills/update-product-docs/scripts/product-contract-ids.mjs":
    "ids\n",
  ".agents/skills/run-github-work-item/SKILL.md": "work skill\n",
  ".agents/skills/run-github-work-item/references/issue-contract.md":
    "issue contract\n",
  ".agents/skills/run-github-work-item/agents/openai.yaml":
    "interface:\n",
  ".agents/skills/run-github-work-item/scripts/work-item.mjs":
    "work item\n",
  ".agents/skills/commit-work-item/scripts/validate-commit-paths.mjs":
    "commit paths\n",
  ".agents/skills/commit-work-item/scripts/validate-gate-evidence.mjs":
    "gate evidence\n",
  ".agents/skills/commit-work-item/scripts/validate-gate-evidence.test.mjs":
    "gate evidence test\n",
  ".agents/skills/open-pull-request/scripts/validate-pr-body.mjs":
    "pr body\n",
  ".agents/skills/open-pull-request/scripts/finalize-merge.mjs":
    "finalize\n",
});

function run(cwd, command, arguments_, options = {}) {
  return spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function git(cwd, arguments_) {
  const result = run(cwd, "git", arguments_);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function writeRepositoryFile(directory, path, content) {
  const absolutePath = join(directory, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

async function createRepository(context) {
  const directory = await mkdtemp(
    join(tmpdir(), "lunchtime-gate-evidence-"),
  );
  context.after(async () => rm(directory, { recursive: true, force: true }));
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.name", "Test User"]);
  git(directory, ["config", "user.email", "test@example.com"]);
  git(directory, ["config", "diff.renames", "true"]);

  for (const [path, content] of Object.entries(BASE_FILES)) {
    await writeRepositoryFile(directory, path, content);
  }
  git(directory, ["add", "--", ...Object.keys(BASE_FILES)]);
  git(directory, ["commit", "-q", "-m", "chore: #1 - fixture"]);

  return {
    directory,
    base: git(directory, ["rev-parse", "HEAD"]),
    baseTree: git(directory, ["rev-parse", "HEAD^{tree}"]),
  };
}

async function stageUpdates(repository, updates) {
  for (const [path, content] of Object.entries(updates)) {
    await writeRepositoryFile(repository.directory, path, content);
    git(repository.directory, ["add", "--", path]);
  }
  return git(repository.directory, ["write-tree"]);
}

function evaluateInitial(repository, candidateTree, overrides = {}) {
  return evaluateGateEvidence({
    mode: "initial",
    previousBase: repository.base,
    previousTree: repository.baseTree,
    candidateBase: repository.base,
    candidateTree,
    cwd: repository.directory,
    ...overrides,
  });
}

function assertPartitions(
  evidence,
  {
    selected = [],
    invalidated = selected,
    rerun = selected.filter((group) => invalidated.includes(group)),
    retain = selected.filter((group) => !invalidated.includes(group)),
  },
) {
  const drop = GROUPS.filter((group) => !selected.includes(group));
  assert.deepEqual(evidence.selectedGroups, selected);
  assert.deepEqual(evidence.invalidatedGroups, invalidated);
  assert.deepEqual(evidence.rerunGroups, rerun);
  assert.deepEqual(evidence.retainGroups, retain);
  assert.deepEqual(evidence.dropGroups, drop);
  for (const group of GROUPS) {
    assert.equal(
      evidence.groups[group].decision,
      !selected.includes(group)
        ? "not-required"
        : rerun.includes(group)
          ? "rerun"
          : "retain",
      group,
    );
    assert.equal(
      evidence.groups[group].invalidated,
      invalidated.includes(group),
      group,
    );
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertInitialReRootRecovery(error, reason) {
  assert.match(error.message, reason);
  assert.match(error.message, /initial re-root/);
  assert.match(
    error.message,
    /replace-disabled current HEAD commit.*--candidate-base/,
  );
  assert.match(error.message, /--mode initial/);
  assert.match(error.message, /이전 heavy PASS는 모두 폐기/);
  assert.match(
    error.message,
    /current base→candidate deterministic selection/,
  );
  return true;
}

test("네 회귀군 command manifest는 exact command 목록을 고정한다", () => {
  assert.deepEqual(Object.keys(GROUP_COMMAND_MANIFESTS), GROUPS);
  assert.deepEqual(GROUP_COMMAND_MANIFESTS, {
    productDocsRegression: [
      "node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs",
      "node --test .agents/skills/update-product-docs/scripts/validate-product-docs.test.mjs",
    ],
    workItemRegression: [
      "node --test .agents/skills/run-github-work-item/scripts/work-item.test.mjs",
      "node --test .agents/skills/run-github-work-item/scripts/bootstrap-mvp.test.mjs",
    ],
    commitPrRegression: [
      "node --test .agents/skills/commit-work-item/scripts/validate-commit-message.test.mjs",
      "node --test .agents/skills/commit-work-item/scripts/validate-commit-paths.test.mjs",
      "node --test .agents/skills/commit-work-item/scripts/validate-gate-evidence.test.mjs",
      "node --test .agents/skills/open-pull-request/scripts/validate-pr-body.test.mjs",
    ],
    finalizeRegression: [
      "node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs",
      "node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs",
      "node --test .agents/skills/open-pull-request/scripts/finalize-remote-branch.test.mjs",
      "node --test .agents/skills/open-pull-request/scripts/finalize-local-cleanup.test.mjs",
    ],
  });
  const digests = GROUPS.map((group) => commandManifestDigest(group));
  assert.equal(new Set(digests).size, GROUPS.length);
  for (const digest of digests) assert.match(digest, /^[0-9a-f]{64}$/);
});

test("일반 docs-only 수정은 대형 회귀군을 요구하지 않는다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    "docs/meetings/review.md": "meeting fixed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);

  assert.equal(evidence.full, false);
  assert.equal(evidence.failClosed, false);
  assert.deepEqual(evidence.selectionPaths, ["docs/meetings/review.md"]);
  assert.deepEqual(evidence.invalidationPaths, [
    "docs/meetings/review.md",
  ]);
  assertPartitions(evidence, {});
});

test("owner와 downstream 경계는 관련 회귀군만 선택한다", async (context) => {
  const cases = [
    [
      ".agents/skills/update-product-docs/scripts/validate-product-docs.mjs",
      ["productDocsRegression"],
    ],
    [
      ".agents/skills/run-github-work-item/scripts/work-item.mjs",
      ["workItemRegression"],
    ],
    [
      ".agents/skills/commit-work-item/scripts/validate-commit-paths.mjs",
      ["commitPrRegression"],
    ],
    [
      ".agents/skills/open-pull-request/scripts/validate-pr-body.mjs",
      ["commitPrRegression", "finalizeRegression"],
    ],
    [
      ".agents/skills/open-pull-request/scripts/finalize-merge.mjs",
      ["finalizeRegression"],
    ],
  ];

  for (const [path, expected] of cases) {
    await context.test(path, async (subtest) => {
      const repository = await createRepository(subtest);
      const candidateTree = await stageUpdates(repository, {
        [path]: `${path} changed\n`,
      });
      assertPartitions(evaluateInitial(repository, candidateTree), {
        selected: expected,
      });
    });
  }
});

test("work-item live contract 세 경로는 work-item 입력으로 투영한다", async (context) => {
  const repository = await createRepository(context);
  const paths = [
    ".agents/skills/run-github-work-item/SKILL.md",
    ".agents/skills/run-github-work-item/references/issue-contract.md",
    ".agents/skills/run-github-work-item/agents/openai.yaml",
  ];
  const candidateTree = await stageUpdates(
    repository,
    Object.fromEntries(paths.map((path) => [path, `${path} changed\n`])),
  );
  const evidence = evaluateInitial(repository, candidateTree);

  assertPartitions(evidence, { selected: ["workItemRegression"] });
  assert.notEqual(
    evidence.groups.workItemRegression.baseInputDigest,
    evidence.groups.workItemRegression.candidateInputDigest,
  );
});

test("공유 product-contract parser는 네 회귀군을 모두 선택한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    ".agents/skills/update-product-docs/scripts/product-contract-ids.mjs":
      "ids changed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);

  assert.equal(evidence.full, false);
  assertPartitions(evidence, { selected: GROUPS });
});

test("공유 하네스 계약은 결정적으로 전체 회귀를 선택한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    "AGENTS.md": "agents changed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);

  assert.equal(evidence.full, true);
  assert.equal(evidence.failClosed, false);
  assert.equal(evidence.reason, "selection:shared-harness-contract");
  assertPartitions(evidence, { selected: GROUPS });
});

test("helper 변경은 remote 선택과 local 무효화를 분리한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    ".agents/skills/commit-work-item/scripts/validate-gate-evidence.mjs":
      "gate evidence changed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);

  assert.equal(evidence.full, true);
  assert.equal(evidence.failClosed, false);
  assert.equal(evidence.reason, "local-evidence-control-changed");
  assertPartitions(evidence, {
    selected: ["commitPrRegression"],
    invalidated: GROUPS,
    rerun: ["commitPrRegression"],
  });
});

test("base identity가 바뀌면 Git 호출 없이 중단하고 re-root를 안내한다", () => {
  let calls = 0;
  assert.throws(
    () =>
      evaluateGateEvidence({
        mode: "delta",
        previousBase: "1".repeat(40),
        previousTree: "2".repeat(40),
        candidateBase: "3".repeat(40),
        candidateTree: "4".repeat(40),
        gitRunner: () => {
          calls += 1;
          throw new Error("must not run");
        },
      }),
    (error) =>
      assertInitialReRootRecovery(
        error,
        /previous base와 candidate base identity가 다릅니다/,
      ),
  );

  assert.equal(calls, 0);
});

test("rename diff는 양쪽 경로를 유지하고 모든 helper Git 호출은 replace를 끈다", () => {
  const calls = [];
  const previousTree = "1".repeat(40);
  const candidateTree = "2".repeat(40);
  const paths = readChangedTreePaths({
    previousTree,
    candidateTree,
    cwd: "/tmp/example",
    gitRunner: (arguments_, options) => {
      calls.push({ arguments_, options });
      return {
        status: 0,
        signal: null,
        stdout: Buffer.from("old\0new\0"),
        stderr: Buffer.alloc(0),
      };
    },
  });

  assert.deepEqual(paths, ["old", "new"]);
  assert.deepEqual(calls, [{
    arguments_: [
      "--no-replace-objects",
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      previousTree,
      candidateTree,
      "--",
    ],
    options: { cwd: "/tmp/example" },
  }]);
});

test("실제 replace ref는 candidate tree 판정을 바꾸지 못한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    ".agents/skills/run-github-work-item/scripts/work-item.mjs":
      "work item changed\n",
  });
  git(repository.directory, [
    "replace",
    candidateTree,
    repository.baseTree,
  ]);

  assert.equal(
    git(repository.directory, ["cat-file", "-p", candidateTree]),
    git(repository.directory, ["cat-file", "-p", repository.baseTree]),
  );
  assert.notEqual(
    git(repository.directory, [
      "--no-replace-objects",
      "cat-file",
      "-p",
      candidateTree,
    ]),
    git(repository.directory, [
      "--no-replace-objects",
      "cat-file",
      "-p",
      repository.baseTree,
    ]),
  );
  assertPartitions(evaluateInitial(repository, candidateTree), {
    selected: ["workItemRegression"],
  });
});

test("mode·path·blob OID와 command manifest가 projection에 결속된다", () => {
  const entry = {
    mode: "100644",
    path: ".agents/skills/run-github-work-item/scripts/work-item.mjs",
    oid: "1".repeat(40),
  };
  const original = projectGroupInput([entry], "workItemRegression");
  const modeChanged = projectGroupInput(
    [{ ...entry, mode: "100755" }],
    "workItemRegression",
  );
  const pathChanged = projectGroupInput(
    [{
      ...entry,
      path: ".agents/skills/run-github-work-item/scripts/other.mjs",
    }],
    "workItemRegression",
  );
  const blobChanged = projectGroupInput(
    [{ ...entry, oid: "2".repeat(40) }],
    "workItemRegression",
  );

  assert.notEqual(original.inputDigest, modeChanged.inputDigest);
  assert.notEqual(original.inputDigest, pathChanged.inputDigest);
  assert.notEqual(original.inputDigest, blobChanged.inputDigest);
  assert.equal(
    original.commandManifestDigest,
    commandManifestDigest("workItemRegression"),
  );
});

test("실제 executable mode 변경도 관련 group만 무효화한다", async (context) => {
  const repository = await createRepository(context);
  const path =
    ".agents/skills/run-github-work-item/scripts/work-item.mjs";
  await chmod(join(repository.directory, path), 0o755);
  git(repository.directory, ["add", "--", path]);
  const candidateTree = git(repository.directory, ["write-tree"]);

  assertPartitions(evaluateInitial(repository, candidateTree), {
    selected: ["workItemRegression"],
  });
});

test("shared 변경 뒤 Markdown delta는 네 회귀군 증거를 유지한다", async (context) => {
  const repository = await createRepository(context);
  const previousTree = await stageUpdates(repository, {
    "AGENTS.md": "agents changed\n",
  });
  const candidateTree = await stageUpdates(repository, {
    "docs/meetings/review.md": "meeting fixed\n",
  });
  const evidence = evaluateGateEvidence({
    mode: "delta",
    previousBase: repository.base,
    previousTree,
    candidateBase: repository.base,
    candidateTree,
    cwd: repository.directory,
  });

  assert.deepEqual(evidence.selectionPaths, [
    "AGENTS.md",
    "docs/meetings/review.md",
  ]);
  assert.deepEqual(evidence.invalidationPaths, [
    "docs/meetings/review.md",
  ]);
  assert.equal(evidence.full, true);
  assert.equal(evidence.failClosed, false);
  assertPartitions(evidence, {
    selected: GROUPS,
    invalidated: [],
    rerun: [],
    retain: GROUPS,
  });
});

test("변경을 base로 완전히 되돌리면 이전 group은 retain하지 않고 drop한다", async (context) => {
  const repository = await createRepository(context);
  const path =
    ".agents/skills/run-github-work-item/scripts/work-item.mjs";
  const previousTree = await stageUpdates(repository, {
    [path]: "work item changed\n",
  });
  const candidateTree = await stageUpdates(repository, {
    [path]: BASE_FILES[path],
  });
  const evidence = evaluateGateEvidence({
    mode: "delta",
    previousBase: repository.base,
    previousTree,
    candidateBase: repository.base,
    candidateTree,
    cwd: repository.directory,
  });

  assertPartitions(evidence, {
    selected: [],
    invalidated: ["workItemRegression"],
    rerun: [],
    retain: [],
  });
});

test("strict schema·version 불일치는 initial re-root를 안내한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    ".agents/skills/run-github-work-item/scripts/work-item.mjs":
      "work item changed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);
  const parsed = parseEvidenceJson(JSON.stringify(evidence));

  assert.equal(parsed.schema, EVIDENCE_SCHEMA);
  assert.equal(parsed.version, EVIDENCE_VERSION);

  const unknown = clone(evidence);
  unknown.extra = true;
  assert.throws(
    () => parseEvidenceJson(JSON.stringify(unknown)),
    (error) => assertInitialReRootRecovery(error, /field 집합/),
  );

  const oldVersion = clone(evidence);
  oldVersion.version -= 1;
  assert.throws(
    () => parseEvidenceJson(JSON.stringify(oldVersion)),
    (error) => assertInitialReRootRecovery(error, /version/),
  );

  const badPartition = clone(evidence);
  badPartition.rerunGroups = [];
  assert.throws(
    () => parseEvidenceJson(JSON.stringify(badPartition)),
    /partition/,
  );
});

test("manifest·판정·base 불일치는 initial re-root를 안내한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    ".agents/skills/run-github-work-item/scripts/work-item.mjs":
      "work item changed\n",
  });
  const evidence = evaluateInitial(repository, candidateTree);
  const valid = parseEvidenceJson(JSON.stringify(evidence));
  assert.deepEqual(
    validatePreviousEvidence(valid, {
      candidateBase: repository.base,
      cwd: repository.directory,
    }),
    {
      previousBase: repository.base,
      previousTree: candidateTree,
    },
  );

  const badManifest = clone(evidence);
  badManifest.groups.workItemRegression.commandManifestDigest =
    "0".repeat(64);
  assert.throws(
    () =>
      validatePreviousEvidence(
        parseEvidenceJson(JSON.stringify(badManifest)),
        {
          candidateBase: repository.base,
          cwd: repository.directory,
        },
      ),
    (error) =>
      assertInitialReRootRecovery(
        error,
        /identity·manifest·projection·판정/,
      ),
  );

  const coherentButWrongSelection = clone(evidence);
  coherentButWrongSelection.selectedGroups = [];
  coherentButWrongSelection.rerunGroups = [];
  coherentButWrongSelection.dropGroups = [...GROUPS];
  coherentButWrongSelection.groups.workItemRegression.required = false;
  coherentButWrongSelection.groups.workItemRegression.decision =
    "not-required";
  assert.throws(
    () =>
      validatePreviousEvidence(
        parseEvidenceJson(JSON.stringify(coherentButWrongSelection)),
        {
          candidateBase: repository.base,
          cwd: repository.directory,
        },
      ),
    /identity·manifest·projection·판정/,
  );

  const wrongIdentity = clone(evidence);
  wrongIdentity.candidate.tree = repository.baseTree;
  assert.throws(
    () =>
      validatePreviousEvidence(
        parseEvidenceJson(JSON.stringify(wrongIdentity)),
        {
          candidateBase: repository.base,
          cwd: repository.directory,
        },
      ),
    /projection/,
  );

  const wrongBase = clone(evidence);
  wrongBase.base.commit = "f".repeat(40);
  wrongBase.previous.base = "f".repeat(40);
  wrongBase.candidate.base = "f".repeat(40);
  assert.throws(
    () =>
      validatePreviousEvidence(
        parseEvidenceJson(JSON.stringify(wrongBase)),
        {
          candidateBase: repository.base,
          cwd: repository.directory,
        },
      ),
    (error) =>
      assertInitialReRootRecovery(
        error,
        /candidate base가 현재 base와 다릅니다/,
      ),
  );
});

test("CLI initial은 current index tree를 직접 결속해 JSON을 출력한다", async (context) => {
  const repository = await createRepository(context);
  const candidateTree = await stageUpdates(repository, {
    "docs/meetings/review.md": "meeting fixed\n",
  });
  const result = run(repository.directory, process.execPath, [
    SCRIPT,
    "--mode",
    "initial",
    "--candidate-base",
    repository.base,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.candidate.tree, candidateTree);
  assertPartitions(evidence, {});
});

test("CLI는 stale candidate base를 current HEAD와 대조해 중단한다", async (context) => {
  const repository = await createRepository(context);
  await stageUpdates(repository, {
    "README.md": "committed after base\n",
  });
  git(repository.directory, ["commit", "-q", "-m", "chore: move HEAD"]);
  assert.notEqual(
    git(repository.directory, ["rev-parse", "HEAD"]),
    repository.base,
  );

  const result = run(repository.directory, process.execPath, [
    SCRIPT,
    "--mode",
    "initial",
    "--candidate-base",
    repository.base,
  ]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /replace-disabled current HEAD commit/);
  assert.doesNotMatch(result.stderr, /initial re-root/);
});

test("CLI delta는 외부 previous evidence만 받아 필요한 증거를 유지한다", async (context) => {
  const repository = await createRepository(context);
  const previousTree = await stageUpdates(repository, {
    ".agents/skills/run-github-work-item/scripts/work-item.mjs":
      "work item changed\n",
  });
  const initial = evaluateInitial(repository, previousTree);
  const evidenceDirectory = await mkdtemp(
    join(tmpdir(), "lunchtime-previous-evidence-"),
  );
  context.after(async () =>
    rm(evidenceDirectory, { recursive: true, force: true }));
  const evidencePath = join(evidenceDirectory, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(initial));
  await stageUpdates(repository, {
    "docs/meetings/review.md": "meeting fixed\n",
  });

  const result = run(repository.directory, process.execPath, [
    SCRIPT,
    "--mode",
    "delta",
    "--candidate-base",
    repository.base,
    "--previous-evidence",
    evidencePath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assertPartitions(JSON.parse(result.stdout), {
    selected: ["workItemRegression"],
    invalidated: [],
    rerun: [],
    retain: ["workItemRegression"],
  });
});

test("current candidate는 unstaged tracked와 untracked 입력을 거부한다", async (context) => {
  await context.test("unstaged tracked", async (subtest) => {
    const repository = await createRepository(subtest);
    await writeRepositoryFile(
      repository.directory,
      "README.md",
      "unstaged\n",
    );
    assert.throws(
      () =>
        evaluateCurrentWorkspace({
          mode: "initial",
          candidateBase: repository.base,
          cwd: repository.directory,
        }),
      /unstaged tracked/,
    );
  });

  await context.test("untracked", async (subtest) => {
    const repository = await createRepository(subtest);
    await writeRepositoryFile(
      repository.directory,
      "unexpected.txt",
      "untracked\n",
    );
    assert.throws(
      () =>
        evaluateCurrentWorkspace({
          mode: "initial",
          candidateBase: repository.base,
          cwd: repository.directory,
        }),
      /untracked/,
    );
  });
});

test("CLI argument parser는 initial/delta 계약만 허용하고 legacy identity를 거부한다", () => {
  const base = "1".repeat(40);
  assert.deepEqual(
    parseArguments([
      "--mode",
      "initial",
      "--candidate-base",
      base,
    ]),
    { mode: "initial", candidateBase: base },
  );
  assert.deepEqual(
    parseArguments([
      "--mode",
      "delta",
      "--candidate-base",
      base,
      "--previous-evidence",
      "/tmp/evidence.json",
    ]),
    {
      mode: "delta",
      candidateBase: base,
      previousEvidencePath: "/tmp/evidence.json",
    },
  );
  assert.throws(
    () =>
      parseArguments([
        "--mode",
        "initial",
        "--candidate-base",
        base,
        "--candidate-tree",
        "2".repeat(40),
      ]),
    /알 수 없는 인자/,
  );
  assert.throws(
    () =>
      parseArguments([
        "--mode",
        "delta",
        "--candidate-base",
        base,
      ]),
    /필수 인자/,
  );
  assert.deepEqual(parseArguments(["--help"]), { help: true });
});

test("invalid OID와 모호한 ls-tree record는 Git 판정 전에 거부한다", () => {
  for (const oid of [
    "",
    "HEAD",
    "0".repeat(40),
    ` ${"1".repeat(40)}`,
    `${"1".repeat(40)} `,
  ]) {
    assert.throws(() => canonicalOid(oid, "test OID"), /40자리/);
  }

  assert.deepEqual(
    parseLsTreeOutput(
      Buffer.from(`100644 blob ${"a".repeat(40)}\tdocs/a.md\0`),
    ),
    [{
      mode: "100644",
      path: "docs/a.md",
      oid: "a".repeat(40),
    }],
  );
  for (const output of [
    `100644 blob ${"a".repeat(40)} docs/a.md\0`,
    `100644 tree ${"a".repeat(40)}\tdocs/a.md\0`,
    `100644 blob ${"a".repeat(40)}\t../a.md\0`,
    `100644 blob ${"a".repeat(40)}\tdocs/a.md`,
  ]) {
    assert.throws(
      () => parseLsTreeOutput(Buffer.from(output)),
      /ls-tree|mode·path·blob/,
    );
  }
});
