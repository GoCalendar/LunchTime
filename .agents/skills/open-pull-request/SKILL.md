---
name: open-pull-request
description: LunchTime 이슈 브랜치의 전체 변경을 검증해 Draft·Ready GitHub PR을 생성·갱신하고, 명시적인 완료·병합 요청에서는 현재 head·CI·review snapshot을 다시 검증해 한 번의 squash merge부터 작업 완료와 안전한 로컬 정리까지 finalize한다. PR을 열거나 작성·갱신할 때, Draft를 Ready로 바꿀 때, PR 제목·본문·템플릿을 검증할 때, 작업을 끝내거나 병합할 때 사용한다.
---

# Pull Request 열기

PR은 이슈의 내용을 복제하는 보고서가 아니라 구현 결과와 검증 근거를 넘기는
인계 문서다. 시작 전에 [PR 본문 계약](references/pr-body-contract.md)을
끝까지 읽고 `.github/PULL_REQUEST_TEMPLATE.md`를 사용한다.

## 책임 경계

- PR 모드는 최종 비교, 검증, push, PR 생성·갱신과 사후 재조회까지만
  수행한다.
- finalize 모드는 명시적인 완료·병합 또는 end-to-end 요청에서만 현재 상태
  검증, exact-head squash merge 한 번, 원격 branch 삭제·재조회,
  `run-github-work-item complete` 호출과 안전한 로컬 정리를 조정한다.
- 두 모드 모두 변경을 스테이징하거나 커밋·amend·rebase하지 않는다.
- 이슈와 Project 상태 전이의 세부 소유자는 병합 뒤 호출하는
  `run-github-work-item complete`다.
- 실패한 쓰기를 자동 반복하지 않는다. 상태를 다시 읽고 원인을 확인한 뒤에만
  별도의 새 실행으로 재개한다.

## 요청 모드 선택

- **PR 생성·갱신만:** PR 생성·갱신과 생성 결과 재조회에서 멈춘다. Ready
  전환이나 CI 확인을 요청받아도 병합 권한으로 확대하지 않는다.
- **완료·병합·end-to-end:** 1~5단계를 완료한 뒤 6~8단계 finalize를
  계속한다.
- 요청이 불명확하면 PR 모드로 처리하고 finalize하지 않는다. 이미 병합된 PR의
  완료·정리 요청이면 `merged-recovery`로 GitHub 상태를 재조회해 충족된
  쓰기와 merge를 반복하지 않고 원격 ref 확인부터 남은 단계만 수행한다.

## 1. 모드별 진입 조건 확인

모든 모드에서 먼저 인증, 현재 저장소와 기본 브랜치를 읽는다.

```bash
gh auth status
gh api user --jq .login
gh repo view --json nameWithOwner,defaultBranchRef
git remote get-url origin >/dev/null
```

현재 `gh` 계정에 저장소 쓰기 권한이 있고 기본 브랜치가 `main`이어야 한다.
그 뒤 요청 모드에 따라 진입 조건을 분리한다.

### 일반 PR·OPEN finalize

1. 현재 브랜치는 `main`이 아니며 `CONTRIBUTING.md`, 작업 관리 설정과
   `run-github-work-item start`의 선점 기록이 모두 일치한다.
2. 이슈가 열려 있고 현재 계정 한 명에게 할당되어 있다.
3. 작업 트리에 수정·스테이징·미추적 파일이 없고 브랜치에는 현재 이슈의
   단일 목적만 있다.

원격 상태와 전체 변경을 한 번 갱신해 확인한다.

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --check origin/main...HEAD
```

커밋 범위에는 `commit-work-item`의 메시지 validator를 실행한다. 브랜치가
원격 `main`보다 뒤처졌거나 충돌하면 자동 rebase하지 않고 중단한다.

### `merged-recovery`

병합 뒤 중단된 실행은 issue worktree, clean `main` worktree 또는 정확한 로컬
정리가 이미 끝난 저장소에서 재개할 수 있다. 현재 cwd가 non-main branch이거나
issue worktree가 존재해야 한다고 가정하지 않고 `git worktree list --porcelain`과
각 실제 경로의 상태를 읽는다.
issue worktree가 이미 없으면 clean `main` worktree에서 재개한다.

1. PR의 정확한 closing issue가 열려 있거나 GitHub auto-close로 `completed`
   종료되어 있고 현재 계정 한 명에게 계속 할당되어 있어야 한다. 이슈를 다시
   열거나 재할당하지 않는다.
2. `validate-finalize --merged-recovery`가 반환한 branch는 현재 계정이 소유한
   exact winning claim branch와 같아야 한다. 다음 읽기 전용 dry-run으로
   assignee·claim·PR head·base·단일 closing reference를 함께 재검증한다.
   실행 계약은
   `complete <issue> --pr <pr> --head <validated-head> --dry-run`이다.

   ```bash
   node .agents/skills/run-github-work-item/scripts/work-item.mjs \
     complete <issue> --pr <pr> --head <validated-head> --dry-run
   ```

3. issue worktree나 local branch가 남아 있으면 검증한 branch·head와 정확히
   같고 clean이어야 한다. 둘 다 이미 없으면 이를 정상적인 정리 완료 상태로
   허용한다. `main` worktree는 존재하는 경우 clean이어야 한다.
4. 현재 cwd의 `HEAD`와 `origin/main` 사이 branch diff를 recovery 신원
   증거로 사용하지 않는다. destructive 단계는 아래 exact remote/local OID
   검증을 각각 통과한 대상에만 수행한다.

## 2. 중복 PR과 문서 영향 확인

열린 PR을 제한된 한 번의 조회로 확인한다.

- 같은 head 브랜치의 열린 PR
- 같은 이슈를 `Closes #N`으로 닫는 열린 PR
- 같은 브랜치를 사용했던 닫힌 PR 또는 병합된 PR

같은 head의 열린 PR 하나만 있으면 새 PR을 만들지 않고 그 PR을 갱신한다.
후보가 둘 이상이거나 다른 브랜치가 같은 이슈를 닫고 있으면 중단한다. 닫힌
브랜치를 새 작업에 재사용하지 않는다.

`update-product-docs`로 PRD·정책·제품 정의 영향을 판정한다. 정본끼리
충돌하거나 제품 결정이 없으면 Ready PR을 만들지 않는다. Ready validator는
추적 표의 모든 PRD·Policy ID가 현재 branch의 `docs/prd/`,
`docs/policies/`에서 FR·AC·Policy visible heading 또는 PRD 기술 스파이크
표의 첫 셀로 실제 정의되어 있는지도 확인한다.

## 3. 제목과 본문 작성

제목은 squash merge 뒤 `main`의 커밋 제목이 되므로 커밋 계약과 같은 형식을
사용한다.

```text
<type>: LT-NNN - <결과>
<type>: #<이슈 번호> - <결과>
```

본문은 템플릿의 version marker, 다섯 heading, section marker와 필드 이름을
유지한다. 이슈·PRD를 통째로 복사하지 않고 이번 변경에서 달라진 결과, 중요한
결정, 제외·후속 작업과 증거만 적고 정본 ID를 연결한다.

- **Draft:** 실패·미실행 검증이나 `결정 필요`를 허용하되 실제 상태, 책임
  주체와 다음 조건을 적는다. `독립 리뷰` 행도 정확히 하나 유지하고 실패나
  미실행이면 발견 사항·blocker와 재개 조건을 사실대로 적는다. 연결 이슈와
  작업 키는 실제 값이어야 한다.
- **Ready:** placeholder, 실패·미실행 검증, 미확정 결정이 없어야 한다.
  `독립 리뷰` 행이 정확히 하나이고 `통과`여야 하며 검토 snapshot, 원본
  요구사항, raw diff, 테스트 결과, 검토자 수·관점과 P0~P2 발견·해소 결과를
  재구성할 수 있는 증거가 필요하다. snapshot에는 검토한 exact head commit
  SHA를 `review-head=<40자리 SHA>`로 정확히 한 번 적고 Ready validator
  입력의 현재 head와 완전히 일치시킨다. 짧은 prefix나 다른 용도의 SHA는
  review-head 증거를 대신하지 않는다.

독립 리뷰는 구현 테스트와 `update-product-docs` 문서 영향 판정 뒤 작성
컨텍스트와 분리된 읽기 전용 검토자가 수행한다. 작성자 자기 검토는 인정하지
않고 작성·수정자와 최종 승인자를 분리하며, 의도한 답이나 예상 결론 없이
원본 요구사항, raw diff와 테스트 결과를 제공한다. 검토자는 직접 수정하지
않고 P0~P2를 파일 위치와 재현 근거로 보고한다. 낮은 위험은 최소 1명,
계약·validator·workflow 변경은 최소 2명, 고위험 변경은 필요한 전문 관점별
검토자를 사용한다. 수정 후 새 snapshot을 별도 패스로 검토하며 최초 리뷰를
1회로 세어 review-fix cycle을 최대 3회로 제한한다. 3회 뒤에도 P0/P1이
남으면 Ready 전환이나 PR 승인을 중단하고 blocker로 보고한다. 새 리뷰 전용
Skill은 만들지 않는다.

작성한 제목과 본문을 검증한다.

```bash
node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs \
  --template .github/PULL_REQUEST_TEMPLATE.md
node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs \
  --body <body-file> --title "<title>" --issue <number> --branch <branch> --draft
node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs \
  --body <body-file> --title "<title>" --issue <number> --branch <branch> \
  --head <current-head-sha>
```

두 번째 명령은 Draft, 세 번째 명령은 Ready에 사용한다. GitHub
`pull_request` event 검증은 event의 `pull_request.head.sha`를 같은 계약에
사용한다.

## 4. push와 PR 쓰기

커밋이 원격에 없을 때 현재 브랜치를 `origin`으로 한 번 push한다. force
push하지 않는다.

- 기존 PR이 없으면 `gh pr create --base main --head <branch>`로 생성한다.
- Draft에는 `--draft`를 사용한다.
- 기존 PR은 `gh pr edit`로 제목과 본문을 갱신한다.
- Draft를 Ready로 바꿀 때는 Ready 검증 뒤 `gh pr ready`를 실행한다.
- Ready를 Draft로 되돌리는 동작은 사용자가 명시한 경우에만 수행한다.

push, 생성, 갱신과 상태 전환은 각 단계에서 최대 한 번만 실행한다. 실패하면
같은 명령을 자동 반복하지 않는다.

## 5. 생성 결과 검증

`gh pr view`로 번호, URL, 제목, 본문, base/head, Draft 상태와 종료 이슈
연결을 다시 읽는다. 응답을 임시 event JSON 또는 본문 파일로 저장해 validator를
재실행하고, GitHub가 `Closes #N`을 종료 이슈로 인식하는지 확인한다.

PR 생성·갱신만 요청받았다면 여기서 멈춘다. 최종 보고에는 PR 링크와 상태,
base/head, 종료 이슈·작업 키, 검증 증거, 문서 영향 판정, 남은 실패·미실행
항목을 포함한다. 인증 정보, 신원 값과 로컬 절대 경로는 보고하지 않는다.

## 6. Finalize 직전 현재 snapshot 검증

완료·병합 또는 end-to-end 요청일 때만 진행한다. 먼저 `origin/main`을 한 번
fetch한다. 그 뒤 required checks → PR → review threads 순서의 bounded 조회로
세 입력을 파일에 고정한다.

```bash
git fetch --prune origin
gh pr checks <pr> -R <owner/repo> --required \
  --json name,state,bucket,link,workflow,event,startedAt,completedAt
gh pr view <pr> \
  --json id,number,url,updatedAt,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,title,body,mergeable,mergeStateStatus,mergedAt,mergedBy,mergeCommit,closingIssuesReferences,statusCheckRollup
gh api graphql -f query='<reviewThreads query>' -F owner=<owner> -F name=<repo> -F number=<pr>
```

GraphQL은 `repository.nameWithOwner`, pull request의
`id`·`number`·`url`·`updatedAt`·base/head name과 OID, 그리고
`reviewThreads(first: 100)`의 `nodes.id`·`nodes.isResolved`와
`pageInfo.hasNextPage`를 조회한다. 다음 명령으로 세 응답과 local Git object를
함께 검증한다.

```bash
node .agents/skills/open-pull-request/scripts/validate-finalize.mjs \
  --pr <pr-json> --checks <required-checks-json> --threads <threads-json> \
  --issue <issue> --pull-request <pr> --repo <owner/repo>
```

validator가 출력한 exact base, head, head tree, head branch와 제목만 다음
단계에 사용한다. 검증은 PR이 `OPEN`·Ready이고 base가 `main`이며, exact head
Git tree에서 추적 ID가 정의되고 head SHA와 독립 리뷰 snapshot이 같으며,
required check가 하나 이상 모두 `pass`인지 확인한다. 각 required check의
`name`·`link`는 같은 PR 응답의 `statusCheckRollup`에서 유일한 성공 run과
일치해야 한다. review thread 응답의 repo·PR node·number·URL·`updatedAt`·
base/head name·OID도 PR 응답과 모두 같고, thread가 전부 해결됐으며 다음
page가 없어야 한다. `origin/main`은 PR base OID와 같고 base가 head의
ancestor여야 하며, mergeable 상태, 제목·본문과 `closingIssuesReferences`도
이슈 계약과 일치해야 한다. 조회 중 identity가 달라지거나 어떤 상태도 읽을 수
없으면 중단하고 새 snapshot부터 다시 검토한다. 마지막 merge는 `--admin` 없이
실행해 서버 ruleset이 mutation 시점의 required CI·thread resolution·strict
base를 다시 판정하게 한다.

프로세스가 merge 성공 뒤 중단된 새 실행은 merged PR을 다시 읽고
`git fetch --prune origin`으로 merge commit을 확보한다. exact head object가
없을 때만 `refs/pull/<pr>/head`를 한 번 fetch하고, 현재 인증 login을 읽어 다음
recovery mode를 사용한다.

```bash
node .agents/skills/open-pull-request/scripts/validate-finalize.mjs \
  --pr <pr-json> --issue <issue> --pull-request <pr> \
  --repo <owner/repo> --actor <current-login> --merged-recovery
```

이 모드는 `MERGED`, base `main`, `mergedAt`, 40자리 `mergeCommit.oid`, exact
head·branch, 같은 head의 `review-head`, 제목·본문과 closing issue를
exact head Git tree 기준 추적 ID와 `mergedBy` actor를 검증한다. 또한 merge
commit의 유일한 parent가 PR `baseRefOid`, merge tree가 exact head tree,
subject가 검증한 PR 제목이고 merge commit이 `origin/main` first-parent
history에 있는 squash topology인지 확인한다. 병합 전에만 의미가 있는 required check·review thread
입력은 받거나 다시 판정하지 않고
`MERGEABLE`·`CLEAN`도 요구하지 않는다. 검증에 성공하면 위
`complete --dry-run --head`로 현재 소유권을 확인한다. merge 명령은 실행하지 않고 원격 ref 확인부터
출력된 exact head·branch로 재개한다. `OPEN` PR을
recovery로 처리하거나 `MERGED` PR을 일반 finalize로 처리하지 않으며 두 mode의
입력을 섞지 않는다.

## 7. Exact-head squash merge와 원격 재조회

검증 직후 다음 쓰기를 정확히 한 번 실행한다. `--delete-branch`는 병합 전에
local branch까지 제거할 수 있으므로 사용하지 않는다. `--admin`, `--auto`,
`--merge`, `--rebase`, 일반 force push도 사용하지 않는다.

```bash
gh pr merge <pr> --squash --match-head-commit <validated-head> \
  --subject "<validated-title>"
```

성공 응답 뒤 PR을 다시 조회하고 `origin/main`을 fetch한 뒤 위
`--merged-recovery` validator로 `MERGED`, squash topology·tree·actor, base
`main`, 검증한 head·종료 이슈를 확인한다. 이 재조회가 성공한 뒤에만 exact remote ref를 읽는다.
여기서 성공은 recovery 재검증까지 통과한 상태를 뜻한다. 출력이 비어 있으면
이미 삭제된 상태로 다음 단계로 진행한다.
정확히 한 줄이고 OID가 `<validated-head>`와 같을 때만 다음 lease/CAS 삭제를
한 번 실행한다. OID가 다르거나 여러 줄이면 검증 뒤 branch가 이동·재생성된
것이므로 삭제하지 않고 중단한다. 삭제 뒤 같은 `git ls-remote`가 성공한 빈
출력인지 확인한다.

```bash
git ls-remote --heads origin refs/heads/<validated-branch>
git push \
  --force-with-lease=refs/heads/<validated-branch>:<validated-head> \
  origin :refs/heads/<validated-branch>
```

merge 명령이 오류 또는 불명확한 응답을 반환해도 다시 실행하지 않는다. PR과
원격 branch를 한 번 재조회해 이미 병합됐으면 local 상태를 건드리지 않고
`--merged-recovery` 검증을 통과한 뒤 exact remote ref의 현재 OID 확인부터
재개한다. remote 삭제 응답이 불명확해도 같은 삭제를 반복하지 않고 ref를
재조회한다. PR이 열려 있거나 remote OID가 검증한 head와 다르거나 상태를
확정할 수 없으면 현재 상태와 복구 명령을 보고하고 중단한다.

## 8. `complete`와 안전한 로컬 정리

병합과 원격 branch 삭제가 재조회에서 확인된 뒤 다음 상태 전이를 한 번
실행한다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs \
  complete <issue> --pr <pr> --head <validated-head>
```

`complete` 성공과 사후 검증 전에는 worktree나 local branch를 삭제하지 않는다.
`merged-recovery`에서도 원격 ref가 이미 없으면 삭제를 반복하지 않고,
`complete`가 이미 만족됐으면 그 멱등 결과를 확인한 뒤 로컬 정리만 이어간다.
성공 뒤 `git worktree list --porcelain`에서 검증한 branch와 정확히 연결된
worktree path, `main` worktree path를 해석하고 다음을 모두 만족할 때만
정리한다.

1. issue worktree의 branch가 검증한 head branch와 정확히 같고,
   `git -C <issue-worktree> rev-parse HEAD`와
   `git -C <main-worktree> rev-parse refs/heads/<validated-branch>`가 모두
   `<validated-head>`와 정확히 같다. 다음 두 출력도 모두 비어 있어 tracked,
   staged, 모든 untracked·ignored 경로가 없음을 확인한다.

   ```bash
   git -C <issue-worktree> status --porcelain=v1 \
     --untracked-files=all --ignored=matching --ignore-submodules=none
   git -C <issue-worktree> ls-files --others --ignored \
     --exclude-standard --directory --no-empty-directory
   ```

   특히 `.omc`, OS·IDE 잔여물도 ignored라는 이유로 삭제 대상으로 삼지 않는다.
2. `git -C <main-worktree> branch --show-current`가 `main`이고
   `git -C <main-worktree> status --porcelain=v1 --untracked-files=all
   --ignore-submodules=none`이 비어 있다.
3. `git -C <main-worktree> fetch --prune origin`과
   `git -C <main-worktree> merge --ff-only origin/main`이 성공한다.
4. 삭제될 issue worktree를 현재 cwd로 사용하지 않는다. 정확한 issue
   worktree만 main worktree에서 다음 명령으로 제거하고, 같은 안전한 cwd에서
   old-OID CAS로 검증한 local branch만 삭제한 뒤 worktree 목록·branch 부재와
   clean 최신 `main`을 다시 확인한다.

   ```bash
   git -C <main-worktree> worktree remove -- <issue-worktree>
   git -C <main-worktree> update-ref -d \
     refs/heads/<validated-branch> <validated-head>
   ```

dirty·staged·untracked 사용자 변경, ignored 사용자 또는 도구 상태,
branch·path 불일치, 여러 후보,
local ref나 worktree HEAD의 OID 불일치, fast-forward 실패가 하나라도 있으면
삭제·clean·reset·stash하지 않고 정리되지 않은 정확한 대상을 보고한다.
worktree 제거 뒤 local CAS가 실패해도 branch를 강제로 삭제하지 않는다. 일부
정리 쓰기가 실패하면 나머지를 자동 반복하지 않고 현재 로컬 상태를 다시
확인한다.

복구 시 issue worktree와 local branch가 모두 이미 없고 main worktree가
clean·최신이면 로컬 정리가 이미 만족된 것으로 확인한다. issue worktree만
없고 local branch가 검증한 head에 남아 있으면 main worktree에서
`update-ref -d` old-OID CAS만 실행한다. branch만 없고 worktree가 남은 모순
상태, 다른 OID, dirty 상태나 여러 후보는 추측해 정리하지 않고 중단한다.

## 중단 조건

- 인증·권한 실패, 일반 PR·OPEN finalize의 `main` 직접 작업,
  선점·브랜치·이슈 불일치. `merged-recovery`의 clean `main` cwd 재진입은
  이 중단 조건의 예외다.
- 더러운 작업 트리, 범위 밖 변경, 빈 커밋 범위, 중복 PR
- 원격 `main`과 충돌하거나 뒤처진 상태
- 실패한 필수 검증, 문서 영향 미판정, Ready 계약 위반
- push나 PR 쓰기 뒤 재조회 결과 불일치
- stale head·독립 리뷰 snapshot, 실패·대기 required CI, 미해결 review
  thread, Draft·base·종료 참조·mergeability 불일치
- 병합 결과나 원격 branch 삭제를 확정할 수 없는 상태
- `complete` 실패, dirty·사용자 소유 변경 또는 정확히 식별할 수 없는 local
  worktree·branch
