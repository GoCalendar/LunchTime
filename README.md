# LunchTime

> 점심 모집의 상태는 구조화하고, 필요한 대화는 그 맥락 안에 남기는 macOS 앱.

LunchTime은 회사에서 반복되는 점심 모집과 배달 주문 협의를 돕는 도구입니다. 점심방마다 참여자, 가게, 메뉴, 주문 마감, 주문 완료 상태를 한곳에서 관리하고, 방 안에서 필요한 대화를 이어갈 수 있도록 합니다.

현재 제품 동작은 승인된 PRD·정책을 기준으로 구현합니다. 이 README는 저장소와
문서의 탐색 인덱스이며 모든 이슈가 처음부터 전부 읽는 작업 컨텍스트가
아닙니다. 구현 입력은 GitHub 이슈가 지정한 정확한 문서·코드·테스트
범위입니다.

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
| `docs/product-definition/` | 초기 아이디어와 의사결정 과정을 보존합니다. | 역사 archive |
| `docs/prd/` | 논의를 거쳐 확정된 제품·기능 요구사항을 기록합니다. | 요구사항 정본 |
| `docs/policies/` | 상태 전이, 권한, 예외 처리 등 세부 동작 규칙을 기록합니다. | 동작 규칙 정본 |
| `docs/architecture/` | 승인된 제품 계약을 실현하는 구성요소, 통신과 데이터 흐름을 설명합니다. | 기술 구조 |

`product-definition`은 일반 구현·리뷰·문서 영향 판정의 입력이 아닙니다.
사용자가 역사 조사를 명시적으로 요청하거나 archive 자체를 유지하는 이슈가
아니면 읽거나 수정하지 않습니다. 현재 제품 동작은 PRD와 정책을 기준으로
판단하며 두 정본이 충돌하면 임의로 우선하지 않습니다.

문서와 디렉터리는 실제로 필요한 시점에만 만들며, 새 문서가 생기면 아래 인덱스에 추가합니다.

## 문서 언어 원칙

문서와 스킬은 한국어를 기본 작성 언어로 사용합니다. 다만 자연스러운 표현과
정확한 의미 전달을 우선하며, PRD·POL·D·F ID, 파일 경로, 명령, URL,
코드·API 식별자, 기술 용어와 제품·플랫폼 고유명사는 원문을 사용할 수 있습니다.

## 문서 인덱스

### 제품 정의 archive

`docs/product-definition/`의 파일별 목록은 일반 작업 인덱스에서 제외합니다.
이 archive는 초기 브레인스토밍의 역사 보존용이며 새 결정과 미결정 작업은
GitHub 이슈, 승인된 제품 결과는 PRD·Policy에서 관리합니다.

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
  Codex의 요청을 exact issue context와 단일 Skill owner에 연결하는
  orchestrator 인덱스입니다.
- [BDD/ATDD 테스트 표준](docs/development/02_testing_standard.md)은 제품 정본을
  행동 시나리오와 `direct case/suite → affected target → subsystem → global`
  선택으로 전환하는 기준을 설명합니다.
- [검증 게이트와 CI 흐름](docs/development/03_validation_ci_flow.md)은 구현 중
  artifact별 validator와 영향받은 원격 CI target을 고르는 경계를 설명합니다.

## 앱 빌드와 검증

| 항목 | 값 |
|------|-----|
| 최소 지원 macOS | 14.0 |
| Xcode | CI 고정 26.2. 고정 이전 CI 실행이 16.4에서, 로컬이 26.1에서 게이트 통과를 확인했습니다. 구조적 하한은 16.0입니다. |
| Swift 언어 모드 | 6.0. actor 격리 기본값은 `nonisolated`이며 `SWIFT_DEFAULT_ACTOR_ISOLATION`을 설정하지 않습니다. |
| Node.js | CI는 24로 고정하며 24에서 게이트 전 항목 통과를 확인했습니다. 20.10.0에서는 한 항목이 실패합니다. |
| UI 프레임워크 | SwiftUI 단독. AppKit을 직접 사용하지 않습니다. |
| 앱·단위 테스트 scheme | `LunchTime` |
| UI 테스트 scheme | `LunchTimeUITests` |
| 대상 | 앱 `LunchTime`, 단위 테스트 `LunchTimeTests`, UI 테스트 `LunchTimeUITests` |
| 앱 번들 식별자 | `com.gocalendar.LunchTime` |

로컬 build와 직접 관련 XCTest의 예시는 다음과 같습니다.

```bash
xcodebuild build -project LunchTime.xcodeproj -scheme LunchTime -destination 'platform=macOS'
xcodebuild test -project LunchTime.xcodeproj -scheme LunchTime -destination 'platform=macOS' -only-testing:LunchTimeTests/<TestClass>/<testMethod>
```

영향받은 case를 분리할 수 없을 때 affected test target으로 넓히고, subsystem
또는 전체 test는 영향 범위가 불명확하거나 release 검증을 명시한 예외에만
사용합니다. CI도 같은 project·scheme·destination과 영향 선택을 사용합니다.
아래 `테스트 구성`과 `CI 게이트` 절을 함께 보십시오.

CI는 `DEVELOPER_DIR`로 Xcode 26.2를 고정합니다. runner 이미지 기본값은 더 낮은
버전이라 고정하지 않으면 실행마다 다른 SDK로 컴파일될 수 있고 게이트가 결정적으로
유지되지 않습니다. 이미지에서 이 버전이 사라지면 앱 게이트가 설치된 Xcode 목록을
출력하며 실패하므로, 그때 지원 버전을 다시 정합니다.

이 고정은 CI에만 적용하며 로컬 Xcode 버전을 강제하지 않습니다. 로컬과 CI의 SDK가
다르면 로컬에서 통과한 코드가 CI에서만 깨질 수 있으므로, 두 결과가 갈리면 이 차이를
먼저 확인합니다. 실증된 하한은 Xcode 16.4입니다. `DEVELOPER_DIR` 고정 이전
CI 실행이 runner 기본 툴체인 Xcode 16.4에서 앱 빌드·테스트·Release 빌드를 모두
통과했습니다. 구조적 하한은 16.0이며 `project.pbxproj`의 `objectVersion = 77`,
폴더 동기화 그룹과 `SWIFT_VERSION = 6.0`이 그보다 낮은 Xcode를 배제합니다.

저장소 도구 검증은 Node.js 24 이상에서 실행합니다. `.agents/skills/` test
일부가 확장자 없는 stub 파일에 ESM 문법을 사용하므로 Node 20에서는 module
자동 감지가 없어 실패합니다. CI는 24로 고정하며 로컬도 같은 계열을
사용합니다.

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
  이름 자체가 유일해야 합니다. 이 두 규칙은 Xcode 폴더 동기화의 문서화된 동작에서
  따온 것이며 이 저장소에서 실행으로 확인하지는 않았습니다.
- 공통 테스트 fixture는 `LunchTimeTests/Support/`에 둡니다. 현재 이 폴더에는
  기준선 테스트도 함께 있습니다. 저장소 최상위 `Tests/`는 어떤 대상에도
  동기화되지 않으므로 번들 리소스로 쓰려면 `LunchTime.xcodeproj` 편집이
  필요합니다. `#filePath` 기준 상대 경로로 읽는 fixture는 번들 동기화를 요구하지
  않지만, `.github/mvp-work-items.json`이 LT-035~LT-040에 부여한
  `Tests/Fixtures/**` 소유 경로와 이 규칙 중 어느 쪽을 정본으로 삼을지는 아직
  결정되지 않았습니다.
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
- [PRD-01](docs/prd/01_lunchtime_mvp.md) 10절은 최소 macOS 버전, SwiftUI/AppKit
  경계, 코드 서명과 배포 방식 네 항목을 앱 기반 작업에 위임합니다. 이 골격은 앞
  두 항목만 확정했고 서명·배포는 확정하지 않았습니다. 같은 절이 요구하는 출시
  검토 증거도 아직 확보하지 않았습니다. 서명·배포를 확정하려면
  `LunchTime.xcodeproj` 편집이 필요하지만 현재 작업 목록에 그 파일을 소유한
  후속 이슈가 없어 전용 이슈를 새로 만들어야 합니다.

### 테스트 구성

`-only-testing`을 제거한 전체 target 명령은 단위 테스트 `LunchTimeTests`를
모두 실행합니다. 영향 범위를 한정할 수 없는 예외에서만 사용합니다. UI 테스트
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

UI 테스트를 실제로 실행하려면 scheme의 skip 설정 또는 `app-ci.yml`의
`-skip-testing` 인자를 바꿔야 합니다. scheme이 있는 `LunchTime.xcodeproj/**`와
`.github/workflows/app-ci.yml`은 작업 목록에서 LT-001만 소유하므로 UI 테스트
실행을 게이트로 되돌릴 수 있는 후속 이슈가 없습니다. `LunchTimeUITests/**`를
소유한 열네 작업은 테스트를 추가할 수 있지만 그 실행 경로를 열 수는 없습니다.
실행이 필요한 release gate가 생기면 전용 이슈에서 소유권을 먼저 정리해야
합니다.

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
| 앱 영향 검증 | [`macOS 앱 검증`](.github/workflows/app-ci.yml) | 앱 영향 경로의 affected target; 영향 불명·release 예외의 확대 검증 |
| 하네스 영향 검증 | [`저장소 작업 도구 검증`](.github/workflows/validate-harness.yml) | 변경 owner의 validator·direct contract test와 선택 결과 결속 |
| PR metadata | [`PR 메타데이터 검증`](.github/workflows/validate-pr-metadata.yml) | 조회 시점의 live PR 제목·본문·Draft·head·base 계약 |

앱, 하네스와 PR metadata workflow는 서로 독립적으로 실행됩니다. Required
summary check는 선택된 target의 `success`와 비대상의 `skipped`를 구분하되,
required라는 이유로 모든 고비용 job을 실행하지 않습니다.

병합을 차단하는 필수 검사는 저장소 ruleset이 정합니다. 현재 ruleset은
`app-test`·`validate`·`pr-metadata`를 strict required check로 요구합니다.
세 workflow 모두 해당 job에 별도 표시 이름을 두지 않으므로 job ID가 검사
이름이 됩니다.

## 제품 문서 갱신 절차

제품 동작·규칙·Architecture 경계에 영향을 주는 변경은 이슈가 지정한 exact
정본만 [update-product-docs](.agents/skills/update-product-docs/SKILL.md)로
확인합니다. 제품 동작이나 보장 범위가 달라졌다면 코드와 정본을 같은
변경에서 갱신합니다. 역사 archive와 관련 없는 정본은 읽지 않습니다.

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
  이슈 범위, 관련 테스트, 문서 영향, 한 번의 review round와 Git 안전을
  확인하고 원자적 commit을 만듭니다.
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
- [하네스 검증 워크플로](.github/workflows/validate-harness.yml)는 PR head
  변경(`opened`·`synchronize`)과 수동 실행에서 영향받은 문서·Skill owner의
  validator·test를 검사합니다.
- [macOS 앱 검증 워크플로](.github/workflows/app-ci.yml)는 같은 PR head 변경과
  수동 실행에서 영향받은 앱 target을 검사합니다. Docs·tooling-only 또는 PR
  본문·제목 편집에서는 앱 test를 실행하지 않습니다.
- [PR 메타데이터 검증 워크플로](.github/workflows/validate-pr-metadata.yml)는
  설정된 `opened`·`synchronize`·`reopened`·`edited`·`ready_for_review`
  event마다 live 제목·본문·Draft·head·base를 다시 읽어 검증합니다.

실제 요청 라우팅과 단계는
[개발 하네스 가이드](docs/development/01_harness_guide.md), 사람용 규칙과 예외는
[개발 협약](CONTRIBUTING.md)을 기준으로 판단합니다. 준비된 이슈를 선점한 뒤
독립 worktree에서 exact context만 읽고 관련 test를 실행합니다. 위험도에 따른
한 번의 review round와 메인 세션 finding closure, 원자적 commit, 영향받은
CI가 있는 PR, 요청된 경우의 squash merge와 완료 전이를 순서대로 수행합니다.
