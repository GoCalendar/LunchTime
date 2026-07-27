# LunchTime

> 점심 모집의 상태는 구조화하고, 필요한 대화는 그 맥락 안에 남기는 macOS 앱.

LunchTime은 회사에서 반복되는 점심 모집과 배달 주문 협의를 돕는 도구입니다. 점심방마다 참여자, 가게, 메뉴, 주문 마감, 주문 완료 상태를 한곳에서 관리하고, 방 안에서 필요한 대화를 이어갈 수 있도록 합니다.

현재는 제품 정의 회의를 마치고 승인된 PRD·정책 문서를 바탕으로 기술 검증과 구현 작업을 준비하는 단계입니다. 이 README는 아이디어가 어떤 논의를 거쳐 요구사항과 정책으로 확정되는지 안내하는 문서 인덱스입니다.

## 현재 제품 방향

- 전 사원이 MacBook을 사용하는 환경을 전제로 하며 Windows는 고려하지 않습니다.
- 별도 운영 서버 없이 지원 회사 WiFi에서 자동 신뢰된 LunchTime 피어(Peer)끼리 암호화된 로컬 데이터를 복제합니다.
- 점심 운영 시간은 `Asia/Seoul` 기준 11:00~14:30이며, 14:30부터 사용자 입력을 닫고 최대 120초 동안 종료 스냅샷을 대조합니다.
- 한 점심방은 한 가게의 주문 그룹이며, 참여자·개인 메뉴·마감·주문 상태와 방별 채팅을 함께 제공합니다.
- 점심과 무관한 대화를 위한 `라운지`를 MVP에 포함합니다.
- 과거 주문 히스토리에서 가게명과 배달의민족 링크를 재사용해 새 방을 빠르게 만듭니다.
- 취소되지 않은 종료 방의 구조화 상세는 자동 신뢰된 피어에게 최대 14일 열람 전용으로 제공하고, 성공 주문의 재모집용 최소 가게 히스토리는 더 오래 로컬에 남깁니다.
- 사용자가 입력한 배달의민족 링크 문자열은 검증·정규화 없이 Mac 화면의 QR로 휴대폰에 전달합니다.
- 참여와 메뉴의 누락 가능성을 숨기지 않고, 데이터가 불완전하면 주문 완료를 차단합니다.
- 동기화 실패는 트리거당 최대 3회·총 30초에서 멈추며, 새 의미 있는 트리거나 수동 새로고침으로만 다시 시도합니다.

확정된 제품 범위와 사용자 경험은 PRD를, 상태·권한·동기화·보존·보안 규칙은 정책 문서를 기준으로 판단합니다. 실제 사내망에서의 피어 발견, 자동 신뢰 네트워크 판정, 암호 키 교환과 성능 한계는 출시 전 기술 검증이 필요합니다.

## 문서 체계

| 경로 | 역할 | 성격 |
|------|------|------|
| `docs/product-definition/` | 아이디어, 가설, 질문, 논의와 의사결정 과정을 기록합니다. | 논의 이력 |
| `docs/prd/` | 논의를 거쳐 확정된 제품·기능 요구사항을 기록합니다. | 요구사항 정본 |
| `docs/policies/` | 상태 전이, 권한, 예외 처리 등 세부 동작 규칙을 기록합니다. | 동작 규칙 정본 |
| `docs/architecture/` | 승인된 제품 계약을 실현하는 구성요소, 통신과 데이터 흐름을 설명합니다. | 기술 구조 |

`product-definition`은 결정의 배경을 이해하기 위한 기록입니다. 현재 제품이 어떻게 동작해야 하는지는 PRD와 정책 문서를 기준으로 판단합니다. 두 정본 사이에 모순이 발견되면 어느 한쪽을 임의로 우선하지 않고 함께 정정합니다.

문서와 디렉터리는 실제로 필요한 시점에만 만들며, 새 문서가 생기면 아래 인덱스에 추가합니다.

## 문서 언어 원칙

문서와 스킬은 한국어를 기본 작성 언어로 사용합니다. 다만 자연스러운 표현과
정확한 의미 전달을 우선하며, PRD·POL·D·F ID, 파일 경로, 명령, URL,
코드·API 식별자, 기술 용어와 제품·플랫폼 고유명사는 원문을 사용할 수 있습니다.

## 문서 인덱스

### 제품 정의 과정

| 순서 | 문서 | 역할 |
|------|------|------|
| 00 | [초기 아이디어](docs/product-definition/00_initial_idea.md) | 문제의식과 지금까지의 논의 기록 |
| 01 | [제품 방향](docs/product-definition/01_product_direction.md) | 목적, 대상, 가치, 제약과 비목표 |
| 02 | [현재 점심 주문 여정](docs/product-definition/02_current_lunch_journey.md) | Slack과 배민을 이용하는 현재 방식 |
| 03 | [문제와 유지할 강점](docs/product-definition/03_pains_and_existing_strengths.md) | 개선할 문제와 잃지 말아야 할 장점 |
| 04 | [가설과 검증 계획](docs/product-definition/04_assumptions_and_validation.md) | 제품·기술 가설과 검증 순서 |
| 05 | [어떻게 하면 질문](docs/product-definition/05_how_might_we.md) | 구체적인 해결 질문과 가설적 답 |
| 06 | [기능 후보 목록](docs/product-definition/06_feature_inventory.md) | 우선순위 없는 F-ID 작업 원장 |
| 07 | [경험 및 정보 구조](docs/product-definition/07_experience_structure.md) | 기능을 macOS 화면에 배치한 제안 |
| 08 | [목표 사용자 여정](docs/product-definition/08_target_lunch_journey.md) | LunchTime에서 기대하는 전체 흐름 |
| 09 | [범위 제안](docs/product-definition/09_scope_proposal.md) | MVP 후보, 검증 게이트와 후속 범위 |
| 10 | [결정 및 미결정 목록](docs/product-definition/10_decision_backlog.md) | 확정 방향, 제안과 PRD 전 결정 과제 |

제품 정의 과정은 [da-in/vibe-sprint](https://github.com/da-in/vibe-sprint)의 단계형 사고 모델에서 통찰을 얻되, 정해진 단계(STEP)·순서·산출물에 종속되지 않고 LunchTime에 필요한 방식으로 진행합니다.

제품 정의 문서는 제공된 아이디어와 피드백, 결정의 배경을 구조화한 기록입니다. 현재 동작의 정본은 아래 PRD와 정책 문서이며, 기술 검증으로 전제가 달라지면 결정 기록과 정본을 함께 갱신합니다.

### PRD

| 문서 | 역할 |
|------|------|
| [PRD 안내](docs/prd/README.md) | PRD의 역할, 문서 목록과 변경 원칙 |
| [PRD-01. LunchTime MVP](docs/prd/01_lunchtime_mvp.md) | MVP 범위, 사용자 경험, 기능 요구사항과 수용 조건 |

PRD-01은 첫 번째 제품 약속입니다. 앞으로 독립적인 사용자 문제·제품 결과·
릴리스 약속이 생기면 새 PRD를 추가하고, 같은 약속의 세부 변경은 기존 PRD를
갱신합니다. 구현 작업 하나마다 PRD를 새로 만드는 구조는 아닙니다.

### 정책 문서

| 문서 | 정본 범위 |
|------|-----------|
| [정책 문서 안내](docs/policies/README.md) | 정책 문서의 역할, 우선순위와 목록 |
| [POL-01. 일일·방 생명주기](docs/policies/01_daily_room_lifecycle.md) | 11:00~14:30 일일 세션, 참여, 메뉴, 주문 완료와 자동 종료 |
| [POL-02. 복제·정합성·보존](docs/policies/02_replication_consistency_retention.md) | P2P 장부, 복귀 동기화, 누락 방지, 보존과 히스토리 |
| [POL-03. 보안·신뢰 경계](docs/policies/03_security_and_trust.md) | 회사 WiFi 자동 신뢰, 전송·저장 암호화와 내부 위협 경계 |
| [POL-04. macOS 화면·채팅](docs/policies/04_surfaces_and_chat.md) | 메뉴 막대, 방, 라운지, QR과 연결 상태 화면 |

### 시스템 아키텍처

[시스템 아키텍처 인덱스](docs/architecture/README.md)에서 시스템 경계,
Peer 발견·연결, 메시지 교환, 복제·복구, 저장·보안 문서를 질문별로 찾을 수
있습니다.

### 개발 표준

- [개발 하네스 가이드](docs/development/01_harness_guide.md)는 Claude Code와
  Codex의 요청을 정본 입력과 단일 Skill owner에 연결하고, 이슈 확인부터
  병합 뒤 완료까지의 11단계와 독립 리뷰 계약을 잇는 orchestrator 인덱스입니다.
- [BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)은 제품 정본을
  행동 시나리오, 결정적 테스트와 회귀 증거로 전환하는 기준을 설명합니다.

## 앱 빌드와 검증

| 항목 | 값 |
|------|-----|
| 최소 지원 macOS | 14.0 |
| Xcode | 26.2 (로컬·CI 공통) |
| UI 프레임워크 | SwiftUI 단독. AppKit을 직접 사용하지 않습니다. |
| 앱·단위 테스트 scheme | `LunchTime` |
| UI 테스트 scheme | `LunchTimeUITests` |
| 대상 | 앱 `LunchTime`, 단위 테스트 `LunchTimeTests`, UI 테스트 `LunchTimeUITests` |
| 앱 번들 식별자 | `com.gocalendar.LunchTime` |

로컬에서 다음 명령으로 빌드와 테스트를 실행합니다.

```bash
xcodebuild build -project LunchTime.xcodeproj -scheme LunchTime -destination 'platform=macOS'
xcodebuild test -project LunchTime.xcodeproj -scheme LunchTime -destination 'platform=macOS'
```

CI는 같은 project·scheme·destination과 같은 테스트 실행 대상을 사용합니다. 다만
`-skip-testing`으로 UI 제외를 한 번 더 못박고 Release 구성 빌드를 추가로
검사합니다. 아래 `테스트 구성`과 `CI 게이트` 절을 함께 보십시오.

CI는 `DEVELOPER_DIR`로 Xcode 26.2를 고정합니다. runner 이미지 기본값은 더 낮은
버전이라 고정하지 않으면 로컬과 다른 SDK로 컴파일되고, 로컬에서 통과한 코드가
CI에서만 깨질 수 있습니다. 이미지에서 이 버전이 사라지면 앱 게이트가 설치된
Xcode 목록을 출력하며 실패하므로, 그때 지원 버전을 다시 정합니다.

### 소스 폴더 규칙

- `LunchTime/`, `LunchTimeTests/`, `LunchTimeUITests/` 아래에 파일이나 폴더를
  추가하면 `LunchTime.xcodeproj/project.pbxproj`를 수정하지 않아도 컴파일 대상에
  포함됩니다.
- 한 대상 안에서 Swift 파일 이름은 전역으로 유일해야 합니다. 폴더를 나눠도 같은
  이름을 쓸 수 없으므로(`Room/View.swift`와 `Lounge/View.swift`는 함께 빌드되지
  않습니다) 기능을 드러내는 이름을 사용합니다.
- 코드가 아닌 파일은 해당 대상의 리소스로 흡수됩니다. `*.md`는 빌드에서
  제외하지만 그 밖의 파일을 `LunchTime/` 아래에 두면 앱 번들에 포함됩니다.
- 리소스 파일은 확장자를 포함한 이름이 한 대상 안에서 유일해야 합니다. 리소스는
  번들에 평탄하게 복사되므로 서로 다른 폴더의 같은 이름 파일은 함께 빌드되지
  않습니다. `Alpha/thing.txt`와 `Beta/thing.txt`는 충돌하고,
  `thing.txt`와 `thing.json`은 공존합니다. Swift 파일은 확장자가 같으므로 결과적으로
  이름 자체가 유일해야 합니다.
- 공통 테스트 fixture는 `LunchTimeTests/Support/`에 둡니다. 현재 이 폴더에는
  기준선 테스트도 함께 있습니다. 저장소 최상위 `Tests/`는 어떤 대상에도
  동기화되지 않으므로 fixture 위치로 쓸 수 없습니다.
- 다음 변경은 폴더 추가로 해결할 수 없고 `LunchTime.xcodeproj`를 편집해야
  합니다: Swift Package 의존성, `Info.plist` 키, entitlement, 새 빌드 설정.
  이 파일은 단일 소유 대상이므로 전용 이슈에서 변경합니다. 현재 작업 목록에는
  이 파일을 편집할 수 있는 후속 이슈가 없어 새로 만들어야 합니다.

### 서명과 배포

- 빌드 재현성을 위해 코드 서명을 ad-hoc(`CODE_SIGN_IDENTITY = "-"`)으로
  고정했습니다. 인증서 보유 여부와 무관하게 로컬과 CI가 같은 경로를 탑니다.
  이는 빌드 설정이며 출시 서명·배포 정책이 아닙니다.
- App Sandbox와 Hardened Runtime은 현재 꺼져 있습니다. 공증, entitlement와
  배포 방식은 이 골격에서 확정하지 않습니다.
- 최소 macOS 버전과 SwiftUI 경계는 [PRD-01](docs/prd/01_lunchtime_mvp.md)이 앱
  기반 작업에 위임한 기술 선택이며 사용자에게 보이는 제품 동작을 바꾸지
  않습니다. 같은 절이 요구하는 출시 검토 증거는 아직 확보하지 않았습니다.

### 테스트 구성

위 `xcodebuild test` 명령은 단위 테스트 `LunchTimeTests`만 실행합니다. UI 테스트
`LunchTimeUITests`는 기본 scheme의 테스트 대상에서 제외되어 있습니다. UI 실행은
automation mode 권한과 앱 실행 타이밍에 의존해 결정적이지 않고, 한 번 실패하면
테스트 데몬 상태가 남아 이후 테스트 실행까지 막는 것을 확인했습니다.
[BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)도 E2E를 MVP 필수
게이트로 두지 않습니다.

UI 테스트를 실행할 때는 전용 scheme을 사용합니다.

```bash
xcodebuild test -project LunchTime.xcodeproj -scheme LunchTimeUITests -destination 'platform=macOS'
```

CI는 기본 scheme을 사용하고 `-skip-testing:LunchTimeUITests`로 한 번 더 제외해
scheme이 바뀌어도 게이트가 결정적으로 유지되게 합니다. UI 대상은 CI에서도 계속
빌드되므로 컴파일 회귀는 잡힙니다.

테스트는 Debug 구성에서만 실행합니다. `@testable import`가 필요한 테스트 대상은
Release 구성에서 빌드되지 않습니다.

### 작업 트리 운영 제약

이슈 작업 트리에서는 Xcode GUI로 프로젝트를 열지 않습니다. Xcode는 개인 IDE
상태를 만들고, 작업 완료 절차는 작업 트리에 잔여물이 있으면 정리를 중단합니다.
빌드 산출물은 저장소 밖 기본 위치에 두고 `-derivedDataPath`로 저장소 안을
지정하지 않습니다.

`.gitignore`는 커밋을 막을 뿐 작업 완료 절차를 통과시키지 않습니다. 완료 절차는
무시된 잔여물도 허용하지 않으므로, 정리 전에
`git status --porcelain --untracked-files=all --ignored=matching`으로 남은 항목을
확인합니다. 최상위 `.omc`는 유일하게 허용되는 항목이므로 삭제하지 않고, 그 밖의
항목만 제거합니다. `xcodebuild`도 빈 작업 공간 디렉터리를 만들 수 있습니다.

### CI 게이트

| 게이트 | 워크플로 | 검사 |
|--------|----------|------|
| 앱 빌드·테스트 | [`macOS 앱 검증`](.github/workflows/app-ci.yml) | `xcodebuild build`, `xcodebuild test`와 Release 구성 빌드 |
| 제품 문서 | [`저장소 작업 도구 검증`](.github/workflows/validate-harness.yml) | `validate-product-docs.mjs` |
| 패치 공백 | [`저장소 작업 도구 검증`](.github/workflows/validate-harness.yml) | `git diff --check` |

두 워크플로는 서로 독립적으로 실패합니다. 제품 문서 검증과 패치 공백 검사는
같은 job의 개별 단계이므로 앞 단계가 실패하면 실행되지 않습니다.

병합을 차단하는 필수 검사는 저장소 ruleset이 정합니다. 현재 ruleset은 하네스
워크플로의 `validate` 검사만 필수로 요구하므로 앱 게이트는 아직 병합을 막지
않습니다. 앱 게이트를 병합 조건으로 만들려면 ruleset에 `app-test`를 추가해야
합니다. 두 워크플로 모두 job에 별도 표시 이름을 두지 않으므로 job 이름이 그대로
검사 이름이 됩니다.

## 제품 문서 갱신 절차

구현을 마치고 PR을 만들기 전에는 [update-product-docs](.agents/skills/update-product-docs/SKILL.md) 스킬(Skill)로 변경사항이 PRD·정책 문서에 미치는 영향을 확인합니다. 제품 동작이나 보장 범위가 달라졌다면 코드와 정본 문서를 같은 변경에서 갱신합니다. 새 PRD·Policy ID의 문서·구현 동시 작업 조건과 Ready 전 추적성은 같은 Skill의 planned ID 계약을 따릅니다.

스킬의 단일 원본은 `.agents/skills/`에 두며, Claude에서도 같은 스킬을 사용하도록 `.claude/skills`를 해당 디렉터리의 심볼릭 링크로 연결합니다.

## AI 작업 하네스

- [공용 AI 작업 협약](AGENTS.md)은 Codex와 Claude Code가 함께 따르는
  정본입니다. `CLAUDE.md`는 이 파일을 가리킵니다.
- [개발 협약](CONTRIBUTING.md)은 Trunk-Based Development, 브랜치,
  작업 템플릿, 커밋, 풀 리퀘스트와 병합 규칙을 연결하는 사람용 정본입니다.
- [`update-product-docs` 스킬](.agents/skills/update-product-docs/SKILL.md)은
  PRD·정책 생성, 추적성, 가독성과 구현 변경의 문서 영향을 검사합니다.
- [`run-github-work-item` 스킬](.agents/skills/run-github-work-item/SKILL.md)은
  on-demand 이슈 생성, 준비 확인, 작업 선점, 병합 뒤 완료와 후행 작업 해제를
  관리합니다.
- [`commit-work-item` 스킬](.agents/skills/commit-work-item/SKILL.md)은
  이슈 범위, 검증, 문서 영향과 작성자 정보를 확인하고 원자적 커밋을 만듭니다.
- [`open-pull-request` 스킬](.agents/skills/open-pull-request/SKILL.md)은
  변경 요약, 추적성, 검증 근거와 문서 영향 판정을 구조화해 PR을 만들고,
  명시적인 완료·병합 요청에서는 현재 head를 다시 검증해 finalize합니다.
- [MVP 작업 목록](.github/mvp-work-items.json)은 40개 작업의 순서,
  우선순위, 경로 소유권과 GitHub 기본 의존성 DAG의 정본입니다.
- [MVP 프로젝트](https://github.com/orgs/GoCalendar/projects/1)와
  [MVP 보드](https://github.com/orgs/GoCalendar/projects/1/views/2)는
  `Todo / In Progress / Done` 실행 상태를 보여줍니다.
- [작업 관리 설정](.github/work-management.json)과
  [일괄 등록 절차](.agents/skills/run-github-work-item/references/bulk-registration.md)는
  작업 목록을 이슈·마일스톤·프로젝트 필드와 안전하게 맞추는 방법을 정의합니다.
- [MVP 작업 이슈 양식](.github/ISSUE_TEMPLATE/work-item.yml)은 모든 작업이
  같은 맥락·완료 조건·의존성·경로 소유권·검증 정보를 갖게 합니다.
- [PR 템플릿](.github/PULL_REQUEST_TEMPLATE.md)은 다음 AI가 대화 이력 없이
  맥락과 핵심 검토 지점을 복원할 수 있는 고정 본문 구조를 제공합니다.
- [하네스 검증 워크플로](.github/workflows/validate-harness.yml)는 PR과
  `main` 변경에서 문서·스킬 스크립트·패치 형식을 검사합니다.
- [macOS 앱 검증 워크플로](.github/workflows/app-ci.yml)는 PR과 `main` 변경에서
  앱 빌드와 테스트를 검사합니다. PR 본문·제목 편집에서는 재실행하지 않습니다.

실제 요청 라우팅과 단계는
[개발 하네스 가이드](docs/development/01_harness_guide.md), 사람용 규칙과 예외는
[개발 협약](CONTRIBUTING.md)을 기준으로 판단합니다. 준비된 이슈를 선점한 뒤
독립 작업 트리에서 구현하고, 제품 문서 영향 확인, 원자적 커밋, 검증된 PR,
요청된 경우에만 squash merge와 완료 전이를 순서대로 수행합니다.
