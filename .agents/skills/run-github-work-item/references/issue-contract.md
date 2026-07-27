# GitHub 이슈 계약

독립적으로 병합 가능한 결과 하나마다 이슈 하나를 사용한다. AI 개발자가 대화 이력에서 제품 의도를 다시 구성하지 않고 작업할 수 있도록 충분한 맥락을 이슈에 제공한다.

## 필수 본문 구역

다음 제목을 정확한 순서로 사용한다. 마크다운으로 작성한 이슈는 `##`를 사용할 수 있고 GitHub 이슈 양식은 `###`를 생성할 수 있다. 한 본문의 모든 필수 구역은 같은 제목 수준을 사용한다.

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

개별 생성과 일괄 생성 전에 결정적 검증기를 실행한다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs validate-body <body-file>
```

## 내용 규칙

- 이슈는 한국어를 기본 작성 언어로 사용한다. 자연스러운 표현과 정확한 의미 전달을 우선하며, 계약 ID, 레이블, 명령, 경로, URL, 코드 식별자와 기술 용어는 원문을 사용할 수 있다.
- `목표`에 관찰 가능한 결과 하나를 작성한다.
- 모든 구역에 의미 있는 내용을 작성한다. 한 글자 값, `TBD`, `TODO` 또는 코드 울타리 안에 숨긴 제목은 계약을 충족하지 않는다.
- `완료 조건`은 행동 시나리오의 정본이다. 각 시나리오를 관찰 가능한
  Given/When/Then 또는 조건/행동/결과로 작성하고 happy path뿐 아니라 적용
  가능한 error·recovery path를 함께 다룬다. 각 시나리오에 관련 추적 ID 또는
  아래에서 허용한 tooling-only 비적용 근거와 재현 가능한 검증 계획을 연결한다.
- `작업 범위`에 포함 작업과 제외 작업을 구체적으로 나열한다.
- GitHub 기본 `blocked by` / `blocking` 관계를 의존 관계의 정본으로 사용한다. `선행 작업` 문장은 연결 이유를 설명할 뿐 기본 의존 관계를 대신하지 않는다.
- `추적성`에 적용 가능한 정본 ID를 하나 이상 연결한다. `PRD-NN-FR-NN`, `PRD-NN-AC-NN`, `PRD-NN-SP-NN`, `POL-NN-R-NN`을 사용하며 각 숫자 부분은 두 자리 이상일 수 있다. `D-NN` 결정 ID와 `F-NN` 기능 원장 ID는 보조 이력으로 추가할 수 있지만 PRD 또는 정책 정본을 대신하지 않는다. 접두사 없는 `FR-NN`, `AC-NN`, `SP-NN`, `R-NN`은 사용하지 않는다.
- 제품 동작, 사용자 결과, PRD 요구사항과 Policy 규칙을 바꾸지 않는 개별
  tooling-only 작업은 제품 ID 대신 다음 계약을 모두 만족할 수 있다.
  - 실제 type label의 raw 문자열은 앞뒤 whitespace 정규화 없이
    `type:chore` 정확히 하나여야 한다. type label 누락, whitespace 변형,
    다른 type이나 여러 type label은 비적용 근거를 허용하지 않는다.
  - `추적성`에는 direct bullet 한 줄로
    `- 해당 없음 — 제품 동작·PRD·Policy 추적 대상이 아닌 도구 작업: <구체적 사유>`
    를 적는다. 같은 본문에서 제품 계약 ID와 혼용하지 않는다.
  - `완료 조건`의 각 `- 추적 ID:` 행에도 같은 prefix와 시나리오별 구체적
    사유를 적고, `문서 영향`에는
    `- 제품 문서: 변경 없음 — <구체적 근거>` 한 줄을 둔다.
  - `변경 허용 경로`에 `docs/prd` 또는 `docs/policies` 정본 경로를 넣지
    않는다. 레이블과 문구는 구조적 gate일 뿐 tooling-only라는 의미 승인이
    아니므로 독립 리뷰에서 실제 제품 영향이 없는지 확인한다.
  - exact 비적용 prefix가 있는 본문은 rendered ID·경로 projection보다 먼저
    선형 fail-closed 소스 scanner를 통과해야 한다. 허용하는 Markdown은 정확한
    `<!-- lunchtime-work-item:create key=<key> project=<required|none> -->`
    marker 한 줄, 일반 제목·문단·unordered·ordered list·표, inline code와
    같은 줄에서 bracket·destination이 모두 닫힌 `[label](destination)`
    inline link로 제한한다. link destination에는 공백·title을 두지 않는다.
  - inline code 밖에서는 다른 HTML comment·tag·autolink와 모든 `<`·`>`,
    HTML entity, default-ignorable Unicode, image, reference definition,
    full·collapsed·shortcut reference link, blockquote, 4열 이상 소스
    들여쓰기와 각 nested list marker 뒤 tab·5칸 이상 padding,
    indented·fenced code, CRLF가 아닌 bare CR, 닫히지 않거나 짝이 맞지
    않는 link bracket·destination을 거부한다. 이
    제한은 CommonMark 전체를 재해석하는 규칙이 아니라 렌더링 projection의
    모호성을 닫는 의도적인 소스 allowlist다. 오류가 지목한 문법을 일반
    텍스트·inline code 또는 완결된 inline link로 고친다.
  - 본문만 검사할 때도 실제 생성 예정 label을 함께 전달한다.

    ```bash
    node .agents/skills/run-github-work-item/scripts/work-item.mjs \
      validate-body <body-file> --label type:chore
    ```

  이 예외는 개별 `validate-body`, `create`, `check`, `start`에만 적용한다.
  `.github/mvp-work-items.json` 일괄 등록은 계속 제품 정본 ID를 요구한다.
- 같은 이슈와 PR에서 새 PRD·Policy ID를 정의해야 한다면 `추적성`에 정확한
  예상 ID와 `planned — 이 PR에서 정의`를 함께 적는다. 이 예외는 해당 정본
  문서를 같은 변경에서 실제로 만드는 작업에만 사용한다. `변경 허용 경로`와
  `문서 영향`의 같은 항목에는 ID namespace 번호와 파일 번호가 일치하는 구체적
  `docs/prd/**/NN_*.md` 또는 `docs/policies/**/NN_*.md` 파일을 포함하고,
  Ready 전 exact head 기준 제품 문서 validator가 새 ID를 정본에서 확인해야
  한다. `README.md`, 인덱스 또는 재귀 glob만으로는 정의 파일 소유가 되지
  않는다. 별도 구현 이슈가 아직 존재하지 않는 ID를 미리 참조하는 용도로
  사용하지 않는다.
- 경로 구역에는 저장소 상대 경로나 좁은 경로 패턴을 사용한다. 이슈가 실제로 저장소 전반의 변경을 소유하는 경우가 아니면 저장소 전체를 허용하지 않는다.
- `검증`에는 완료 조건의 시나리오별 명령·관찰 방법과 남길 증거를 적는다.
  구현 테스트와 문서 영향 확인 뒤 수행할 독립 리뷰의 최소 인원과 전문 관점도
  위험도에 맞게 계획한다.
- `문서 영향`에는 검토할 PRD 또는 정책 파일을 적거나 제품 동작이 바뀌지 않는 이유를 설명한다.
- 이슈 본문 validator는 제목·순서·필수 내용 같은 객관적 구조만 검사한다.
  시나리오의 제품적 타당성이나 문장 품질을 정규식으로 판정하지 않으며, 이
  계약만을 이유로 기존 이슈를 일괄 마이그레이션하지 않는다.

## 상태 계약

- 작업 흐름 레이블은 `status:todo`, `status:in-progress`, `status:done` 중 정확히 하나만 허용한다.
- `dependency:blocked`는 열려 있는 GitHub 기본 선행 이슈에서 파생한다. 기본 의존 관계 연결을 대신하지 않는다.
- MVP·Project 관리 이슈에서는 Project `Status`와 작업 흐름 레이블이 같은
  단계를 나타내야 한다. `project=none` create marker가 있는 일반 이슈는
  Project 상태를 만들지 않고 작업 흐름 레이블을 생명주기 정본으로 사용한다.
- 담당자가 없고 열린 선행 이슈도 없는 `Todo` 이슈만 선점할 수 있다.
- 시작 전이에 작업 브랜치와 에이전트 표식을 기록한다.
- PR은 `Closes #123` 같은 종료 참조로 이슈를 식별해야 한다.

## 개별 생성 계약

개별 이슈는 `work-item.mjs create`로 생성한다. 본문 파일을 먼저
`validate-body`로 검증하고 다음 두 명령을 서로 다른 명시적 실행으로 사용한다.

```bash
node .agents/skills/run-github-work-item/scripts/work-item.mjs create \
  --idempotency-key <stable-key> --title <title> --body <body-file> \
  --milestone <exact-open-title> --label <existing-label> --dry-run
node .agents/skills/run-github-work-item/scripts/work-item.mjs create \
  --idempotency-key <stable-key> --title <title> --body <body-file> \
  --milestone <exact-open-title> --label <existing-label> \
  --confirm-plan <dry-run-token>
```

- 실제 쓰기 전에 같은 입력의 dry-run 계획 전체를 확인한다. stale token,
  중복 marker·제목, 다른 본문·milestone·요청·파생 label의 정확한 집합·담당자
  상태는 안전하게 실패한다. 요청하지 않은 label은 자동 삭제하지 않는다.
- `status:todo`와 열린 기본 선행 이슈에 따른 `dependency:blocked`는 도구가
  파생한다. type·area 같은 기존 label만 `--label`로 전달하고 선행 이슈는
  `--blocked-by`로 연결한다.
- assignee 입력은 제공하지 않고 생성 요청에도 assignee를 넣지 않는다. 생성
  뒤 담당자 0명을 재조회한다.
- MVP 이슈만 `--project`로 Project 추가와 `Status=Todo`를 요청한다. 일반
  이슈는 Project 없이 생성한다. create marker가 `project=none`이고 이슈
  작성자의 현재 저장소 권한이 write 이상인 경우에만 `check`·`start`와 후속
  생명주기가 Project 조회·전이를 생략한다. 신뢰할 수 없는 작성자의 marker,
  marker가 없는 기존 이슈와 Project opt-in 이슈는 기존 Project 계약을
  유지한다.
- 저장소 전체에서 같은 idempotency key를 찾을 때 관련 없는 malformed marker는
  건너뛴다. 선택된 이슈의 malformed·중복 marker나 신뢰할 수 없는 작성자가
  같은 key를 사용한 충돌은 자동 수정·덮어쓰기하지 않는다.
- 일부 쓰기 뒤 실패하면 생성된 이슈를 자동 삭제·덮어쓰기·재시도하지 않는다.
  완료 단계와 실제 상태를 확인하고 같은 idempotency key로 새 dry-run을 수행한
  뒤 남은 안전한 단계만 별도 명령으로 재개한다. 그 사이 기본 선행 이슈가
  닫혀 stale `dependency:blocked`가 남았다면 이 도구 소유 파생 label만
  mutation 직전 live 의존 관계를 재확인하고 제거할 수 있다.

공개 저장소 이슈에 비밀값, 내부 네트워크 식별자, 인증 정보 또는 개인 데이터를 넣지 않는다.
