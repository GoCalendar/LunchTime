# MVP 이슈 일괄 등록

`bootstrap-mvp.mjs`는 확정된 MVP 작업 목록을 GitHub 이슈, 마일스톤, Project
필드와 GitHub 기본 의존 관계로 한 번에 연결한다. 이 도구는 레이블, 마일스톤,
Project 또는 필드를 생성하지 않는다. 저장소 관리자가 해당 기반을 먼저
구성한 뒤 매니페스트를 검토하고 실행한다.

## 실행 순서

저장소 루트에서 다음 순서를 지킨다.

```bash
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs validate
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs apply --dry-run
node .agents/skills/run-github-work-item/scripts/bootstrap-mvp.mjs apply
```

`validate`는 로컬 매니페스트만 읽는다. `apply --dry-run`은 활성 `gh` 계정,
저장소, 레이블, 열린 마일스톤, Project 필드와 기존 이슈·의존 관계를
실제로 읽지만 쓰기를 수행하지 않는다. 모의 실행 결과와 활성 계정을 사람이
확인한 뒤에만 `apply`를 한 번 실행한다.

실패한 명령을 반복문으로 재실행하지 않는다. 각 GitHub 요청은 한 번만
시도되고 요청별 대기 시간은 30초, 페이지 조회는 최대 20페이지로 제한된다.

## 매니페스트 계약

정본은 `.github/mvp-work-items.json`이며 최상위 구조는 다음과 같다.

```json
{
  "schemaVersion": 1,
  "repository": "GoCalendar/LunchTime",
  "project": {
    "owner": "GoCalendar",
    "number": 1
  },
  "milestone": "MVP",
  "items": []
}
```

각 항목에는 아래 필드를 빠짐없이 넣는다. 알 수 없는 필드는 스키마 오타로
간주해 거부한다.

```json
{
  "key": "LT-001",
  "title": "독립적으로 병합 가능한 결과",
  "type": "type:spike",
  "areas": ["area:p2p"],
  "priority": "P0",
  "phase": "Discovery",
  "order": 1,
  "dependsOn": [],
  "overview": "이슈 개요",
  "context": "이 작업이 필요한 제품 및 기술 맥락",
  "goal": "관찰 가능한 한 가지 결과",
  "scope": {
    "include": ["포함할 구체 작업"],
    "exclude": ["이번 이슈에서 하지 않을 작업"]
  },
  "acceptance": ["독립적으로 검증 가능한 완료 조건"],
  "traceability": ["PRD-01-SP-01", "POL-02-R-01"],
  "allowedPaths": ["docs/technical-design/**"],
  "forbiddenPaths": ["Sources/LunchTime/**"],
  "verification": ["node --test"],
  "documentImpact": ["docs/prd/01_lunchtime_mvp.md 검토"]
}
```

### 연속성과 의존 관계

- `items` 배열의 첫 항목은 `LT-001`, 다음은 `LT-002`처럼 `key`가 중복·누락 없이
  연속되어야 한다.
- `order`도 1부터 배열 순서대로 중복·누락 없이 연속되어야 한다.
- `dependsOn`은 같은 매니페스트에 존재하는 더 낮은 `order`의 `key`만 참조한다.
- 의존 관계 그래프는 DAG여야 한다.
- 선행 이슈가 하나라도 열려 있으면 `dependency:blocked`를 붙인다. 선행 작업이
  없거나 모두 닫혀 있으면 붙이지 않는다.

### 허용 열거형과 범위 레이블

`type`과 `areas`에는 아래 목록의 범위 레이블만 직접 기록할 수 있다. 다른
레이블 문자열은 매니페스트에 넣을 수 없다.

- `type`: `type:feat`, `type:fix`, `type:refactor`, `type:docs`,
  `type:chore`, `type:spike`, `type:test`
- `area`: `area:app-shell`, `area:p2p`, `area:domain`, `area:ui`,
  `area:data`, `area:security`, `area:quality`
- `priority`: `P0`, `P1`, `P2`, `P3`
- `phase`: `Discovery`, `Foundation`, `Domain`, `Surface`, `Verification`

Project에는 다음 필드와 선택지가 정확한 이름과 타입으로 이미 존재해야 한다.

- 설정된 `Status`: 단일 선택 필드이며 설정된 `Todo` 선택지를 사용한다.
- `Priority`: 단일 선택 필드이며 매니페스트의 `priority` 선택지를 포함한다.
- `Phase`: 단일 선택 필드이며 매니페스트의 `phase` 선택지를 포함한다.
- `Order`: 숫자 필드다.

## 본문과 추적성

이슈 본문 첫 줄은 다음 정확한 표식이다.

```html
<!-- lunchtime-mvp-work-item:key=LT-001 -->
```

표식은 재실행 시 같은 이슈를 찾는 식별자다. 한 이슈에 표식이 여러 개
있거나 같은 표식이 여러 이슈에 있으면 중단한다.

본문은 [이슈 계약](issue-contract.md)의 11개 제목을 정확한 순서로
작성한다. `선행 작업`에는 매니페스트 `key`와 실제 GitHub 이슈 링크를 함께
기록한다. 링크는 선행 이슈가 만들어진 뒤 결정되므로 이슈는 반드시 `order`
순으로 생성된다. `추적성`에는 아래 정본 ID를 하나 이상 넣는다.

- `PRD-NN-FR-NN…`
- `PRD-NN-AC-NN…`
- `PRD-NN-SP-NN…`
- `POL-NN-R-NN…`

제품 정의 이력의 `D-NN…`과 기능 원장의 `F-NN…`은 보조 참조로 함께 넣을 수
있지만, PRD 또는 정책 정본 ID를 대신할 수 없다.

본문 어느 구역도 `TODO`, `TBD`, 한 글자 값 또는 빈 목록으로 대신할 수
없다.

## 공개 저장소 안전성

매니페스트는 공개 이슈의 입력이다. 다음 정보가 감지되면 검증이
안전하게 실패하고 중단된다.

- 인증 정보, GitHub 토큰, 비밀 키
- 개인 이메일
- SSID, MAC 주소, 사설·로컬 IP 주소
- 로컬 절대 경로와 `file://` URI

`allowedPaths`와 `forbiddenPaths`에는 저장소 상대 경로나 좁은 경로 패턴만 쓴다.
상위 경로(`..`), URL, 로컬 절대 경로는 허용하지 않는다.

## 재실행과 충돌 처리

등록 중간에 실패해도 이미 만든 정확한 상태는 다음 실행에서 건너뛴다.
누락된 다음 항목은 안전하게 복구할 수 있다.

- 필요한 관리 대상 레이블이 빠졌으면 추가한다.
- 마일스톤이 비어 있으면 설정한다.
- Project 항목이나 필드 값이 비어 있으면 추가한다.
- 매니페스트에 있는 GitHub 기본 `blocked by` 관계가 빠졌으면 추가한다.

쓰기 실행이 끝나면 모든 이슈, 관리 대상 레이블, 마일스톤, Project 필드와
GitHub 기본 의존 관계를 한 번 다시 읽는다. 남은 작업이 하나라도 보이면 성공으로
보고하지 않고 중단한다. 이 검증도 자동 재시도하지 않는다.

아래 상태는 사람이 수정한 충돌로 간주하며 덮어쓰지 않고 즉시
중단한다.

- 표식 이슈의 제목 또는 본문이 매니페스트와 다르다.
- 다른 `status:`, `dependency:`, `type:`, `area:` 레이블이 있다.
- 다른 마일스톤 또는 Project 필드 값이 있다.
- 매니페스트에 없는 GitHub 기본 선행 이슈가 있다.
- 이슈가 닫혀 있거나 담당자가 지정됐거나 매니페스트보다 앞서 생성되어 선행 이슈 링크를
  계산할 수 없다.

관리 범위 밖 레이블은 보존한다. 충돌 시 출력된 완료 단계와 실제 상태를 직접
확인하고 수동으로 정리한다. 그 뒤 `apply --dry-run`을 한 번 실행해 계획을
확인하고, 새 `apply` 명령을 한 번 실행한다. 자동 재시도와 무한 반복은
허용하지 않는다.
