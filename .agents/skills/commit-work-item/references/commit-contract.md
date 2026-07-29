# LunchTime 커밋 계약

이 문서는 `commit-work-item`의 stage와 commit 안전을 소유합니다. 테스트 선택,
제품 문서 작성과 PR 수명주기는 각 owner를 링크하고 여기서 복제하지 않습니다.

## 1. 입력과 중단 조건

기본 입력은 다음뿐입니다.

- 현재 GitHub 이슈의 목표, 완료 조건, 추적성, 허용·금지 경로, 검증과 문서
  영향
- `run-github-work-item start`가 기록한 branch
- 전체 local status와 의도한 diff
- 이슈가 지정한 exact PRD·Policy·Architecture context
- 관련 테스트 결과, 제품 문서 영향과 한 번의 review round 결과

`README.md`, `AGENTS.md`, `CONTRIBUTING.md` 전체, 관련 없는 Skill과
`docs/product-definition/**`을 commit 준비를 위해 읽지 않습니다. 이슈 입력이
부족하거나 정본이 충돌하면 탐색을 넓혀 추측하지 않고 중단합니다.

다음 중 하나면 commit하지 않습니다.

- 현재 branch가 `main`이거나 선점 branch와 다릅니다.
- 이슈 목표와 독립적으로 되돌릴 수 없는 여러 결과가 섞였습니다.
- 변경이 허용 경로 밖이거나 금지 경로를 침범합니다.
- 사용자 소유 변경과 이슈 변경을 안전하게 분리할 수 없습니다.
- 필요한 관련 테스트, 제품 문서 영향 또는 review 결과가 없습니다.
- Review finding 수정이 범위·요구사항·아키텍처·신뢰 경계를 넓혀야 합니다.

## 2. Branch와 작업 상태

Trunk-Based Development를 따르며 `main`에는 직접 commit하지 않습니다.
Branch 형식과 선점 기록은 `CONTRIBUTING.md`와 `run-github-work-item`이
소유합니다. 이 Skill은 branch를 만들거나 전환하지 않습니다.

시작할 때 읽기 전용으로 확인합니다.

```bash
git branch --show-current
git status --short --branch
git diff --name-status
git diff --cached --name-status
git ls-files --others --exclude-standard
```

기존 index가 비어 있지 않으면 그 변경을 reset, unstage, stash하거나
덮어쓰지 않습니다. 경로와 상태를 보고하고 중단합니다.

## 3. 원자적 범위와 사용자 상태 보호

하나의 commit은 다음을 만족해야 합니다.

- 이슈 목표의 관찰 가능한 결과 하나를 만듭니다.
- 코드, 직접 관련 테스트와 필요한 정본이 함께 일관됩니다.
- 독립적으로 되돌려도 다른 결과를 불완전하게 만들지 않습니다.
- 작업과 무관한 정리, formatting, 개인 설정과 다른 이슈 결과를 포함하지
  않습니다.

다음 항목은 이슈가 정확히 소유하고 변경 의도가 확인된 경우가 아니면
stage하지 않습니다.

- 작업 시작 전부터 존재한 변경과 untracked 파일
- 다른 작업자·이슈의 변경
- IDE·OS 생성 파일과 개인 도구 설정
- 임시 설정, 자격 증명과 환경별 값
- 개인 데이터, 내부 네트워크 식별자와 로컬 절대 경로

`.gitignore`는 안전 gate가 아닙니다. 강제 추가된 ignored 파일과 이미
tracked된 개인 잔여물은 index 검사에서 별도로 차단합니다. 같은 파일 안에
사용자 hunk와 이슈 hunk가 섞여 신뢰성 있게 분리할 수 없으면 파일 전체를
stage하지 않습니다.

## 4. Commit 전 검증

### 관련 테스트

[테스트 표준](../../../../docs/development/02_testing_standard.md)의 순서를
사용합니다.

`direct case/suite → affected target → affected subsystem → global`

가장 좁고 충분한 test를 실행합니다. Global은 영향 불명, 공유 build·dependency·
toolchain 경계 또는 명시적 release 검증의 예외입니다. 문서만 바뀌면 앱
test를 실행하지 않고, 하네스 변경은 해당 owner validator·direct test를
선택합니다.

증거에는 검증한 행동, 선택 범위와 이유, 명령, 종료 결과와 test 수만
기록합니다. 회귀군 ledger, command digest와 tree별 evidence JSON은 요구하지
않습니다.

### 제품 문서 영향

이슈가 지정한 관련 정본과 diff만
[`update-product-docs`](../../update-product-docs/SKILL.md)로 대조합니다.

- 사용자 결과·수용 동작은 PRD
- 상태·권한·실패·복구·보존·보안은 Policy
- 구성요소·protocol·저장·통신 경계는 Architecture

영향이 있으면 이슈가 소유한 정본을 같은 결과에 포함합니다. 필요한 정본이
범위 밖이면 현재 이슈를 넓히지 않고 blocker 또는 후속 이슈로 분리합니다.
역사 archive는 영향 판정 대상이 아닙니다.

### 한 번의 review round

[AGENTS.md](../../../../AGENTS.md#독립-리뷰)의 위험도를 사용합니다.

| 위험 | reviewer |
|---|---|
| 낮음 | 0명 허용 |
| 일반 | 읽기 전용 1명 |
| 높음 — 보안·데이터 손실·분산 정합성·권한 경계·동시성·파괴적 변경 | 같은 round에서 전문 관점 최대 2명 |

Reviewer는 원본 요구사항, 관련 exact 정본, 전체 intended diff와 실제 관련
test 결과를 보고 P0~P2 finding과 근거를 반환합니다. Reviewer가 직접
수정하지 않습니다.

메인 세션은 같은 round의 finding을 모두 모아 타당성을 판단하고 수용한
항목을 한 번에 수정합니다. 각 finding은 수정 diff와 직접 관련 test 결과로
closure를 확인합니다. Reviewer를 다시 호출하거나 delta review chain을
만들지 않습니다.

수정이 이슈 범위, 원본 요구사항, Architecture 또는 trust boundary를
넓혀야 한다면 현재 candidate에 포함하지 않습니다. Blocker 또는 후속 이슈로
분리하고 새 범위는 새 작업에서 검토합니다.

## 5. 안전한 staging

검토한 개별 파일을 목록으로 확정한 뒤 명시적으로 stage합니다.

```bash
git add -- path/to/file-a path/to/file-b
```

다음 방식은 금지합니다.

```text
git add .
git add -A
git add --all
git add <directory>
git add <glob>
git commit -a
```

Stage 뒤 index 전체를 확인합니다.

```bash
git diff --cached --name-status
git diff --cached --stat
git diff --cached
node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs --index
git diff --cached --check
git write-tree
```

`validate-commit-paths`는 전체 index를 검사해 `.omc`, `.DS_Store`,
AppleDouble `._*`, `Thumbs.db`, `Desktop.ini`, editor swap·backup과 명백한
JetBrains 개인 상태를 차단합니다. 금지 경로 삭제가 stage되어 index에서
사라지는 정리 commit은 허용합니다.

예상하지 않은 경로, 범위 밖 hunk, 비밀, 개인 정보, 로컬 절대 경로, 개인
설정, 우발적 binary 또는 path gate 실패가 있으면 commit하지 않습니다.
파일을 자동 삭제·unstage하지 않고 현재 index와 이유를 보고합니다.

`git write-tree` 결과를 최종 candidate tree로 기록합니다. 별도의 base→delta
lineage나 evidence helper는 사용하지 않습니다.

## 6. 조건부 validator

모든 staged candidate에 공통 D0 묶음을 실행하지 않습니다.

| 대상 | 실행 시점 |
|---|---|
| `validate-commit-paths --index`, `git diff --cached --check` | commit할 최종 index |
| 제품 문서 validator | PRD·Policy 또는 그 validator 변경 |
| work item validator·bootstrap test | 이슈 본문·manifest 또는 해당 owner 구현 변경 |
| PR body validator | PR 본문 작성·갱신 단계 |
| 앱 test | 앱 동작 또는 affected target 변경 |

Validator 구현을 바꾸면 그 validator의 direct test suite를 실행합니다. 공유
parser·classifier로 영향을 한정할 수 없을 때만 subsystem 또는 global로
확대합니다. Review 전·후 모든 validator를 관성적으로 반복하지 않습니다.

Finding 수정 뒤에는 수정한 동작의 direct test와 새로 영향받은 조건부
validator만 실행합니다. 같은 candidate의 이미 통과한 관련 없는 test는
반복하지 않습니다.

## 7. Commit 메시지

작업 키가 있는 이슈는 첫 형식, 없는 일반 이슈는 두 번째 형식을 사용합니다.

```text
<type>: LT-NNN - <관찰 가능한 결과>
<type>: #<GitHub 이슈 번호> - <관찰 가능한 결과>
```

`LT-NNN`은 이슈의 실제 작업 키입니다. GitHub 이슈 번호를 변환해 만들지
않습니다. 제목은 72자 이하이며 결과 중심으로 씁니다.

| type | 기준 |
|---|---|
| `feat` | 새 제품 기능 |
| `fix` | 의도와 다른 동작 수정 |
| `refactor` | 동작을 바꾸지 않는 구조 개선 |
| `test` | 테스트·검증이 주된 결과 |
| `docs` | 문서만 변경 |
| `chore` | 빌드·설정·자동화·유지보수 |
| `spike` | 재현 가능한 기술 검증 |

필요한 경우 본문에 맥락, 핵심 변경, 추적성, 실제 관련 test와 문서 영향을
간결하게 적습니다. `Co-Authored-By`와 AI 공동 작성 표식을 넣지 않습니다.

```bash
node .agents/skills/commit-work-item/scripts/validate-commit-message.mjs \
  --file <commit-message-file>
```

## 8. 신원과 hook

현재 저장소에서 Git이 해석한 `user.name`과 `user.email`이 설정됐는지만
무출력 확인합니다. 값을 보고서나 tracked 파일에 남기지 않습니다.

다음 방식으로 신원을 덮어쓰지 않습니다.

- `git commit --author`
- `GIT_AUTHOR_*`, `GIT_COMMITTER_*`
- 이 작업을 위한 `git config` 변경

일반 `git commit`을 사용하고 활성 hook을 `--no-verify`로 우회하지 않습니다.
Hook 실패를 자동 retry하거나 우회하지 않습니다.

## 9. Commit 후 확인

```bash
git show -s --format='%H%n%s%n%b' HEAD
git rev-parse HEAD^{tree}
git diff-tree --no-commit-id --name-status -r HEAD
git status --short --branch
```

- 메시지와 포함 경로를 다시 검증합니다.
- `HEAD^{tree}`가 최종 candidate tree와 같은지 확인합니다.
- Author·Committer가 사전 확인한 local identity와 일치하는지는 값을
  출력하지 않고 비교합니다.
- 남은 사용자 변경과 untracked 파일을 수정하지 않습니다.

실패하면 자동 amend, reset 또는 새 commit을 실행하지 않습니다. 이 Skill은
push하지 않습니다. PR Skill이 current branch·commit을 다시 확인하고
base와 head가 같은 저장소인 PR만 게시·완료합니다.

## 10. 결과 보고

```text
커밋
- 이슈·branch·commit:
- 포함·제외 경로:
- 관련 테스트: 선택 범위·이유·명령·결과
- 제품 문서 영향:
- review: 위험도·reviewer 수·finding과 closure
- staging: index path·공백 검사
- tree: candidate와 commit 일치
- 신원·hook: 값이 아닌 일치와 결과
- 남은 변경:
- push: 실행하지 않음
```
