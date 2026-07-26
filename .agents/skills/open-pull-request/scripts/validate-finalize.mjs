#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { validatePullRequest } from "./validate-pr-body.mjs";

const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/;
const HEAD_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

function parseRepositoryFromUrl(url) {
  try {
    const parsed = new URL(String(url ?? ""));
    if (parsed.hostname.toLowerCase() !== "github.com") return "";
    const [owner, repository, resource, number] = parsed.pathname
      .split("/")
      .filter(Boolean);
    if (
      !owner ||
      !repository ||
      resource !== "issues" ||
      !/^[1-9][0-9]*$/.test(number ?? "")
    ) {
      return "";
    }
    return `${owner}/${repository}`;
  } catch {
    return "";
  }
}

function closingReferenceRepository(reference) {
  return (
    reference?.repository?.nameWithOwner ??
    reference?.repository?.name_with_owner ??
    parseRepositoryFromUrl(reference?.url)
  );
}

export function parseGitHubRepositoryFromRemoteUrl(remoteUrl) {
  const raw = String(remoteUrl ?? "");
  if (!raw || raw !== raw.trim() || /[\r\n]/.test(raw)) return "";

  const scpLike = raw.match(
    /^git@github\.com:([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i,
  );
  if (scpLike) {
    const repository = `${scpLike[1]}/${scpLike[2]}`;
    return REPOSITORY_PATTERN.test(repository) ? repository : "";
  }

  try {
    const parsed = new URL(raw);
    if (
      !["https:", "ssh:"].includes(parsed.protocol) ||
      parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.pathname.endsWith("/") ||
      parsed.pathname.includes("//") ||
      parsed.pathname.includes("%") ||
      parsed.search ||
      parsed.hash
    ) {
      return "";
    }
    if (parsed.protocol === "https:" && (parsed.username || parsed.password)) {
      return "";
    }
    if (
      parsed.protocol === "ssh:" &&
      (parsed.username !== "git" ||
        parsed.password ||
        (parsed.port && parsed.port !== "22"))
    ) {
      return "";
    }
    if (parsed.protocol === "https:" && parsed.port) return "";
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return "";
    const repository = segments[1].replace(/\.git$/i, "");
    const combined = `${segments[0]}/${repository}`;
    return REPOSITORY_PATTERN.test(combined) ? combined : "";
  } catch {
    return "";
  }
}

function pullRequestHeadRepository(pr) {
  const nameWithOwner = String(pr?.headRepository?.nameWithOwner ?? "").trim();
  if (REPOSITORY_PATTERN.test(nameWithOwner)) return nameWithOwner;
  const owner = String(pr?.headRepositoryOwner?.login ?? "").trim();
  const name = String(pr?.headRepository?.name ?? "").trim();
  const combined = `${owner}/${name}`;
  return REPOSITORY_PATTERN.test(combined) ? combined : "";
}

function reviewThreadsConnection(response) {
  return response?.data?.repository?.pullRequest?.reviewThreads;
}

function pullRequestUrlMatches(url, repository, pullRequestNumber) {
  try {
    const parsed = new URL(String(url ?? ""));
    const [owner, name, resource, number] = parsed.pathname
      .split("/")
      .filter(Boolean);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com" &&
      `${owner}/${name}`.toLowerCase() === repository.toLowerCase() &&
      resource === "pull" &&
      Number(number) === pullRequestNumber
    );
  } catch {
    return false;
  }
}

function threadIdentity(response) {
  const repository = response?.data?.repository;
  const pullRequest = repository?.pullRequest;
  return {
    repository: repository?.nameWithOwner,
    id: pullRequest?.id,
    number: pullRequest?.number,
    url: pullRequest?.url,
    updatedAt: pullRequest?.updatedAt,
    baseRefName: pullRequest?.baseRefName,
    baseRefOid: pullRequest?.baseRefOid,
    headRefName: pullRequest?.headRefName,
    headRefOid: pullRequest?.headRefOid,
    headRepository: pullRequest?.headRepository?.nameWithOwner,
    isCrossRepository: pullRequest?.isCrossRepository,
  };
}

function prIdentity(pr) {
  return {
    repository: undefined,
    id: pr?.id,
    number: pr?.number,
    url: pr?.url,
    updatedAt: pr?.updatedAt,
    baseRefName: pr?.baseRefName,
    baseRefOid: pr?.baseRefOid,
    headRefName: pr?.headRefName,
    headRefOid: pr?.headRefOid,
    headRepository: pullRequestHeadRepository(pr),
    isCrossRepository: pr?.isCrossRepository,
  };
}

function checkRollupIdentity(check) {
  if (check?.__typename === "CheckRun") {
    return {
      name: check.name,
      link: check.detailsUrl,
      successful:
        check.status === "COMPLETED" &&
        ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion),
    };
  }
  if (check?.__typename === "StatusContext") {
    return {
      name: check.context,
      link: check.targetUrl,
      successful: check.state === "SUCCESS",
    };
  }
  return null;
}

function runGit(repositoryRoot, arguments_, { allowedStatuses = [0] } = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: resolve(repositoryRoot),
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!allowedStatuses.includes(result.status)) {
    const detail =
      String(result.stderr ?? "").trim() ||
      result.error?.message ||
      "알 수 없는 Git 오류";
    throw new Error(`Finalize Git snapshot을 읽지 못했습니다: ${detail}`);
  }
  return result;
}

function remoteRepositoryProof(repositoryRoot, { push = false } = {}) {
  const arguments_ = ["remote", "get-url"];
  if (push) arguments_.push("--push");
  arguments_.push("--all", "origin");
  const urls = runGit(repositoryRoot, arguments_)
    .stdout.split(/\r?\n/)
    .filter(Boolean);
  return {
    count: urls.length,
    repository:
      urls.length === 1 ? parseGitHubRepositoryFromRemoteUrl(urls[0]) : "",
  };
}

function readCommitSnapshot(repositoryRoot, oid) {
  if (!HEAD_PATTERN.test(String(oid ?? ""))) {
    throw new Error("Git commit snapshot에는 40자리 OID가 필요합니다.");
  }
  const result = runGit(repositoryRoot, [
    "show",
    "-s",
    "--format=%H%x00%T%x00%P%x00%s",
    String(oid).toLowerCase(),
  ]);
  const [commit, tree, parents, subject] = result.stdout
    .replace(/\n$/, "")
    .split("\0");
  if (commit?.toLowerCase() !== String(oid).toLowerCase()) {
    throw new Error("요청한 OID와 Git commit snapshot이 일치하지 않습니다.");
  }
  return {
    commit: commit.toLowerCase(),
    tree: tree?.toLowerCase(),
    parents: parents ? parents.split(" ").map((value) => value.toLowerCase()) : [],
    subject,
  };
}

export function readFinalizeGitProof(
  pr,
  {
    repositoryRoot = process.cwd(),
    mode = "open",
    mainRef = "refs/remotes/origin/main",
  } = {},
) {
  const head = readCommitSnapshot(repositoryRoot, pr?.headRefOid);
  const base = readCommitSnapshot(repositoryRoot, pr?.baseRefOid);
  const main = runGit(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${mainRef}^{commit}`,
  ]).stdout.trim().toLowerCase();
  const ancestor = runGit(
    repositoryRoot,
    ["merge-base", "--is-ancestor", base.commit, head.commit],
    { allowedStatuses: [0, 1] },
  ).status === 0;
  const originFetch = remoteRepositoryProof(repositoryRoot);
  const originPush = remoteRepositoryProof(repositoryRoot, { push: true });

  const proof = {
    base: base.commit,
    head: head.commit,
    headTree: head.tree,
    main,
    baseIsAncestorOfHead: ancestor,
    originFetchRepository: originFetch.repository,
    originFetchUrlCount: originFetch.count,
    originPushRepository: originPush.repository,
    originPushUrlCount: originPush.count,
  };
  if (mode !== "merged-recovery") return proof;

  const merge = readCommitSnapshot(repositoryRoot, pr?.mergeCommit?.oid);
  const firstParentCommits = new Set(
    runGit(repositoryRoot, ["rev-list", "--first-parent", mainRef])
      .stdout.split(/\r?\n/)
      .filter(Boolean)
      .map((value) => value.toLowerCase()),
  );
  return {
    ...proof,
    merge: merge.commit,
    mergeTree: merge.tree,
    mergeParents: merge.parents,
    mergeSubject: merge.subject,
    mainFirstParentContainsMerge: firstParentCommits.has(merge.commit),
  };
}

export function validateFinalizeSnapshot({
  pr,
  checks,
  threads,
  gitProof,
  issueNumber,
  pullRequestNumber,
  repository,
  actor,
  mode = "open",
}) {
  const errors = [];
  const normalizedIssue = Number(issueNumber);
  const normalizedPullRequest = Number(pullRequestNumber);
  const normalizedRepository = String(repository ?? "");
  const mergedRecovery = mode === "merged-recovery";

  if (!["open", "merged-recovery"].includes(mode)) {
    errors.push("Finalize 검증 mode는 `open` 또는 `merged-recovery`여야 합니다.");
  }

  if (!Number.isInteger(normalizedIssue) || normalizedIssue < 1) {
    errors.push("종료 이슈 번호는 양의 정수여야 합니다.");
  }
  if (
    !Number.isInteger(normalizedPullRequest) ||
    normalizedPullRequest < 1
  ) {
    errors.push("PR 번호는 양의 정수여야 합니다.");
  }
  if (!REPOSITORY_PATTERN.test(normalizedRepository)) {
    errors.push("저장소는 `OWNER/REPO` 형식이어야 합니다.");
  }
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
    errors.push("현재 PR snapshot JSON object가 필요합니다.");
    return { errors };
  }

  if (!Number.isInteger(pr.number) || pr.number < 1) {
    errors.push("PR snapshot에 양의 정수 `number`가 필요합니다.");
  } else if (pr.number !== normalizedPullRequest) {
    errors.push("PR snapshot 번호가 요청한 PR 번호와 다릅니다.");
  }
  if (!String(pr.id ?? "").trim()) {
    errors.push("PR snapshot에 GraphQL node `id`가 필요합니다.");
  }
  if (
    !pullRequestUrlMatches(
      pr.url,
      normalizedRepository,
      normalizedPullRequest,
    )
  ) {
    errors.push("PR snapshot URL이 요청한 저장소와 PR 번호에 귀속되지 않습니다.");
  }
  if (!String(pr.updatedAt ?? "").trim()) {
    errors.push("PR snapshot에 `updatedAt`이 필요합니다.");
  }
  const expectedState = mergedRecovery ? "MERGED" : "OPEN";
  if (pr.state !== expectedState) {
    errors.push(
      `${mergedRecovery ? "복구" : "Finalize"} 대상 PR은 현재 \`${expectedState}\`여야 합니다.`,
    );
  }
  if (pr.isDraft !== false) {
    errors.push("Finalize 대상 PR은 Ready 상태여야 합니다.");
  }
  if (pr.baseRefName !== "main") {
    errors.push("Finalize 대상 PR base는 `main`이어야 합니다.");
  }
  const headRepository = pullRequestHeadRepository(pr);
  if (!headRepository) {
    errors.push("PR snapshot에 current head repository identity가 필요합니다.");
  } else if (
    headRepository.toLowerCase() !== normalizedRepository.toLowerCase()
  ) {
    errors.push("PR head repository가 현재 작업 저장소와 다릅니다.");
  }
  if (pr.isCrossRepository !== false) {
    errors.push(
      "자동 finalize와 source branch 정리는 same-repository PR에서만 허용됩니다.",
    );
  }
  if (!HEAD_PATTERN.test(String(pr.headRefOid ?? ""))) {
    errors.push("PR snapshot에 40자리 current head OID가 필요합니다.");
  }
  if (!HEAD_PATTERN.test(String(pr.baseRefOid ?? ""))) {
    errors.push("PR snapshot에 40자리 base OID가 필요합니다.");
  }
  if (mergedRecovery) {
    if (!String(pr.mergedAt ?? "").trim()) {
      errors.push("병합 복구 snapshot에는 `mergedAt`이 필요합니다.");
    }
    if (!HEAD_PATTERN.test(String(pr.mergeCommit?.oid ?? ""))) {
      errors.push("병합 복구 snapshot에는 40자리 `mergeCommit.oid`가 필요합니다.");
    }
    if (!String(actor ?? "").trim()) {
      errors.push("병합 복구에는 현재 인증 actor가 필요합니다.");
    } else if (pr.mergedBy?.login !== actor) {
      errors.push("병합 actor가 현재 인증 actor와 일치하지 않습니다.");
    }
  } else {
    if (pr.mergeable !== "MERGEABLE") {
      errors.push("Finalize 대상 PR은 현재 `MERGEABLE`이어야 합니다.");
    }
    if (pr.mergeStateStatus !== "CLEAN") {
      errors.push("Finalize 대상 PR merge state는 현재 `CLEAN`이어야 합니다.");
    }
  }

  errors.push(
    ...validatePullRequest({
      body: pr.body ?? "",
      title: pr.title ?? "",
      draft: Boolean(pr.isDraft),
      issueNumber: normalizedIssue,
      branch: pr.headRefName ?? "",
      base: pr.baseRefName ?? "",
      expectedHead: pr.headRefOid ?? "",
      definitionsRef: pr.headRefOid ?? "",
    }),
  );

  const closingReferences = pr.closingIssuesReferences;
  if (!Array.isArray(closingReferences)) {
    errors.push("PR snapshot에 `closingIssuesReferences` 배열이 필요합니다.");
  } else if (closingReferences.length !== 1) {
    errors.push(
      `PR은 종료 이슈를 정확히 하나 인식해야 합니다. (현재 ${closingReferences.length}개)`,
    );
  } else {
    const [reference] = closingReferences;
    if (Number(reference?.number) !== normalizedIssue) {
      errors.push("GitHub가 인식한 종료 이슈 번호가 예상 이슈와 다릅니다.");
    }
    const referenceRepository = closingReferenceRepository(reference);
    if (
      !referenceRepository ||
      referenceRepository.toLowerCase() !== normalizedRepository.toLowerCase()
    ) {
      errors.push("GitHub가 인식한 종료 이슈 저장소가 현재 저장소와 다릅니다.");
    }
  }

  if (mergedRecovery) {
    if (checks !== undefined || threads !== undefined) {
      errors.push(
        "병합 복구 mode에는 OPEN 시점의 `checks` 또는 `threads` 입력을 사용할 수 없습니다.",
      );
    }
  } else {
    if (!Array.isArray(pr.statusCheckRollup)) {
      errors.push("PR snapshot에 current head `statusCheckRollup` 배열이 필요합니다.");
    }
    if (!Array.isArray(checks)) {
      errors.push("현재 required check JSON 배열이 필요합니다.");
    } else if (checks.length === 0) {
      errors.push("현재 head의 required check를 하나 이상 확인해야 합니다.");
    } else {
      for (const [index, check] of checks.entries()) {
        if (!check || typeof check !== "object" || Array.isArray(check)) {
          errors.push(
            `required check ${index + 1}의 응답 형식이 올바르지 않습니다.`,
          );
          continue;
        }
        if (!String(check.name ?? "").trim()) {
          errors.push(`required check ${index + 1}에 이름이 없습니다.`);
        }
        if (String(check.bucket ?? "").toLowerCase() !== "pass") {
          errors.push(
            `required check '${check.name || index + 1}'가 현재 head에서 통과하지 않았습니다.`,
          );
        }
        if (!String(check.link ?? "").trim()) {
          errors.push(
            `required check '${check.name || index + 1}'에 current run link가 없습니다.`,
          );
          continue;
        }
        if (Array.isArray(pr.statusCheckRollup)) {
          const matches = pr.statusCheckRollup
            .map(checkRollupIdentity)
            .filter(
              (candidate) =>
                candidate?.name === check.name &&
                candidate?.link === check.link,
            );
          if (matches.length !== 1) {
            errors.push(
              `required check '${check.name || index + 1}'가 PR current head rollup 하나에 정확히 귀속되지 않습니다.`,
            );
          } else if (!matches[0].successful) {
            errors.push(
              `required check '${check.name || index + 1}'의 PR current head rollup이 성공 상태가 아닙니다.`,
            );
          }
        }
      }
    }

    if (Array.isArray(threads?.errors) && threads.errors.length > 0) {
      errors.push("review thread GraphQL 응답에 오류가 있습니다.");
    }
    const reviewThreads = reviewThreadsConnection(threads);
    const responseIdentity = threadIdentity(threads);
    const expectedIdentity = {
      ...prIdentity(pr),
      repository: normalizedRepository,
    };
    for (const key of Object.keys(expectedIdentity)) {
      const actual = String(responseIdentity[key] ?? "");
      const expected = String(expectedIdentity[key] ?? "");
      const matches =
        key === "repository"
          ? actual.toLowerCase() === expected.toLowerCase()
          : actual === expected;
      if (!matches) {
        errors.push(
          `review thread snapshot의 ${key}가 PR snapshot과 일치하지 않습니다.`,
        );
      }
    }
    if (
      !reviewThreads ||
      !Array.isArray(reviewThreads.nodes) ||
      !Number.isInteger(reviewThreads.totalCount) ||
      reviewThreads.totalCount < 0 ||
      typeof reviewThreads.pageInfo?.hasNextPage !== "boolean" ||
      typeof reviewThreads.pageInfo?.hasPreviousPage !== "boolean"
    ) {
      errors.push("현재 review thread connection을 완전하게 읽지 못했습니다.");
    } else {
      if (reviewThreads.pageInfo.hasNextPage) {
        errors.push(
          "review thread 조회에 다음 page가 남아 있어 미해결 0개를 증명할 수 없습니다.",
        );
      }
      if (reviewThreads.pageInfo.hasPreviousPage) {
        errors.push(
          "review thread 조회에 이전 page가 있어 첫 page 전체 snapshot이 아닙니다.",
        );
      }
      if (reviewThreads.totalCount !== reviewThreads.nodes.length) {
        errors.push(
          "review thread totalCount와 반환된 node 수가 달라 전체 snapshot을 증명할 수 없습니다.",
        );
      }
      const nodeIds = reviewThreads.nodes.map((thread) =>
        String(thread?.id ?? "").trim(),
      );
      if (
        nodeIds.some((id) => !id) ||
        new Set(nodeIds).size !== nodeIds.length
      ) {
        errors.push("review thread node id는 비어 있지 않고 고유해야 합니다.");
      }
      const { startCursor, endCursor } = reviewThreads.pageInfo;
      if (
        reviewThreads.nodes.length === 0
          ? startCursor !== null || endCursor !== null
          : !String(startCursor ?? "").trim() ||
            !String(endCursor ?? "").trim()
      ) {
        errors.push("review thread page cursor가 반환된 node와 일치하지 않습니다.");
      }
      const unresolved = reviewThreads.nodes.filter(
        (thread) => thread?.isResolved !== true,
      );
      if (unresolved.length > 0) {
        errors.push(`미해결 review thread가 ${unresolved.length}개 있습니다.`);
      }
    }
  }

  if (!gitProof || typeof gitProof !== "object" || Array.isArray(gitProof)) {
    errors.push("exact Git object proof가 필요합니다.");
  } else {
    const expectedRemoteRepository = normalizedRepository.toLowerCase();
    for (const [label, repositoryValue, urlCount] of [
      [
        "fetch",
        gitProof.originFetchRepository,
        gitProof.originFetchUrlCount,
      ],
      [
        "push",
        gitProof.originPushRepository,
        gitProof.originPushUrlCount,
      ],
    ]) {
      if (
        urlCount !== 1 ||
        !REPOSITORY_PATTERN.test(String(repositoryValue ?? "")) ||
        String(repositoryValue).toLowerCase() !== expectedRemoteRepository
      ) {
        errors.push(
          `origin ${label} URL이 PR source repository 하나에 정확히 귀속되지 않습니다.`,
        );
      }
    }
    if (String(gitProof.base ?? "").toLowerCase() !== String(pr.baseRefOid ?? "").toLowerCase()) {
      errors.push("Git proof의 base commit이 PR base OID와 다릅니다.");
    }
    if (String(gitProof.head ?? "").toLowerCase() !== String(pr.headRefOid ?? "").toLowerCase()) {
      errors.push("Git proof의 head commit이 PR head OID와 다릅니다.");
    }
    if (!HEAD_PATTERN.test(String(gitProof.headTree ?? ""))) {
      errors.push("Git proof에 exact head tree OID가 필요합니다.");
    }
    if (gitProof.baseIsAncestorOfHead !== true) {
      errors.push("PR base commit이 exact head의 ancestor가 아닙니다.");
    }
    if (mergedRecovery) {
      if (
        String(gitProof.merge ?? "").toLowerCase() !==
        String(pr.mergeCommit?.oid ?? "").toLowerCase()
      ) {
        errors.push("Git proof의 merge commit이 PR merge commit과 다릅니다.");
      }
      if (
        !Array.isArray(gitProof.mergeParents) ||
        gitProof.mergeParents.length !== 1 ||
        String(gitProof.mergeParents[0] ?? "").toLowerCase() !==
          String(pr.baseRefOid ?? "").toLowerCase()
      ) {
        errors.push("병합 결과는 PR base를 유일한 parent로 갖는 squash commit이어야 합니다.");
      }
      if (
        String(gitProof.mergeTree ?? "").toLowerCase() !==
        String(gitProof.headTree ?? "").toLowerCase()
      ) {
        errors.push("squash merge tree가 exact PR head tree와 다릅니다.");
      }
      if (gitProof.mergeSubject !== pr.title) {
        errors.push("squash merge subject가 검증한 PR 제목과 다릅니다.");
      }
      if (gitProof.mainFirstParentContainsMerge !== true) {
        errors.push("merge commit이 origin/main first-parent history에 없습니다.");
      }
    } else {
      if (
        String(gitProof.main ?? "").toLowerCase() !==
        String(pr.baseRefOid ?? "").toLowerCase()
      ) {
        errors.push("현재 origin/main OID가 PR base snapshot과 다릅니다.");
      }
    }
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) return { errors: uniqueErrors };

  return {
    errors: [],
    snapshot: {
      verified: true,
      repository: normalizedRepository,
      issue: normalizedIssue,
      pr: pr.number,
      base: pr.baseRefOid.toLowerCase(),
      head: pr.headRefOid.toLowerCase(),
      headTree: gitProof.headTree.toLowerCase(),
      branch: pr.headRefName,
      title: pr.title,
      updatedAt: pr.updatedAt,
      sourceRepository: headRepository,
      remote: "origin",
      ...(mergedRecovery
        ? {
            recovery: true,
            mergeCommit: pr.mergeCommit.oid.toLowerCase(),
            mergeTree: gitProof.mergeTree.toLowerCase(),
          }
        : {}),
    },
  };
}

export function parseArguments(argv) {
  const parsed = { mergedRecovery: false };
  const options = new Set([
    "--pr",
    "--checks",
    "--threads",
    "--issue",
    "--pull-request",
    "--repo",
    "--actor",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--merged-recovery") {
      parsed.mergedRecovery = true;
      continue;
    }
    if (!options.has(argument)) {
      throw new Error(`알 수 없는 인자입니다: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} 값이 필요합니다.`);
    parsed[
      argument === "--pull-request"
        ? "pullRequest"
        : argument.slice(2)
    ] = value;
    index += 1;
  }

  for (const option of ["pr", "issue", "pullRequest", "repo"]) {
    if (!parsed[option]) {
      throw new Error(`--${option} 인자가 필요합니다.`);
    }
  }
  if (parsed.mergedRecovery) {
    if (parsed.checks || parsed.threads) {
      throw new Error(
        "--merged-recovery에는 --checks와 --threads를 지정할 수 없습니다.",
      );
    }
    if (!parsed.actor) {
      throw new Error("--merged-recovery에는 --actor 인자가 필요합니다.");
    }
  } else {
    for (const option of ["checks", "threads"]) {
      if (!parsed[option]) {
        throw new Error(`--${option} 인자가 필요합니다.`);
      }
    }
  }
  return parsed;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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
    const pr = await readJson(args.pr);
    const result = validateFinalizeSnapshot({
      pr,
      checks: args.checks ? await readJson(args.checks) : undefined,
      threads: args.threads ? await readJson(args.threads) : undefined,
      issueNumber: args.issue,
      pullRequestNumber: args.pullRequest,
      repository: args.repo,
      actor: args.actor,
      mode: args.mergedRecovery ? "merged-recovery" : "open",
      gitProof: readFinalizeGitProof(pr, {
        mode: args.mergedRecovery ? "merged-recovery" : "open",
      }),
    });
    if (result.errors.length > 0) {
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result.snapshot));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
