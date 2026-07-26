---
name: open-pull-request
description: LunchTime 이슈 브랜치의 전체 변경을 검증해 Draft·Ready GitHub PR을 생성·갱신하고, 명시적인 완료·병합 요청에서는 same-repository source·현재 head·CI·전체 review snapshot을 다시 검증해 한 번의 squash merge부터 작업 완료, 원격 branch와 OMC 상태 보존 로컬 정리까지 finalize한다. PR을 열거나 작성·갱신할 때, Draft를 Ready로 바꿀 때, PR 제목·본문·템플릿을 검증할 때, 작업을 끝내거나 병합할 때 사용한다.
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
node .agents/skills/open-pull-request/scripts/finalize-remote-branch.mjs \
  --repo <nameWithOwner> --inspect-origin
```

현재 `gh` 계정에 저장소 쓰기 권한이 있고 기본 브랜치가 `main`이어야 한다.
`origin` fetch·push URL은 각각 정확히 하나이며 credential 없는 canonical
`github.com` HTTPS 또는 SSH URL로 같은 작업 저장소를 가리켜야 한다. raw
remote URL은 증거나 오류에 출력하지 않는다.
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
   실행 계약은 `complete <issue> --pr <pr> --head <validated-head> --repo <validated-repository> --dry-run`이다.

   ```bash
   node .agents/skills/run-github-work-item/scripts/work-item.mjs \
     complete <issue> --pr <pr> --head <validated-head> \
     --repo <owner/repo> --dry-run
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

커밋이 원격에 없을 때 현재 브랜치를 검증된 canonical `origin`으로 한 번
push한다. force push하지 않는다. 모든 `gh pr` 읽기·쓰기는 cwd나 `GH_REPO`
환경에 맡기지 않고 검증된 repository를 명시적인 `-R` 인자로 전달한다.

- 기존 PR이 없으면
  `gh pr create -R <validated-repository> --base main --head <branch>`로
  생성한다.
- Draft에는 `--draft`를 사용한다.
- 기존 PR은 `gh pr edit -R <validated-repository>`로 제목과 본문을
  갱신한다.
- Draft를 Ready로 바꿀 때는 Ready 검증 뒤
  `gh pr ready -R <validated-repository>`를 실행한다.
- Ready를 Draft로 되돌리는 동작은 사용자가 명시한 경우에만 수행한다.

push, 생성, 갱신과 상태 전환은 각 단계에서 최대 한 번만 실행한다. 실패하면
같은 명령을 자동 반복하지 않는다.

## 5. 생성 결과 검증

`gh pr view -R <validated-repository>`로 번호, URL, 제목, 본문, base/head,
Draft 상태와 종료 이슈 연결을 다시 읽는다. 응답을 임시 event JSON 또는 본문
파일로 저장해 validator를 재실행하고, GitHub가 `Closes #N`을 종료 이슈로
인식하는지 확인한다.

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
gh pr view <pr> -R <owner/repo> \
  --json id,number,url,updatedAt,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,headRepositoryOwner,isCrossRepository,title,body,mergeable,mergeStateStatus,mergedAt,mergedBy,mergeCommit,closingIssuesReferences,statusCheckRollup
gh api graphql -f query='
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      pullRequest(number: $number) {
        id
        number
        url
        updatedAt
        baseRefName
        baseRefOid
        headRefName
        headRefOid
        isCrossRepository
        headRepository { nameWithOwner }
        reviewThreads(first: 100) {
          totalCount
          nodes { id isResolved }
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
        }
      }
    }
  }' -F owner=<owner> -F name=<repo> -F number=<pr>
```

GraphQL은 `repository.nameWithOwner`, pull request의
`id`·`number`·`url`·`updatedAt`·base/head name과 OID·
`isCrossRepository`·`headRepository.nameWithOwner`, 그리고
`reviewThreads(first: 100)`의 `totalCount`, `nodes.id`·
`nodes.isResolved`와 양쪽 page flag·cursor를 위 고정 query로 조회한다. 다음
명령으로 세 응답과 local Git object, credential을 제외한 canonical `origin`
fetch·push repository identity를 함께 검증한다.

```bash
node .agents/skills/open-pull-request/scripts/validate-finalize.mjs \
  --pr <pr-json> --checks <required-checks-json> --threads <threads-json> \
  --issue <issue> --pull-request <pr> --repo <owner/repo> \
  > <validated-finalize-snapshot.json>
```

validator가 출력한 exact base, head, head tree, head branch, source
repository, remote, 제목과 `updatedAt`만 다음 단계에 사용한다. 자동
finalize는 PR source, base와 canonical `origin` fetch·push가 모두 같은 작업 저장소인
same-repository PR에만 허용한다. fork·cross-repository PR과 multiple·
credential·unparseable remote URL은 merge나 branch 삭제 전에 중단한다.
검증은 PR이 `OPEN`·Ready이고 base가 `main`이며, exact head
Git tree에서 추적 ID가 정의되고 head SHA와 독립 리뷰 snapshot이 같으며,
required check가 하나 이상 모두 `pass`인지 확인한다. 각 required check의
`name`·`link`는 같은 PR 응답의 `statusCheckRollup`에서 유일한 성공 run과
일치해야 한다. review thread 응답의 repo·PR node·number·URL·`updatedAt`·
base/head name·OID·source repository·cross-repository 여부도 PR 응답과 모두
같아야 한다. `totalCount`는 고유한 node 수와 같고 양쪽 page가 없으며 cursor가
node 유무와 일치하고 thread가 전부 해결돼야 한다. `origin/main`은 PR base
OID와 같고 base가 head의
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
head·branch, same-repository source와 canonical `origin` fetch·push, 같은
head의 `review-head`, 제목·본문과 closing issue를
exact head Git tree 기준 추적 ID와 `mergedBy` actor를 검증한다. 또한 merge
commit의 유일한 parent가 PR `baseRefOid`, merge tree가 exact head tree,
subject가 검증한 PR 제목이고 merge commit이 `origin/main` first-parent
history에 있는 squash topology인지 확인한다. 병합 전에만 의미가 있는 required check·review thread
입력은 받거나 다시 판정하지 않고
`MERGEABLE`·`CLEAN`도 요구하지 않는다. 검증에 성공하면 위
`complete --dry-run --head --repo`로 현재 소유권을 확인한다. merge 명령은 실행하지 않고 원격 ref 확인부터
출력된 exact head·branch로 재개한다. `OPEN` PR을
recovery로 처리하거나 `MERGED` PR을 일반 finalize로 처리하지 않으며 두 mode의
입력을 섞지 않는다.

## 7. Exact-head squash merge와 원격 재조회

검증 직후 `finalize-merge.mjs`의 읽기 전용 계획을 실행한다. helper는 validator
출력 파일의 repository·PR·base·head·branch·제목·`updatedAt`을 현재 PR
재조회와 다시 비교하고, 제목 원문 대신 fingerprint를 포함한 plan token을
출력한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-merge.mjs \
  --snapshot <validated-finalize-snapshot.json> --dry-run
```

계획을 확인한 뒤 같은 snapshot 파일과 출력된 token으로 다음 mutation을
정확히 한 번 실행한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-merge.mjs \
  --snapshot <validated-finalize-snapshot.json> \
  --confirm-plan <plan-token>
```

helper는 `gh pr merge`를 shell 문자열로 만들지 않고 검증된 repository·PR·
head·제목을 각각 별도 argv로 전달하며 head는 `--match-head-commit` 값으로
고정한다. 따라서 PR 제목의 quote, `$()`,
backtick과 shell 구문은 실행되지 않고 `--subject` 값 하나로만 전달된다.
`--delete-branch`는 병합 전에 local branch까지 제거할 수 있으므로 사용하지
않는다. `--admin`, `--auto`, `--merge`, `--rebase`, 일반 force push도
사용하지 않는다.

성공 응답 뒤 PR을 다시 조회하고 `origin/main`을 fetch한 뒤 위
`--merged-recovery` validator로 `MERGED`, squash topology·tree·actor, base
`main`, 검증한 head·종료 이슈를 확인한다. 이 재조회가 성공한 뒤에만 다음
helper의 읽기 전용 계획으로 exact remote ref와 canonical `origin` 설정을
함께 고정한다. 즉, 재조회가 성공한 뒤에만 exact remote ref를 읽는다. 여기서
성공은 recovery 재검증까지 통과한 상태를 뜻한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-remote-branch.mjs \
  --repo <owner/repo> --branch <validated-branch> \
  --head <validated-head> --dry-run
```

출력이 `alreadyAbsent: true`이면 삭제를 반복하지 않고 다음 단계로 진행한다.
그 밖에는 출력된 `planToken`을 사람이 확인 가능한 새 명령에 그대로 넣어 한
번만 실행한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-remote-branch.mjs \
  --repo <owner/repo> --branch <validated-branch> \
  --head <validated-head> --confirm-plan <plan-token>
```

helper는 계획과 실행에서 `origin` fetch·push URL을 다시 읽어 각각 정확히
하나인지, credential 없는 canonical GitHub URL인지, 둘 다 같은 source
repository인지 확인한다. raw URL 대신 그 fingerprint를 plan token에 묶고,
캡처한 exact push URL로만 조회·한 번의 lease 삭제·사후 부재 확인을 수행한다.
아래 기존 표기는 helper 내부 의미를 설명하기 위한 호환 표기이며 직접
실행하지 않는다. 실제 명령은 `origin` 이름이 아니라 검증한 push URL을
사용한다.

```bash
git ls-remote --heads origin refs/heads/<validated-branch>
git push --force-with-lease=refs/heads/<validated-branch>:<validated-head> \
  origin :refs/heads/<validated-branch>
```

merge helper가 오류 또는 불명확한 응답을 반환해도 다시 실행하지 않는다. PR과
원격 branch를 한 번 재조회해 이미 병합됐으면 local 상태를 건드리지 않고
`--merged-recovery` 검증을 통과한 뒤 exact remote ref의 현재 OID 확인부터
재개한다. remote 삭제 응답이 불명확해도 같은 삭제를 반복하지 않고 helper의
새 dry-run으로 ref와 URL fingerprint를 다시 읽는다. PR이 열려 있거나 remote
OID·repository·URL fingerprint가 검증값과 다르거나 상태를 확정할 수 없으면
현재 상태와 복구 명령을 보고하고 중단한다.

## 8. `complete`와 안전한 로컬 정리

병합과 원격 branch 삭제가 재조회에서 확인된 뒤 다음 상태 전이를 한 번
실행한다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs \
  complete <issue> --pr <pr> --head <validated-head> \
  --repo <validated-repository>
```

`complete` 성공과 사후 검증 전에는 worktree나 local branch를 삭제하지 않는다.
`merged-recovery`에서도 원격 ref가 이미 없으면 삭제를 반복하지 않고,
`complete`가 이미 만족됐으면 그 멱등 결과를 확인한 뒤 로컬 정리만 이어간다.
먼저 제거 대상 밖의 clean `main` worktree에서 최신 merge commit까지
fast-forward한다.

```bash
git -C <main-worktree> fetch --prune origin
git -C <main-worktree> merge --ff-only origin/main
```

그 뒤 다음 읽기 전용 계획을 실행한다. 경로는 `git worktree list --porcelain`
결과에서 검증한 branch와 정확히 연결된 단일 issue worktree와 단일 `main`
worktree만 사용하며, 현재 cwd는 issue worktree 밖이어야 한다. helper는
`worktree list --porcelain -z`를 지원하는 Git 2.36 이상을 요구하며 실행
초기에 version을 확인한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-local-cleanup.mjs \
  --issue-worktree <issue-worktree> --main-worktree <main-worktree> \
  --branch <validated-branch> --head <validated-head> \
  --repo <validated-repository> --issue <issue> --pr <pr> --dry-run
```

계획 JSON의 exact identity, `action`, archive 위치와 `planToken`을 확인한 뒤
repository를 포함한 같은 일곱 identity 인자로 한 번만 실행한다.

```bash
node .agents/skills/open-pull-request/scripts/finalize-local-cleanup.mjs \
  --issue-worktree <issue-worktree> --main-worktree <main-worktree> \
  --branch <validated-branch> --head <validated-head> \
  --repo <validated-repository> --issue <issue> --pr <pr> \
  --execute --plan-token <plan-token>
```

helper는 branch가 `work/issue-<issue>-<slug>`인지, main·issue worktree와 Git
common dir가 유일한지, `main` HEAD·local main·`origin/main`이 같은지, issue
worktree HEAD와 local ref가 모두 exact head인지 계획과 실행에서 다시
검증한다. explicit repository와 `origin`의 fetch·push URL도 각각 정확히 하나인
credential 없는 canonical GitHub URL이고 같은 repository인지 확인한다. raw
URL은 출력하거나 plan·identity에 저장하지 않고 SHA-256 fingerprint만 plan
token과 runtime canary에만 결속한다. archive key는 issue·PR·branch·head·
issue와 main worktree·Git common dir로 이루어진 stable local locator
identity에서만 계산하고, explicit repository만 같은 namespace의 durable core
`identity.json`에 둔다. 따라서 repository 변경은 새 archive namespace를
선택하지 못하고 기존 core identity와 충돌한다. 같은 repository의 canonical
URL 변경은 old token을 무효화하지만 새 dry-run이 현재 fingerprint로 기존
archive를 검증해 복구할 수 있다. 내부 OID 검증은 다음 계약과 같으며 이
명령들을 따로 실행해 helper를 우회하지 않는다.

```bash
git -C <issue-worktree> rev-parse HEAD
git -C <main-worktree> rev-parse refs/heads/<validated-branch>
# 두 OID 모두 <validated-head>
```

main과 issue의 일반 Git 상태는 비어 있어야 한다. ignored preflight는 아래 두
증거를 함께 읽으며, 아무 ignored 경로도 없거나 `.gitignore`의 `.omc` 패턴에
귀속된 root `.omc` 하나만 허용한다. `.DS_Store`, IDE 파일과 다른
ignored·untracked 경로는 자동 보존·삭제하지 않는다. tracked 검사를 생략하게
만드는 `assume-unchanged`·`skip-worktree` index flag도 허용하지 않으며
index를 자동 수정해 해제하지 않는다. sparse checkout은 `skip-worktree`를
사용하므로 cleanup 대상과 main 모두 `git sparse-checkout disable`로 완전히
materialize하거나 별도 full checkout worktree를 사용해야 한다.
`fsmonitor-valid` 상태는 index에서 지우지 않고 `core.fsmonitor=false`로
해석에서 배제한다.

```bash
git -C <issue-worktree> status --porcelain=v1 \
  --untracked-files=all --ignored=matching --ignore-submodules=none
git -C <issue-worktree> ls-files --others --ignored \
  --exclude-standard
```

실제 `.omc/`가 있으면 그 아래가 symlink·special file·다른 filesystem·
external hardlink 없이 일반 파일과 디렉터리만인지 검사하고 setuid·setgid·
sticky mode도 허용하지 않는다. 공유 setgid directory에서 상속된 bit도
예외가 아니므로 사용자가 source `.omc`의 특수 mode를 제거한 뒤 새 dry-run을
실행해야 한다. source proof는 device·inode·timestamp를
포함한 `snapshotDigest`, inode identity를 포함한 `treeDigest`, 그리고 relative
path·type·전체 permission mode·file bytes만 포함해 새 inode와도 비교할 수
있는 `contentDigest`를 함께 계산한다. 실제 Git common dir 아래
`lunchtime-worktree-state/v2/<identity-sha256>/`에 0700 디렉터리와 exclusive
0600 core `identity.json`, append-only
`intents/<generation-sha256>.json`과
`generations/<generation-sha256>/generation.json` receipt를 만든다. exact
archive key·previous·kind·source proof를 담은 durable intent를 atomic
no-replace로 먼저 발행한 뒤에만 generation container를 만든다. 보존 payload는
원본을 rename·삭제하지 않고 exclusive create로 만든 helper-owned 새 inode
sealed snapshot이다. 먼저 final generation namespace 밖의 전용 0700
`snapshot-scratch/`에 256-bit nonce basename을 가진 empty root를 만들고,
exact durable intent digest·scratch basename·root device/inode·pending·final
경로를 `snapshot-attempt.json`에 결속한다. attempt 발행 중에는 root FD의
전후 identity와 path identity를 함께 확인한다. attempt 없이 중단된 scratch는
same-filesystem 0700 empty inert residue로만 inventory·canary에 남기며
삭제·rename·payload 채택 또는 소급 attempt 발행을 하지 않는다. 이름·type·
device·mode·empty 조건이 다르면 중단한다.

copy는 exact attempt root와 일치하는 bound scratch에서만 수행한다. 각 파일은
source FD의 전후 identity와 hardlink 수를 확인하면서 새 inode로 쓰고 fsync하며,
source 전체의 snapshot 전후 안정성과 source·payload `contentDigest` 일치를
확인한다. 이 verified snapshot은 cross-device 또는 실패 시 원본을 지우는 copy
fallback이 아니라 원본을 그대로 보존하는 primary snapshot 단계다. durable
attempt에 결속된 complete, 실제 entry가 하나 이상인 nonempty `partial`, 첫
entry 전 실패한 exact-empty `failed-empty` candidate만 deterministic
`pending.omc`로 same-filesystem atomic no-replace publish한다. publish 전후
root device/inode를 attempt와 다시 대조하며 scratch·pending·current 중 owned
root는 정확히 하나여야 한다.
완전한 snapshot은 device·inode·`treeDigest`·`contentDigest` seal과 exact
`attemptDigest`를 `snapshot-complete.json`에 결속한 뒤 `pending.omc`를
`current.omc`로 atomic no-replace publish한다. rename으로 바뀔 수 있는
timestamp는 publication 뒤 receipt의 full proof에서 다시 읽는다.

`generation.json`은 exact durable intent의 `intentDigest`, snapshot의
`attemptDigest`와 현재 snapshot의
device·inode·`snapshotDigest`·`treeDigest`·`contentDigest`를
`payloadProof`로 결속하며 active head뿐 아니라 historic generation 전체에
같은 검증을 적용한다. receipt 발행 전후에는 full proof가 같은 실행에서 정확히
일치해야 한다. 완료된 archive를 새 실행에서 읽을 때는 device·inode·
`treeDigest`·`contentDigest`의 `payloadSeal`을 receipt와 대조해 APFS·
FileProvider의 timestamp-only churn을 payload 변조로 오판하지 않는다. 대신
그 시점에 다시 읽은 `snapshotDigest` 포함 current full proof를 새 plan token과
archive canary에 결속하므로 dry-run 뒤 timestamp를 포함한 어떤 proof drift도
이후 mutation 전에 중단한다. intent·snapshot outcome의 seal도 함께 대조한다.
JSON은 0600 pending file을 fsync한 뒤 final path로 atomic no-replace
publish하고 parent directory도 fsync한다. 새 archive·generation entry와
snapshot file·directory도 생성·receipt 완료 경계에서 fsync하며, 기존
directory·symlink·receipt를 덮어쓰지 않는다.

실제 `.omc/`가 없더라도 빈 첫 generation을 만든다. `.omc` symlink bridge는
만들지 않으므로 old head의 `.omc/` ignore 규칙에서도 directory 존재 여부와
무관하게 같은 계약을 사용한다. receipt 전 중단은 durable intent와 결속된
후보가 최대 하나이고 새 inode snapshot의 `contentDigest`가 intent와 정확히
같을 때만 재개한다. snapshot 생성 전 source가 바뀌면 old intent를 빈
`orphan` generation으로 봉인하고 현재 source를 다음 generation에 append한다.
완료된 receipt-less snapshot 뒤 source가 바뀌거나 empty payload 뒤 source가
생긴 경우도 각각 기존 preserved·empty generation을 먼저 봉인한 뒤 현재
source를 append한다. durable attempt 뒤 copy가 중단되었거나 source drift로
재개할 수 없게 된 helper-owned bound scratch는 현재 proof와 exact
`attemptDigest`를 `snapshot-failed.json`에 결속하고 `pending.omc`,
`current.omc` 순서로 atomic no-replace publish한다. candidate가 nonempty일
때만 `partial` orphan receipt로 봉인하고 현재 source 전체를 다음 preserved
generation에 append한다. 첫 entry 전 실패한 exact owned empty root는
`failed-empty` orphan receipt로 봉인해 같은 attempt·root·failed proof를
보존한다. 그 뒤 현재 source가 있으면 새 preserved generation을, 사라졌으면
truthful empty generation을 append한다. source가 그 사이 바뀌어도 실패
candidate와 최신 source 상태를 각각 보존한다. durable intent·attempt·exact root
ownership이 없는 pending/current payload, empty `partial`, nonempty
`failed-empty`, unknown collision, scratch·pending·current 동시 존재,
outcome과 맞지 않는 변조 payload나 proof 불일치는 추측해 성공·봉인하지 않고
중단한다.

receipt-less preserved intent의 source가 사라져도 helper-owned exact candidate가
있으면 candidate를 덮어쓰거나 버리지 않는다. nonempty 실패 candidate는
`partial` orphan, exact empty 실패 candidate는 `failed-empty` orphan, intent의
`contentDigest`와 같은 complete candidate는 preserved generation으로 먼저
봉인한 뒤 현재 source 부재를 나타내는 truthful empty generation을 append한다.
scratch→pending, outcome, pending→current, recovery receipt와 뒤따르는 empty
intent·container·current·receipt 어디서 중단돼도 같은 inode와 chain을 forward
resume한다. source와 helper-owned candidate가 모두 없을 때만 복구를 추측하지
않고 fail-closed한다.

이 계약은 외부 writer의 filesystem freeze나 lease를 제공하지 않는다. snapshot
중 source가 계속 바뀌면 이후 mutation 없이 fail-closed하고 writer가 안정된 뒤
새 dry-run으로 재개한다. snapshot 뒤 원본에 발생한 write는 sealed generation을
바꾸지 않으며 아래 worktree root 전체와 함께 quarantine된다. root rename 전에
열린 FD가 rename 뒤에도 쓰면 그 변경은 mutable quarantined root에 남는다.
helper-owned sealed payload의 namespace·device·inode·mode·bytes라는
immutable seal이 receipt proof에서 drift하면 원인이 무엇이든 quarantine·
local ref CAS·성공 반환을 중단한다. 완료된 실행 사이의 timestamp-only drift는
새 full proof로 다시 계획할 수 있지만, 같은 dry-run 뒤의 timestamp drift는
canary가 중단한다.

generation이 준비되면 helper는 `git rev-parse --git-dir`에서 검증한 exact
`<git-common-dir>/worktrees/<id>` metadata와 issue worktree root의 device·
inode·mode를 durable quarantine intent에 결속한다. root `.git` marker와
metadata의 `commondir`·`gitdir`·`HEAD`도 device·inode·mode·size·byte digest로
결속하고 이동 뒤 그 bytes를 해석·재작성하지 않는다. 각 directory는
`O_DIRECTORY|O_NOFOLLOW` FD로 먼저 열고 hook 전후 FD·path identity와 exact
Git registration을 다시 확인한다. 그 뒤 worktree root 전체를
`worktree-quarantine/roots/<quarantine-id>`로, metadata directory 전체를
`worktree-quarantine/metadata/<quarantine-id>`로 같은 filesystem atomic
no-replace 이동하고 양쪽 parent를 fsync한 뒤 exclusive receipt를 발행한다.
`git worktree remove`나 `git worktree prune`은 호출하지 않는다.
quarantine transition canary는 durable intent와 pending metadata 부재를
확인하고, intent 발행 hook 뒤·root 이동 전후와 hook 뒤·metadata 이동 전후와
hook 뒤·receipt 발행 뒤마다 stage별 root·metadata device·inode·mode,
issue registration 존재·부재와 exact receipt를 다시 검증한다. 같은 canary는
main worktree root·branch·HEAD·main·origin/main ref·clean 상태·common dir·
registration과 issue local ref도 exact plan에 대조한다. sealed generation
canary도 같은 mutation 경계와 local ref CAS 직전·직후, 최종 성공 반환 전에
검증한다. repository와 canonical origin fetch·push fingerprint canary는
identity와 published-pending cleanup, generation intent·container, snapshot
attempt, copy 시작·종료, scratch→pending, outcome, pending→current,
generation receipt, quarantine intent·root·metadata·receipt, local ref CAS의
모든 durable boundary 직전·직후에 적용한다. `beforeRefDelete` hook 뒤에는
fresh full plan과 plan token을 다시 만들고 exact generation·unbound scratch·
quarantine intent·root·metadata·receipt·registration을 확인한 뒤에만 CAS를
실행한다. 어떤 경계에서든 proof나 origin fingerprint drift가 발견되면 그 뒤
mutation을 실행하지 않으며 최종 scan 실패를 성공으로 반환하지 않는다.

root atomic rename 직전에는 origin canary를 먼저 끝내고, exact issue root의
tracked·staged·untracked·additional ignored residue scan을 마지막 bounded
pre-rename operation으로 실행한다. root 이동 뒤에는 quarantined root와 현재
위치의 exact metadata를 FD·path proof로 고정하고, inherited `GIT_*`를 제거한
환경에서 `GIT_DIR`·`GIT_COMMON_DIR`은 exact common dir, `GIT_WORK_TREE`는
quarantined root, `GIT_INDEX_FILE`은 current metadata의 `index`로 명시한다.
마지막 all-untracked `git ls-files --others --directory -z` 결과는 exact
`.omc` 또는 `.omc/`만 허용한 뒤 `.omc`가 실제 ignored root인지 별도로
증명한다. 이 post-move residue canary는 root·metadata·receipt hook 뒤와
local ref CAS 직전에 다시 실행한다.
pre-scan 뒤 `.omc` 밖 residue가 생기면 root는 이미 quarantine됐을 수 있지만
metadata 진행·local ref CAS·성공 반환을 중단하고 local ref와 residue를 그대로
둔다. 복구는 사용자가 residue를 제거하거나 다른 곳으로 옮긴 뒤에만 재개하며
helper가 자동 삭제·이동·reset·stash하지 않는다.
index의 `assume-unchanged`·`skip-worktree` flag가 하나라도 있으면 먼저
fail-closed한다. sparse checkout이면 full checkout worktree에서 다시
실행한다. index와 exact head는 staged OID로 비교한다.
모든 helper Git 호출은 inherited `GIT_*`를 제거하고 optional index write를
끄는 `GIT_OPTIONAL_LOCKS=0`과 함께 ambient 설정과 무관하게
`core.fsmonitor=false`,
`core.fileMode=true`, `core.trustctime=true`, `core.checkStat=default`,
`core.ignoreStat=false`, `core.untrackedCache=false`를 고정한다. worktree와
index는 stat-cache의 ctime·mtime 추정값이나 `--quiet` 결과가 아니라 external
diff·textconv를 끈 full-index patch의 실제 출력이 비었는지 비교하며, 이 검사
전후 exact linked-worktree index identity와 bytes가 바뀌지 않아야 한다.
`GIT_OPTIONAL_LOCKS=0`은 dry-run·execute의 Git 호출이 main index bytes를
다시 쓰지 않게 하며, 회귀 테스트는 `UNTR`·`FSMN` extension이 있는 index의
byte-for-byte 보존을 확인한다. 실행 bit drift가 있으면 index의 100755·100644
mode와 실제 파일 mode를 사용자가 맞춘 뒤 새 dry-run을 실행하며 helper는
config나 index를 자동으로 고치지 않는다. permission mode를 표현할 수 없어
`core.fileMode=false`가 필요한 filesystem은 지원하지 않으므로 full-mode
filesystem의 worktree를 사용한다. helper-owned archive directory는 setgid
parent나 umask와 무관하게 생성 직후 FD로 exact 0700을 다시 봉인하며
helper-owned JSON file도 FD로 exact 0600을 적용한다.

이 scan과 atomic rename/CAS 사이에는 외부 writer를 동결하는 filesystem lease가
없으므로 완전한 linearizable freeze를 보장하지 않는다. 각 scan은 그 bounded
시점의 증거이며 이후 writer가 만든 상태는 다음 post-move canary에서
fail-closed한다. `.omc` 내부의 mutable write는 허용해 quarantined root에
보존한다.

helper가 `git worktree remove`나 `git worktree prune`을 호출하지 않으므로
최종 검증 뒤 `.omc`가 재생성되어도 root와 함께 보존된다. root 이동 뒤
original path가 다시 생기면 이를 삭제하지 않고 unregistered bounded
residue로 보고한다. exact registration 부재와 quarantine
root·metadata·receipt를 확인한 뒤에만 old-OID local branch CAS를 실행하고
최신 clean `main`을 재검증한다.

```bash
git -C <main-worktree> update-ref -d \
  refs/heads/<validated-branch> <validated-head>
```

dry-run 뒤 repository·origin fingerprint·identity·OID·상태·archive가 달라지면
plan token이 무효다.
dirty·staged·untracked 사용자 변경, root `.omc` 외 ignored 상태, archive
collision·fork·cycle, 신뢰되지 않은 symlink·hardlink·special file·mount,
branch·path 불일치, 여러 후보, local OID 불일치나 fast-forward 실패가 하나라도
있으면 이동·삭제·clean·reset·stash하지 않고 중단한다. metadata quarantine 뒤
local CAS가 실패해도 branch를 강제로 삭제하지 않는다. 일부 쓰기가 끝난 복구는
exact core·generation·quarantine intent와 receipt, payload inode를 요구하며
`resume-generation`,
`append-generation`, `seal-orphan-and-append`, `seal-empty-and-append`,
`seal-partial-and-append`, `seal-failed-empty-and-append`,
`seal-preserved-and-append`, `quarantine-ready`, `quarantine-recovery`,
`delete-ref-recovery`, `satisfied` 중 현재 상태 하나만 새 dry-run으로
재구성한다. receipt 없이 이미 없어진 worktree·ref를 추측해 완료로 판정하지
않는다.

## 중단 조건

- 인증·권한 실패, 일반 PR·OPEN finalize의 `main` 직접 작업,
  선점·브랜치·이슈 불일치. `merged-recovery`의 clean `main` cwd 재진입은
  이 중단 조건의 예외다.
- 더러운 작업 트리, 범위 밖 변경, 빈 커밋 범위, 중복 PR
- 원격 `main`과 충돌하거나 뒤처진 상태
- 실패한 필수 검증, 문서 영향 미판정, Ready 계약 위반
- push나 PR 쓰기 뒤 재조회 결과 불일치
- stale head·독립 리뷰 snapshot, 실패·대기 required CI, 미해결 review
  thread, 불완전한 thread page, Draft·base·source·종료 참조·mergeability
  불일치
- 병합 결과나 canonical origin·원격 branch 삭제를 확정할 수 없는 상태
- `complete` 실패, dirty·사용자 소유 변경, exact verified sealed generation과
  mutable root quarantine으로 보존할 수 없는 `.omc` 또는 정확히 식별할 수 없는 local
  worktree·branch·archive receipt
