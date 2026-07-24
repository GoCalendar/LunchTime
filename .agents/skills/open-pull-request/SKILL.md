---
name: open-pull-request
description: LunchTime 이슈 브랜치의 전체 변경을 검증하고 다음 AI가 대화 이력 없이 해석할 수 있는 고정 계약의 Draft 또는 Ready GitHub PR을 생성·갱신한다. PR을 열거나 작성하거나 갱신할 때, Draft를 Ready로 바꿀 때, PR 제목·본문·템플릿을 검증할 때 사용한다.
---

# Pull Request 열기

PR은 이슈의 내용을 복제하는 보고서가 아니라 구현 결과와 검증 근거를 넘기는
인계 문서다. 시작 전에 [PR 본문 계약](references/pr-body-contract.md)을
끝까지 읽고 `.github/PULL_REQUEST_TEMPLATE.md`를 사용한다.

## 책임 경계

- 이 스킬은 최종 비교, 검증, push, PR 생성·갱신과 사후 재조회만 수행한다.
- 변경을 스테이징하거나 커밋·amend·rebase·merge하지 않는다.
- 이슈와 Project의 완료 처리는 병합 뒤 `run-github-work-item complete`가
  담당한다.
- 실패한 쓰기를 자동 반복하지 않는다. 상태를 다시 읽고 원인을 확인한 뒤에만
  별도의 새 실행으로 재개한다.

## 1. 진입 조건 확인

다음 상태를 읽는다.

```bash
gh auth status
gh api user --jq .login
gh repo view --json nameWithOwner,defaultBranchRef
git branch --show-current
git status --porcelain=v1
git remote get-url origin >/dev/null
```

다음을 모두 만족하지 않으면 GitHub에 쓰지 않는다.

1. 현재 `gh` 계정에 저장소 쓰기 권한이 있고 기본 브랜치가 `main`이다.
2. 현재 브랜치는 `main`이 아니며 `CONTRIBUTING.md`, 작업 관리 설정과
   `run-github-work-item start`의 선점 기록이 모두 일치한다.
3. 이슈가 열려 있고 현재 계정에 할당되어 있다.
4. 작업 트리에 수정·스테이징·미추적 파일이 없다.
5. 브랜치에는 현재 이슈의 단일 목적만 있다.

원격 상태와 전체 변경을 한 번 갱신해 확인한다.

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
git diff --check origin/main...HEAD
```

커밋 범위에는 `commit-work-item`의 메시지 validator를 실행한다. 브랜치가
원격 `main`보다 뒤처졌거나 충돌하면 자동 rebase하지 않고 중단한다.

## 2. 중복 PR과 문서 영향 확인

열린 PR을 제한된 한 번의 조회로 확인한다.

- 같은 head 브랜치의 열린 PR
- 같은 이슈를 `Closes #N`으로 닫는 열린 PR
- 같은 브랜치를 사용했던 닫힌 PR 또는 병합된 PR

같은 head의 열린 PR 하나만 있으면 새 PR을 만들지 않고 그 PR을 갱신한다.
후보가 둘 이상이거나 다른 브랜치가 같은 이슈를 닫고 있으면 중단한다. 닫힌
브랜치를 새 작업에 재사용하지 않는다.

`update-product-docs`로 PRD·정책·제품 정의 영향을 판정한다. 정본끼리
충돌하거나 제품 결정이 없으면 Ready PR을 만들지 않는다.

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
  재구성할 수 있는 증거가 필요하다.

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
  --body <body-file> --title "<title>" --issue <number> --branch <branch>
```

두 번째 명령은 Draft, 세 번째 명령은 Ready에 사용한다.

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

최종 보고에는 PR 링크와 상태, base/head, 종료 이슈·작업 키, 검증 증거, 문서
영향 판정, 남은 실패·미실행 항목을 포함한다. 인증 정보, 신원 값과 로컬 절대
경로는 보고하지 않는다.

## 중단 조건

- 인증·권한 실패, `main` 직접 작업, 선점·브랜치·이슈 불일치
- 더러운 작업 트리, 범위 밖 변경, 빈 커밋 범위, 중복 PR
- 원격 `main`과 충돌하거나 뒤처진 상태
- 실패한 필수 검증, 문서 영향 미판정, Ready 계약 위반
- push나 PR 쓰기 뒤 재조회 결과 불일치
