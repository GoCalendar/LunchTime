# LunchTime

> 점심 모집의 상태는 구조화하고, 필요한 대화는 그 맥락 안에 남기는 macOS 앱.

LunchTime은 회사에서 반복되는 점심 모집과 배달 주문 협의를 돕는 도구입니다. 점심방마다 참여자, 가게, 메뉴, 주문 마감, 주문 완료 상태를 한곳에서 관리하고, 방 안에서 필요한 대화를 이어갈 수 있도록 합니다.

현재는 제품 정의 회의를 마치고 정본 초안을 바탕으로 기술 검증과 구현 작업을 준비하는 단계입니다. 이 README는 아이디어가 어떤 논의를 거쳐 요구사항과 정책으로 확정되는지 안내하는 문서 인덱스입니다.

## 현재 제품 방향

- 전 사원이 MacBook을 사용하는 환경을 전제로 하며 Windows는 고려하지 않습니다.
- 별도 운영 서버 없이 지원 회사 WiFi에서 자동 신뢰된 LunchTime Peer끼리 암호화된 로컬 데이터를 복제합니다.
- 점심 운영 시간은 `Asia/Seoul` 기준 11:00~14:30이며, 14:30부터 사용자 입력을 닫고 최대 120초 동안 종료 스냅샷을 대조합니다.
- 한 점심방은 한 가게의 주문 그룹이며, 참여자·개인 메뉴·마감·주문 상태와 방별 채팅을 함께 제공합니다.
- 점심과 무관한 대화를 위한 `라운지`를 MVP에 포함합니다.
- 과거 주문 히스토리에서 가게명과 배달의민족 링크를 재사용해 새 방을 빠르게 만듭니다.
- 취소되지 않은 종료 Room의 구조화 상세는 자동 신뢰된 Peer에게 최대 14일 열람 전용으로 제공하고, 성공 주문의 재모집용 최소 가게 히스토리는 더 오래 로컬에 남깁니다.
- 사용자가 입력한 배달의민족 링크 문자열은 검증·정규화 없이 Mac 화면의 QR로 휴대폰에 전달합니다.
- 참여와 메뉴의 누락 가능성을 숨기지 않고, 데이터가 불완전하면 주문 완료를 차단합니다.
- 동기화 실패는 트리거당 최대 3회·총 30초에서 멈추며, 새 의미 있는 트리거나 수동 새로고침으로만 다시 시도합니다.

확정된 제품 범위와 사용자 경험은 PRD를, 상태·권한·동기화·보존·보안 규칙은 Policies를 기준으로 판단합니다. 실제 사내망에서의 Peer 발견, 자동 신뢰 네트워크 판정, 암호 키 교환과 성능 한계는 출시 전 기술 검증이 필요합니다.

## 문서 체계

| 경로 | 역할 | 성격 |
|------|------|------|
| `docs/product-definition/` | 아이디어, 가설, 질문, 논의와 의사결정 과정을 기록합니다. | 논의 이력 |
| `docs/prd/` | 논의를 거쳐 확정된 제품·기능 요구사항을 기록합니다. | 요구사항 정본 |
| `docs/policies/` | 상태 전이, 권한, 예외 처리 등 세부 동작 규칙을 기록합니다. | 동작 규칙 정본 |

`product-definition`은 결정의 배경을 이해하기 위한 기록입니다. 현재 제품이 어떻게 동작해야 하는지는 PRD와 Policies를 기준으로 판단합니다. 두 정본 사이에 모순이 발견되면 어느 한쪽을 임의로 우선하지 않고 함께 정정합니다.

문서와 디렉터리는 실제로 필요한 시점에만 만들며, 새 문서가 생기면 아래 인덱스에 추가합니다.

## 문서 인덱스

### Product Definition

| 순서 | 문서 | 역할 |
|------|------|------|
| 00 | [초기 아이디어](docs/product-definition/00_initial_idea.md) | 문제의식과 지금까지의 논의 기록 |
| 01 | [제품 방향](docs/product-definition/01_product_direction.md) | 목적, 대상, 가치, 제약과 비목표 |
| 02 | [현재 점심 주문 여정](docs/product-definition/02_current_lunch_journey.md) | Slack과 배민을 이용하는 현재 방식 |
| 03 | [문제와 유지할 강점](docs/product-definition/03_pains_and_existing_strengths.md) | 개선할 문제와 잃지 말아야 할 장점 |
| 04 | [가설과 검증 계획](docs/product-definition/04_assumptions_and_validation.md) | 제품·기술 가설과 검증 순서 |
| 05 | [어떻게 하면 질문](docs/product-definition/05_how_might_we.md) | 구체적인 해결 질문과 가설적 답 |
| 06 | [기능 후보 목록](docs/product-definition/06_feature_inventory.md) | 우선순위 없는 F-ID 작업 원장 |
| 07 | [경험 및 정보 구조](docs/product-definition/07_experience_structure.md) | 기능을 macOS Surface에 배치한 제안 |
| 08 | [목표 사용자 여정](docs/product-definition/08_target_lunch_journey.md) | LunchTime에서 기대하는 전체 흐름 |
| 09 | [범위 제안](docs/product-definition/09_scope_proposal.md) | MVP 후보, 검증 게이트와 후속 범위 |
| 10 | [결정 및 미결정 목록](docs/product-definition/10_decision_backlog.md) | 확정 방향, 제안과 PRD 전 결정 과제 |

제품 정의 과정은 [da-in/vibe-sprint](https://github.com/da-in/vibe-sprint)의 단계형 사고 모델에서 인사이트를 얻되, 정해진 STEP·순서·산출물에 종속되지 않고 LunchTime에 필요한 방식으로 진행합니다.

Product Definition 문서는 제공된 아이디어와 피드백, 결정의 배경을 구조화한 기록입니다. 현재 동작의 정본은 아래 PRD와 Policies이며, 기술 검증으로 전제가 달라지면 결정 기록과 정본을 함께 갱신합니다.

### PRD

| 문서 | 역할 |
|------|------|
| [PRD 안내](docs/prd/README.md) | PRD의 역할, 문서 목록과 변경 원칙 |
| [PRD-01. LunchTime MVP](docs/prd/01_lunchtime_mvp.md) | MVP 범위, 사용자 경험, 기능 요구사항과 수용 조건 |

### Policies

| 문서 | 정본 범위 |
|------|-----------|
| [Policies 안내](docs/policies/README.md) | 정책 문서의 역할, 우선순위와 목록 |
| [POL-01. 일일·방 생명주기](docs/policies/01_daily_room_lifecycle.md) | 11:00~14:30 일일 세션, 참여, 메뉴, 주문 완료와 자동 종료 |
| [POL-02. 복제·정합성·보존](docs/policies/02_replication_consistency_retention.md) | P2P 장부, 복귀 동기화, 누락 방지, 보존과 히스토리 |
| [POL-03. 보안·신뢰 경계](docs/policies/03_security_and_trust.md) | 회사 WiFi 자동 신뢰, 전송·저장 암호화와 내부 위협 경계 |
| [POL-04. macOS 화면·채팅](docs/policies/04_surfaces_and_chat.md) | MenuBar, Room, Lounge, QR과 연결 상태 UI |

## 제품 문서 갱신 워크플로

구현을 마치고 PR을 만들기 전에는 [`update-product-docs` Skill](.agents/skills/update-product-docs/SKILL.md)로 변경사항이 PRD·Policies에 미치는 영향을 확인합니다. 제품 동작이나 보장 범위가 달라졌다면 코드와 정본 문서를 같은 변경에서 갱신합니다.

스킬의 단일 원본은 `.agents/skills/`에 두며, Claude에서도 같은 스킬을 사용하도록 `.claude/skills`를 해당 디렉터리의 심볼릭 링크로 연결합니다.
