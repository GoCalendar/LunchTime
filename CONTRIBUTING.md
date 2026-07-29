# LunchTime 개발 협약

이 문서는 사람이 확인할 브랜치, commit, PR과 병합 안전 경계를 설명합니다.
AI의 컨텍스트 선택과 리뷰·테스트 기본값은 [AGENTS.md](AGENTS.md), 세부 실행은
현재 작업 단계의 Skill이 소유합니다.

## 1. 기본 원칙

- `main`은 유일한 trunk이며 PR을 통해서만 갱신합니다.
- 하나의 이슈는 독립적으로 병합 가능한 결과 하나, 짧은 수명 브랜치 하나,
  담당자 하나와 PR 하나를 소유합니다.
- `develop`·`release` 같은 장기 통합 브랜치를 만들지 않습니다.
- 이슈를 컨텍스트 manifest로 사용하고, 이슈가 지정한 정확한 정본·코드·테스트
  범위만 읽습니다.
- `docs/product-definition/**`은 역사 archive입니다. 일반 개발 입력이나 문서
  영향 대상으로 사용하지 않습니다.

## 2. 작업 흐름

1. 이슈의 목표, 완료 조건, 추적성, 허용·금지 경로, 검증과 문서 영향을
   확인합니다.
2. `run-github-work-item check`와 `start`로 준비 상태와 소유권을 확인합니다.
3. 최신 `origin/main` 기준 독립 worktree에서 이슈 브랜치를 사용합니다.
4. 직접 관련 행동 테스트를 먼저 만들거나 갱신하고 최소 구현을 반복합니다.
5. 이슈가 지정한 PRD·Policy·Architecture에 대한 실제 의미 영향만
   확인합니다.
6. 위험도에 따라 독립 review round를 0회 또는 1회 수행합니다. 같은 round에는
   고위험 관점 reviewer를 최대 2명까지 병렬 배치할 수 있습니다.
7. 메인 세션이 review finding을 수정하고 관련 테스트로 해소를 확인합니다.
8. 검토한 파일만 stage해 원자적 commit을 만들고 PR을 게시합니다.
9. 명시적인 완료 요청에서만 exact-head CI와 same-repository 경계를 확인한 뒤
   squash merge, 이슈 완료와 안전한 정리를 수행합니다.

사전 조건이나 검증이 실패하면 다음 단계로 넘어가지 않습니다. 실패한 외부
쓰기를 자동 반복하지 않고 실제 상태를 먼저 재조회합니다. 요청 라우팅은
[개발 하네스 가이드](docs/development/01_harness_guide.md)를 사용합니다.

## 3. 브랜치와 worktree

브랜치 형식은 다음과 같습니다.

```text
work/issue-<GitHub 이슈 번호>-<짧은 영문 설명>
```

- 설명에는 소문자 영문, 숫자와 하이픈만 사용합니다.
- 브랜치명은 `start` 선점 기록과 정확히 같아야 합니다.
- `start` 성공 전에 브랜치를 만들지 않습니다.
- 작업자마다 독립 worktree를 사용하고 브랜치를 공유하지 않습니다.
- 최초 push 전 필요하면 `origin/main` 위로 rebase할 수 있습니다.
- 공개한 브랜치의 이력을 자동으로 다시 쓰지 않습니다. 불가피하면 영향
  확인 뒤 `--force-with-lease`만 사용합니다.

## 4. 이슈와 구현 입력

[작업 이슈 양식](.github/ISSUE_TEMPLATE/work-item.yml)의 기존 필드를
컨텍스트 manifest로 사용합니다.

```text
결과: 목표와 완료 조건
제품 계약: 적용되는 정확한 PRD·Policy 파일, ID와 절
구현 경계: 변경 허용·금지 경로
관련 코드: 허용 경로에서 확인한 구현과 인접 테스트
검증: 선택할 case·suite·target과 확대 조건
리뷰: 낮음 0명 / 일반 1명 / 높음 같은 round 최대 2명
```

전체 문서 인덱스나 디렉터리 glob을 컨텍스트 대신 적지 않습니다. 구현 중
정본 충돌이나 새 제품 결정이 필요해지면 임의의 기본값을 만들지 않고 현재
이슈를 차단하거나 후속 제품 계약 이슈를 만듭니다.

## 5. 테스트와 리뷰

테스트는 다음 사다리에서 가장 좁고 충분한 범위를 선택합니다.

`direct case/suite → affected target → affected subsystem → global`

global 검증은 공유 기반·빌드 설정 변경으로 영향을 한정할 수 없거나 release
검증을 명시한 경우의 예외입니다. 문서만 바뀌면 앱 테스트를 실행하지 않고,
하네스 owner 변경은 해당 validator·계약 테스트만 실행합니다. 로컬과 CI는
같은 영향 판단을 사용합니다. 상세 선택 규칙은
[테스트 표준](docs/development/02_testing_standard.md)이 소유합니다.

리뷰는 한 round만 수행합니다.

- 낮은 위험은 reviewer를 생략할 수 있습니다.
- 일반 변경은 분리된 읽기 전용 reviewer 1명을 사용합니다.
- 보안·데이터 손실·분산 정합성·권한 경계·동시성·파괴적 변경은 같은
  round에서 전문 관점 최대 2명을 병렬 사용합니다.
- finding은 모두 모은 뒤 메인 세션이 타당성을 판단하고 한 번에 수정합니다.
- 수정 확인은 finding별 diff와 직접 관련 테스트로 수행하며 reviewer를 다시
  호출하지 않습니다.
- review 뒤 범위·요구사항·아키텍처·신뢰 경계를 넓혀야 하는 finding은 현재
  이슈에서 고치지 않고 blocker 또는 후속 이슈로 분리합니다.

## 6. Commit

상세 절차는
[`commit-work-item`](.agents/skills/commit-work-item/references/commit-contract.md)이
소유합니다.

- 스킬 진입 전 index가 비어 있어야 합니다.
- 검토한 개별 파일만 `git add -- <path>...`로 stage합니다.
- `git add .`, `git add -A`, `git add --all`, directory·glob staging과
  `git commit -a`를 사용하지 않습니다.
- 사용자 변경, 로컬 설정, 인증 정보와 범위 밖 파일을 포함하지 않습니다.
- 활성 hook을 우회하거나 로컬 Git 신원을 덮어쓰지 않습니다.
- commit tree가 검토한 staged tree와 같은지 확인합니다.

메시지는 작업 키가 있으면 첫 형식, 없으면 두 번째 형식을 사용합니다.

```text
<type>: LT-NNN - <결과 중심 요약>
<type>: #<이슈 번호> - <결과 중심 요약>
```

## 7. Pull request와 완료

PR 상세 계약은
[`open-pull-request`](.agents/skills/open-pull-request/SKILL.md)가 소유합니다.

- base는 `main`이고 본문에 `Closes #<이슈 번호>`를 둡니다.
- 이슈나 정본을 복사하지 않고 변경 결과, 추적성, 실제 테스트 선택·결과와
  문서 영향만 기록합니다.
- 미완료 조건이 있으면 Draft로 게시합니다.
- 로컬 전체 테스트나 전체 하네스 회귀를 관성적으로 반복하지 않습니다.
  exact PR head에서 영향받은 CI target과 필수 metadata check를 확인합니다.
- PR 생성·갱신 요청만으로 병합하지 않습니다.
- 완료 요청에서는 Ready, current head, 해결된 review 대화, 필수 CI, 제목·
  본문·종료 참조와 base/head의 same-repository 신원을 재확인합니다.
- 검증된 head를 한 번만 squash merge합니다. 불명확한 응답은 재조회하고
  같은 쓰기를 반복하지 않습니다.
- 병합 확인 뒤 `run-github-work-item complete`가 이슈 상태를 맞춥니다.
  로컬 정리는 정확히 식별한 clean worktree·branch만 다루며 `.omc`와 사용자
  상태를 보존합니다.

## 8. 예외

긴급 수정도 별도 이슈, 짧은 브랜치와 PR을 사용합니다. 공개할 수 없는 보안
맥락은 민감정보를 제거한 최소 참조만 이슈에 남기고 승인된 비공개 채널을
사용합니다. 반복되는 예외는 일회성 우회 대신 이 협약과 하네스를 갱신합니다.
