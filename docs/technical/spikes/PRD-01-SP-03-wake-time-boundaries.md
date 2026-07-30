# PRD-01-SP-03. 복귀·시계 경계·bounded sync

| 항목 | 값 |
|---|---|
| 상태 | **Draft · blocker 있음** — 모델 검증 완료 · 실기기 출시 gate 미해제 |
| 작업 이슈 | [#4 복귀·시계 경계·bounded sync 스파이크](https://github.com/GoCalendar/LunchTime/issues/4) |
| 관련 PRD | [PRD-01-FR-01, FR-09, FR-10, AC-03, AC-05, AC-09, SP-03](../../prd/01_lunchtime_mvp.md) |
| 관련 Policy | [POL-01-R-01, R-04](../../policies/01_daily_room_lifecycle.md), [POL-02-R-02, R-08](../../policies/02_replication_consistency_retention.md) |
| 실험 도구 | `Experiments/SP03WakeAndTime` |
| 마지막 검증 | 2026-07-30 |

## 1. 결론

다음 구현 불변식은 결정적 모델과 macOS event adapter 테스트로 재현했습니다.

- lifecycle·network trigger 100개가 겹쳐도 활성 bounded session은 최대 1개입니다.
- 한 session은 최대 3회 또는 단조 시간 30초 중 먼저 도달한 한도에서 끝납니다.
- 실패 뒤 cadence timer만으로 새 session을 만들지 않고 새 의미 있는 trigger가 있어야 재개합니다.
- 정상 anti-entropy cadence는 30초에 due가 되며 데이터·정상 Peer 부재와 14:30 terminal close에서 중단합니다.
- 업무 달력은 기기 locale·time zone과 무관하게 `Asia/Seoul`로 고정하고, 장부와 Peer 교환 시각은 UTC instant로 표현합니다.
- KST 쓰기 창은 `[11:00, 14:30)`이고 같은 운영일의 terminal close를 복원하면 process 재실행·time zone 변경·벽시계 rollback 뒤에도 다시 열리지 않습니다.
- finalization은 단조 시간 120초의 바깥 한도와 내부 3회·30초 상한을 함께 적용합니다.
- local-only Room은 유효한 macOS wall/monotonic 기준점이 있으면 Peer 부재만으로 시간 의존 쓰기를 차단하지 않습니다.
- 한 번 공유된 Room은 다시 local-only가 되지 않으며, eligible Room Peer별 fresh 표본 전체가 후보 허용 오차 안에서 일관될 때만 후보 판정을 통과합니다.
- 시계 검증 불가·허용 오차 초과·오래된 검증·system clock 변경은 참여 수락, 주문 마감 수정과 주문 상태 변경만 fail-closed로 차단합니다. local-only는 새 로컬 기준점, 공유 Room은 새 기준점과 fresh Peer 대조를 모두 요구합니다.
- 14:30 이전 생성 여부를 검증할 수 없는 늦은 이벤트는 열람용 스냅샷만 계산하고 성공·주문 완료·성공 히스토리를 자동 정정하지 않습니다.

그러나 `PRD-01-SP-03`의 출시 gate는 아직 해제할 수 없습니다. 현재 환경에서
실행한 live probe는 process launch만 관찰했습니다. 두 Mac의 시계 교환,
실제 sleep·wake, foreground, network 전환, 14:30 finalization과 실제
전력·네트워크 비용은 측정하지 않았습니다.

`±1초`, freshness `30초`, 연속 표본 `3개`와 wall/monotonic 진행 불연속
허용치는 **실기기 미확정 후보**입니다.
이 수치를 [POL-02-R-08](../../policies/02_replication_consistency_retention.md)의
승인값으로 사용해서는 안 됩니다. 후보 판정 로직이 통과해도 공유 이력 Room의
출시 쓰기 허용으로 해석하지 않으며, 증거가 없는 동안 fail-closed를 유지해야
합니다.

[POL-02-R-08](../../policies/02_replication_consistency_retention.md)은 macOS
시스템 wall clock을 MVP의 절대 시각 신뢰 원천으로 확정했습니다. Peer 시각은
이를 보정하거나 평균·다수결·quorum으로 대체하지 않고 공유 Room의 불일치
탐지와 fresh 교차 확인에만 사용합니다. 따라서 이전의 “절대 시각 신뢰 원천
또는 quorum 미결정” blocker는 #86으로 해소됐습니다. 남은 실제 live 행렬과
제품 책임자 승인까지 완료되기 전에는 #4의 PR을 **Ready로 전환하거나
merge해서는 안 되며 Draft로 유지**합니다.

## 2. 모델과 실기기 증거의 경계

### 2.1 결정적 모델이 답하는 것

- trigger coalescing과 동시에 활성인 session 수
- 시도 횟수·단조 경과 시간·finalization 바깥 한도
- anti-entropy 시작 조건과 중단 조건
- 고정 KST 14:30 terminal close와 durable snapshot 복원 뒤 rollback 차단
- 4-timestamp offset 구간 계산과 fail-closed 분기
- local-only·공유 이력 Room 분기, 되돌릴 수 없는 공유 이력과 서로 다른 복구 조건
- eligible Room Peer별 표본 수, 여러 Peer의 전체 표본 충돌과 미승인 후보의 출시 차단
- 늦은 이벤트의 열람·자동 정정 허용 범위

### 2.2 결정적 모델이 답하지 않는 것

- 실제 두 Mac 사이의 wall-clock 차이와 지연 분포
- 실제 sleep 뒤 `NSWorkspace.didWakeNotification` 전달 시각
- 실제 foreground와 network path callback burst의 순서
- 실제 Peer 대조가 3회·30초와 120초 안에서 끝나는지
- 실제 sleep 중 `ContinuousClock` 진행과 wake 뒤 wall/monotonic 연속성 분포
- local-only 새 기준점과 공유 Room의 새 기준점·fresh Peer 복구
- Instruments 또는 `powermetrics` 수준의 에너지 비용
- 지원 사내망에서 교환한 실제 byte 수

테스트의 synthetic notification과 가짜 timestamp는 adapter와 판정 로직을
검증할 뿐 실기기 관찰을 대체하지 않습니다.

## 3. 실험 도구

`Experiments/SP03WakeAndTime`은 앱 project와 분리된 Swift 6, macOS 14
SwiftPM package입니다.

| 구성요소 | 책임 |
|---|---|
| `BoundedSyncSession` | 최대 3회·30초와 stop reason |
| `SyncCoordinator` | 단일 활성 session, trigger burst 병합, 실패 뒤 cadence 억제 |
| `AntiEntropyCadence` | 정상 조건 30초 cadence와 중단 조건 |
| `DailyWriteBoundary` | 고정 `Asia/Seoul` 쓰기 창과 복원 가능한 terminal-close snapshot |
| `FinalizationCoordinator` | 단조 120초 바깥 한도와 내부 session 검증 |
| `ClockSkewGate` | local-only·공유 Room, macOS 기준점, Peer별 후보 판정과 출시 fail-closed |
| `ClockExchangeProbe` | Bonjour A/B rendezvous, 양방향 3회 4-timestamp 교환과 익명 evidence |
| `LateEventClockSafety` | 검증 불가 늦은 이벤트의 열람 전용 처리 |
| `SystemEventSource` | AppKit, NSWorkspace, Foundation, Network event를 `SyncTrigger`로 정규화 |
| `ScenarioCatalog` | 기대값을 실행 전에 선언한 15개 결정적 시나리오 |
| `sp03-probe` | 모델 JSON, live system-event timeline, 익명 typed evidence 집계 |

timeout과 cadence에는 절전 중에도 증가하는
[Swift `ContinuousClock`](https://developer.apple.com/documentation/swift/continuousclock)을
사용합니다. 14:30과 Peer 시계 비교에만 wall clock을 사용합니다.
`SuspendingClock`이나 `Date` 경과 시간으로 30초·120초를 재면 sleep 또는
사용자 시계 변경이 상한을 늘릴 수 있으므로 사용하지 않습니다. API 의미는
문서로 확인되지만 이 스파이크의 출시 증거에는 실제 macOS sleep 전후 진행
측정도 별도로 남깁니다.

live adapter는 다음 macOS 14 호환 API를 사용합니다.

- [NSApplication.didBecomeActiveNotification](https://developer.apple.com/documentation/appkit/nsapplication/didbecomeactivenotification)
- [NSWorkspace.didWakeNotification](https://developer.apple.com/documentation/appkit/nsworkspace/didwakenotification)
- [NWPathMonitor](https://developer.apple.com/documentation/network/nwpathmonitor)
- [NSSystemClockDidChange](https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/nssystemclockdidchange)

`NWPathMonitor`의 첫 callback은 현재 path의 baseline이므로 app launch와 별도
network change로 세지 않습니다. adapter는 hostname, IP, SSID와 interface
이름을 읽거나 결과에 넣지 않습니다.

## 4. 재현 절차

### 4.1 직접 테스트

```bash
swift test --package-path Experiments/SP03WakeAndTime
```

2026-07-30 실행 결과:

```text
102 tests, 13 suites, 0 failures
```

### 4.2 결정적 시나리오

```bash
swift run --package-path Experiments/SP03WakeAndTime sp03-probe
swift run --package-path Experiments/SP03WakeAndTime sp03-probe --list
swift run --package-path Experiments/SP03WakeAndTime sp03-probe \
  --scenario clock-skew-exceeded-blocks-writes
```

기본 실행 결과:

```text
scenarioCount: 15
modelPassed: true
anonymized: true
verdict: model-passed-live-gate-pending
thresholdStatus: candidate-awaiting-two-mac-live-evidence
policyToleranceMayBeApproved: false
```

모델 대리 비용은 session 시작 3회, attempt 7회, timer wake 3회,
payload 전송 0바이트입니다. payload가 0인 이유는 이 package가 실제 복제
payload를 교환하지 않기 때문입니다. 이 값을 실제 network 비용으로 해석해서는
안 됩니다.

### 4.3 실제 system event 관찰

```bash
swift run --package-path Experiments/SP03WakeAndTime sp03-probe \
  --observe-seconds 900
```

15분 관찰 시간 안에 다른 앱으로 전환했다가 복귀하고, 짧은 sleep·wake와
network 전환을 직접 수행합니다. 이 결과는 adapter 관찰일 뿐 실제 Peer
session·cadence·finalization 증거가 아닙니다. 실제 system clock 변경은 작업용
Mac이 아닌 disposable VM 또는 별도 시험 기기에서만 수행합니다.

현재 환경에서 1초 관찰한 결과:

```text
events: appLaunch 1개
sessionsStarted: 1
peakConcurrentSessions: 1
verdict: partial-live-observation-only
```

이 실행은 launch adapter의 실제 동작만 확인합니다. wake·foreground·network
증거와 bounded Peer session 증거가 아닙니다.

### 4.4 두 Mac 시계 교환

두 물리 Mac을 같은 지원 사내망에 연결하고 다음 명령을 **동시에** 실행합니다.
`--confirm-distinct-physical-macs`는 실제로 서로 다른 물리 Mac 두 대임을
운영자가 확인한 경우에만 사용합니다.

Mac A:

```bash
swift run --package-path Experiments/SP03WakeAndTime sp03-probe \
  --clock-local A --clock-peer B --confirm-distinct-physical-macs \
  > sp03-clock-A-run01.json
```

Mac B:

```bash
swift run --package-path Experiments/SP03WakeAndTime sp03-probe \
  --clock-local B --clock-peer A --confirm-distinct-physical-macs \
  > sp03-clock-B-run01.json
```

Apple의
[TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)에
따라 Terminal 또는 SSH에서 실행한 command-line tool은 macOS에서 local
network 접근을 자동 허용합니다. IDE나 다른 GUI 앱에서 실행하면 그 앱이
responsible code로 판정될 수 있으므로, 재현 명령은 Terminal에서 실행합니다.

각 JSON은 A/B 라벨, 닫힌 interface 분류, 양방향 완료 round, local `T1`을
0으로 정규화한 4-timestamp, offset 구간과 `500ms` 안전 여유 판정을
포함합니다. hostname, IP, SSID, interface 이름, 절대 실행 시각과 원문
network 오류는 포함하지 않습니다. 성공한 단일 실행도
`policyToleranceMayBeApproved: false`를 유지합니다. 6.2절의 10회 행렬과
7절의 나머지 live gate, 제품 책임자 승인이 아직 남아 있기 때문입니다.

현재 Mac에서 확인 flag 없이 두 process를 동시에 실행한 plumbing 결과는 양쪽
모두 outbound 3회와 inbound `[1, 2, 3]`을 약 1.1초 안에 마쳤습니다. 두
process가 같은 host여서 loopback이 관측됐고, 결과는 의도대로
`sample-ineligible:sameHost`, `crossHostEvidence: false`였습니다. 이 결과는
TCP framing과 fail-closed 판정만 확인하며 두 Mac evidence로 세지 않습니다.
같은 host에서 `--confirm-distinct-physical-macs`를 잘못 지정해도 loopback
관측이 운영자 확인보다 우선하므로 동일하게 `sameHost`로 거부됩니다.

### 4.5 typed live evidence 집계

live·clock 출력은 전체 보고서와 별도로 재사용 가능한 `evidenceBundle`을
포함합니다. 각 원본 보고서는 임시 디렉터리에 보존하고 bundle만 추출한 뒤
배열로 합칩니다.

```bash
jq '.evidenceBundle' sp03-clock-A-run01.json > bundle-clock-A-run01.json
jq '.evidenceBundle' sp03-clock-B-run01.json > bundle-clock-B-run01.json
jq -s '.' bundle-*.json \
  | swift run --package-path Experiments/SP03WakeAndTime sp03-probe \
      --aggregate-live-evidence
```

clock·system-event 외의 bounded session, cadence, 시계 경계·복구,
finalization과 resource 측정도 `LiveEvidenceBundle`의 해당 typed artifact로
기록합니다. 집계기는 빈 입력을 성공으로 채우거나 누락값을 추정하지 않습니다.
최대 입력은 1 MiB이며, hostname·IP·SSID·로컬 절대 경로 marker가 있거나
필수 증거가 하나라도 빠지면 `live-gate-pending`과 nonzero로 끝납니다. 집계
결과가 `release-gate-evidence-complete`여도 제품 책임자의 후보값 승인은
별도로 남습니다.

## 5. 결정적 시나리오 결과

| 시나리오 | 결과 | 주요 추적 |
|---|---|---|
| `trigger-burst-coalesces` | 통과 | PRD-01-FR-09, POL-02-R-02 |
| `attempt-limit-stops-session` | 통과 | PRD-01-AC-03, POL-02-R-02 |
| `time-limit-stops-session` | 통과 | PRD-01-AC-03, POL-02-R-02 |
| `failed-session-does-not-self-restart` | 통과 | PRD-01-FR-09, POL-02-R-02 |
| `normal-anti-entropy-within-30-seconds` | 통과 | PRD-01-FR-09, POL-02-R-02 |
| `anti-entropy-suspends-without-prerequisites` | 통과 | PRD-01-FR-01, POL-02-R-02 |
| `daily-close-never-reopens` | 통과 | PRD-01-FR-01, POL-01-R-01 |
| `finalization-completes-within-120-seconds` | 통과 | PRD-01-AC-05, POL-01-R-04 |
| `local-only-baseline-allows-without-peer` | 통과 | PRD-01-AC-09, POL-02-R-08 |
| `shared-clock-candidate-does-not-open-release-gate` | 통과 · 출시 차단 유지 | PRD-01-SP-03, POL-02-R-08 |
| `eligible-room-peers-must-all-agree` | 통과 | PRD-01-FR-10, POL-02-R-08 |
| `clock-skew-exceeded-blocks-writes` | 통과 | PRD-01-AC-09, POL-02-R-08 |
| `clock-skew-unverifiable-blocks-writes` | 통과 | PRD-01-FR-10, POL-02-R-08 |
| `system-clock-change-invalidates-validation` | 통과 · durable 복구 분기 | PRD-01-FR-10, POL-02-R-08 |
| `unverifiable-late-event-is-read-only` | 통과 | PRD-01-AC-05, POL-02-R-08 |

## 6. 시계 검증 후보

### 6.1 4-timestamp 판정

한 round는 로컬 송신 `T1`, Peer 수신 `T2`, Peer 송신 `T3`, 로컬 수신 `T4`를
기록합니다.

```text
offset = ((T2 - T1) + (T3 - T4)) / 2
network round-trip = local monotonic elapsed - peer monotonic processing
uncertainty = network round-trip / 2 + timestamp capture uncertainty
```

각 `Date` 캡처는 바로 앞과 뒤의 `ContinuousClock` 시각을 함께 기록합니다.
두 단조 시각 사이의 경과를 밀리초로 올림(`ceil`)한 값이 그 캡처의
불확실성입니다. 한 표본의 `timestamp capture uncertainty`는 local `T1·T4`
두 캡처와 Peer `T2·T3` 두 캡처, 총 네 값의 합입니다. local elapsed는
`T1` 캡처 전부터 `T4` 캡처 후까지 올림하고, Peer processing은 `T2` 캡처
전부터 `T3` 캡처 후까지 내림합니다. 따라서 network round-trip은 local
elapsed에서 Peer processing을 뺀 보수적 잔여입니다.

local elapsed, Peer processing과 capture uncertainty는 각각 `0...30,000ms`
범위여야 합니다. 합산 overflow, 음수 network round-trip, 음수 값 또는
상한 초과는 offset으로 보정하지 않고 fail-closed합니다. live wire의 음수
또는 상한 초과 값은 malformed frame으로, capture 합산 overflow·합계 상한
초과는 `probe-failed:reportingOverflow`로, 음수 network round-trip과
연속성 위반은 `probe-failed:clockJumpDetected`로 보고합니다.
또한 local·Peer 각각의 wall-clock 경과와 대응 단조 경과 차이는 네 캡처
불확실성 합에 미승인 연속성 여유 후보를 더한 값 이하여야 합니다. 현재
`10ms`는 단위 테스트와 probe에서 사용하는 후보일 뿐 승인된 정책값이
아닙니다. 이보다 큰 차이는 일반 지연으로 흡수하지 않고 관찰 중 시계
불연속 후보로 판정합니다.

공유 이력 Room에서는 eligible Room Peer마다 연속 3개 표본을 요구합니다.
현재 검증 session의 모든 대상 Peer 표본 구간이 서로 겹치고, 각 구간 전체가
후보 허용 오차 안에 있을 때만 후보 판정을 통과합니다. 특정 Peer를 임의로
선택하거나 평균·다수결로 outlier를 지우지 않습니다. 다음 경우에는 추측하지
않고 즉시 fail-closed합니다.

- eligible Room Peer 없음
- 한 Peer라도 표본 3개 미만
- monotonic duration이 잘못됐거나 불완전한 표본
- 같은 Peer 또는 여러 Peer의 표본 구간끼리 교집합 없음
- 불확실성 구간이 허용 오차 경계를 걸침
- 검증 뒤 30초 경과
- `NSSystemClockDidChange` 수신 또는 wall/monotonic 진행 불연속

freshness는 단조 시각 기준 반열린 구간
`[validatedAt, validatedAt + 30,000ms)`입니다. 검증 이전 시각과 정확히
30,000ms가 된 시점부터는 stale입니다. system clock 변경 뒤에는 macOS 시각
점검과 수동 새로고침으로 새 wall/monotonic 기준점을 만든 뒤 local-only
Room만 복구할 수 있습니다. 공유 이력 Room은 새 기준점과 fresh한 eligible
Room Peer 대조를 모두 통과해야 복구 후보가 됩니다.

local-only Room은 현재 process의 macOS 기준점이 유효하면 Peer 표본을
요구하지 않습니다. Room event의 outbound handoff, remote-origin event 수신
또는 원격 StorageACK 관찰 중 하나라도 발생하면 durable `everShared`를 먼저
남기고 이후 다시 local-only로 되돌리지 않습니다. macOS wall clock이 절대
시각 신뢰 원천이고 Peer는 공유 Room의 교차 확인 수단이므로 Peer 표본으로
wall clock을 보정하지 않습니다.

### 6.2 `±1초` 후보의 승인 조건

후보를 승인값으로 올리려면 최소한 다음 증거가 필요합니다.

1. 지원 사내망의 서로 다른 물리 Mac 두 대를 사용합니다.
2. A/B 명령 한 쌍을 같은 `pairEvidenceID`로 묶어 10개 pair, 총 20개 JSON을
   남깁니다. 각 JSON은 정확히 3개 표본을 포함해야 합니다.
3. 각 pair에는 local label `A`, `B` 결과가 하나씩 있고 두 결과 모두
   `reciprocalPeerMatched == true`, `crossHostEvidence == true`여야 합니다.
4. 모든 표본의 `|offset| + uncertainty`가 `500ms` 이하여야 합니다.
5. wake, foreground와 network 전환 뒤에도 같은 조건을 충족해야 합니다.
6. 하나라도 실패하면 `±2초`처럼 수치를 자동 확대하지 않고 제품 계약 검토로 돌립니다.

두 명령을 동시에 실행하는 pair를 `run01`부터 `run10`까지 반복한 뒤, 20개
결과를 다음과 같이 검증합니다. `pairEvidenceID`는 양쪽의 익명 run instance
ID를 정렬해 만든 SHA-256 64자리 소문자 hex이므로 같은 실행의 A/B 결과만
묶습니다. 명령은 10개 고유 pair, pair마다 A/B 결과 2개, 상호 Peer 일치,
cross-host 양성 증거, 정확히 3개 round와 모든 round의 `500ms` 기준을 한 번에
검사하며 하나라도 누락되면 nonzero로 끝납니다.

```bash
jq -e -s '
  group_by(.pairEvidenceID)
  | length == 10
    and all(.[];
      length == 2
      and (map(.localLabel) | sort == ["A", "B"])
      and all(.[];
        (.pairEvidenceID
          | type == "string" and test("^[0-9a-f]{64}$"))
        and ((.localLabel == "A" and .peerLabel == "B")
          or (.localLabel == "B" and .peerLabel == "A"))
        and .reciprocalPeerMatched == true
        and .crossHostEvidence == true
        and .candidateEligibility == "eligible"
        and .failure == null
        and (.rounds
          | length == 3
            and all(.[];
              .failure == null
              and .withinFiveHundredMillisecondSafetyMargin == true))
      )
    )
' sp03-clock-{A,B}-run{01..10}.json
```

`500ms`는 승인 허용치가 아니라 `±1초` 후보에 2배 안전 여유가 있는지 확인하는
실험 기준입니다. 이 행렬의 Peer 시각은 macOS wall clock을 보정하는 값이
아니라 공유 Room의 불일치 탐지 증거입니다. 7절의 전체 실기기 행렬과 제품
책임자 승인 전에는 후보 수치를 `POL-02-R-08`의 확정값으로 올리지 않습니다.

## 7. 실기기 시험 행렬

| 항목 | 필요한 증거 | 현재 결과 |
|---|---|---|
| cold launch | 실제 process launch event와 session 시작 | 일부 확인 — `appLaunch` 1회 |
| foreground burst | 실제 activation과 동시 session 최대 1 | 미측정 |
| sleep·wake | 실제 wake notification, 14:30 전·후 복귀 | 미측정 |
| network 전환 | 실제 path change burst와 재개 | 미측정 |
| 새 Peer | 실제 발견 event와 bounded 대조 | 미측정 |
| 3회·30초 | 지연 Peer 상대의 실제 attempt·elapsed | 미측정 |
| 30초 cadence | 활성 데이터·정상 Peer 조건의 실제 간격 | 미측정 |
| 120초 finalization — 깨어 있는 기기 | 14:30 뒤 즉시 시작·종료 결과 | 미측정 |
| 120초 finalization — 잠든 기기 | 14:30을 지나 wake한 뒤 시작·종료 결과 | 미측정 |
| clock candidate | 두 Mac 양방향 4-timestamp 행렬 | 미측정 |
| local-only 기준점 | Peer 없이 유효한 기준점 허용, 무효화 뒤 수동 새 기준점 복구 | 모델만 통과 · 실기기 미측정 |
| 공유 이력 고정 | 최초 공유 전 durable 기록, Peer 부재·단일 참여 뒤에도 복귀 금지 | 모델만 통과 · 실기기 미측정 |
| system clock change | disposable 환경의 durable 무효화, local-only 새 기준점, 공유 Room 새 기준점과 fresh Peer 복구 | 미측정 |
| freshness 경계 | 실제 29,999ms 허용과 30,000ms stale | 모델만 통과 · 실기기 미측정 |
| 연속 표본 수 | 1·2개 차단과 3번째 표본 뒤 후보 판정 | 모델만 통과 · 실기기 미측정 |
| 여러 eligible Peer | Peer별 표본 수와 전체 구간 일치·outlier 차단 | 모델만 통과 · 실기기 미측정 |
| wall/monotonic 연속성 | 후보 허용 범위와 불연속 차단 | 모델만 통과 · 실기기 미측정 |
| sleep/wake clock | 실제 sleep 중 `ContinuousClock` 진행과 wake 뒤 deadline | 문서 의미 확인 · 실기기 미측정 |
| 전력·network 비용 | timer wake, CPU/energy, 실제 bytes | 미측정 |

JSON 최상위 `complete`는 `liveGate`의 두 Mac clock 교환, 10-pair clock 행렬,
wake, foreground, network 전환, 새 Peer 발견, 실제 bounded session, 실제
30초 cadence, local-only 기준점 복구, 공유 Room 기준점과 fresh Peer 복구,
freshness·표본 수 경계, wall/monotonic 연속성, sleep/wake clock 의미,
깨어 있는 기기 finalization, 잠든 기기 finalization과 실제 resource 비용을
모두 충족한 경우에만 `true`입니다. 하나라도 빠지면 최상위
`missingEvidence`에 남고 `policyToleranceMayBeApproved`도 `false`입니다.

## 8. 구현 불변식

1. session timeout, cadence와 finalization elapsed는 wall clock을 사용하지 않습니다.
2. 하나의 coordinator는 동시에 bounded session 하나만 소유합니다.
3. 종료된 session은 timer나 task를 만들어 자신을 다시 시작하지 않습니다.
4. system clock change는 동기화 trigger가 아니라 시계 검증 무효화 trigger입니다.
5. daily close는 KST 운영일별 terminal snapshot이며 process 재실행·time zone 변경·wall clock rollback으로 해제하지 않습니다.
6. 14:30 이후 복귀는 쓰기를 열지 않고 finalization부터 시작합니다.
7. finalization 내부 session도 3회·30초를 넘지 않습니다.
8. local-only Room은 유효한 macOS 기준점만 요구하고 Peer 부재만으로 차단하지 않습니다.
9. `everShared`는 한 번 `true`가 되면 다시 local-only로 되돌리지 않습니다.
10. 공유 Room의 후보 판정은 eligible Peer별 표본 수와 전체 표본 구간을 모두 검사합니다.
11. 미승인 후보 판정 통과와 출시 쓰기 허용을 분리하며, 증거 전에는 공유 Room을 fail-closed합니다.
12. 열람, 제한된 동기화와 수동 새로고침은 시계 차이 gate가 막지 않습니다.
13. 검증 불가 늦은 이벤트는 성공 결과를 자동 정정하지 않습니다.
14. 모델 보고서는 실기기 gate의 미측정을 명시적으로 남깁니다.
15. 결과에는 hostname, IP, SSID, interface 이름, 절대 실행 시각과 로컬 절대 경로를 넣지 않습니다.

## 9. 한계와 열린 항목

- 실제 두 Mac 시계 교환 증거가 없습니다.
- 같은 host 두 process 통신은 확인했지만 의도대로 후보 evidence에서 제외됩니다.
- 실제 sleep·foreground·network burst 순서를 관찰하지 않았습니다.
- 실제 Peer 동기화 payload와 byte 비용을 모델링하지 않았습니다.
- OS 수준 energy 측정을 하지 않았습니다.
- local-only 새 기준점과 공유 Room의 새 기준점·fresh Peer 복구를 실기기에서 관찰하지 않았습니다.
- 여러 eligible Room Peer의 불일치·outlier 차단을 실제 장비에서 관찰하지 않았습니다.
- wall/monotonic 진행 불연속 후보와 실제 sleep 중 `ContinuousClock` 진행을 계측하지 않았습니다.
- Peer 시각을 근거로 로컬 finalization을 앞당기는 동작은 승인되지 않았습니다.
- macOS 시각의 암호학적 진위나 관리자 권한으로 함께 잘못 설정된 여러 기기까지 검출하지 못하는 위험은 `POL-02-R-08`이 MVP에서 수용합니다.

이 항목 중 제품 동작을 선택해야 하는 내용은 현재 이슈에서 추측하지 않습니다.
실기기 행렬을 채운 뒤에도 남으면 후속 제품 계약 이슈로 분리합니다.

## 10. 문서 영향

- 이 문서는 #86의 KST·macOS 시각·Room별 신뢰 계약에 맞춰 모델 결과, live prerequisite와 미측정 gate를 분리합니다.
- [POL-02-R-08](../../policies/02_replication_consistency_retention.md)은 변경하지 않습니다. 현재 결과는 후보 수치를 승인할 실기기 증거가 없으므로 #86이 남긴 미승인 후보와 fail-closed 규칙을 그대로 지킵니다.
- [PRD-01](../../prd/01_lunchtime_mvp.md)과 [POL-01](../../policies/01_daily_room_lifecycle.md)은 변경하지 않습니다. #86이 승인 사용자 결과를 이미 정렬했고 이 spike는 이를 검증합니다.
- [복제·정합성·복구 Architecture](../../architecture/04_replication_consistency_and_recovery.md)는 변경하지 않습니다. #86이 `everShared`, `clockRecoveryRequired`, 기준점, eligible Room Peer와 terminal close 구현 경계를 이미 확정했습니다.

## 11. 다음 단계

1. 현재 Mac에서 15분 live adapter 관찰을 수행하되 system clock은 변경하지 않습니다.
2. 두 물리 Mac에서 6.2절 clock 행렬을 양방향으로 실행하고 익명 typed evidence로 집계합니다.
3. 7절의 wake·foreground·network·Peer session·cadence·local-only·공유 Room 복구·비용 행렬을 채웁니다.
4. 실제 KST 14:30에 한 기기는 awake, 다른 기기는 sleep 상태로 finalization과 terminal close를 관찰합니다.
5. 별도 시험 기기에서만 system clock 변경·rollback과 복구 행렬을 수행합니다.
6. 위 증거가 후보를 지지하면 제품 책임자가 허용 오차, freshness, 표본 수, wall/monotonic 연속성 기준과 sleep/wake clock 의미를 승인합니다.
7. 승인 뒤에만 `POL-02-R-08`을 확정값으로 갱신하고 `PRD-01-SP-03` 출시 gate를 해제하며 #4 PR을 Ready로 전환할 수 있습니다.
8. 증거가 후보를 지지하지 않으면 수치를 자동 완화하지 않고 후속 제품 계약 이슈를 만듭니다.
