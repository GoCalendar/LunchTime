# LunchTime 커밋 계약

이 문서는 `commit-work-item`이 스테이징과 커밋을 수행할 때 적용할 상세
계약이다. 저장소의 현재 `AGENTS.md`, 작업 이슈와 `run-github-work-item`의
선점 기록이 더 구체적인 값을 제공하면 그 값을 사용한다.

## 1. 브랜치와 작업 이슈

- `main`을 통합 브랜치로 사용하는 Trunk-Based Development를 따른다.
- `main`에는 직접 커밋하지 않는다. 이슈 하나마다 짧은 수명의 브랜치와 PR을
  사용하고, 장기 `develop`·`release` 브랜치를 만들거나 경유하지 않는다.
- 브랜치 이름은 `CONTRIBUTING.md`와 `run-github-work-item start`의 선점
  기록을 기준으로 판단한다. 이 문서에서 별도 형식을 만들지 않는다.
- 이 스킬은 브랜치를 만들거나 전환하지 않는다. 현재 브랜치가 `main`이거나
  선점 기록과 다르면 중단한다.
- 이슈 본문의 안정적인 작업 키 또는 `.github/mvp-work-items.json`의 `key`에서
  `LT-NNN`을 확인한다. GitHub 이슈 번호를 세 자리로 변환해 작업 키를 만들지
  않는다.
- 이슈의 목표, 완료 조건, 추적성, 변경 허용 경로, 변경 금지 경로, 검증과
  문서 영향을 커밋 판단의 입력으로 사용한다.

시작할 때 다음 읽기 전용 명령으로 로컬 상태를 확인한다.

```bash
git branch --show-current
git status --short --branch
git diff --name-status
git diff --cached --name-status
git ls-files --others --exclude-standard
```

선점 정보가 없거나 이슈 상태·현재 브랜치·작업 키를 연결할 수 없으면
추측하지 말고 중단한다.

## 2. 원자적 변경 범위

하나의 커밋은 다음 조건을 모두 만족해야 한다.

- 이슈의 목표에서 설명한 관찰 가능한 결과 하나를 만든다.
- 이슈의 변경 허용 경로 안에 있고 변경 금지 경로를 침범하지 않는다.
- 코드, 테스트와 필요한 정본 문서가 함께 일관된 상태가 된다.
- 독립적으로 되돌렸을 때 다른 결과를 불완전하게 만들지 않는다.
- 작업과 무관한 정리, 포맷 변경, 개인 설정 또는 다른 이슈의 결과를 포함하지
  않는다.

서로 독립적인 결과가 섞였으면 경로와 이유를 제시해 분리를 제안한다. 사용자의
결정 없이 여러 결과를 한 커밋으로 묶지 않는다.

## 3. 사용자 변경과 로컬 파일 보호

다음 항목은 작업 이슈가 명시적으로 소유하고 변경 의도가 확인된 경우가 아니면
커밋하지 않는다.

- 작업 시작 전부터 존재한 수정과 미추적 파일
- 다른 작업자나 다른 이슈가 만든 변경
- IDE·OS 생성 파일과 개인 도구 설정
- 로컬 실행을 위한 임시 설정, 자격 증명과 환경별 값
- 개인 데이터, 내부 네트워크 식별자와 로컬 절대 경로

저장소 `.gitignore`는 `.omc`, OS 메타데이터와 명백한 편집기·IDE 개인 상태가
일반 `git add`와 작업 트리 상태에 섞이지 않게 한다. ignore는 `git add -f`나
이미 index에 들어온 경로에는 효력이 없으므로 커밋 안전 gate로 간주하지 않는다.
공유 가능한 `.vscode` 설정과 JetBrains 코드 스타일·실행 설정까지 디렉터리
단위로 숨기지 않는다.

이미 index에 다른 작업의 변경이 있으면 `git restore --staged`, `git reset`
등으로 임의 해제하지 않는다. 선택한 파일에 사용자 변경과 이슈 변경이 함께
있어 안전하게 분리할 수 없으면 파일 전체를 스테이징하지 말고 중단한다.

## 4. 제품 문서 영향

커밋 전에 `update-product-docs`의 구현 영향 확인 절차로 다음을 판정한다.

- PRD: 사용자에게 보이는 기능, 흐름, 입력·출력, 범위, 제약과 수용 동작
- 정책: 생명주기, 상태, 권한, 검증, 충돌, 실패, 복구, 동기화, 보존,
  암호화와 신뢰 경계
- Architecture: 앱 구성요소, 통신·프로토콜, 복제·정합성·복구, 저장·보안
  구조와 구현 경계
- 제품 정의: 승인된 결정, 근거, 가정과 미결정 질문

문서 변경이 필요하면 코드와 관련 정본을 같은 원자적 결과에 포함한다. 필요한
문서가 이슈의 변경 허용 경로 밖이거나 변경 금지 경로에 있으면 정본을
무단으로 수정하거나 생략하거나 tooling-only 비적용을 승인하지 않는다. 별도
제품 계약 이슈로 차단하고 그 정본 변경이 끝난 새 기준에서 의미 영향을 다시
판정한다. 문서 변경이 불필요하면 제품·정책·아키텍처 계약이 달라지지 않는
구체적인 이유를 기록한다.

## 5. 검증 증거

candidate와 commit은 다음 순서로 만든다.

1. 구현 중에는 이슈별 행동 테스트와 필요한 국소 회귀 테스트만 빠르게
   수행한다. 현재 `AGENTS.md` 고정 게이트 전체를 바뀔 snapshot에 반복하지
   않는다.
2. `update-product-docs`로 PRD·Policy·Architecture 의미 영향 판정과 변경
   허용·금지 경로 guard를 독립 리뷰 전에 끝낸다.
3. 진입 전에 index가 비어 있음을 확인하고, 이슈가 소유한 explicit path만
   명시적으로 stage한다. unstaged tracked 변경과 예상하지 않은 untracked
   입력이 없는 상태에서 base OID, cached diff digest, candidate tree OID와
   filesystem input 상태를 candidate identity로 고정한다.
4. 작성 컨텍스트와 분리된 읽기 전용 reviewer가 같은 cached diff·candidate
   tree, 원본 요구사항, 행동 테스트와 의미 영향 결과를 독립 리뷰한다.
5. 같은 snapshot의 발견 사항을 모아 저장소 고정 게이트 전체를 실행하지 않고
   일괄 수정한다. 수정하면 행동 테스트와 의미 영향 판정을 갱신하고 다시
   stage한 새 candidate만 리뷰한다.
6. 더 이상 계획된 수정이 없을 때 이슈 `검증`과 현재 `AGENTS.md` 고정 게이트
   전체의 중복 제거된 합집합을 같은 filesystem에서 한 번 실행한다.
7. 게이트 전후 candidate tree·filesystem input이 같고 모든 결과가
   통과한 경우에만 같은 staged tree를 commit한다.
8. commit tree와 이후 PR head tree가 candidate tree와 같을 때만 완전한 로컬
   증거를 재실행 없이 인계한다. 원격 required CI는 생략하지 않는다.

candidate identity와 최종 증거에는 base OID, cached diff digest, candidate
tree OID, unstaged tracked·untracked input 상태, review pass와 검토자
수·관점·P0~P2 결과, 실행한 gate 집합·명령·종료 상태, 검증 전후 tree·input,
commit tree OID를 기록한다. PR 단계에서는 PR head tree OID를 같은 연속
증거에 추가한다.

독립 리뷰는 작성 컨텍스트와 분리된 읽기 전용 검토자가 수행한다. 작성자의
자기 검토는 독립 리뷰가 아니며, 작성·수정자와 최종 승인자를 분리한다. 의도한
답이나 예상 결론을 주입하지 않고 검토자는 직접 수정하지 않으며 P0~P2 발견
사항을 파일 위치와 재현 근거로 보고한다.

- 낮은 위험의 단순 변경은 최소 1명이 검토한다.
- 계약·validator·workflow 변경은 최소 2명이 검토한다.
- 분산 통신·정합성·보안 같은 고위험 변경은 필요한 전문 관점별 검토자를
  병렬 배치한다.
- 같은 snapshot의 reviewer는 가능하면 병렬로 시작하고 모두 끝난 뒤 발견
  사항을 합류시킨다.
- 수정하면 새 cached diff·candidate tree를 별도 독립 리뷰 패스에 제공한다.
- 최초 리뷰를 1회로 세어 review-fix cycle은 최대 3회다. 3회 뒤에도 P0/P1이
  남으면 최종 게이트와 commit을 진행하지 않고 blocker로 보고한다.

최종 게이트는 같은 candidate를 읽되 입력·출력이 격리된 읽기 전용 명령만
병렬 실행한다. 같은 index·working tree·외부 상태·공유 cache·자원을 쓰거나
자원 경합으로 더 느려지는 명령은 순차 실행하며, 모든 결과를 barrier에서
join한 뒤 한 번에 판정한다. 게이트 일부가 먼저 통과해도 전체 결론을 앞당기지
않는다.

- tracked content를 수정하면 행동 테스트·의미 영향·리뷰·게이트 증거를 모두
  무효화하고 새 candidate의 필요한 빠른 행동 테스트를 다시 수행한 뒤 의미
  영향 판정과 독립 리뷰부터 다시 시작한다.
- 환경만 복구되고 candidate tree와 input이 같으면 실패 원인과 동일성 근거를
  남기고 실패한 새 명령을 한 번만 실행한다. 자동 반복하지 않는다.
- 의미 영향·독립 리뷰 증거가 불완전하지만 candidate tree와 input이 같으면
  같은 candidate의 의미 영향 판정과 새 독립 리뷰부터 복구한 뒤 최종 게이트로
  진행한다.
- 최종 gate 증거만 불완전하고 candidate tree와 input이 같으면 동일한 clean
  snapshot에서 현재 고정 게이트 전체를 새로 실행한다.
- candidate tree나 input이 다르면 기존 로컬 증거를 모두 무효화하고 새
  candidate의 필요한 빠른 행동 테스트, 의미 영향 판정과 독립 리뷰부터 다시
  시작한다.

명령, 종료 상태, 테스트 수, 수동 확인 결과와 CI URL처럼 실제로 확보한
증거만 기록한다. 실행하지 않은 검증을 통과로 표시하거나 tree·input이 다른
작업의 결과를 재사용하지 않는다.

## 6. 안전한 스테이징

독립 리뷰용 candidate를 고정할 때 스테이징할 개별 파일을 먼저 목록으로
확정한 뒤 저장소 상대 경로를 명시한다. 스킬 진입 전에 index에 다른 작업의
변경이 있으면 임의로 해제하지 않고 중단하며, 이후에는 이 스킬이 고정한 exact
candidate만 staged 상태로 허용한다.

```bash
git add -- path/to/file-a path/to/file-b
```

공백이 있는 경로는 셸에서 하나의 인자로 전달되도록 인용한다. 다음 방식은
사용하지 않는다.

```text
git add .
git add -A
git add --all
git add <directory>
git add <glob>
git commit -a
```

스테이징 뒤 다음 명령으로 index 전체를 검토한다.

```bash
git diff --cached --name-status
git diff --cached --stat
git diff --cached
node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs --index
git diff --cached --check
```

commit path gate는 staged diff만이 아니라 `git ls-files --cached -z`로 전체
index를 검사한다. 따라서 ignore를 강제로 우회했거나 이전 commit에 들어간
`.omc` 경로 구성요소, `.DS_Store`, AppleDouble `._*`, `Thumbs.db`,
`Desktop.ini`, 편집기 swap·backup과 명백한 JetBrains 개인 상태도 차단한다.
금지 경로의 삭제가 stage되어 index에서 사라진 정리 commit은 허용한다.

예상하지 않은 경로, 이슈 범위 밖 hunk, 비밀, 개인 정보, 로컬 절대 경로,
개인 설정, commit path gate 실패 또는 우발적 바이너리가 있으면 커밋하지
않는다. 실패한 경로를 자동 삭제하거나 unstage하지 않고 현재 index와 이유를
보고한다.

## 7. 커밋 메시지

작업 키가 있는 이슈는 첫 번째 형식, 작업 키가 없는 일반 이슈는 두 번째
형식을 사용한다.

```text
<type>: LT-NNN - <관찰 가능한 결과>
<type>: #<GitHub 이슈 번호> - <관찰 가능한 결과>
```

`LT-NNN`은 현재 이슈의 작업 키를 사용한다. 결과는 파일을 수정했다는 표현보다
사용자·시스템·개발 흐름에 생긴 결과를 한국어 중심으로 요약한다.
GitHub 이슈 번호를 변형해 `LT-NNN`을 만들지 않는다. 제목은 72자 이하로
작성한다.

변경 성격에 따라 다음 type을 사용한다.

| type | 사용 기준 |
|------|-----------|
| `feat` | 새 제품 기능이나 관찰 가능한 동작 추가 |
| `fix` | 의도와 다른 동작 또는 결함 수정 |
| `refactor` | 관찰 가능한 동작을 바꾸지 않는 구조 개선 |
| `test` | 테스트와 검증 체계가 주된 결과 |
| `docs` | 문서만 변경 |
| `chore` | 빌드, 설정, 자동화와 유지보수 |
| `spike` | 재현 가능한 기술 검증과 의사결정 증거 |

맥락이 필요한 커밋에는 제목 뒤 빈 줄 하나와 다음 본문을 사용한다.

```text
- 맥락: 이 결과가 필요한 이유
- 변경: 핵심 동작과 중요한 경계
- 추적성: PRD·POL·D·F ID
- 검증: 실제 통과한 명령과 결과
- 문서 영향: 갱신한 정본 또는 변경 불필요 근거
```

본문도 한국어를 기본으로 작성하되 ID, 경로, 명령, 코드 식별자, 기술 용어와
제품·플랫폼 고유명사는 원문을 사용할 수 있다. `Co-Authored-By` 트레일러와
AI 공동 작성 표식을 넣지 않는다.

작성한 메시지는 커밋 전에 검증한다.

```bash
node .agents/skills/commit-work-item/scripts/validate-commit-message.mjs \
  --file <commit-message-file>
```

CI에서는 PR의 전체 커밋 범위를 같은 계약으로 검증한다.

```bash
node .agents/skills/commit-work-item/scripts/validate-commit-message.mjs \
  --range <base>..<head>
```

## 8. 작성자·커미터와 hook

커밋 전에 Git이 현재 저장소에서 해석하는 `user.name`과 `user.email`이 모두
설정되어 있는지 무출력 검사로 확인한다.

```bash
test -n "$(git config --get user.name)"
test -n "$(git config --get user.email)"
```

다음 방식으로 신원을 덮어쓰지 않는다.

- `git commit --author`
- `GIT_AUTHOR_*` 또는 `GIT_COMMITTER_*` 환경 변수
- 이 작업을 위한 `git config` 변경
- tracked 파일에 개인 이름, 이메일 또는 계정 ID 기록

일반 `git commit`을 사용해 활성 `pre-commit`, `prepare-commit-msg`,
`commit-msg` 등 Git hook이 실행되게 한다. `--no-verify`로 hook을 우회하지
않는다. 활성 hook이 실패하면 커밋 결과를 만들기 위해 우회하지 말고 중단한다.
스킬은 hook을 설치하거나 개인 신원 정책을 tracked 파일로 만들지 않는다.

## 9. 커밋 후 검증

커밋이 성공하면 즉시 다음 항목을 확인한다.

```bash
git show -s --format='%H%n%s%n%b' HEAD
git rev-parse HEAD^{tree}
git diff-tree --no-commit-id --name-status -r HEAD
git status --short --branch
```

- 제목과 본문이 메시지 계약을 지키고 `Co-Authored-By`가 없는지 확인한다.
- Author와 Committer가 커밋 전에 확인한 로컬 Git 신원과 일치하는지는 값을
  출력하지 않고 비교하며, 결과 보고에는 일치 여부만 남긴다.
- 커밋 경로가 검토한 explicit path 목록과 이슈 경로 계약에 맞는지 확인한다.
- `HEAD^{tree}`가 review·verification candidate tree와 정확히 같은지
  확인한다. 같으면 candidate에서 통과한 commit path gate 증거를 재사용하고
  이 gate와 다른 고정 게이트를 다시 실행하지 않는다.
- 남은 변경과 미추적 파일이 커밋 전 사용자 상태를 침범하지 않았는지 확인한다.

검증이 실패하면 자동으로 `git commit --amend`, reset 또는 새 커밋을 실행하지
않는다. 현재 해시와 불일치를 보고하고 사용자의 결정을 기다린다. 이 스킬은
어떤 경우에도 `git push`를 실행하지 않는다.

## 10. 결과 보고

다음 항목을 빠짐없이 보고한다.

```text
커밋
- 이슈: LT-NNN 또는 #이슈 번호
- 브랜치: 현재 짧은 수명 브랜치
- 커밋: 해시와 제목
- 포함 경로: 명시적으로 스테이징한 파일
- 제외 경로: 사용자 변경과 제외 이유
- 검증: gate 집합, 통과한 명령·결과와 전후 input 동일성
- 정본 의미 영향: PRD·Policy·Architecture 변경 또는 변경 불필요 근거
- 독립 리뷰: cached diff·candidate tree, 검토자 수·관점, P0~P2 발견·해소 결과
- tree 결속: base·candidate·commit tree와 증거 재사용 판정
- 신원·hook: 값이 아닌 로컬 설정 일치 여부와 hook 결과
- 남은 변경: tracked·untracked 상태
- push: 실행하지 않음
```
