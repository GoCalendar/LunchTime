# LunchTime AI 작업 협약

이 문서는 Codex와 Claude Code가 항상 적용할 최소 작업 규칙입니다.
`CLAUDE.md`는 이 파일을 가리키며, 상세 절차는 현재 단계의 Skill 하나와 그
Skill이 조건부로 지시한 참조만 따릅니다.

## 컨텍스트 로딩

GitHub 이슈를 작업 컨텍스트의 manifest로 사용합니다.

1. 먼저 이슈의 목표, 완료 조건, 추적 ID, 변경 허용·금지 경로, 검증과 문서
   영향을 읽습니다.
2. 이슈가 가리킨 정확한 PRD·Policy·Architecture 파일과 관련 절, 변경 경로의
   코드와 인접 테스트, 현재 단계의 Skill만 읽습니다.
3. 구현을 위해 실제 미확정 사항이 생겼을 때만 직접 연결된 특정 문서를
   추가로 읽습니다. 디렉터리, 문서 인덱스나 정본 전체를 선제적으로 순회하지
   않습니다.
4. 이슈가 필요한 정본 경로·ID를 제공하지 않거나 정본끼리 충돌하면 추측하지
   않고 이슈 보완 또는 후속 제품 계약 작업을 요청합니다.

`docs/prd/`는 제품 결과와 요구사항, `docs/policies/`는 상태·권한·실패·복구·
보존·보안 규칙, `docs/architecture/`는 구현 경계의 정본입니다.
`docs/product-definition/**`은 초기 브레인스토밍과 결정 과정의 역사 자료입니다.
일반 구현·리뷰·문서 영향 판정에서는 읽거나 수정하지 않습니다. 사용자가 역사
조사를 명시적으로 요청하거나 이슈가 해당 archive의 정확한 파일을 직접
소유하는 경우에만 예외로 다룹니다.

`README.md`와 `CONTRIBUTING.md`도 매 작업의 선행 전체 읽기 대상이 아닙니다.
저장소 구조나 사람용 Git 규칙을 확인해야 할 때 관련 절만 읽습니다.

문서와 Skill은 한국어를 기본 작성 언어로 사용합니다. ID, 경로, 명령, URL,
코드 식별자와 기술 용어는 원문을 사용할 수 있습니다.

## 이슈 작업 흐름

1. 한 번에 하나의 GitHub 이슈만 구현합니다.
2. `run-github-work-item check`로 준비 상태를 확인하고, 구현 직전에
   `start`가 성공한 뒤에만 코드를 수정합니다.
3. 기록된 `work/issue-<번호>-<설명>` 브랜치를 최신 `origin/main` 기준의 독립
   worktree에서 사용합니다. `main`에 직접 커밋하거나 장기
   `develop`·`release` 브랜치를 만들지 않습니다.
4. 이슈의 허용 경로만 변경합니다. 필요한 결과가 금지·범위 밖 경로를
   요구하면 현재 범위를 넓히지 않고 blocker 또는 후속 이슈로 전환합니다.
5. 구현과 관련 테스트가 끝나면 필요한 제품 문서 영향, 한 번의 독립 리뷰,
   명시적 staging과 commit, PR 순으로 진행합니다.
6. PR 생성·갱신 요청은 병합하지 않습니다. 명시적인 완료·병합 요청에서만
   `open-pull-request` finalize와 `run-github-work-item complete`를 사용합니다.

요청별 Skill owner와 종료 지점은
[개발 하네스 가이드](docs/development/01_harness_guide.md)를 따릅니다.

## 테스트 선택

테스트는 변경 영향에 가장 가까운 범위부터 선택합니다.

1. 변경 동작을 직접 검증하는 case 또는 suite
2. 그 case를 따로 실행할 수 없을 때 affected target
3. 여러 target에 걸친 공유 경계일 때 affected subsystem
4. 영향 범위를 신뢰성 있게 한정할 수 없거나 release 검증을 명시한 경우에만
   global test

구현 중과 CI 모두 이 순서를 사용하며 전체 테스트를 기본값으로 삼지 않습니다.
변경한 행동의 happy·error·recovery와 직접 관련 회귀는 테스트 코드가
소유합니다. 실행 대상, 선택 이유, 명령과 실제 결과만 증거로 남깁니다.
상세 기준은 [BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)을
따릅니다.

## 독립 리뷰

리뷰는 기능 테스트를 다시 수행하는 회귀 gate가 아니라 요구사항 누락, 설계,
보안 경계와 테스트 공백을 찾는 한 번의 검토입니다.

| 위험 | 한 review round의 reviewer |
|---|---|
| 낮음 — 기계적 문서, 국소 설정, 단순 rename | 0명 허용 |
| 일반 — 기능, 계약, validator, workflow | 1명 |
| 높음 — 보안, 데이터 손실, 분산 정합성, 권한 경계, 동시성, 파괴적 변경 | 같은 round에서 최대 2명 |

- Reviewer는 작성 컨텍스트와 분리된 읽기 전용 역할이며 원본 요구사항, 관련
  정본, 전체 diff와 실제 관련 테스트 결과를 봅니다.
- 같은 round의 reviewer는 병렬로 검토하고 P0~P2, `file:line`, 근거와 필요한
  수정을 보고합니다.
- 메인 세션은 발견 사항의 타당성을 확인하고 수용한 항목을 한 번에 수정한 뒤
  수정 diff와 직접 관련 테스트로 각 finding의 해소를 확인합니다. reviewer를
  다시 호출하지 않습니다.
- 리뷰 뒤 수정이 이슈 범위, 요구사항, 아키텍처 또는 신뢰 경계를 넓혀야 한다면
  현재 작업에서 구현하지 않습니다. blocker 또는 후속 이슈로 분리하고, 새
  범위는 새 작업의 리뷰 대상으로 취급합니다.

## 문서 영향

사용자 동작이나 제품 규칙을 바꾸면 이슈가 지정한 관련 PRD·Policy를 같은
변경에서 갱신합니다. 구현 경계가 바뀌면 관련 Architecture를 갱신합니다.
변경이 없으면 그 이유를 기록합니다. 새 PRD·Policy ID의 조건은
[`update-product-docs`](.agents/skills/update-product-docs/SKILL.md)의 planned
ID 계약이 소유합니다.

## Git과 외부 상태 안전

- 사용자 소유 변경, 범위 밖 파일, 로컬 IDE·OS 잔여물을 수정하거나
  스테이징하지 않습니다.
- 검토한 개별 파일만 `git add -- <file>...`로 stage합니다. `git add .`,
  `git add -A`, directory·glob staging과 `git commit -a`를 사용하지 않습니다.
- 기존 index에 다른 변경이 있으면 reset·unstage·stash하지 않고 중단합니다.
- 활성 Git hook을 우회하지 않고 저장소 로컬 신원을 덮어쓰지 않습니다.
- 비밀, 내부 네트워크 식별자, 개인 데이터와 로컬 절대 경로를 추적 파일,
  이슈 또는 PR에 기록하지 않습니다.
- 자동 retry에는 횟수와 시간 상한을 두며, GitHub 쓰기 응답이 불명확하면
  상태를 재조회하고 완료된 쓰기를 반복하지 않습니다.
- PR과 완료 처리는 base와 head가 모두 이 저장소인 same-repository
  경계에서만 수행합니다. fork 또는 저장소 신원이 불명확하면 중단합니다.
