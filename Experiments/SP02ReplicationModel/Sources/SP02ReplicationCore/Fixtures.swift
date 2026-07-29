import Foundation

// 결정적 fixture 카탈로그.
//
// 모든 값은 익명 라벨과 논리 시각(분)이다. 실제 시계, 실제 전송과 무작위
// 입력을 쓰지 않으므로 같은 seed에서 항상 같은 결과가 나온다.

/// fixture가 공유하는 라벨과 시각.
public enum FixtureBase {
    public static let daySession = "DAY-1"

    public static let r1 = RoomID("R1")
    public static let r2 = RoomID("R2")

    public static let u1 = UserID("U1")
    public static let u2 = UserID("U2")
    public static let u3 = UserID("U3")

    public static let d1 = DeviceID("D1")
    public static let d2 = DeviceID("D2")
    public static let d3 = DeviceID("D3")

    public static let p1 = PeerID("P1")
    public static let p2 = PeerID("P2")
    public static let p3 = PeerID("P3")

    /// 11:05. Room 생성.
    static let created = 665
    /// 12:00. R1의 주문 마감 시각.
    static let deadline = 720

    static let peerDevices: [PeerID: DeviceID] = [p1: d1, p2: d2, p3: d3]
}

func makeEvent(
    _ id: String,
    user: UserID,
    device: DeviceID,
    room: RoomID?,
    order: Int,
    at minute: Int,
    kind: EventKind
) -> LedgerEvent {
    LedgerEvent(
        id: EventID(id),
        daySession: FixtureBase.daySession,
        room: room,
        authorUser: user,
        authorDevice: device,
        logicalOrder: order,
        occurredAtMinute: minute,
        kind: kind
    )
}

/// 두 사용자가 마감 전 ACK로 확정하고 각자 메뉴를 등록한 기본 Room.
///
/// 여러 fixture가 이 집합을 공유한다. 같은 출발점을 쓰면 fixture 사이 차이가
/// "무엇을 바꿨는가" 하나로 좁혀진다.
struct BaseRoom {
    let roomCreated: LedgerEvent
    let requestU1: LedgerEvent
    let requestU2: LedgerEvent
    let acceptanceForU2: LedgerEvent
    let confirmationU2: LedgerEvent
    let acceptanceForU1: LedgerEvent
    let confirmationU1: LedgerEvent
    let menuU1: LedgerEvent
    let menuU2: LedgerEvent

    /// P1이 만든 이벤트.
    var authoredByP1: [LedgerEvent] {
        [roomCreated, requestU1, acceptanceForU2, confirmationU1, menuU1]
    }

    /// P2가 만든 이벤트.
    var authoredByP2: [LedgerEvent] {
        [requestU2, confirmationU2, acceptanceForU1, menuU2]
    }

    var all: [LedgerEvent] { authoredByP1 + authoredByP2 }

    init() {
        let base = FixtureBase.self
        roomCreated = makeEvent(
            "E01", user: base.u1, device: base.d1, room: base.r1, order: 1, at: base.created,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: base.deadline)
        )
        requestU1 = makeEvent(
            "E02", user: base.u1, device: base.d1, room: base.r1, order: 2, at: 666,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        requestU2 = makeEvent(
            "E03", user: base.u2, device: base.d2, room: base.r1, order: 3, at: 668,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        acceptanceForU2 = makeEvent(
            "E04", user: base.u1, device: base.d1, room: base.r1, order: 4, at: 669,
            kind: .participationAcceptance(requestID: EventID("E03"))
        )
        confirmationU2 = makeEvent(
            "E05", user: base.u2, device: base.d2, room: base.r1, order: 5, at: 670,
            kind: .participationConfirmation(
                requestID: EventID("E03"), acceptanceID: EventID("E04"), ackReceivedAtMinute: 670
            )
        )
        acceptanceForU1 = makeEvent(
            "E06", user: base.u2, device: base.d2, room: base.r1, order: 6, at: 671,
            kind: .participationAcceptance(requestID: EventID("E02"))
        )
        confirmationU1 = makeEvent(
            "E07", user: base.u1, device: base.d1, room: base.r1, order: 7, at: 672,
            kind: .participationConfirmation(
                requestID: EventID("E02"), acceptanceID: EventID("E06"), ackReceivedAtMinute: 672
            )
        )
        menuU1 = makeEvent(
            "E08", user: base.u1, device: base.d1, room: base.r1, order: 8, at: 675,
            kind: .menuRevision(
                items: ["M1"], revision: 1, parent: nil, supersedes: [], authority: EventID("E07")
            )
        )
        menuU2 = makeEvent(
            "E09", user: base.u2, device: base.d2, room: base.r1, order: 9, at: 676,
            kind: .menuRevision(
                items: ["M2"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
    }
}

/// 한 이벤트를 소유 Peer가 아닌 모든 Peer에게 한 번씩 보내는 전달 목록.
func broadcast(
    _ events: [LedgerEvent],
    from sender: PeerID,
    to receivers: [PeerID],
    copies: Int = 1,
    acknowledgementReturns: Bool = true,
    reachesLedger: Bool = true
) -> [Delivery] {
    var deliveries: [Delivery] = []
    for event in events {
        for receiver in receivers where receiver != sender {
            for _ in 0..<copies {
                deliveries.append(Delivery(
                    event: event,
                    from: sender,
                    to: receiver,
                    reachesLedger: reachesLedger,
                    acknowledgementReturns: acknowledgementReturns
                ))
            }
        }
    }
    return deliveries
}

/// 저장소에 고정한 fixture 목록.
public enum FixtureCatalog {
    public static var all: [Fixture] {
        [
            deterministicReplay(),
            duplicateAndReorder(),
            sameIDPayloadConflict(),
            transportVersusStorageAcknowledgement(),
            lateParticipationAndMissedAcknowledgement(),
            menuRevisionDivergence(),
            duplicateRoomParticipation(),
            partitionAndRejoin(),
            boundedSessionExhaustion(),
            orderStatusRaceAndLateMenu(),
            unauthorizedWrites(),
            duplicateRoomRecord(),
            plantedRoomRecordAuthority(),
            deadlineShrinkingRoomRecord()
        ]
    }

    public static func named(_ name: String) -> Fixture? {
        all.first { $0.name == name }
    }

    // MARK: - 1. 결정적 replay

    static func deterministicReplay() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        return Fixture(
            name: "deterministic-replay",
            question: "같은 이벤트 집합을 서로 다른 도착 순서로 적용해도 세 Peer의 구조화 projection이 같은가?",
            traceIDs: ["PRD-01-FR-09", "PRD-01-AC-02", "POL-02-R-01", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                .deliver(label: "전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all))
            ],
            convergentPeers: all,
            findings: [
                "장부 도착 순서와 무관하게 세 Peer의 projection hash가 같다.",
                "참여하지 않은 인식된 Peer(P3)도 같은 구조화 결과를 계산한다."
            ]
        )
    }

    // MARK: - 2. 중복과 순서 뒤섞기

    static func duplicateAndReorder() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        return Fixture(
            name: "duplicate-and-reorder",
            question: "같은 이벤트를 여러 번 받아도 업무 효과가 중복 적용되지 않고 projection이 유지되는가?",
            traceIDs: ["PRD-01-FR-09", "POL-02-R-01", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                .deliver(label: "중복 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all, copies: 3)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all, copies: 3))
            ],
            convergentPeers: all,
            findings: [
                "같은 ID·같은 payload를 세 번씩 받아도 projection hash가 1번 fixture와 같다.",
                "재수신은 기존 저장분의 StorageACK를 다시 만들 뿐 장부를 바꾸지 않는다."
            ]
        )
    }

    // MARK: - 3. 동일 ID·다른 payload

    static func sameIDPayloadConflict() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        // 같은 event ID에 다른 메뉴 내용을 실은 envelope. 정상 중복이 아니다.
        let forgedMenuU2 = makeEvent(
            "E09", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 9, at: 676,
            kind: .menuRevision(
                items: ["M2-변조"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        return Fixture(
            name: "same-id-payload-conflict",
            question: "같은 event ID에 다른 payload가 오면 정상 중복으로 인정하지 않고 격리하는가?",
            traceIDs: ["POL-02-R-01", "PRD-01-FR-12", "POL-03-R-03"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                .deliver(label: "정상 전파와 변조 envelope", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all)
                    + [Delivery(event: forgedMenuU2, from: FixtureBase.p2, to: FixtureBase.p3)])
            ],
            // 변조 envelope를 받지 않은 P1·P2는 계속 수렴한다.
            convergentPeers: [FixtureBase.p1, FixtureBase.p2],
            // P3의 결과는 어느 payload가 먼저 도착했는지에 따라 달라진다.
            // 이것은 모델의 한계이자 이 스파이크가 보고해야 할 발견이다.
            expectsOrderIndependentProjection: false,
            findings: [
                "동일 ID·다른 payload는 StorageACK 대상이 아니고 격리된다.",
                "먼저 도착한 payload가 장부에 남으므로 변조 envelope를 받은 Peer의 결과는 도착 순서에 의존한다.",
                "따라서 결정적 수렴은 event ID가 정직하게 발급된다는 전제 위에서만 성립한다."
            ]
        )
    }

    // MARK: - 4. 전송 성공과 저장 ACK

    static func transportVersusStorageAcknowledgement() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        let p1WithoutMenu = base.authoredByP1.filter { $0.id != base.menuU1.id }
        let p2WithoutMenu = base.authoredByP2.filter { $0.id != base.menuU2.id }
        return Fixture(
            name: "transport-versus-storage-ack",
            question: "전송 호출이 성공했지만 저장 회신이 없는 메뉴를 `복제됨`으로 표시하는가?",
            traceIDs: ["PRD-01-AC-02", "PRD-01-FR-06", "POL-02-R-03", "POL-02-R-04"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                .deliver(label: "참여 record 전파", deliveries:
                    broadcast(p1WithoutMenu, from: FixtureBase.p1, to: all)
                    + broadcast(p2WithoutMenu, from: FixtureBase.p2, to: all)),
                .deliver(label: "메뉴 전송 성공·저장 회신 유실", deliveries:
                    broadcast([base.menuU1], from: FixtureBase.p1, to: all, acknowledgementReturns: false)
                    + broadcast([base.menuU2], from: FixtureBase.p2, to: all, acknowledgementReturns: false))
            ],
            convergentPeers: all,
            findings: [
                "메뉴가 상대 장부에 실제로 도달해 구조화 projection은 세 Peer가 같다.",
                "그런데도 작성 기기는 자기 메뉴를 `이 기기에 저장됨`으로 유지하고 주문 완료를 막는다.",
                "동기화 상태는 장부가 아니라 로컬 관측이므로 같은 event 집합에서도 Peer마다 다르다."
            ]
        )
    }

    // MARK: - 5. 늦은 참여와 마감 뒤 ACK

    static func lateParticipationAndMissedAcknowledgement() -> Fixture {
        let base = FixtureBase.self
        let all = [base.p1, base.p2, base.p3]

        let roomCreated = makeEvent(
            "E01", user: base.u1, device: base.d1, room: base.r1, order: 1, at: base.created,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: base.deadline)
        )
        // U2: 마감 5분 전 요청, 마감 1분 전 ACK 수신 → 확정.
        let requestU2 = makeEvent(
            "E10", user: base.u2, device: base.d2, room: base.r1, order: 10, at: 715,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptanceU2 = makeEvent(
            "E11", user: base.u1, device: base.d1, room: base.r1, order: 11, at: 717,
            kind: .participationAcceptance(requestID: EventID("E10"))
        )
        let confirmationU2 = makeEvent(
            "E12", user: base.u2, device: base.d2, room: base.r1, order: 12, at: 719,
            kind: .participationConfirmation(
                requestID: EventID("E10"), acceptanceID: EventID("E11"), ackReceivedAtMinute: 719
            )
        )
        // U3: 같은 창에서 요청했지만 마감까지 ACK를 받지 못함 → 영구 실패.
        let requestU3 = makeEvent(
            "E13", user: base.u3, device: base.d3, room: base.r1, order: 13, at: 716,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptanceU3 = makeEvent(
            "E14", user: base.u1, device: base.d1, room: base.r1, order: 14, at: 718,
            kind: .participationAcceptance(requestID: EventID("E13"))
        )
        let failureU3 = makeEvent(
            "E15", user: base.u3, device: base.d3, room: base.r1, order: 15, at: 719,
            kind: .participationFailure(
                requestID: EventID("E13"), reason: .acknowledgementMissedDeadline
            )
        )
        // 마감 뒤에 도착한 ACK로 만든 confirmation. 소급 확정 시도다.
        let lateConfirmationU3 = makeEvent(
            "E16", user: base.u3, device: base.d3, room: base.r1, order: 16, at: 725,
            kind: .participationConfirmation(
                requestID: EventID("E13"), acceptanceID: EventID("E14"), ackReceivedAtMinute: 725
            )
        )

        let p1Events = [roomCreated, acceptanceU2, acceptanceU3]
        let p2Events = [requestU2, confirmationU2]
        let p3Events = [requestU3, failureU3, lateConfirmationU3]

        return Fixture(
            name: "late-participation-and-missed-ack",
            question: "마감 전 ACK로 확정된 늦은 참여와 마감까지 ACK가 없던 참여를 다른 결과로 계산하는가?",
            traceIDs: ["PRD-01-FR-02", "PRD-01-AC-09", "POL-02-R-04", "POL-02-R-05"],
            daySession: base.daySession,
            peers: FixtureBase.peerDevices,
            authored: [base.p1: p1Events, base.p2: p2Events, base.p3: p3Events],
            phases: [
                .deliver(label: "마감 전 전파", deliveries:
                    broadcast(p1Events, from: base.p1, to: all)
                    + broadcast([requestU2], from: base.p2, to: all)
                    + broadcast([requestU3, failureU3], from: base.p3, to: all)),
                .deliver(label: "마감 뒤 늦은 전파", deliveries:
                    broadcast([confirmationU2], from: base.p2, to: all)
                    + broadcast([lateConfirmationU3], from: base.p3, to: all))
            ],
            convergentPeers: all,
            findings: [
                "마감 전에 저장된 U2의 confirmation record는 마감 뒤 도착해도 유효한 참여로 계산된다.",
                "마감까지 ACK를 받지 못한 U3는 영구 실패이며 마감 뒤 ACK로 만든 confirmation은 거부된다.",
                "확정 판정의 근거는 ACK 수신 시각이지 전파 시각이 아니다."
            ]
        )
    }

    // MARK: - 6. 메뉴 리비전 분기

    static func menuRevisionDivergence() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        // 같은 논리 변경을 서로 다른 ID로 다시 만든 경우(아키텍처 04).
        let branchA = makeEvent(
            "E20", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 680,
            kind: .menuRevision(
                items: ["M2-a"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let branchB = makeEvent(
            "E21", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 11, at: 681,
            kind: .menuRevision(
                items: ["M2-b"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let p2Events = base.authoredByP2 + [branchA, branchB]
        return Fixture(
            name: "menu-revision-divergence",
            question: "같은 사용자의 분기 메뉴 리비전에서 자동 승자를 고르지 않고 확인 필요로 남기는가?",
            traceIDs: ["PRD-01-FR-03", "PRD-01-AC-02", "POL-02-R-04", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: p2Events],
            phases: [
                .deliver(label: "분기 리비전 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(p2Events, from: FixtureBase.p2, to: all))
            ],
            convergentPeers: all,
            findings: [
                "두 head가 모두 장부에 남고 어느 쪽도 자동 채택되지 않는다.",
                "세 Peer가 같은 `확인 필요` 결과로 수렴하며 주문 완료가 차단된다.",
                "마지막 쓰기 우선이나 논리 순서 큰 쪽 선택 같은 자동 규칙을 두지 않았다."
            ]
        )
    }

    // MARK: - 7. 중복 Room 참여

    static func duplicateRoomParticipation() -> Fixture {
        let base = FixtureBase.self
        let all = [base.p1, base.p2, base.p3]

        let room1 = makeEvent(
            "E01", user: base.u1, device: base.d1, room: base.r1, order: 1, at: base.created,
            kind: .roomCreated(store: "S1", orderDeadlineMinute: base.deadline)
        )
        let room2 = makeEvent(
            "E30", user: base.u3, device: base.d3, room: base.r2, order: 2, at: 666,
            kind: .roomCreated(store: "S2", orderDeadlineMinute: base.deadline)
        )
        let requestR1 = makeEvent(
            "E31", user: base.u2, device: base.d2, room: base.r1, order: 3, at: 668,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let acceptanceR1 = makeEvent(
            "E32", user: base.u1, device: base.d1, room: base.r1, order: 4, at: 669,
            kind: .participationAcceptance(requestID: EventID("E31"))
        )
        let confirmationR1 = makeEvent(
            "E33", user: base.u2, device: base.d2, room: base.r1, order: 5, at: 670,
            kind: .participationConfirmation(
                requestID: EventID("E31"), acceptanceID: EventID("E32"), ackReceivedAtMinute: 670
            )
        )
        let requestR2 = makeEvent(
            "E34", user: base.u2, device: base.d2, room: base.r2, order: 6, at: 671,
            kind: .participationRequest(roomRecord: EventID("E30"))
        )
        let acceptanceR2 = makeEvent(
            "E35", user: base.u3, device: base.d3, room: base.r2, order: 7, at: 672,
            kind: .participationAcceptance(requestID: EventID("E34"))
        )
        let confirmationR2 = makeEvent(
            "E36", user: base.u2, device: base.d2, room: base.r2, order: 8, at: 673,
            kind: .participationConfirmation(
                requestID: EventID("E34"), acceptanceID: EventID("E35"), ackReceivedAtMinute: 673
            )
        )

        let p1Events = [room1, acceptanceR1]
        let p2Events = [requestR1, confirmationR1, requestR2, confirmationR2]
        let p3Events = [room2, acceptanceR2]

        return Fixture(
            name: "duplicate-room-participation",
            question: "분리 뒤 재결합에서 같은 사용자의 두 Room 참여를 자동 선택하지 않고 충돌로 남기는가?",
            traceIDs: ["PRD-01-FR-02", "PRD-01-AC-11", "POL-02-R-05"],
            daySession: base.daySession,
            peers: FixtureBase.peerDevices,
            authored: [base.p1: p1Events, base.p2: p2Events, base.p3: p3Events],
            phases: [
                .deliver(label: "분리 구간 전파", deliveries:
                    broadcast([room1, acceptanceR1], from: base.p1, to: [base.p1, base.p2])
                    + broadcast([requestR1, confirmationR1], from: base.p2, to: [base.p1, base.p2])
                    + broadcast([room2, acceptanceR2], from: base.p3, to: [base.p2, base.p3])
                    + broadcast([requestR2, confirmationR2], from: base.p2, to: [base.p2, base.p3])),
                .antiEntropy(
                    label: "재결합 대조",
                    pairs: [PeerPair(base.p1, base.p2), PeerPair(base.p2, base.p3), PeerPair(base.p1, base.p3)],
                    limits: SessionLimits()
                )
            ],
            convergentPeers: all,
            findings: [
                "재결합 뒤 세 Peer가 같은 `참여 충돌` 결과로 수렴한다.",
                "먼저 만들어진 참여나 논리 순서가 앞선 참여를 자동으로 채택하지 않는다.",
                "두 Room 모두 주문 완료가 막히며 사용자 선택 이벤트가 있어야 풀린다."
            ]
        )
    }

    // MARK: - 8. 네트워크 분리와 재결합

    static func partitionAndRejoin() -> Fixture {
        let base = BaseRoom()
        return Fixture(
            name: "partition-and-rejoin",
            question: "분리 중 서로 다른 상태였던 두 Peer가 제한 세션 안의 대조로 같은 결과에 도달하는가?",
            traceIDs: ["PRD-01-AC-03", "PRD-01-FR-09", "POL-02-R-02", "POL-02-R-03"],
            daySession: FixtureBase.daySession,
            peers: [FixtureBase.p1: FixtureBase.d1, FixtureBase.p2: FixtureBase.d2],
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                // 분리 구간에는 어떤 전달도 없다. 각자 자기 이벤트만 보유한다.
                .deliver(label: "분리 구간", deliveries: []),
                .antiEntropy(
                    label: "재결합 대조",
                    pairs: [PeerPair(FixtureBase.p1, FixtureBase.p2)],
                    limits: SessionLimits()
                )
            ],
            convergentPeers: [FixtureBase.p1, FixtureBase.p2],
            findings: [
                "분리 구간에는 두 Peer의 projection hash가 다르다.",
                "제한 세션 한 번의 대조로 양쪽 요약이 일치하고 hash가 같아진다.",
                "대조가 끝난 scope만 `동기화됨`이 되며 그 전에는 최신으로 표시하지 않는다."
            ]
        )
    }

    // MARK: - 9. 세션 한도 소진

    static func boundedSessionExhaustion() -> Fixture {
        let base = BaseRoom()
        return Fixture(
            name: "bounded-session-exhaustion",
            question: "한 세션의 횟수 한도 안에 차이를 해소하지 못하면 무한 재시도 대신 확인 필요로 멈추는가?",
            traceIDs: ["PRD-01-AC-03", "POL-02-R-02", "POL-02-R-03"],
            daySession: FixtureBase.daySession,
            peers: [FixtureBase.p1: FixtureBase.d1, FixtureBase.p2: FixtureBase.d2],
            authored: [FixtureBase.p1: base.authoredByP1, FixtureBase.p2: base.authoredByP2],
            phases: [
                .deliver(label: "분리 구간", deliveries: []),
                .antiEntropy(
                    label: "예산이 모자란 재결합 대조",
                    pairs: [PeerPair(FixtureBase.p1, FixtureBase.p2)],
                    // 한 번의 시도로 방향당 record 하나만 옮길 수 있는 예산.
                    limits: SessionLimits(recordsPerAttempt: 1)
                )
            ],
            convergentPeers: [],
            divergentPeers: [FixtureBase.p1, FixtureBase.p2],
            findings: [
                "3회 시도로 차이를 해소하지 못하면 세션이 멈추고 scope가 `확인 필요`가 된다.",
                "세션 안에서 자동으로 재시작하지 않으므로 무한 재시도가 생기지 않는다.",
                "두 Peer의 projection은 다르며 어느 쪽도 자신을 최신으로 표시하지 않는다."
            ]
        )
    }

    // MARK: - 10. 주문 상태 경쟁과 늦은 메뉴

    static func orderStatusRaceAndLateMenu() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        // 완료 전에 유효하게 만들어졌지만 완료 기기에 늦게 도착한 메뉴 리비전.
        let lateMenuU2 = makeEvent(
            "E40", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 10, at: 682,
            kind: .menuRevision(
                items: ["M2-2"], revision: 2, parent: EventID("E09"), supersedes: [], authority: EventID("E05")
            )
        )
        let completedByU1 = makeEvent(
            "E41", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 12, at: 690,
            kind: .orderCompleted(roomRecord: EventID("E01"), authority: EventID("E07"), snapshot: snapshot)
        )
        let revertedByU2 = makeEvent(
            "E42", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 13, at: 691,
            kind: .orderReverted(roomRecord: EventID("E01"), authority: EventID("E05"))
        )
        // 같은 논리 순서의 두 순서 이벤트. 결정적 보조 키(event ID)로 정렬한다.
        let revertedByU1 = makeEvent(
            "E43", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 14, at: 693,
            kind: .orderReverted(roomRecord: EventID("E01"), authority: EventID("E07"))
        )
        let completedByU2 = makeEvent(
            "E44", user: FixtureBase.u2, device: FixtureBase.d2, room: FixtureBase.r1, order: 14, at: 693,
            kind: .orderCompleted(roomRecord: EventID("E01"), authority: EventID("E05"), snapshot: snapshot)
        )

        let p1Events = base.authoredByP1 + [completedByU1, revertedByU1]
        let p2Events = base.authoredByP2 + [lateMenuU2, revertedByU2, completedByU2]

        return Fixture(
            name: "order-status-race-and-late-menu",
            question: "같은 논리 순서의 주문 상태 경쟁을 결정적으로 정렬하고, 완료 뒤 도착한 유효 메뉴를 성공으로 숨기지 않는가?",
            traceIDs: ["PRD-01-FR-05", "PRD-01-FR-06", "PRD-01-AC-02", "POL-02-R-04", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [FixtureBase.p1: p1Events, FixtureBase.p2: p2Events],
            phases: [
                .deliver(label: "완료 시점까지 전파", deliveries:
                    broadcast(base.authoredByP1 + [completedByU1, revertedByU1], from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2 + [revertedByU2, completedByU2], from: FixtureBase.p2, to: all)),
                .deliver(label: "완료 뒤 늦은 메뉴 전파", deliveries:
                    broadcast([lateMenuU2], from: FixtureBase.p2, to: all))
            ],
            convergentPeers: all,
            findings: [
                "논리 순서가 같은 두 순서 이벤트를 event ID로 정렬해 모든 Peer가 같은 마지막 동작을 계산한다.",
                "완료 스냅샷에 없던 유효 메뉴 리비전이 도착하면 완료를 그대로 안전한 완료로 표시하지 않는다.",
                "완료 표식은 장부에 남고 사용자에게는 `확인 필요`가 함께 보인다."
            ]
        )
    }

    // MARK: - 11. 권한 없는 쓰기

    static func unauthorizedWrites() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        // U3/D3은 R1의 참여자도 생성자도 아니다. 세 가지 쓰기를 모두 시도한다.
        let outsiderCompletion = makeEvent(
            "E50", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 20, at: 700,
            kind: .orderCompleted(
                roomRecord: EventID("E01"), authority: EventID("E05"), snapshot: snapshot
            )
        )
        let outsiderCancellation = makeEvent(
            "E51", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 21, at: 701,
            kind: .roomCancelled(roomRecord: EventID("E01"))
        )
        let outsiderMenu = makeEvent(
            "E52", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 22, at: 702,
            kind: .menuRevision(
                items: ["M3"], revision: 1, parent: nil, supersedes: [], authority: EventID("E05")
            )
        )
        // 참여자 U1이 U2의 메뉴 head를 대신 버리려는 시도.
        let crossUserSupersede = makeEvent(
            "E53", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 23, at: 703,
            kind: .menuRevision(
                items: ["M1-x"], revision: 2, parent: EventID("E08"), supersedes: [EventID("E09")],
                authority: EventID("E07")
            )
        )
        let hostile = [outsiderCompletion, outsiderCancellation, outsiderMenu, crossUserSupersede]

        return Fixture(
            name: "unauthorized-writes",
            question: "참여자·생성자가 아닌 사용자의 주문 완료·Room 취소·메뉴와 남의 head를 버리는 리비전을 장부가 받아들이는가?",
            traceIDs: ["PRD-01-FR-05", "PRD-01-AC-10", "POL-01-R-04", "POL-02-R-04", "POL-03-R-02"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [
                FixtureBase.p1: base.authoredByP1,
                FixtureBase.p2: base.authoredByP2,
                FixtureBase.p3: hostile
            ],
            phases: [
                .deliver(label: "정상 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all)),
                .deliver(label: "권한 없는 쓰기 전파", deliveries:
                    broadcast(hostile, from: FixtureBase.p3, to: all))
            ],
            convergentPeers: all,
            findings: [
                "권한 record가 없는 주문 완료·Room 취소·메뉴는 어느 Peer의 장부에도 들어가지 않는다.",
                "남의 메뉴 head를 supersedes로 지목한 리비전도 거부된다.",
                "거부된 event는 StorageACK 대상이 아니므로 작성자는 성공으로 오인하지 않는다."
            ]
        )
    }

    // MARK: - 12. 중복 Room 생성 record

    static func duplicateRoomRecord() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        // 같은 Room에 대한 두 번째 생성 record. 마감을 14:20으로 늘려 잡는다.
        let forgedRoomRecord = makeEvent(
            "E60", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 30, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        // 원래 마감(12:00) 뒤인 12:05에 ACK를 받았다고 신고하는 참여.
        let lateRequest = makeEvent(
            "E61", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 31, at: 701,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        let lateAcceptance = makeEvent(
            "E62", user: FixtureBase.u1, device: FixtureBase.d1, room: FixtureBase.r1, order: 32, at: 702,
            kind: .participationAcceptance(requestID: EventID("E61"))
        )
        let lateConfirmation = makeEvent(
            "E63", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 33, at: 726,
            kind: .participationConfirmation(
                requestID: EventID("E61"), acceptanceID: EventID("E62"), ackReceivedAtMinute: 725
            )
        )
        let forged = [forgedRoomRecord, lateRequest, lateConfirmation]

        return Fixture(
            name: "duplicate-room-record",
            question: "같은 Room에 생성 record가 둘이면 마감 판정과 Room 정보가 도착 순서에 흔들리는가?",
            traceIDs: ["PRD-01-AC-09", "POL-02-R-01", "POL-02-R-04", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [
                FixtureBase.p1: base.authoredByP1 + [lateAcceptance],
                FixtureBase.p2: base.authoredByP2,
                FixtureBase.p3: forged
            ],
            phases: [
                .deliver(label: "정상 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all)),
                .deliver(label: "중복 생성 record와 늦은 참여 전파", deliveries:
                    broadcast(forged, from: FixtureBase.p3, to: all)
                    + broadcast([lateAcceptance], from: FixtureBase.p1, to: all))
            ],
            convergentPeers: all,
            findings: [
                "두 생성 record가 모두 장부에 남지만 마감은 가장 이른 값으로 fail-closed한다.",
                "늘려 잡은 마감으로 만든 confirmation은 어느 Peer에서도 거부되고 소급 확정이 일어나지 않는다.",
                "Room 정보가 확정되지 않았으므로 `duplicateRoomRecord` 충돌이 남고 주문 완료가 막힌다.",
                "생성 record가 둘이어도 결과가 도착 순서에 흔들리지 않는다."
            ]
        )
    }

    // MARK: - 13. 심은 생성 record로 발급한 쓰기 권한

    /// fixture 11은 **남의** 권한 record를 참조하는 경로만 시험한다.
    ///
    /// 그것만으로는 "자기 record를 심어 권한을 스스로 발급하는" 축이 통째로
    /// 빈다. `roomCreated`는 누구나 만들 수 있어야 하므로 작성자 검증이 없고,
    /// 그 record가 곧 주문 상태·취소의 권한 근거이기 때문이다.
    static func plantedRoomRecordAuthority() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        // 현재 확정 참여자와 메뉴 head를 그대로 담은 스냅샷. 완료가 `확인 필요`로
        // 남는 이유를 "스냅샷 불일치"가 아니라 "Room 정보 미확정" 하나로 좁힌다.
        let snapshot = OrderSnapshot(
            participants: [FixtureBase.u1, FixtureBase.u2],
            menuHeads: [FixtureBase.u1: EventID("E08"), FixtureBase.u2: EventID("E09")]
        )
        // U3/D3이 같은 Room ID로 심은 자기 생성 record.
        let plantedRoomRecord = makeEvent(
            "E70", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 30, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 860)
        )
        // 취소 대상 종류 검사를 위한 자기 record. 확정되지 않은 참여 요청이다.
        let outsiderRequest = makeEvent(
            "E71", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 31, at: 701,
            kind: .participationRequest(roomRecord: EventID("E01"))
        )
        // 자기 참여 요청을 취소 대상으로 지목한다. 작성자 검사만으로는 통과한다.
        let cancellationOnOwnRequest = makeEvent(
            "E72", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 32, at: 702,
            kind: .roomCancelled(roomRecord: EventID("E71"))
        )
        // 심은 생성 record를 지목한 취소. 장부의 작성자 검사는 통과한다.
        let cancellationOnPlantedRecord = makeEvent(
            "E73", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 33, at: 703,
            kind: .roomCancelled(roomRecord: EventID("E70"))
        )
        // 심은 생성 record를 권한 근거로 쓴 주문 완료.
        let completionOnPlantedRecord = makeEvent(
            "E74", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 34, at: 704,
            kind: .orderCompleted(
                roomRecord: EventID("E01"), authority: EventID("E70"), snapshot: snapshot
            )
        )
        let planted = [
            plantedRoomRecord,
            outsiderRequest,
            cancellationOnOwnRequest,
            cancellationOnPlantedRecord,
            completionOnPlantedRecord
        ]

        return Fixture(
            name: "planted-room-record-authority",
            question: "같은 Room ID로 자기 생성 record를 심으면 Room 취소와 주문 완료 권한을 스스로 발급할 수 있는가?",
            traceIDs: ["PRD-01-FR-05", "PRD-01-AC-10", "POL-01-R-04", "POL-01-R-05", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [
                FixtureBase.p1: base.authoredByP1,
                FixtureBase.p2: base.authoredByP2,
                FixtureBase.p3: planted
            ],
            phases: [
                .deliver(label: "정상 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all)),
                .deliver(label: "심은 생성 record와 권한 쓰기 전파", deliveries:
                    broadcast(planted, from: FixtureBase.p3, to: all))
            ],
            convergentPeers: all,
            findings: [
                "취소 대상이 생성 record가 아니면 자기 record를 지목해도 장부가 거부한다.",
                "심은 생성 record를 지목한 취소는 장부를 통과하지만 정본 생성자의 것이 아니므로 적용되지 않는다.",
                "심은 생성 record를 권한 근거로 쓴 주문 완료는 장부를 통과하지만 확정 완료로 승격되지 않는다.",
                "세 시도 모두 도착 순서와 무관하게 같은 결과로 수렴한다."
            ]
        )
    }

    // MARK: - 14. 마감을 줄여 잡은 생성 record

    /// fixture 12는 마감을 **늘려 잡은** record만 시험한다.
    ///
    /// 반대 방향이 더 위험하다. 장부는 그 시점까지 받은 생성 record만 보고
    /// 마감을 계산하므로, 마감을 줄여 잡은 record가 confirmation보다 늦게 오면
    /// 그 Peer의 장부에는 confirmation이 남고 먼저 받은 Peer에서는 거부된다.
    /// 같은 이벤트 집합인데 **검증 결과가 갈리는** 유일한 경로였다.
    static func deadlineShrinkingRoomRecord() -> Fixture {
        let base = BaseRoom()
        let all = [FixtureBase.p1, FixtureBase.p2, FixtureBase.p3]
        // 11:08. base의 두 confirmation(11:10, 11:12 수신)보다 앞선 마감이다.
        let shrunkRoomRecord = makeEvent(
            "E80", user: FixtureBase.u3, device: FixtureBase.d3, room: FixtureBase.r1, order: 80, at: 700,
            kind: .roomCreated(store: "S9", orderDeadlineMinute: 668)
        )

        return Fixture(
            name: "deadline-shrinking-room-record",
            question: "마감을 줄여 잡은 생성 record가 늦게 도착하면 이미 확정된 참여의 판정이 Peer마다 갈리는가?",
            traceIDs: ["PRD-01-AC-09", "POL-02-R-01", "POL-02-R-04", "POL-02-R-05"],
            daySession: FixtureBase.daySession,
            peers: FixtureBase.peerDevices,
            authored: [
                FixtureBase.p1: base.authoredByP1,
                FixtureBase.p2: base.authoredByP2,
                FixtureBase.p3: [shrunkRoomRecord]
            ],
            phases: [
                .deliver(label: "정상 전파", deliveries:
                    broadcast(base.authoredByP1, from: FixtureBase.p1, to: all)
                    + broadcast(base.authoredByP2, from: FixtureBase.p2, to: all)),
                .deliver(label: "마감 축소 record 전파", deliveries:
                    broadcast([shrunkRoomRecord], from: FixtureBase.p3, to: all))
            ],
            convergentPeers: all,
            findings: [
                "정본 마감은 모든 생성 record의 최소값이므로 두 참여 모두 확정에서 내려간다.",
                "장부가 confirmation을 거부했는지 여부와 무관하게 projection은 같은 결과를 낸다.",
                "확정이 내려간 결과는 `참여 실패`가 아니라 `확인 필요`이며 주문 완료를 막는다."
            ]
        )
    }
}
