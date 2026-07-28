# LunchTime AI 작업 협약

이 문서는 Codex와 Claude Code가 함께 따르는 저장소 작업 규칙의 정본입니다.
`CLAUDE.md`는 이 파일을 가리키며, 양쪽 도구는 `.agents/skills/`의 같은
스킬(Skill)을 사용합니다.

## 정본과 문서 역할

- 작업 전 [저장소 안내](README.md)와 관련 문서를 읽습니다.
- 브랜치, 작업 진행, 커밋과 PR 규칙은 [개발 협약](CONTRIBUTING.md)을
  기준으로 판단합니다.
- `docs/product-definition/`은 논의와 결정 이력입니다.
- `docs/prd/`는 승인된 제품 결과와 요구사항의 정본입니다.
- `docs/policies/`는 상태, 권한, 실패, 복구, 보존과 보안 규칙의 정본입니다.
- 구현 방식은 기술 설계나 ADR, 실행 단위는 GitHub 이슈에 둡니다.
- 정본끼리 충돌하거나 구현에 필요한 제품 결정이 없으면 임의로 선택하지
  말고 작업을 중단해 결정이 필요함을 알립니다.
- 문서와 스킬은 한국어를 기본 작성 언어로 사용합니다. 자연스러운 표현과
  정확한 의미 전달을 우선하며, PRD·POL·D·F ID, 파일 경로, 명령, URL,
  코드·API 식별자, 기술 용어와 제품·플랫폼 고유명사는 원문을 사용할 수
  있습니다.

## 작업 시작

새 이슈 작성·감사는 `run-github-work-item`의 on-demand `create` 계약을
사용하며 아래 11단계 구현 흐름 밖의 준비 작업입니다. 요청 유형별 첫 입력과
Skill owner는 [개발 하네스 가이드](docs/development/01_harness_guide.md)를
따릅니다.

1. 한 작업자는 한 번에 하나의 GitHub 이슈만 구현합니다.
2. 이슈의 개요, 목표, 완료 조건, 추적 ID, 선행 작업과 변경 경로를 읽습니다.
3. `run-github-work-item` 스킬의 `check`로 준비 상태를 확인합니다.
4. `CONTRIBUTING.md`의 브랜치 계약에 맞는 이름을 정하고 구현 직전에 같은
   스킬의 `start`를 실행합니다. 성공한 전이만 작업 시작을 승인합니다.
5. `start`가 실패하면 코드를 수정하지 않습니다. 담당자(Assignee), GitHub 기본
   의존성, 상태 라벨, 프로젝트 상태 또는 동시 작업 한도를 먼저 바로잡습니다.
6. 최신 `origin/main`에서 스킬에 기록한 정확한 브랜치명으로 독립 작업
   트리(worktree)를 사용합니다.
7. `main`에 직접 커밋하거나 장기 `develop`·`release` 브랜치를 만들지 않습니다.

## 구현과 충돌 방지

- 이슈의 변경 허용 경로만 수정하고 변경 금지 경로를 침범하지 않습니다.
- 다른 진행 중 이슈와 공유 계약이나 빌드 매니페스트가 겹치면 먼저 의존성을
  추가하거나 소유 이슈가 병합될 때까지 기다립니다.
- 적용 가능한 PRD 요구사항, 수용 기준, 정책 규칙 ID를 코드, 테스트와 PR에서
  추적합니다. tooling-only 비적용 조건은
  [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)의
  이슈 계약을 따릅니다.
- 새 PRD·Policy ID의 문서·구현 동시 작업 조건과 Ready 전 추적성은
  [update-product-docs](.agents/skills/update-product-docs/SKILL.md)의
  planned ID 계약을 따릅니다.
- 자동 재시도는 횟수와 시간 한도가 있는 경우에만 구현합니다. 무한 반복과
  무한 재시도를 추가해서는 안 됩니다.
- 사용자 소유의 미추적 파일과 작업 범위 밖 변경은 수정하거나 스테이징하지
  않습니다.
- 공개 저장소에 인증 정보, 사내 네트워크 식별자, 개인 데이터와 로컬 절대
  경로를 기록하지 않습니다.

## 행동 시나리오와 독립 리뷰

- 구현 전에 이슈 `완료 조건`과 관련 PRD·Policy에서 관찰 가능한
  happy·error·recovery 시나리오와 검증 계획을 도출합니다. 상세 원칙은
  [BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)을 따릅니다.
- 모든 단위 테스트에 Gherkin을 강제하지 않습니다. 구현 중에는 외부 행동을
  검증하는 이슈별 빠른 테스트를 반복하고 fake clock·fake transport·결정적
  fixture를 사용합니다. 저장소 고정 게이트 전체를 리뷰 전에 반복하거나
  flaky 실패를 단순 rerun으로 숨기지 않습니다.
- 독립 리뷰 전에 전체 diff와 이슈 경로 계약을 PRD·Policy·Architecture
  정본에 대조합니다. 필요한 정본 변경이 누락됐거나 금지 경로에 있으면
  tooling-only 비적용을 승인하지 않고 별도 제품 계약 이슈로 차단합니다.
- clean 독립 worktree에서 검토한 경로만 명시적으로 stage하고 unstaged tracked
  변경과 예상하지 않은 untracked 입력이 없는 cached diff·candidate tree를
  고정합니다. 고정 직후 빠른 공통 gate를 먼저 실행하고 모두 통과한 같은
  tree만 독립 리뷰에 넘깁니다. 빠른 공통 gate만으로 발견한 수정은 다시
  명시적으로 stage하고 gate를 통과시킨 뒤 첫 리뷰를 시작하므로 review pass를
  소비하지 않습니다. 독립 리뷰는 작성 컨텍스트와 분리된 읽기 전용 reviewer가
  원본 요구사항, 같은 cached diff와 실제 행동 테스트·정본 영향 결과로
  수행합니다. 기대 결론을 주입하지 않고 작성·수정자와 승인 역할을
  분리합니다.
- 최초 candidate의 발견 사항은 P0~P2, `file:line`, 재현 근거와 필요한 수정을
  포함해 먼저 합친 뒤 일괄 수정합니다. 수정은 발견 즉시 명시적으로 stage하고
  빠른 공통 gate를 먼저 통과시킵니다. 그 뒤 필요한 행동 테스트와 정본 영향
  판정을 갱신하고 이전·현재 tree, 그 사이 staged delta와 현재 전체 cached
  diff를 별도 pass로 검토합니다. 최초 전체 리뷰와 끊기지 않은 delta review
  chain이 최종 candidate를 모두 덮으면 최종 review tree로 결속할 수
  있습니다. 범위·요구사항·보안 경계가 넓어지거나 chain에 공백·모호함이
  있으면 새 전체 리뷰를 수행합니다. review-fix 사이에는 무거운 회귀군을
  실행하지 않으며, 최대 3 pass 뒤에도 P0/P1이 남으면 blocker로 보고합니다.
- 단순 문서는 최소 1명, 계약·validator·workflow 변경은 최소 2명, 분산
  통신·정합성·보안은 전문 관점별 reviewer를 배치합니다. 상세 증거 계약은
  [개발 하네스 가이드](docs/development/01_harness_guide.md)를 따르며, 현재
  흐름을 위해 새 리뷰 전용 Skill을 만들지 않습니다.

## 커밋과 PR

1. 구현 중 행동 테스트와 PRD·Policy·Architecture 의미 영향 판정을 마친 뒤
   `commit-work-item` 스킬로 candidate staging, 빠른 공통 gate, 독립 리뷰,
   선택된 무거운 회귀군과 commit을 이어서 수행합니다.
2. candidate를 만들 때 검토한 경로만 명시적으로 스테이징합니다. `git add .`와
   `git add -A`를 사용하지 않으며 cached diff·candidate tree를 리뷰와 최종
   검증 증거에 결속합니다.
3. 커밋 작성자와 커미터 정보는 저장소 로컬 설정으로 확인하고 활성 개인
   로컬 hook을 우회하지 않습니다. 개인 계정 값과 hook 정책은 추적 파일에
   기록하지 않습니다.
4. 커밋 뒤 `open-pull-request` 스킬을 사용해 base가 `main`인 PR을 만듭니다.
5. PR 본문은 고정된 다섯 구역에 종료할 이슈, 이번 변경의 맥락과 결과,
   추적 ID, 검증 증거와 제품 문서 영향 판정을 기록합니다.
6. 이슈나 정본 문서를 통째로 복사하지 않고 이번 변경을 이해하는 데 필요한
   차이와 링크만 남깁니다.
7. 미완료 조건이 있으면 숨기지 않고 Draft로 열며, 완료된 검증만 통과로
   표시합니다.
8. 최종 candidate tree, review tree, 검증 tree, commit tree와 PR head tree가
   결속되고 증거가 완전할 때 로컬 게이트를 commit·PR 단계에서 반복하지
   않습니다. 검증 tree는 현재 candidate의 빠른 공통 gate와 재실행했거나
   유효하게 유지한 무거운 회귀군 증거를 합쳐 판정할 수 있습니다. 원격
   required CI는 별도 증거이므로 생략하지 않습니다.

## 문서와 검증

- 새 기능, 사용자 동작, 상태, 권한, 실패, 동기화, 보존 또는 보안 변경에는
  `update-product-docs` 스킬을 사용합니다.
- 구현 이슈 작성 전과 독립 리뷰 전에 PRD·Policy·Architecture 의미 영향과
  경로 계약을 확인합니다.
- 경로를 명시적으로 stage해 candidate tree를 고정할 때마다 독립 리뷰보다
  먼저 다음 빠른 공통 gate를 실행합니다. 최초 candidate와 수정 candidate
  모두 생략할 수 없습니다. 빠른 공통 gate 통과 뒤 tree가 그대로 유지되면 그
  증거를 최종 증거로 사용하며, 이 gate만의 수정은 review pass를 소비하지
  않습니다.

  ```bash
  node .agents/skills/update-product-docs/scripts/validate-product-docs.mjs
  node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs validate
  node .agents/skills/commit-work-item/scripts/validate-commit-paths.mjs --index
  node .agents/skills/open-pull-request/scripts/validate-pr-body.mjs --template .github/PULL_REQUEST_TEMPLATE.md
  git diff --cached --check
  ```

- 빠른 공통 gate를 통과한 candidate에는
  `.agents/skills/commit-work-item/scripts/validate-gate-evidence.mjs`의
  evidence JSON을 결속합니다. 현재 base→candidate 분류의 `selectedGroups`가
  아래 무거운 회귀군 중 이번 결과에 필요한 군을 정하고, 독립 리뷰가 끝난
  같은 tree에서 그 군만 실행합니다. 같은 index, working tree, 외부 상태,
  공유 cache 또는 자원을 쓰지 않는 읽기 전용·격리 명령만 병렬 실행하고,
  나머지는 순차 실행한 뒤 결과를 모두 모아 판정합니다.

  - `product-docs-regression`: 제품 계약 ID와 문서 validator 회귀 테스트
  - `work-item-regression`: 이슈 상태 전이와 MVP bootstrap 회귀 테스트
  - `commit-pr-regression`: commit path·message·gate evidence와 PR 본문 회귀 테스트
  - `finalize-regression`: merge·원격 branch·로컬 정리 회귀 테스트

  정확한 명령과 evidence schema는
  [commit-work-item 계약](.agents/skills/commit-work-item/references/commit-contract.md)이
  소유합니다.

- gate 실패를 발견하면 해당 candidate의 gate 진행을 즉시 중단합니다. 새
  명령을 시작하지 않고 실행 중 명령을 안전하게 취소·종료한 뒤 수정하며,
  의도한 경로만 명시적으로 stage하고 빠른 공통 gate를 먼저 통과시킵니다.
  필요한 행동 테스트·의미 영향 판정과 delta review가 끝난 뒤 무거운 회귀군을
  재개합니다.
- helper의 delta 판정은 현재 base→candidate의 `selectedGroups`와
  이전→candidate의 `invalidatedGroups`를 분리합니다. 완료한 회귀군은
  `selectedGroups ∩ invalidatedGroups`만 재실행하고, 선택됐지만 입력이
  그대로인 PASS는 유지하며 선택된 pending은 계속합니다. 현재 선택되지 않은
  군은 증거를 버리고 `not-required`로 처리합니다. 변경을 base까지 완전히
  되돌려 `selectedGroups`가 비면 무거운 회귀군을 다시 실행하지 않습니다.
- 공유 계약·경로 classifier·입력 manifest, 환경 또는 선언하지 않은
  입력이 바뀌거나 입력 영향을 확정할 수 없으면 로컬 무거운 회귀군 네 개를
  모두 무효화합니다. helper 자체 변경도 로컬 증거 판정이 바뀌므로 전체
  invalidated 처리하지만 current selection과의 교집합인
  `commit-pr-regression`만 다시 실행하고 나머지는 버립니다. 증거를
  재사용하지 않는 원격 CI도 owning `commit-pr-regression`만 실행합니다. 각
  증거에는 실제 실행 tree와 명령·입력 digest를 남기며, 최종 candidate의
  빠른 공통 gate와 유효한 회귀군 증거가 모두 있어야 검증 tree를
  확정합니다.
- tree·input이 같은 환경 전용 실패만 원인과 동일성 근거를 기록한 새 명령으로
  한 번 재실행할 수 있으며 자동 반복하지 않습니다. 같은 tree·input에서 의미
  영향·독립 리뷰 증거가 불완전하면 그 판정과 필요한 delta 또는 전체
  리뷰부터 복구합니다. gate 증거가 불완전하면 exact candidate에서 빠른 공통
  gate와 helper가 선택한 무거운 회귀군만 새로 실행합니다.
- 통과한 결정적 검증만으로 의미상 정확성을 단정하지 않습니다. 의미 검토와
  독립 리뷰가 먼저 모순, 누락과 회귀를 확인합니다.

## PR과 작업 완료

1. PR 본문 계약과 템플릿을 검증하고 `Closes #<issue>`가 GitHub에 인식되는지
   확인합니다.
2. PR이 병합되기 전에는 이슈를 `Done`으로 바꾸거나 닫지 않습니다.
3. PR 생성·갱신만 요청받았으면 사후 재조회에서 멈춥니다. 완료·병합 또는
   end-to-end 진행을 명시한 경우에만
   [open-pull-request](.agents/skills/open-pull-request/SKILL.md)의 finalize
   모드로 이동합니다.
4. `open-pull-request`는 Ready 상태, 현재 head와 독립 리뷰, 필수 CI, 해결된
   리뷰 대화, base·제목·본문·종료 참조와 same-repository 경계를 다시 검증한
   뒤 exact-head squash merge를 한 번만 수행하고 원격 branch 결과를
   확인합니다. 이미 병합됐거나 응답이 불명확한 실행은 현재 상태를 재조회해
   완료된 쓰기를 반복하지 않습니다.
5. 병합과 원격 branch 정리가 확인된 뒤
   [run-github-work-item](.agents/skills/run-github-work-item/SKILL.md)의
   `complete`가 이슈 레이블·Project 상태·이슈 종료와 후행 의존성 전이를
   소유합니다.
6. `complete` 성공 뒤 로컬 worktree·branch 정리는 `open-pull-request`가
   계속 소유합니다. 정확히 식별한 clean 대상만 정리하고 `.omc`와 사용자 소유
   상태는 보존하며, dirty·잔여물·신원 drift·불명확한 상태에서는 자동
   삭제·이동·reset·stash 없이 fail-closed합니다. 상세 실행 계약과 복구
   상태는 해당 Skill만 정본으로 소유합니다.
7. 선행 작업이 모두 끝난 후행 이슈에만 `blocked` 라벨을 제거하고 근거가 담긴
   댓글을 남깁니다.

프로젝트의 최대 `In Progress` 수 검사는 GitHub의 서로 다른 이슈를 하나의
트랜잭션으로 잠그지 못하므로 최선형 진입 제어(best-effort admission
guard)입니다. `start` 최종 검증이 초과를 발견하면 구현을 시작하지 말고
프로젝트 상태를 수동으로 정리합니다.

GitHub 상태 전이는 자동 반복하지 않습니다. 일부 단계가 실패하면 추가 변경을
멈추고 현재 상태를 확인한 뒤, 사람이 확인 가능한 새 명령으로만 재개합니다.
