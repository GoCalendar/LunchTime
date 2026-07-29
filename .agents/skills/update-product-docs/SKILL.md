---
name: update-product-docs
description: LunchTime의 PRD와 정책을 작성·검토·갱신하고, 구현 변경이 관련 제품 정본에 미치는 영향을 exact issue context와 planned ID 계약으로 판정한다. 새 기능을 정의하거나 제품 동작을 변경할 때, PRD·정책을 만들거나 구현·PR의 제품 문서 영향을 확인할 때 사용한다.
---

# 제품 문서 갱신

`docs/prd/`는 제품 결과와 요구사항, `docs/policies/`는 상태·권한·실패·복구·
보존·보안 규칙의 정본입니다. `docs/architecture/`는 이를 실현하는 기술
경계를 설명합니다.

`docs/product-definition/**`은 초기 브레인스토밍과 의사결정 과정의 역사
archive입니다. 일반 제품 문서 작성, 구현 영향 판정, 리뷰와 PR에서는 읽거나
수정하지 않습니다. 사용자가 역사 조사를 명시적으로 요청하거나 이슈가
archive의 정확한 파일을 직접 소유할 때만 예외로 다룹니다. 새 미결정 사항은
GitHub 이슈에서 관리하고, 승인된 결과만 PRD·Policy에 반영합니다.

## 컨텍스트 선택

1. 이슈의 목표, 완료 조건, 추적 ID, 변경 허용·금지 경로와 문서 영향을
   읽습니다.
2. 이슈가 지정한 정확한 PRD·Policy·Architecture 파일과 관련 절만 읽습니다.
3. 전체 diff에서 제품 의미가 바뀐 경로를 확인합니다.
4. 실제 모순이나 누락을 해소하는 데 필요한 직접 연결 문서만 추가로 읽습니다.

PRD·Policy 인덱스 전체, 관련 없는 정본, 모든 Architecture 문서와 역사
archive를 선제적으로 순회하지 않습니다. 이슈가 필요한 정본을 지정하지
않았거나 정본끼리 충돌하면 추측하지 않고 이슈 보완 또는 후속 제품 계약
작업을 요청합니다.

## 작업 모드

### PRD 작성·재구성

PRD를 실제로 작성할 때만 다음 참조를 읽습니다.

- [PRD 기준](./references/prd-standard.md)
- [PRD 템플릿](./references/prd-template.md)
- [가독성과 AI 작업 준비도](./references/readability-and-ai-readiness.md)

승인된 범위에 필요한 문서만 만들고 자리표시자나 빈 디렉터리를 만들지
않습니다.

### Policy 작성·재구성

Policy를 실제로 작성할 때만 다음 참조를 읽습니다.

- [정책 기준](./references/policy-standard.md)
- [정책 템플릿](./references/policy-template.md)
- [가독성과 AI 작업 준비도](./references/readability-and-ai-readiness.md)

상태, 권한, 불변식, 실패·복구·보존·보안 경계를 관찰 가능하게 정의합니다.

### 구현 영향 확인

구현 또는 PR의 제품 문서 영향을 판정할 때는 작성 템플릿을 읽지 않습니다.

1. 사용자나 환경이 제공한 PR base를 우선하고, 없으면
   `origin/main`과의 공통 조상을 기준으로 전체 diff를 봅니다.
2. diff가 다음 의미를 바꾸는지 분류합니다.
   - PRD: 사용자 흐름, 입력·출력, 범위, 제약, 성공 조건과 수용 동작
   - Policy: 상태, 권한, 충돌, 실패, 복구, 동기화, 보존, 암호화와 신뢰
   - Architecture: 구성요소, protocol, 저장·통신·복제·보안 구현 경계
3. 영향이 있으면 이슈가 소유한 정확한 정본을 같은 변경에서 갱신합니다.
4. 영향이 없으면 diff와 기존 계약이 같은 이유를 짧게 기록합니다.
5. 필요한 정본이 금지·허용 범위 밖이거나 승인되지 않은 제품 결정이
   필요하면 현재 이슈를 넓히지 않습니다. blocker 또는 후속 제품 계약 이슈로
   분리합니다.

Review finding 수정 뒤에는 finding이 닿은 의미와 관련 문서만 다시 확인합니다.
수정이 범위·요구사항·아키텍처·신뢰 경계를 넓혀야 한다면 현재 작업에서
수정하지 않습니다.

## Planned ID 계약

- `planned ID`는 GitHub 이슈의 계획 표식이며 정본 정의가 아닙니다.
- 새 ID는 승인된 결정이 있고, 같은 이슈가 namespace 번호와 일치하는 구체적
  `NN_*.md` 정본 파일, 필요한 인덱스, 구현과 테스트 경로를 소유할 때만
  만듭니다.
- 문서와 구현은 같은 issue·branch·PR에서 작성할 수 있습니다.
- Ready 전 exact PR head에서 실제 ID 정의, 인덱스, validator, 구현·테스트와
  PR의 양방향 추적을 확인합니다.
- 승인된 결정, planned ID 또는 변경 경로 소유가 없거나 미결정 제품 선택이
  남으면 새 ID를 만들지 않습니다.
- 폐기한 ID를 다른 의미로 재사용하지 않습니다.

## 문서 역할

- 문제, 목표 결과, 사용자 흐름, 관찰 가능한 요구사항, 성공 지표와 수용
  기준은 PRD에 둡니다.
- 상태, 권한, 불변식, 실패, 복구, 보존과 보안 경계는 Policy에 둡니다.
- 구현 선택, protocol, library, schema와 구성요소 경계는 Architecture 또는
  ADR에 둡니다.
- 실행 작업, 파일 소유권, 테스트 선택, 의존성과 미결정 사항은 GitHub 이슈에
  둡니다.
- 완전한 규칙을 여러 문서에 복사하지 않고 정본을 링크합니다.

## 추적성

- PRD에는 `PRD-NN`, 요구사항과 수용 기준에는 `PRD-NN-FR-NN`,
  `PRD-NN-AC-NN` namespace를 사용합니다.
- Policy에는 `POL-NN`, 참조 가능한 규칙에는 `POL-NN-R-NN`을 사용합니다.
- 관련 코드·테스트·이슈와 PR에서 실제 적용 ID를 양방향으로 찾을 수 있게
  합니다.
- 문서를 추가·대체·폐기할 때만 `README.md`, `docs/prd/README.md`,
  `docs/policies/README.md`의 해당 인덱스를 갱신합니다.

## 검증

변경한 artifact에 필요한 검증만 실행합니다.

| 변경 | 검증 |
|---|---|
| PRD·Policy Markdown | `validate-product-docs.mjs`, `git diff --check` |
| validator 구현 | 위 validator와 해당 direct test suite |
| 구현 영향 판정만 | 관련 test 결과와 diff 대조; 제품 문서 test 없음 |
| planned ID | exact head의 ID·인덱스·구현·테스트·PR 추적 확인 |

문서 변경이라는 이유로 앱 전체 test, 모든 하네스 회귀군, MVP bootstrap 또는
PR body validator를 실행하지 않습니다. 독립 review round의 위험도와 finding
closure는 [AGENTS.md](../../../AGENTS.md#독립-리뷰)가 소유하며 이 Skill은
review chain이나 별도 승인자를 만들지 않습니다.

의미 검토에서는 관련 정본끼리의 모순, 요구사항과 수용 기준 연결, 누락된
실패·복구, 중복 규칙, 사람이 훑기 쉬운 구조와 추측 없이 구현 가능한지를
확인합니다. Validator 통과만으로 의미상 정확성을 단정하지 않습니다.

## 안전 규칙

- 우연한 구현 동작에 맞춰 제품 계약을 다시 쓰지 않습니다.
- 누락된 결정을 구현 편의를 위해 만들지 않습니다.
- 관찰 가능한 조건 없이 `적절히`, `충분히`, `빠르게` 같은 표현을 승인
  기준으로 사용하지 않습니다.
- 비밀, 내부 자격 증명, 개인 데이터, 로컬 절대 경로와 채팅 내용을 추적
  문서에 넣지 않습니다.
- 읽기 전용 영향 감사 요청에서는 편집하지 않습니다.

## 결과 보고

```text
제품 문서
- 모드: PRD 작성 / Policy 작성 / 구현 영향
- 확인한 exact context: 파일과 ID
- PRD: 변경 파일·ID / 변경 없음과 근거
- Policy: 변경 파일·ID / 변경 없음과 근거
- Architecture: 변경 파일 / 변경 없음과 근거
- Planned ID: 없음 / 검증 결과
- 관련 검증: 선택한 명령과 결과
- 미결정·범위 밖: 없음 / blocker·후속 이슈
```
