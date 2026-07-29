# GitHub 이슈 계약

독립적으로 병합 가능한 결과 하나마다 이슈 하나를 사용합니다. 이슈는 대화
이력이나 저장소 전체 탐색 없이 작업을 시작할 수 있는 exact context
manifest입니다.

## 필수 본문 구역

다음 제목을 정확한 순서와 같은 제목 수준으로 사용합니다.

1. `개요`
2. `맥락`
3. `목표`
4. `작업 범위`
5. `완료 조건`
6. `선행 작업`
7. `추적성`
8. `변경 허용 경로`
9. `변경 금지 경로`
10. `검증`
11. `문서 영향`

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs \
  validate-body <body-file> [--label <actual-label>...]
```

## Exact context 규칙

- `목표`에는 완료 후 관찰할 결과 하나를 적습니다.
- `맥락`과 `추적성`에는 이번 결과를 지배하는 정확한 PRD·Policy ID, 파일과
  관련 절을 연결합니다. 구현 경계가 필요할 때만 정확한 Architecture 파일을
  추가합니다.
- 디렉터리 전체, 재귀 glob, PRD·Policy·Architecture 인덱스 전체를 읽으라는
  지시로 exact context를 대신하지 않습니다.
- `docs/product-definition/**`은 역사 archive입니다. 일반 구현·리뷰·문서
  영향의 참조나 변경 경로에 넣지 않습니다. 역사 조사 또는 archive 유지
  자체가 목표인 이슈만 정확한 파일과 이유를 명시할 수 있습니다.
- `작업 범위`에는 포함과 제외를, 경로 구역에는 저장소 기준의 좁은 경로를
  적습니다. 필요한 경로가 다른 이슈 소유이거나 금지 경로이면 의존
  관계 또는 후속 이슈를 사용합니다.
- `검증`에는 가장 좁은 direct case·suite, 필요 시 affected target, 확대
  조건과 실제 남길 결과를 계획합니다. “전체 테스트”는 영향 불명 또는
  명시적 release 검증일 때만 사용합니다.
- 리뷰 위험을 `낮음`·`일반`·`높음`으로 분류합니다. 낮음은 reviewer 0명,
  일반은 1명, 높음은 같은 한 round에서 최대 2명을 계획합니다.
- `문서 영향`에는 바꿀 정확한 PRD·Policy·Architecture 파일 또는 변경하지
  않는 구체적인 이유를 적습니다.

모든 구역에는 의미 있는 내용을 씁니다. 한 글자 값, `TBD`, `TODO`, 코드
울타리 안에 숨긴 제목은 계약을 충족하지 않습니다.

## 완료 조건과 추적성

- `완료 조건`은 행동 시나리오의 정본입니다. 이번 변경에 적용되는
  happy·error·recovery를 Given/When/Then 또는 조건/행동/결과로 작성하고 각
  시나리오에 추적 ID와 direct 검증 계획을 연결합니다.
- 적용되지 않는 error·recovery 축을 형식적으로 만들지 말고 제외 이유를
  검증 계획에 적습니다.
- 정본 ID는 `PRD-NN-FR-NN`, `PRD-NN-AC-NN`, `PRD-NN-SP-NN`,
  `POL-NN-R-NN`을 사용합니다. `D-NN`·`F-NN`은 역사 보조 ID이며 정본 ID를
  대신하지 않습니다.
- 같은 이슈에서 새 PRD·Policy ID를 정의하면 예상 ID 뒤에
  `planned — 이 PR에서 정의`를 적습니다. 허용 경로와 문서 영향에는 namespace
  번호와 일치하는 구체적 `docs/prd/**/NN_*.md` 또는
  `docs/policies/**/NN_*.md` 파일, 필요한 인덱스와 구현·테스트 경로를
  포함합니다. Ready 전 exact head에서 실제 정의와 양방향 추적을 검증합니다.

## Tooling-only 비적용

제품 동작, 사용자 결과, PRD 요구사항과 Policy 규칙을 바꾸지 않는 개별
`type:chore`만 제품 ID 대신 다음 형식을 사용할 수 있습니다.

- 실제 type label raw 문자열은 `type:chore` 정확히 하나여야 합니다.
- `추적성` direct bullet:
  `- 해당 없음 — 제품 동작·PRD·Policy 추적 대상이 아닌 도구 작업: <구체적 사유>`
- 각 완료 조건의 `- 추적 ID:`에도 같은 prefix와 시나리오별 이유를 적습니다.
- `문서 영향`에는
  `- 제품 문서: 변경 없음 — <구체적 근거>` 한 줄을 둡니다.
- 허용 경로에 `docs/prd` 또는 `docs/policies` 정본을 넣지 않습니다.
- 메인 세션은 diff에서 실제 제품 영향이 없는지 확인합니다. 낮은 위험이라면
  이 확인만으로 reviewer를 생략할 수 있습니다.

이 exact prefix를 사용하는 본문은 source allowlist를 먼저 통과해야 합니다.
일반 제목·문단·목록·표, inline code, 같은 줄에서 완결된 inline link와 정확한
create marker만 사용합니다. HTML·entity·image·reference link·blockquote·
fenced/indented code·bare CR·모호하거나 닫히지 않은 bracket과 destination은
거부합니다. 오류가 지목한 표현을 일반 텍스트, inline code 또는 완결된
inline link로 고칩니다. 실제 label도 validator에 전달합니다.

이 예외는 개별 `validate-body`, `create`, `check`, `start`에만 적용합니다.
MVP 일괄 등록은 계속 제품 정본 ID를 요구합니다.

## 상태 계약

- 작업 흐름 label은 `status:todo`, `status:in-progress`, `status:done` 중
  정확히 하나입니다.
- `dependency:blocked`는 열린 GitHub 기본 선행 관계에서 파생합니다.
- MVP·Project 관리 이슈는 Project `Status`와 label을 맞춥니다. 검증된
  `project=none` 일반 이슈는 label을 생명주기 정본으로 사용합니다.
- 담당자가 없고 열린 선행 이슈가 없는 `Todo`만 선점할 수 있습니다.
- 시작 전이에 branch와 agent marker를 기록합니다.
- PR은 `Closes #123` 같은 종료 참조로 이슈를 식별합니다.

## 개별 생성 계약

본문을 검증한 뒤 서로 다른 명시적 실행으로 dry-run과 실제 쓰기를 수행합니다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs create \
  --idempotency-key <stable-key> --title <title> --body <body-file> \
  --milestone <exact-open-title> --label <existing-label> --dry-run
node .agents/skills/run-github-work-item/scripts/work-item.mjs create \
  --idempotency-key <stable-key> --title <title> --body <body-file> \
  --milestone <exact-open-title> --label <existing-label> \
  --confirm-plan <dry-run-token>
```

- stale token, 중복·malformed marker, 다른 본문·milestone·label·의존 관계,
  예상하지 않은 담당자는 fail-closed합니다.
- 도구가 `status:todo`와 파생 `dependency:blocked`를 관리하며 assignee를
  입력하지 않습니다.
- MVP 이슈만 `--project`를 사용합니다.
- 일부 쓰기 뒤 실패하면 이슈를 삭제·덮어쓰기·자동 재시도하지 않습니다.
  현재 상태와 idempotency key를 재조회한 새 dry-run으로 남은 단계만
  계획합니다.

공개 저장소 이슈에 비밀, 내부 네트워크 식별자, 인증 정보와 개인 데이터를
넣지 않습니다.
