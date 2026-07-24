# LunchTime 시스템 아키텍처

이 디렉터리는 승인된 제품 계약을 중앙 서버 없는 macOS Peer 시스템이 어떻게
실현하는지 질문별로 설명한다. 상세 규칙의 정본은 PRD와 Policy이며, 특정
프레임워크·wire format·암호 방식의 선택 근거는 기술 스파이크나 ADR이 맡는다.

> 이 문서는 제품 동작과 수치를 새로 정의하지 않는다. 관련 PRD·Policy를
> 입력 계약으로 참조하고 시스템이 해당 계약을 실현하는 구조만 설명한다.
> 내용이 충돌하면 PRD·Policy가 우선한다.

## 빠른 선택

| 궁금한 질문 | 읽을 문서 | 확정 계약 | 논리 모델 | 미결정 기술의 위치 |
|---|---|---|---|---|
| 시스템의 경계와 참여 구성요소는 무엇인가? | [01. 시스템 컨텍스트](./01_system_context.md) | 중앙 서버 없음, macOS Peer, 자동 신뢰·외부 QR 경계 | 사용자·앱·Peer·저장소·외부 단말 관계 | 네트워크·규모 검증은 문서의 `미결정 기술` |
| Peer는 어떻게 발견되고 연결되는가? | [02. Peer 네트워크와 전송](./02_peer_network_and_transport.md) | 지원 네트워크 경계, 기기 식별, 제한된 동기화 세션 | discovery→raw transport→기기 인증·secure channel 생명주기 | 발견·전송 구현과 두 WiFi 검증은 문서의 `미결정 기술` |
| Peer는 어떤 메시지를 어떤 의미로 교환하는가? | [03. 통신 프로토콜](./03_communication_protocol.md) | 이벤트 최소 정보, ACK 의미, 인증·무결성 실패 처리 | secure channel 위 compatibility·durable event·ephemeral chat 의미 | wire schema·직렬화·버전 협상은 문서의 `미결정 기술` |
| 중복·누락·순서 역전·충돌에서 어떻게 수렴하는가? | [04. 복제·정합성·복구](./04_replication_consistency_and_recovery.md) | 로컬 장부, 최종 일관성 목표, 정책별 충돌·복구 결과 | anti-entropy, 멱등 적용, projection 재계산 | 요약 자료구조·시계 허용오차·GC는 문서의 `미결정 기술` |
| 데이터는 어디에 남고 어떤 경계에서 보호되는가? | [05. 저장과 보안](./05_storage_and_security.md) | Keychain, 전송·저장 암호화, 메모리 채팅, 자동 신뢰 한계 | 데이터 종류별 저장·복제·삭제와 fail-closed 경로 | 암호 suite·키 교환·저장 형식은 문서의 `미결정 기술` |

`확정 계약`은 아키텍처가 새로 정한 규칙이 아니라 아래 정본에서 받은
입력이다. `논리 모델`은 기술 후보와 무관하게 구현이 지켜야 할 구성요소와
정보 흐름이다. `미결정 기술`은 제품 결과가 아니라 구현 방식의 선택이며,
검증 결과가 나오기 전에는 확정 기술처럼 다루지 않는다.

## 추천 읽기 순서

1. [01. 시스템 컨텍스트](./01_system_context.md)에서 시스템·신뢰 경계를 잡는다.
2. [02. Peer 네트워크와 전송](./02_peer_network_and_transport.md)에서 연결
   생명주기를 따라간다.
3. [03. 통신 프로토콜](./03_communication_protocol.md)에서 메시지 의미와
   ACK의 범위를 구분한다.
4. [04. 복제·정합성·복구](./04_replication_consistency_and_recovery.md)에서
   장부가 수렴하고 실패 뒤 복구되는 과정을 본다.
5. [05. 저장과 보안](./05_storage_and_security.md)에서 데이터 수명과 보호
   경계를 점검한다.

특정 문제만 조사한다면 위 표에서 해당 문서로 바로 이동해도 된다. 각 상세
문서는 필요한 입력 계약과 함께 읽을 문서를 끝에 다시 연결한다.

## 문서 책임 지도

```mermaid
flowchart LR
    U[사용자와 외부 경계] --> C[01 시스템 컨텍스트]
    C --> N[02 발견과 연결]
    N --> P[03 메시지 의미]
    P --> R[04 복제와 복구]
    R --> S[05 저장과 보안]
    S -. 보호 제약 .-> N
    S -. 데이터 수명 .-> R
```

- `01`은 시스템·신뢰 경계를 소유하고 기능 목록이나 Room 상태 규칙을
  반복하지 않는다.
- `02`는 discovery, raw transport와 secure channel까지의 connection
  lifecycle을 소유하고 메시지·충돌 의미를 결정하지 않는다.
- `03`은 secure channel 위 protocol compatibility, durable event,
  ephemeral chat, request/response, ACK와 error의 의미를 소유하고 wire
  schema를 확정하지 않는다.
- `04`는 수렴·충돌·복구를 소유하고 저장 암호화 구현을 결정하지 않는다.
- `05`는 기기 인증·secure channel의 보안 보장과 저장·암호화 실행 경로를
  소유하고 connection lifecycle이나 제품 보존 수치를 다시 정의하지 않는다.

## 정본과의 경계

| 위치 | 답하는 질문 | 아키텍처와의 관계 |
|---|---|---|
| [`docs/product-definition/`](../product-definition/10_decision_backlog.md) | 왜 이 방향을 선택했는가? | 결정 배경과 기술 검증 대기 항목을 제공한다. |
| [`docs/prd/`](../prd/README.md) | 사용자가 무엇을 할 수 있어야 하는가? | 사용자 결과와 수용 조건을 입력한다. |
| [`docs/policies/`](../policies/README.md) | 어떤 상태·권한·실패·복구 규칙이 적용되는가? | 아키텍처가 실행해야 할 규범적 계약을 입력한다. |
| `docs/architecture/` | 구성요소가 계약을 어떻게 실현하는가? | 논리 구조와 아직 선택하지 않은 기술을 구분한다. |
| 기술 스파이크·ADR | 어떤 기술을 왜 선택했는가? | 실제 검증 뒤 구현 선택을 확정한다. |

이 문서 세트에서 `C-*`는 미결정 항목으로 취급하지 않는다. 이전 C-ID의 처리
결과는 [결정 및 미결정 목록](../product-definition/10_decision_backlog.md)에
이미 기록되어 있으며, 여기서 미결정으로 표시하는 것은 기술 스파이크가
남은 구현 방식뿐이다.

## 입력 계약

- [PRD-01. LunchTime MVP](../prd/01_lunchtime_mvp.md):
  `PRD-01-FR-01`~`PRD-01-FR-12`, `PRD-01-AC-01`~`PRD-01-AC-11`
- [POL-01. 일일·방 생명주기](../policies/01_daily_room_lifecycle.md):
  `POL-01-R-01`~`POL-01-R-07`
- [POL-02. 복제·정합성·보존](../policies/02_replication_consistency_retention.md):
  `POL-02-R-01`~`POL-02-R-08`
- [POL-03. 보안·신뢰 경계](../policies/03_security_and_trust.md):
  `POL-03-R-01`~`POL-03-R-07`
- [POL-04. macOS 화면·채팅](../policies/04_surfaces_and_chat.md):
  `POL-04-R-01`, `POL-04-R-03`~`POL-04-R-07`

[결정 및 미결정 목록](../product-definition/10_decision_backlog.md)의 상세
문서별 참조는 다음과 같다.

| 상세 문서 | 참조하는 확정 결정 |
|---|---|
| [01](./01_system_context.md) | `D-02`, `D-03`, `D-20`, `D-28`, `D-34`, `D-35`, `D-38`, `D-42`, `D-43` |
| [02](./02_peer_network_and_transport.md) | `D-16`, `D-20`, `D-27`, `D-32`, `D-35`, `D-42`, `D-43` |
| [03](./03_communication_protocol.md) | `D-03`, `D-16`, `D-17`, `D-29`, `D-30`, `D-32`, `D-37` |
| [04](./04_replication_consistency_and_recovery.md) | `D-03`, `D-16`, `D-17`, `D-18`, `D-19`, `D-27`, `D-28`, `D-29`, `D-30`, `D-31`, `D-32`, `D-33`, `D-34`, `D-37`, `D-38`, `D-40` |
| [05](./05_storage_and_security.md) | `D-19`, `D-20`, `D-28`, `D-34`, `D-35`, `D-36`, `D-42`, `D-43`, `D-44` |

이 표의 합집합이 이 아키텍처 세트가 참조하는 결정의 전체 목록이다. `C-*`는
위에서 설명한 대로 미결정 기술 목록에 포함하지 않는다.

정확한 시간 경계, 세션 횟수·기간, 보존 창과 화면 상태의 값은 위 Policy가
소유한다. 아키텍처는 `정책이 정한 경계`, `제한 세션`, `보존 대상`을
입력으로 받아 실행 지점을 설명한다.

## 기술 검증 대기 지도

| 기술 스파이크 | 이 문서 세트에서 찾을 위치 | 아직 확정하지 않는 것 |
|---|---|---|
| `PRD-01-SP-01` 사내망 Peer 발견 | [02](./02_peer_network_and_transport.md) | 두 WiFi 사이 실제 발견·라우팅, 지원 네트워크 판정, discovery·transport 기술 |
| `PRD-01-SP-02` 복제·충돌 | [03](./03_communication_protocol.md), [04](./04_replication_consistency_and_recovery.md) | wire schema, 요약·누락 요청 형식, 충돌 수렴 구현 |
| `PRD-01-SP-03` 복귀·시간 경계 | [02](./02_peer_network_and_transport.md), [04](./04_replication_consistency_and_recovery.md) | 스케줄링, 시계 허용오차와 검증 방식 |
| `PRD-01-SP-04` 보안·자동 신뢰 | [02](./02_peer_network_and_transport.md), [05](./05_storage_and_security.md) | 암호 suite, 키 교환·회전, 네트워크 경계 판정 |
| `PRD-01-SP-05` 데이터 경계 | [04](./04_replication_consistency_and_recovery.md), [05](./05_storage_and_security.md) | tombstone·GC 안전 조건, 저장 형식, 데이터 경계 시험 방식 |
| `PRD-01-SP-06` 규모·신뢰성 | [01](./01_system_context.md), [02](./02_peer_network_and_transport.md) | 지원 Peer 규모와 성능 범위 |

두 종류의 사내 WiFi는 제품의 **지원 목표**다. 두 망이 실제로 Peer discovery와
직접 연결을 허용하는지는 `PRD-01-SP-01`과 `POL-03-R-07`의 증거가 나오기
전까지 **검증 대기**이며, 이 문서 세트는 연결 가능성을 보장하지 않는다.
