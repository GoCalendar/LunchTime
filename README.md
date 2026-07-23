# LunchTime

> 점심 모집의 상태는 구조화하고, 필요한 대화는 그 맥락 안에 남기는 macOS 앱.

LunchTime은 회사에서 반복되는 점심 모집과 배달 주문 협의를 돕는 도구입니다. 점심방마다 참여자, 가게, 메뉴, 주문 마감, 주문 완료 상태를 한곳에서 관리하고, 방 안에서 필요한 대화를 이어갈 수 있도록 합니다.

현재는 구현에 앞서 제품을 정의하는 단계입니다. 이 README는 아이디어가 어떤 논의를 거쳐 요구사항과 정책으로 확정되는지 안내하는 문서 인덱스입니다.

## 현재 제품 방향

- 전 사원이 MacBook을 사용하는 환경을 전제로 하며 Windows는 고려하지 않습니다.
- 별도 운영 서버 없이 Peer-to-Peer 방식으로 동작하는 것을 목표로 합니다.
- 구조화된 점심방과 방별 채팅을 함께 제공합니다.
- 점심과 무관한 대화를 위한 별도 라운지 공간을 제공합니다.
- 과거 주문 히스토리에서 기존 가게의 모집방을 빠르게 다시 여는 기능을 탐색합니다.
- 회사의 실제 주문 수단인 배달의민족 링크를 다루고, Mac에서 휴대폰으로 자연스럽게 넘기는 흐름을 탐색합니다.

위 항목은 현재의 제품 방향이며, 상세 동작이 모두 확정된 요구사항이라는 뜻은 아닙니다. 확정된 내용은 이후 PRD와 Policies 문서에 반영합니다.

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

현재 Product Definition 문서는 제공된 아이디어와 피드백을 구조화한 초안입니다. 사용자 조사나 기술 검증을 마친 정본이 아니며, 검증과 제품 책임자 리뷰를 거쳐 채택된 내용만 PRD와 Policies로 옮깁니다.

### PRD

아직 확정된 PRD 문서가 없습니다.

### Policies

아직 확정된 Policies 문서가 없습니다.
