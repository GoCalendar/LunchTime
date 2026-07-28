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

<!-- local-gate-evidence-contract {"version":1,"d0":"pre-review","selection":"base-to-candidate","invalidation":"previous-to-candidate","unchangedPass":"retain","changedSelected":"rerun","notSelected":"drop","pending":"continue","ambiguous":"fail-closed"} -->

### 5.1 Candidate와 review chain

candidate identity에는 base commit OID, 전체 cached diff digest,
`git write-tree`의 candidate tree OID, unstaged tracked·예상하지 않은
untracked 입력 상태를 기록한다. 수정 candidate는 이전 identity와
이전→현재 staged delta digest도 연결한다. 명시적으로 stage해 candidate를
고정한 직후 evidence helper가 current index의 tree와 clean 상태를 JSON에
결속하고, [빠른 공통 gate](#52-빠른-공통-gate)를 독립 리뷰 전에 실행한다.
D0가 수정 필요를 발견하면 다시 stage·고정·D0한 뒤 첫 리뷰 또는 다음 delta
review를 시작하므로 review pass를 소비하지 않는다.

최초 candidate는 D0를 통과한 뒤 작성 컨텍스트와 분리된 읽기 전용 reviewer가
원본 요구사항, 전체 cached diff·candidate tree, 행동 테스트와 의미 영향
결과를 검토한다. 같은 snapshot의 발견 사항은 합쳐 수정하고 즉시 명시적으로
stage한다. exact previous evidence JSON을 소비한 delta evidence와 D0를 먼저
갱신한 뒤 필요한 행동 테스트와 PRD·Policy·Architecture 의미 영향 판정을
갱신한다. 다음 review pass에는 다음 입력을 모두 제공한다.

- 이전·현재 base OID와 candidate tree OID
- exact previous·current evidence JSON
- 이전→현재 staged delta
- 현재 candidate의 전체 cached diff
- 갱신한 행동 테스트와 의미 영향 결과

최초 전체 리뷰와 끊기지 않은 delta review chain이 최종 candidate의 모든
변경을 덮으면 최종 candidate를 review tree로 결속할 수 있다. 다음 중 하나면
delta review만으로 승인하지 않고 현재 전체 candidate를 새로 리뷰한다.

- 이슈 범위, 원본 요구사항 또는 보안 경계가 넓어졌다.
- 이전→현재 delta나 review pass가 누락됐다.
- base·tree 연결 또는 delta의 출처가 모호하다.
- reviewer가 현재 전체 cached diff와 delta의 상호작용을 확정할 수 없다.

낮은 위험은 최소 1명, 계약·validator·workflow 변경은 최소 2명, 분산
통신·정합성·보안 같은 고위험 변경은 필요한 전문 관점별 reviewer를
배치한다. 최초 리뷰를 1회로 세어 review-fix cycle은 최대 3회다. 3회 뒤에도
P0/P1이 남으면 최종 gate와 commit을 진행하지 않고 blocker로 보고한다.

### 5.2 빠른 공통 gate

다음 빠른 공통 gate는 최초 candidate와 모든 수정 candidate를 명시적으로
stage·고정한 직후, 최초 전체 리뷰나 delta review보다 먼저 항상 실행한다.

```bash
node .agents/skills/update-product-docs/scripts/validate-product-docs.mjs
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs validate
node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs --index
node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs --template .github/PULL_REQUEST_TEMPLATE.md
git diff --cached --check
```

마지막 명령은 working tree가 아니라 실제 staged candidate의 공백 오류를
검사한다. 빠른 공통 gate는 회귀군 분류 결과나 이전 통과 증거로 생략하지
않는다. 리뷰와 무거운 회귀군 실행 동안 candidate tree와 index·clean 상태가
그대로면 D0 증거를 최종 증거로 유지하며 commit 직전에 반복하지 않는다.

### 5.3 무거운 회귀군

무거운 gate는 다음 네 회귀군으로 고정한다. 괄호 안은 helper의 group ID이며
앞의 이름은 CI job ID다.

- `product-docs-regression` (`productDocsRegression`)

  ```bash
  node --test .agents/skills/update-product-docs/scripts/product-contract-ids.test.mjs
  node --test .agents/skills/update-product-docs/scripts/validate-product-docs.test.mjs
  ```

- `work-item-regression` (`workItemRegression`)

  ```bash
  node --test .agents/skills/run-github-work-item/scripts/work-item.test.mjs
  node --test .agents/skills/run-github-work-item/scripts/bootstrap-mvp.test.mjs
  ```

- `commit-pr-regression` (`commitPrRegression`)

  ```bash
  node --test .agents/skills/commit-work-item/scripts/validate-commit-message.test.mjs
  node --test .agents/skills/commit-work-item/scripts/validate-commit-paths.test.mjs
  node --test .agents/skills/commit-work-item/scripts/validate-gate-evidence.test.mjs
  node --test .agents/skills/open-pull-request/scripts/validate-pr-body.test.mjs
  ```

- `finalize-regression` (`finalizeRegression`)

  ```bash
  node --test .agents/skills/open-pull-request/scripts/validate-finalize.test.mjs
  node --test .agents/skills/open-pull-request/scripts/finalize-merge.test.mjs
  node --test .agents/skills/open-pull-request/scripts/finalize-remote-branch.test.mjs
  node --test .agents/skills/open-pull-request/scripts/finalize-local-cleanup.test.mjs
  ```

D0와 독립 리뷰를 통과한 candidate에서는 evidence JSON이 base→candidate로
계산한 `selectedGroups`만 실행한다. 각 회귀군 안의 명령은 중복 제거하고,
서로 독립된 읽기 전용·격리 회귀군만 병렬 실행한다. 같은 index·working
tree·외부 상태·공유 cache·자원을 쓰는 명령은 순차 실행한 뒤 모든 결과를
barrier에서 join한다.

### 5.4 Gate evidence helper

최초 candidate는 `initial`, 이후 candidate는 exact previous evidence JSON을
입력으로 하는 `delta` 모드를 사용한다. legacy base/tree 인자는 허용하지
않는다.

```bash
node .agents/skills/commit-work-item/scripts/validate-gate-evidence.mjs \
  --mode initial \
  --candidate-base <40-oid> \
  > <initial-evidence-json>
node .agents/skills/commit-work-item/scripts/validate-gate-evidence.mjs \
  --mode delta \
  --candidate-base <40-oid> \
  --previous-evidence <exact-previous-evidence-json> \
  > <delta-evidence-json>
```

helper는 candidate tree 인자를 받지 않고 current `git write-tree`에서
파생한다. unstaged tracked 변경, unmerged entry 또는 예상하지 않은 untracked
입력이 있으면 JSON을 만들지 않는다. `initial`은
`candidate-base^{tree}`를 base·previous tree로 사용한다. `delta`는
`--previous-evidence`의 schema, base/candidate identity, command manifest와
base·previous·candidate projection digest를 다시 계산해 검증한 뒤 그
evidence의 `candidate.tree`를 previous tree로 사용한다. evidence 파일은
저장소 밖의 작업 임시 경로에 두고 index나 untracked 입력에 넣지 않는다.

strict previous evidence가 schema·version, helper decision, command
manifest 또는 base identity 불일치로 거부되면 같은 `delta`를 반복하지
않는다. re-root는 새 mode가 아니라 기존 `initial`만 사용한다.
replace-disabled current HEAD commit을 current base로 검증하고 candidate
base가 그 commit과 같을 때만 re-root한다. current HEAD 또는 candidate base가
unknown·stale이면 중단한다. 검증된 current base가 이전 evidence의 base보다
우선하며, 새 initial evidence에서는 이전 heavy PASS를 모두 폐기하고 current
base→candidate selection만 사용한다. 이 re-root는 gate evidence lineage만
새로 시작한다. raw tree·staged delta를 잇는 review chain은 별도 계약이므로
candidate 범위가 넓어지지 않았고 chain이 완전하면 유지할 수 있으며, re-root
자체만으로 새 전체 리뷰를 강제하지 않는다.

JSON에는 `schema: "lunchtime-gate-evidence"`, `version: 2`, `mode`, `base`,
`previous`, `candidate`, `full`, `failClosed`, `reason`, `diagnostic`,
`selectionPaths`, `invalidationPaths`, `selectedGroups`,
`invalidatedGroups`, `rerunGroups`, `retainGroups`, `dropGroups`와
`groups`를 기록한다. `base`에는 commit·tree, `previous`와 `candidate`에는
base·tree를 둔다. 각 `groups.<camelGroup>`에는 `decision`,
`required`, `invalidated`, `commandManifestDigest`, `baseInputDigest`,
`previousInputDigest`, `candidateInputDigest`, `baseEntryCount`,
`previousEntryCount`, `candidateEntryCount`가 있어야 한다.

`selectionPaths`와 `selectedGroups`는 항상 current base→candidate에서 이번
결과에 필요한 회귀군을 계산한다. `invalidationPaths`와
`invalidatedGroups`는 previous→candidate에서 이전 실행 증거의 입력이
달라졌는지 계산한다. 따라서 delta의 실행 판정은 다음과 같다.

- `selectedGroups ∩ invalidatedGroups`: 완료한 회귀군을 다시 실행한다.
- selected이며 입력이 같은 이전 PASS: `retainGroups`로 유지한다.
- selected이며 아직 완료되지 않은 회귀군: pending을 계속한다.
- current `selectedGroups`에 없는 회귀군: `dropGroups`와
  `decision: not-required`로 이전 증거를 버린다.
- current candidate가 base까지 완전히 revert된 경우: `selectedGroups`가
  비므로 무거운 회귀군을 다시 실행하지 않는다.

tracked input manifest의 정본은
`.github/workflows/validate-harness-paths.mjs`의
`REGRESSION_GROUP_INPUT_RULES`다. 로컬 helper의 group projection과 원격 CI
selection이 같은 규칙을 소비한다. group projection은 해당 규칙으로 선택한
전체 tree entry를 path byte 순서로 정렬한 `mode path object-OID` 항목으로
구성한다. tree diff는 rename 감지를 끄므로 rename의 삭제 경로와 추가 경로를
모두 변경으로 분류한다. 삭제는 previous projection의 entry가 candidate
projection에서 사라진 상태로 비교하며 별도 tombstone을 만들지 않는다.
command manifest digest는 해당 group의 명령과 순서를 결속하며 input
projection digest에도 포함된다.

`LOCAL_EVIDENCE_CONTROL_PATHS`는 로컬 증거 재사용 알고리즘만 제어하는 helper
source·test를 별도로 선언한다. 이 경로가 previous→candidate에서 바뀌면 로컬
`invalidatedGroups`는 네 군 전체지만 current selection은 canonical input
rules에 따라 owning `commitPrRegression`만 선택한다. 따라서 helper-only
변경은 교집합인 commit/PR 회귀군만 실행하고 나머지 이전 증거는
`not-required`로 버린다. 증거를 재사용하지 않는 원격 CI도 같은 canonical
input rules로 owning `commit-pr-regression`만 실행한다.

완료한 회귀군 PASS는 다음 조건을 모두 만족할 때만 다음 candidate에 유지한다.

- 이전 실행이 통과했고 실제 실행 tree와 결과가 기록돼 있다.
- strict previous evidence 검증과 candidate base 일치가 통과했다.
- command manifest digest가 같다.
- 이전 통과 증거의 input projection digest와 현재 candidate digest가 같다.
- 환경과 선언된 외부 입력이 같고 미선언 입력이 없다.
- helper가 `failClosed`가 아니며 현재 selected group을 `retainGroups`로
  판정했다.

유지한 증거도 원래 실행 tree와 digest를 숨기지 않는다. `verification-tree`는
그 증거가 현재 candidate에서 유효하다는 조립된 최종 결론이지, 모든 무거운
회귀군이 그 tree에서 물리적으로 다시 실행됐다는 뜻이 아니다.

### 5.5 실패 수정과 증분 재진입

gate 실패를 발견하면 해당 candidate의 gate 진행을 즉시 중단한다. 새
회귀군을 더 시작하지 않고 실행 중 명령을 안전하게 취소·종료한 뒤 수정한다.
수정 경로만 명시적으로 stage해 새 candidate identity를 만들고 exact previous
evidence를 소비하는 delta JSON과 빠른 공통 gate를 먼저 통과시킨다. D0만의
추가 수정은 delta review 전에 같은 순서로 정리하므로 pass를 소비하지 않는다.
그 뒤 필요한 행동 테스트·의미 영향 판정과 delta review를 수행하고 무거운
회귀군을 재개한다.

- `rerunGroups = selectedGroups ∩ invalidatedGroups`인 완료 회귀군만 다시
  실행한다.
- `retainGroups`의 selected unchanged PASS는 유지한다.
- selected pending은 아직 실행하지 않은 지점부터 계속한다.
- `dropGroups`의 unselected 결과는 최종 증거에서 제거한다.

strict previous evidence가 거부된 경우 같은 delta 입력을 다시 제출하지
않는다. replace-disabled current HEAD commit을 current base로 검증하고
candidate base가 그 commit과 같을 때만 기존 `initial`로 re-root한다. current
HEAD 또는 candidate base가 unknown·stale이면 중단한다. 검증된 current base가
이전 evidence의 base보다 우선하며, 새 initial evidence에서는 이전 heavy
PASS를 모두 폐기하고 current base→candidate selection만 사용한다. raw
tree·staged delta review chain은 별도이므로 candidate 범위가 넓어지지 않았고
chain이 완전하면 그대로 유지한다.

다음 변경이나 drift는 영향 범위를 국소화할 수 없으므로 무거운 회귀군 네
개의 로컬 증거를 모두 invalidated 처리하고, current selection이 전체인
fail-closed 결과에서는 네 군을 모두 다시 실행한다.

- 공유 하네스 계약, 경로 classifier·`REGRESSION_GROUP_INPUT_RULES` 또는
  gate manifest 변경
- 실행 환경 또는 선언된 외부 입력 변경
- 미선언 입력 발견
- tree·input projection을 결정할 수 없거나 helper가 `failClosed`인 경우

helper source·test만 바뀐 경우는 `LOCAL_EVIDENCE_CONTROL_PATHS`에 따라 로컬
네 군을 모두 invalidated 처리하지만 current selection은 owning commit/PR
회귀군뿐이므로 그 교집합만 재실행하고 나머지는 drop한다.

candidate tree와 input이 같은 환경 전용 실패만 원인과 동일성 근거를 남긴
새 명령으로 한 번 재실행할 수 있다. 자동 반복하지 않는다. 의미 영향이나
review chain이 불완전하면 그 판정과 필요한 delta review부터 복구하고,
범위 확대나 chain 공백·모호함이면 새 전체 리뷰를 수행한다.

commit 직전 최종 candidate에는 현재 빠른 공통 gate, 최초 전체 리뷰부터
이어진 review chain, current `selectedGroups` 각 회귀군의 새 실행 또는
유효하게 유지한 PASS가 모두 있어야 하며 pending은 최종 통과해야 한다. 각
증거에는 evidence JSON, 명령, 종료 상태, 테스트 수, 실제 실행 tree, command
manifest와 base·previous·candidate input projection digest를 기록한다. 같은
staged tree를 commit하고 이후 commit tree와 PR head tree가 같을 때 로컬
증거를 재실행 없이 인계한다. 원격 required CI는 생략하지 않는다.

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
