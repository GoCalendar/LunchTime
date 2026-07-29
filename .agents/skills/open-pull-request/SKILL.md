---
name: open-pull-request
description: LunchTime 이슈 branch의 변경과 관련 검증을 확인해 Draft·Ready GitHub PR을 생성·갱신하고, 명시적인 완료·병합 요청에서만 same-repository source·current head·required CI·해결된 review thread를 검증해 exact-head squash merge, 이슈 완료와 안전한 원격·로컬 정리를 수행한다.
---

# Pull Request 열기

PR 생성과 작업 완료를 한 Skill에서 연결하되, 사용자가 요청한 종료 지점을
넘지 않습니다.

## 컨텍스트

기본 입력은 다음뿐입니다.

- 현재 이슈의 목표, 허용 경로, 검증과 문서 영향
- `commit-work-item`이 인계한 branch·commit, 관련 테스트, review와 문서 영향
- 현재 branch의 전체 commit diff와 Git 상태
- [PR 본문 계약](references/pr-body-contract.md)

`README.md`, 관련 없는 정본·Skill·복구 문서와
`docs/product-definition/**`은 기본 입력이 아닙니다. PRD·Policy ID가 있을
때만 exact PR head의 현재 정본 정의를 validator가 읽습니다.

로컬 테스트와 validator가 같은 clean commit에서 이미 통과했다면 PR 단계에서
반복하지 않습니다. exact current head의 원격 결과는 PR head와 required
CI가 확인합니다.

## 모드

- **PR 생성·갱신:** push, Draft·Ready 생성 또는 갱신, 사후 재조회에서
  멈춥니다. 병합하지 않습니다.
- **Ready 전환:** 미완료 검증과 결정이 없을 때만 본문 검증 뒤 한 번
  전환하고 재조회합니다.
- **Finalize:** 사용자가 완료·병합을 명시했을 때만 current snapshot을 새로
  검증해 merge·complete·정리를 수행합니다.
- **Merged recovery:** PR이 이미 병합됐지만 후속 상태 전이·정리가 남았을
  때 merge를 반복하지 않고 병합 증거부터 재구성합니다.

## 1. PR 진입 확인

저장소 루트와 이슈 worktree에서 읽기 전용으로 확인합니다.

```bash
git branch --show-current
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

- branch는 `run-github-work-item start`의
  `work/issue-<번호>-<설명>`과 같아야 합니다.
- working tree와 index가 clean이어야 하며 `main`에서 실행하지 않습니다.
- `origin/main`을 fetch한 뒤 current branch가 뒤처졌거나 충돌하면 자동
  rebase·merge하지 않고 중단합니다.
- `origin` fetch·push URL은 credential 없는 canonical GitHub URL 각각
  하나여야 하며 작업 저장소와 같아야 합니다.
- 이슈 번호, repository와 head branch가 같은 열린 PR을 먼저 찾습니다.
  후보가 여러 개거나 다른 branch가 같은 이슈를 닫으면 중단합니다.
- commit 범위의 메시지와 허용 경로, 관련 테스트·review·문서 영향 인계를
  확인합니다. 제품 결정이나 필요한 정본이 없으면 Ready로 진행하지 않습니다.

GitHub 명령은 검증한 repository를 `-R <owner/repo>` 또는 `GH_REPO`로
고정합니다. fork·cross-repository source와 불명확한 remote 신원은 PR
생성·병합·branch 삭제의 근거로 사용하지 않습니다.

## 2. 제목과 본문

제목은 commit 계약과 같은 형식을 사용합니다.

```text
<type>: LT-NNN - <관찰 가능한 결과>
<type>: #<이슈 번호> - <관찰 가능한 결과>
```

본문은 `<!-- lunchtime-pr:v2 -->`와 다섯 H2를 사용합니다. 이슈·PRD를
복사하지 않고 이번 diff의 결과, 실제 관련 테스트 선택과 문서 영향을
기록합니다.

- Draft는 실패·미실행과 `결정 필요`를 사실대로 기록할 수 있습니다.
- Ready는 placeholder, 실패·미실행과 미확정 결정이 없어야 합니다.
- Ready의 `독립 리뷰`는 저위험 `생략` 근거 또는 단일 round의 `통과`
  근거를 사용합니다.
- 메인 세션이 finding을 수정 diff와 관련 테스트로 모두 닫습니다.
  closure 확인을 위해 reviewer를 다시 호출하지 않습니다.
- Review 뒤 범위·요구사항·Architecture·신뢰 경계를 넓혀야 하면 Ready를
  중단하고 blocker 또는 후속 이슈로 분리합니다.

작성한 본문을 실제 current commit으로 검증합니다.

```bash
node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs \
  --body <body-file> --title <title> --issue <issue> \
  --branch <branch> --head <40-sha> [--draft]
```

Ready의 추적 ID는 `--head`의 Git tree에 실제 정의되어야 합니다. working
tree나 stale `main`, planned 표식은 정의 증거가 아닙니다.

## 3. Push와 PR 쓰기

검증한 current branch를 일반 push로 한 번 게시합니다. force push하지
않습니다.

- PR이 없으면 `gh pr create -R <owner/repo> --base main --head <branch>`로
  Draft 또는 Ready를 만듭니다.
- 같은 이슈·branch의 PR이 있으면 `gh pr edit`로 제목·본문만 갱신합니다.
- Draft를 Ready로 바꾸라는 요청에서는 갱신 결과를 확인한 뒤
  `gh pr ready`를 한 번 실행합니다.
- push, create, edit와 ready 전환은 단계별로 한 번만 실행합니다. 응답이
  불명확하면 같은 쓰기를 반복하지 않고 현재 상태를 재조회합니다.

사후 `gh pr view`로 URL, state, Draft, title, body, base/head repository·
branch·OID와 `Closes #N`을 확인합니다. 요청이 PR 생성·갱신까지라면 여기서
멈춥니다.

## 4. Finalize 진입

명시적 완료·병합 요청에서만 다음 snapshot을 새로 수집합니다.

- PR은 `OPEN`, Ready, base `main`, same-repository source이고 merge
  가능해야 합니다.
- current PR head OID와 local branch head가 같아야 합니다.
- required checks는 하나 이상이며 모두 성공해야 합니다.
- review thread 전체 page를 읽어 미해결 thread가 0개인지 확인합니다.
- 제목·본문·종료 이슈와 exact-head 제품 ID 정의가 계약을 충족해야 합니다.
- canonical `origin` fetch·push identity와 exact Git base·head proof가
  일치해야 합니다.

`gh pr checks --required`, `gh pr view`와 GraphQL thread 조회 결과를 파일로
고정하고 validator가 병합 입력 snapshot을 만들게 합니다.

```bash
node .agents/skills/open-pull-request/scripts/validate-finalize.mjs \
  --pr <pr.json> --checks <checks.json> --threads <threads.json> \
  --issue <issue.json> --pull-request <number> --repo <owner/repo>
```

부분 GraphQL page, 중복·불명확 thread, stale head, pending·실패 CI,
fork·remote 불일치가 있으면 중단합니다. 기대 결론을 만들기 위해 응답을
보정하지 않습니다.

## 5. Exact-head merge와 원격 정리

Validator가 출력한 snapshot으로 dry-run 계획을 확인한 뒤 같은 파일과 token을
한 번 사용합니다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-merge.mjs \
  --snapshot <validated-snapshot.json> --dry-run
node .agents/skills/open-pull-request/scripts/finalize-merge.mjs \
  --snapshot <validated-snapshot.json> --confirm-plan <plan-token>
```

Helper만 exact-head squash merge를 수행합니다. `--admin`, `--auto`,
merge commit, rebase merge와 force push를 사용하지 않습니다. 응답이
불명확해도 merge 명령을 반복하지 않고 PR을 재조회합니다.

이미 `MERGED`이면 `validate-finalize --merged-recovery`로 merge commit,
base parent, exact head tree, subject, `origin/main` first-parent와 actor를
검증합니다. 이 모드는 merge를 다시 실행하지 않습니다.

병합과 `origin/main` 반영을 확인한 뒤 remote branch helper를 dry-run과
확인 token으로 사용합니다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-remote-branch.mjs \
  --repo <owner/repo> --branch <branch> --head <40-sha> --dry-run
node .agents/skills/open-pull-request/scripts/finalize-remote-branch.mjs \
  --repo <owner/repo> --branch <branch> --head <40-sha> \
  --confirm-plan <plan-token>
```

원격 branch가 이미 없으면 성공으로 취급합니다. 다른 OID를 가리키거나
canonical push identity가 바뀌면 삭제하지 않습니다.

## 6. 이슈 완료와 로컬 정리

병합·원격 branch 결과가 확인된 뒤에만
`run-github-work-item complete`를 한 번 실행합니다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs complete \
  <issue> --pr <pr> --head <validated-head> --repo <owner/repo>
```

그 뒤 exact issue worktree와 branch만 cleanup helper로 dry-run·execute합니다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-local-cleanup.mjs \
  --issue-worktree <path> --main-worktree <path> --branch <branch> \
  --head <40-sha> --repo <owner/repo> --issue <issue> --pr <pr> --dry-run
node .agents/skills/open-pull-request/scripts/finalize-local-cleanup.mjs \
  --issue-worktree <path> --main-worktree <path> --branch <branch> \
  --head <40-sha> --repo <owner/repo> --issue <issue> --pr <pr> \
  --execute --plan-token <plan-token>
```

Helper가 clean Git identity, exact worktree·branch·head와 `.omc` 보존·격리를
검증합니다. dirty 상태, 사용자 소유 파일, 신원 drift, 불명확한 quarantine
상태에서는 이동·삭제·reset·stash하지 않습니다. 수동 `rm`, `git worktree
remove`, branch force delete로 우회하지 않습니다.

## 중단 조건

- 이슈 선점 branch·현재 branch·PR head 불일치
- dirty index·working tree 또는 범위 밖 변경
- canonical origin·same-repository source 불일치
- 제품 결정·관련 테스트·문서 영향·review closure 누락
- PR body 계약 위반, stale head, pending·실패 required CI
- 미해결·불완전 review thread snapshot
- merge·remote branch·complete·cleanup 결과를 확정할 수 없는 상태

중단 뒤 완료된 쓰기를 반복하지 않습니다. 마지막 확인된 상태를 재조회하고
해당 helper의 recovery mode로만 다음 한 단계를 재개합니다.

## 결과 보고

PR 생성·갱신 결과에는 PR 링크와 Draft/Ready, base/head, 종료 이슈, 실제 관련
테스트·review·문서 영향과 남은 blocker를 적습니다. Finalize 결과에는
validated head, merge commit, required CI·thread, 이슈 완료, 원격 branch와
로컬 정리 결과를 추가합니다. 인증 정보, Git 신원 값과 로컬 절대 경로는
외부 기록에 남기지 않습니다.
