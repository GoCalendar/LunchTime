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
- KST 쓰기 창은 `[11:00, 14:30)`이고 14:30 이후 벽시계를 되돌려도 다시 열리지 않습니다.
- finalization은 단조 시간 120초의 바깥 한도와 내부 3회·30초 상한을 함께 적용합니다.
- 시계 검증 불가·허용 오차 초과·오래된 검증·system clock 변경은 참여 수락, 주문 마감 수정과 주문 상태 변경만 fail-closed로 차단합니다.
- 14:30 이전 생성 여부를 검증할 수 없는 늦은 이벤트는 열람용 스냅샷만 계산하고 성공·주문 완료·성공 히스토리를 자동 정정하지 않습니다.

그러나 `PRD-01-SP-03`의 출시 gate는 아직 해제할 수 없습니다. 현재 환경에서
실행한 live probe는 process launch만 관찰했습니다. 두 Mac의 시계 교환,
실제 sleep·wake, foreground, network 전환, 14:30 finalization과 실제
전력·네트워크 비용은 측정하지 않았습니다.

`±1초`, freshness `30초`, 연속 표본 `3개`는 **실기기 미확정 후보**입니다.
이 수치를 [POL-02-R-08](../../policies/02_replication_consistency_retention.md)의
승인값으로 사용해서는 안 됩니다. 증거가 없는 동안 기존 fail-closed 동작을
유지해야 합니다.

두 Peer의 상대 시각 일치와 6.2절의 10회 행렬은 필요조건일 뿐 UTC/KST 절대
정확성의 충분조건이 아닙니다. 신뢰할 절대 시각 기준을 정의하거나 여러 Peer의
불일치를 다루는 quorum·선택 규칙을 제품 계약으로 승인하기 전에는 `±1초`를
승인하지 않습니다. 실제 live 행렬과 제품 책임자 승인까지 완료되기 전에는
#4의 PR을 **Ready로 전환하거나 merge해서는 안 되며 Draft로 유지**합니다.

## 2. 모델과 실기기 증거의 경계

### 2.1 결정적 모델이 답하는 것

- trigger coalescing과 동시에 활성인 session 수
- 시도 횟수·단조 경과 시간·finalization 바깥 한도
- anti-entropy 시작 조건과 중단 조건
- KST 14:30 terminal close와 wall-clock rollback
- 4-timestamp offset 구간 계산과 fail-closed 분기
- 늦은 이벤트의 열람·자동 정정 허용 범위

### 2.2 결정적 모델이 답하지 않는 것

- 실제 두 Mac 사이의 wall-clock 차이와 지연 분포
- 실제 sleep 뒤 `NSWorkspace.didWakeNotification` 전달 시각
- 실제 foreground와 network path callback burst의 순서
- 실제 Peer 대조가 3회·30초와 120초 안에서 끝나는지
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
| `DailyWriteBoundary` | 고정 `Asia/Seoul` 쓰기 창과 terminal close |
| `FinalizationCoordinator` | 단조 120초 바깥 한도와 내부 session 검증 |
| `ClockSkewGate` | 4-timestamp 구간, 후보 오차, freshness와 fail-closed |
| `ClockExchangeProbe` | Bonjour A/B rendezvous, 양방향 3회 4-timestamp 교환과 익명 evidence |
| `LateEventClockSafety` | 검증 불가 늦은 이벤트의 열람 전용 처리 |
| `SystemEventSource` | AppKit, NSWorkspace, Foundation, Network event를 `SyncTrigger`로 정규화 |
| `ScenarioCatalog` | 기대값을 실행 전에 선언한 13개 결정적 시나리오 |
| `sp03-probe` | 모델 JSON과 live system-event timeline 출력 |

timeout과 cadence에는 절전 중에도 증가하는
[Swift `ContinuousClock`](https://developer.apple.com/documentation/swift/continuousclock)을
사용합니다. 14:30과 Peer 시계 비교에만 wall clock을 사용합니다.
`SuspendingClock`이나 `Date` 경과 시간으로 30초·120초를 재면 sleep 또는
사용자 시계 변경이 상한을 늘릴 수 있으므로 사용하지 않습니다.

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
87 tests, 12 suites, 0 failures
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
scenarioCount: 13
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
  --observe-seconds 180
```

관찰 시간 안에 다른 앱으로 전환했다가 복귀하고, sleep·wake와 network 전환을
직접 수행합니다. 실제 system clock 변경은 작업용 Mac이 아닌 disposable VM
또는 별도 시험 기기에서만 수행합니다.

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
| `clock-skew-within-candidate` | 모델만 통과 | PRD-01-SP-03, POL-02-R-08 |
| `clock-skew-exceeded-blocks-writes` | 통과 | PRD-01-AC-09, POL-02-R-08 |
| `clock-skew-unverifiable-blocks-writes` | 통과 | PRD-01-FR-10, POL-02-R-08 |
| `system-clock-change-invalidates-validation` | 통과 | PRD-01-FR-10, POL-02-R-08 |
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
불확실성 합에 `10ms` 연속성 여유를 더한 값 이하여야 합니다. 이보다 큰
차이는 일반 지연이 아니라 관찰 중 시계 불연속으로 판정합니다.

연속 3개 표본의 offset 구간이 모두 서로 겹치고, 각 구간 전체가 허용 오차
안에 있을 때만 검증 성공 후보입니다. 다음 경우에는 추측하지 않고 즉시
fail-closed합니다.

- 정상 응답 Peer 없음
- 표본 3개 미만
- monotonic duration이 잘못됐거나 불완전한 표본
- 표본 구간끼리 교집합 없음
- 불확실성 구간이 허용 오차 경계를 걸침
- 검증 뒤 30초 경과
- `NSSystemClockDidChange` 수신

freshness는 단조 시각 기준 반열린 구간
`[validatedAt, validatedAt + 30,000ms)`입니다. 검증 이전 시각과 정확히
30,000ms가 된 시점부터는 stale이며, system clock 변경 뒤에는 새 Peer 표본
3개로 다시 검증하기 전까지 시간 민감 쓰기를 열지 않습니다.

Peer끼리 같은 시각을 보고 있다는 사실은 UTC/KST 절대 정확성을 증명하지
않습니다. 여러 정상 Peer가 서로 다른 시각을 보낼 때의 quorum·선택 규칙도
현재 정본에 없습니다. 이 두 항목을 임의로 구현해서는 안 됩니다.

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
실험 기준입니다. 이 행렬은 두 Peer의 상대 일치만 보이므로 통과 자체로
UTC/KST 정확성을 증명하지 않습니다. 신뢰 기준 또는 승인된
multi-peer/quorum 계약과 제품 책임자 승인이 모두 있기 전에는
`POL-02-R-08`을 확정하지 않습니다.

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
| system clock change | disposable 환경의 무효화와 새 Peer 표본 재검증 복구 | 미측정 |
| 전력·network 비용 | timer wake, CPU/energy, 실제 bytes | 미측정 |

JSON `liveGate.complete`는 두 Mac clock 교환, 10-pair clock 행렬, wake,
foreground, network 전환, 새 Peer 발견, 실제 bounded session, 실제 30초
cadence, system clock 변경 뒤 재검증 복구, 깨어 있는 기기 finalization,
잠든 기기 finalization과 실제 resource 비용을 각각 typed evidence로
요구합니다. 하나라도 `false`이면 `policyToleranceMayBeApproved`도
`false`입니다.

## 8. 구현 불변식

1. session timeout, cadence와 finalization elapsed는 wall clock을 사용하지 않습니다.
2. 하나의 coordinator는 동시에 bounded session 하나만 소유합니다.
3. 종료된 session은 timer나 task를 만들어 자신을 다시 시작하지 않습니다.
4. system clock change는 동기화 trigger가 아니라 시계 검증 무효화 trigger입니다.
5. daily close는 terminal이며 wall clock rollback으로 해제하지 않습니다.
6. 14:30 이후 복귀는 쓰기를 열지 않고 finalization부터 시작합니다.
7. finalization 내부 session도 3회·30초를 넘지 않습니다.
8. 시계 검증 성공은 구간 전체가 승인 오차 안에 있을 때만 가능합니다.
9. 열람, 제한된 동기화와 수동 새로고침은 시계 차이 gate가 막지 않습니다.
10. 검증 불가 늦은 이벤트는 성공 결과를 자동 정정하지 않습니다.
11. 모델 보고서는 실기기 gate의 미측정을 `false`로 명시합니다.
12. 결과에는 hostname, IP, SSID, interface 이름과 로컬 절대 경로를 넣지 않습니다.

## 9. 한계와 열린 항목

- 실제 두 Mac 시계 교환 증거가 없습니다.
- 같은 host 두 process 통신은 확인했지만 의도대로 후보 evidence에서 제외됩니다.
- 실제 sleep·foreground·network burst 순서를 관찰하지 않았습니다.
- 실제 Peer 동기화 payload와 byte 비용을 모델링하지 않았습니다.
- OS 수준 energy 측정을 하지 않았습니다.
- 여러 정상 Peer의 시계가 불일치할 때 quorum 규칙이 없습니다.
- UTC/KST 절대 정확성을 판단할 신뢰 기준이 없습니다.
- Peer 시각을 근거로 로컬 finalization을 앞당기는 동작은 승인되지 않았습니다.
- Peer 간 상대 일치는 절대 시각의 정확성을 증명하지 않습니다.

이 항목 중 제품 동작을 선택해야 하는 내용은 현재 이슈에서 추측하지 않습니다.
실기기 행렬을 채운 뒤에도 남으면 후속 제품 계약 이슈로 분리합니다.

## 10. 문서 영향

- 이 문서를 새로 추가해 모델 결과, live prerequisite와 미측정 gate를 분리했습니다.
- [POL-02-R-08](../../policies/02_replication_consistency_retention.md)에 모델 결과를 승인 허용 오차로 오인하지 않는 증거 gate를 명시합니다.
- [PRD-01](../../prd/01_lunchtime_mvp.md)과 [POL-01](../../policies/01_daily_room_lifecycle.md)의 승인된 사용자 결과는 바꾸지 않습니다.
- Architecture 문서는 바꾸지 않습니다. 실제 transport·scheduler 구현 방식을 확정한 작업이 아니기 때문입니다.

## 11. 다음 단계

1. 두 물리 Mac에서 6.2절 clock 행렬을 양방향으로 실행합니다.
2. 7절의 wake·foreground·network·14:30·비용 행렬을 채웁니다.
3. 신뢰할 절대 시각 기준 또는 multi-peer/quorum 계약을 제품 정본으로
   결정합니다.
4. 위 증거와 계약이 후보를 지지하면 제품 책임자가 허용 오차와 freshness를
   승인합니다.
5. 승인 뒤에만 `POL-02-R-08`을 확정값으로 갱신하고 `PRD-01-SP-03` 출시
   gate를 해제하며 #4 PR을 Ready로 전환할 수 있습니다.
6. 증거가 후보를 지지하지 않으면 수치를 자동 완화하지 않고 후속 제품 계약
   이슈를 만듭니다.
