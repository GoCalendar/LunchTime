---
name: update-product-docs
description: 사람이 읽기 쉬운 템플릿, 전역 추적 가능한 요구사항, AI가 실행할 수 있는 수용 기준, planned ID 수명주기와 구현 변경 영향 검토를 바탕으로 LunchTime PRD와 정책을 작성·검토·갱신한다. 새 기능을 정의하거나 제품 동작을 변경할 때, PRD 또는 정책을 만들거나 재구성할 때, 구현 이슈를 준비하거나 구현을 완료할 때, 풀 리퀘스트를 생성·갱신할 때 사용한다.
---

# 제품 문서 갱신

제품 의도를 사람이 읽기 쉽고 AI 에이전트가 실행할 수 있게 유지한다. `docs/prd/`는 제품 결과와 요구사항의 정본, `docs/policies/`는 규범적 규칙과 예외의 정본, `docs/product-definition/`은 의사결정 이력으로 취급한다.

## Planned ID 계약

- `planned ID`는 GitHub 이슈의 계획 표식일 뿐 정본 정의가 아니다.
- 새 ID는 승인된 결정이 있고, 구현 이슈가 planned ID와 namespace 번호가
  일치하는 구체적 `NN_*.md` 정본 파일, `README·하위 인덱스`, 구현·테스트
  변경 경로를 소유할 때만 만든다. README나 재귀 glob만으로는 정본 정의
  파일을 소유한 것으로 보지 않는다.
- 문서와 구현은 같은 이슈, branch와 PR에서 함께 작성할 수 있으므로
  별도 문서 이슈나 PR을 만들 필요는 없다.
- Ready 전에는 exact PR head Git tree에서 실제 ID 정의, `README·하위
  인덱스`, validator, 구현·테스트와 PR의 양방향 추적을 확인한다. working
  tree, stale `main`, image alt, raw HTML과 접힌 `<details>` 안의 문자열 또는
  planned 표식만으로 아직 존재하지 않는 ID를 완료 증거로 사용하지 않는다.
- 승인된 결정, planned ID 또는 변경 경로 소유가 없거나 미결정 제품 선택이
  남으면 새 ID를 만들지 않고 중단한다.
- 이 canonical 구역은 plain top-level H2, direct bullet과 2칸 continuation,
  inline code만 사용한다. blockquote, image, link, reference definition,
  fenced·indented code와 raw HTML은 계약 증거가 모호해지므로 사용하지 않는다.
- owner·routing H2의 보호 이름은 지정된 위치에서 source가 정확히
  `## <name>`인 plain top-level ATX 한 줄로만 쓴다. 들여쓰기·container·
  setext·closing `#`, formatting·link·reference·entity·hardbreak와
  종결되지 않거나 모호한 inline 문법을 보호 이름에 사용할 수 없다.
- validator는 임의의 CommonMark rendered 동등성을 보장하지 않는다. bounded
  block scanner가 fenced·indented code와 숨겨진 raw HTML을 후보에서 제외한
  뒤, 다른 H2 후보의 visible/source skeleton이 보호 이름 token sequence를
  나타내거나 포함할 수 있으면 실제 rendering과 무관하게 fail-closed한다.

## 작업 모드 선택

### 작성 또는 재구성

새 제품 범위를 정의하거나, 기능을 전달 단계로 전환하거나, 지나치게 큰 문서를 분리할 때 사용한다.

1. 변경 내용을 새 PRD, 기존 PRD, 정책, 제품 정의, 기술 설계, 이슈 중 어디에 기록할지 결정한다.
2. PRD 작업에는 [PRD 기준](./references/prd-standard.md), [PRD 템플릿](./references/prd-template.md), [가독성과 AI 작업 준비도](./references/readability-and-ai-readiness.md)를 읽는다.
3. 정책 작업에는 [정책 기준](./references/policy-standard.md), [정책 템플릿](./references/policy-template.md), [가독성과 AI 작업 준비도](./references/readability-and-ai-readiness.md)를 읽는다.
4. 새 PRD·Policy ID가 필요하면 [Planned ID 계약](#planned-id-계약)을
   적용한다.
5. 승인된 범위에 필요한 문서만 만든다. 자리표시자 디렉터리나 빈 문서를 만들지 않는다.

### 제안 동작 검토

기능을 구체화하거나 구현 이슈를 만들기 전에 사용한다.

1. 관련 PRD, 정책, 제품 정의 결정과 연결된 근거를 읽는다.
2. 모든 구현 이슈가 제품 요구사항, 수용 기준, 영향을 받는 정책 규칙을 인용할 수 있는지 확인한다.
3. `main`에 아직 없는 새 ID를 구현과 함께 정의한다면
   [Planned ID 계약](#planned-id-계약)을 확인한다.
4. 미결정 제품 선택지는 `docs/product-definition/10_decision_backlog.md`에 기록한다. 제품 결정을 이슈나 기술 설계 안에 숨기지 않는다.
5. 문서 사이의 모순, 중복 규칙, 누락된 실패 조건, 읽기 어려운 구조를 별도의 의미 검토로 확인한다.

### 구현 영향 확인

구현 중, 독립 리뷰 전, 리뷰 변경 후와 풀 리퀘스트를 생성하거나 갱신하기 전에
사용한다. 독립 리뷰 전에 의미 영향과 이슈 경로를 먼저 판정하고, 리뷰 수정으로
tracked content가 바뀌면 이전 판정과 staged delta를 대조해 영향받은 의미를
새 candidate에서 다시 판정한다. 범위·요구사항·보안 경계가 넓어지거나
영향을 확정할 수 없으면 전체 diff를 다시 판정한다.

1. 비교 기준을 결정한다.
   - 사용자나 환경이 제공한 PR 기준 브랜치를 우선 사용한다.
   - 없으면 `origin/main`과의 공통 조상 커밋을 사용한다.
   - 커밋된 변경과 커밋되지 않은 변경을 모두 살핀다.
2. 변경 내용을 분류한다.
   - PRD 영향: 사용자에게 보이는 기능, 흐름, 입력, 출력, 범위, 플랫폼, 제약, 성공 조건, 수용 동작의 변경.
   - 정책 영향: 생명주기, 상태, 권한, 검증, 충돌, 실패, 복구, 동기화, 보존, 암호화, 신뢰, 알림, 예외 상황의 변경.
   - Architecture 영향: 앱 구성요소, 통신·프로토콜, 복제·정합성·복구,
     저장·보안 구조와 구현 경계의 변경.
   - 제품 정의 영향: 명시적 결정, 근거, 가정, 미결정 질문의 변경.
3. 영향을 받는 모든 정본 문서를 같은 변경에서 갱신하고, 새 ID에는
   [Planned ID 계약](#planned-id-계약)을 적용한다.
4. Ready 전 planned ID 검증은 같은 계약의 exact-head 기준을 따른다.
5. 이슈의 변경 허용·금지 경로를 대조한다. 필요한 PRD·Policy·Architecture
   정본 갱신이 누락됐거나 금지 경로·허용 범위 밖이면 tooling-only 비적용을
   승인하거나 현재 이슈 범위를 넓히지 않는다. 별도 제품 계약 이슈로 차단하고
   그 정본 변경이 끝난 새 기준에서 영향 판정을 다시 시작한다.
6. 구현이 승인된 문서와 충돌하거나 제품 결정이 승인되지 않았다면 중단하고
   충돌 또는 미결정 사항을 보고한다.

## 문서 역할 유지

- 문제, 목표 결과, 범위, 사용자 흐름, 관찰 가능한 요구사항, 성공 지표, 수용 기준은 PRD에 기록한다.
- 정확한 상태, 권한, 불변식, 실패 처리, 복구, 보존, 보안 경계는 정책에 기록한다.
- 구현 선택, 프로토콜, 라이브러리, 스키마, 아키텍처는 기술 설계나 ADR 문서에 기록한다.
- 실행할 작업, 파일 소유권, 검증 명령, 의존성은 GitHub 이슈에 기록한다.
- 완전한 규칙을 여러 문서에 복사하지 말고 링크한다.

## 추적성 유지

- 각 PRD에 안정적인 `PRD-NN` ID를 부여한다.
- 요구사항과 수용 기준에 `PRD-NN-FR-NN`, `PRD-NN-AC-NN` 네임스페이스를 적용한다.
- 각 정책에 안정적인 `POL-NN` ID를, 참조 가능한 각 규칙 절에 `POL-NN-R-NN` ID를 부여한다.
- 관련 F-ID와 D-ID 의사결정 이력을 보존한다.
- 문서를 추가·대체·폐기할 때 `README.md`, `docs/prd/README.md`, `docs/policies/README.md`를 갱신한다.
- 폐기한 ID를 다른 의미로 재사용하지 않는다.
- planned ID 수명주기는 [Planned ID 계약](#planned-id-계약)을 따른다.

## 품질 게이트 실행

1. 작성·구현 중에는 바뀔 snapshot에 필요한 좁은 행동 테스트와 관련 validator
   테스트만 실행한다. 이 결과는 리뷰 뒤 최종 저장소 게이트의 통과 증거를
   대신하지 않는다.
2. 전체 diff와 경로를 [구현 영향 확인](#구현-영향-확인)에 따라
   PRD·Policy·Architecture·제품 정의에 대조하고, 의미 영향 판정과 planned ID
   계약을 독립 리뷰 전에 끝낸다.
3. 구현 이슈의 commit 흐름에서는 `commit-work-item`이 clean 독립
   worktree에서 검토할 경로만 명시적으로 stage해 cached diff·candidate
   tree를 고정한다. 이 스킬은 영향 판정만 인계하고 독자적으로 index를
   변경하지 않는다. candidate 고정 직후 빠른 공통 gate가 먼저 통과해야
   작성 컨텍스트와 분리된 읽기 전용 검토자가 최초 candidate 전체를 의미
   검토한다. 작성자 자기 검토는 독립 검토가 아니므로 작성·수정자와 최종
   승인자를 분리한다.
   - 의도한 답이나 예상 결론 없이 원본 요구사항, 같은 cached diff와 행동
     테스트·정본 영향 결과를 제공한다.
   - 발견 사항은 P0~P2, 파일 위치와 재현 근거로 보고하고 같은 snapshot의
     결과를 합쳐 일괄 수정한다.
   - 낮은 위험의 단순 문서 변경은 최소 1명, 계약·validator·workflow 변경은
     최소 2명, 분산 통신·정합성·보안 같은 고위험 변경은 필요한 전문 관점별
     검토자를 사용한다.
   - 수정하면 즉시 명시적으로 stage하고 빠른 공통 gate를 먼저 통과시킨다.
     D0만의 추가 수정은 review 전에 끝내므로 pass를 소비하지 않는다. 그 뒤
     좁은 테스트와 의미 영향 판정을 갱신하고 다음 독립 검토 pass에
     이전·현재 tree, staged delta와 현재 전체 cached diff를 제공한다.
     범위·요구사항·보안 경계가 넓어지거나 review chain에 공백·모호함이
     있으면 새 전체 리뷰가 필요하다. review-fix 사이에는 무거운 회귀군을
     실행하지 않는다. 최초 리뷰를 1회로 세어 최대 3회이며, 3회 뒤에도
     P0/P1이 남으면 승인하지 않고 blocker로 보고한다.
4. 최종 gate의 선택·증거 유지·무효화는
   [`commit-work-item` 계약](../commit-work-item/references/commit-contract.md)이
   소유한다. 모든 staged candidate를 고정한 직후, 독립 리뷰 전에 제품 문서
   실제 validator를 포함한 빠른 공통 gate를 실행한다. staged patch 공백
   검사는 working tree가 아닌 index를 검사해야 한다. 리뷰 뒤 tree가
   그대로면 이 D0 증거를 최종 증거로 유지한다.

   ```bash
   node .agents/skills/update-product-docs/scripts/validate-product-docs.mjs
   git diff --cached --check
   ```

5. 제품 문서 계약 ID·validator 회귀 테스트는 helper가
   현재 base→candidate의 `product-docs-regression`을 선택하고 독립 리뷰가
   끝난 뒤에만 실행한다. 단순 Markdown 수정도 빠른 공통 gate는 생략하지
   않는다.
6. gate 실패를 고쳐 tracked content가 바뀌면 즉시 명시적으로 stage하고
   빠른 공통 gate를 먼저 통과시킨 뒤 필요한 좁은 행동 테스트와 이 절의 의미
   영향 판정, delta review를 갱신한다. `commit-work-item`은 현재
   `selectedGroups ∩ invalidatedGroups`만 재실행하고 선택된 unchanged PASS는
   유지하며 pending은 계속하고 unselected 증거는 버린다.
7. 공유 계약·classifier·입력 manifest, base·환경 또는 선언하지 않은 입력이
   바뀌거나 영향 범위를 확정할 수 없으면 로컬 무거운 회귀군 전체를
   무효화한다. helper 자체 변경은 로컬 `invalidatedGroups` 전체에 포함하지만
   current selection에 없는 군은 `not-required`로 버리고, 원격 CI는 owning
   `commit-pr-regression`만 실행한다. tree·input이 같은 환경 전용 실패만
   원인과 동일성 근거를 남긴 새 명령으로 한 번 재실행하며 자동 반복하지
   않는다.
8. 독립 검토는 기존 작업·문서 Skill 안에서 조정한다. 독립 역할이 반복적으로
   필요하다는 별도 근거 없이 리뷰 전용 Skill을 만들지 않는다.
9. 의미 검토에서 다음을 확인한다.
   - PRD와 정책의 일치 여부
   - Architecture와 제품 계약의 경계 일치 여부
   - 요구사항과 수용 기준의 연결 범위
   - 누락된 실패·복구 사례
   - 중복된 규범적 규칙
   - 사람이 훑어보기 쉬운 구조
   - 추측 없이 구현할 수 있는지 여부
10. 스크립트 통과나 작성자의 자기 검토를 의미상 정확성의 독립 증거로
   취급하지 않는다.

## 안전 규칙

- 문서와 스킬은 한국어를 기본 작성 언어로 사용한다. 자연스러운 표현과 정확한 의미 전달을 우선하며, 계약 ID, 파일 경로, 명령, URL, 코드·API 식별자, 기술 용어와 고유명사는 원문을 사용할 수 있다.
- 우연한 구현 동작에 맞추려고 제품 결정을 다시 쓰지 않는다.
- 구현을 진행하려는 목적으로 누락된 결정을 임의로 만들지 않는다.
- 새 ID의 중단 조건은 [Planned ID 계약](#planned-id-계약)을 따른다.
- 커밋할 문서에 비밀, 내부 자격 증명, 개인 컴퓨터 경로, 채팅 내용, 로컬 Git 설정을 넣지 않는다.
- 관찰 가능한 조건이나 명시적인 미결정 항목 없이 `적절히`, `충분히`, `빠르게` 같은 모호한 승인 표현을 사용하지 않는다.
- 검증 경로가 없는 요구사항을 추가하지 않는다.
- 구현을 실질적으로 바꿀 수 있는 미결정 사항이 남아 있으면 초안을 승인 상태로 표시하지 않는다.

## 결과 보고

문서를 작성하거나 검토할 때 다음 형식으로 보고한다.

```text
제품 문서
- 모드: 작성 / 검토 / 구현 영향
- PRD: 변경 문서와 요구사항 ID / 변경 없음
- 정책: 변경 문서와 규칙 ID / 변경 없음
- Architecture: 변경 문서 / 변경 없음
- 제품 정의: 변경 결정 / 변경 없음
- Planned ID: 없음 / 계약 검증 결과
- 미결정 사항: 없음 / ID
- candidate: cached diff·tree와 input 상태 / 대상 아님
- 의미 영향: 통과 / 문서 변경 필요 / blocker
- 독립 리뷰: 대상 아님 / 검토자 수·관점·candidate tree와 P0~P2 결과 / blocker
- 최종 게이트: 동일 candidate에서 통과 / 실패 / 아직 미실행
```

읽기 전용 감사에서는 편집하지 않는다. 정확한 문서와 계약 근거를 들어 `문서 변경 필요` 또는 `문서 변경 불필요`로 보고한다.
