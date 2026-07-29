import Foundation

/// 한 이벤트가 한 Peer에게 전달되는 사건.
///
/// `reachesLedger`와 `acknowledgementReturns`를 따로 두는 이유가 이 스파이크의
/// 두 번째 완료 조건이다. 전송 호출 성공, 상대 장부 도달, 정확한 리비전 저장
/// 회신은 서로 다른 사건이며 하나로 합치면 `복제됨`이 거짓으로 켜진다.
///
/// `event`를 ID가 아니라 값으로 들고 있는 이유는 같은 ID에 다른 payload를 실은
/// 전달을 표현하기 위해서다. 그 경우를 만들 수 없으면 무결성 충돌 격리를
/// 시험할 수 없다.
public struct Delivery: Sendable {
    public let event: LedgerEvent
    public let from: PeerID
    public let to: PeerID
    /// 상대 장부까지 실제로 도달했는지.
    public let reachesLedger: Bool
    /// 저장 회신이 발신 Peer에게 돌아왔는지.
    public let acknowledgementReturns: Bool

    public init(
        event: LedgerEvent,
        from: PeerID,
        to: PeerID,
        reachesLedger: Bool = true,
        acknowledgementReturns: Bool = true
    ) {
        self.event = event
        self.from = from
        self.to = to
        self.reachesLedger = reachesLedger
        self.acknowledgementReturns = acknowledgementReturns
    }
}

/// 반엔트로피 대조 상대 쌍.
public struct PeerPair: Equatable, Sendable {
    public let left: PeerID
    public let right: PeerID

    public init(_ left: PeerID, _ right: PeerID) {
        self.left = left
        self.right = right
    }
}

/// 시뮬레이션 단계.
public enum FixturePhase: Sendable {
    /// 도착 순서를 순열로 뒤섞는 전달 구간.
    case deliver(label: String, deliveries: [Delivery])
    /// 제한 세션 안의 반엔트로피 대조.
    case antiEntropy(label: String, pairs: [PeerPair], limits: SessionLimits)

    public var label: String {
        switch self {
        case .deliver(let label, _): return label
        case .antiEntropy(let label, _, _): return label
        }
    }
}

/// 결정적 시나리오 하나.
public struct Fixture: Sendable {
    public let name: String
    /// 이 fixture가 확인하는 질문.
    public let question: String
    public let traceIDs: [String]
    public let daySession: String
    /// Peer와 그 기기 ID.
    public let peers: [PeerID: DeviceID]
    /// 각 Peer가 스스로 만들어 로컬 append하는 이벤트.
    public let authored: [PeerID: [LedgerEvent]]
    /// Peer별로 "이 Room이 공유·발견된 적 있다"는 로컬 관측.
    public let sharedRooms: [PeerID: Set<RoomID>]
    public let phases: [FixturePhase]
    /// 마지막에 같은 구조화 projection으로 수렴해야 하는 Peer. 2명 이상일 때만 검사한다.
    public let convergentPeers: [PeerID]
    /// 끝까지 서로 다른 결과로 남아야 하는 Peer.
    ///
    /// "수렴하지 않는 것이 정답"인 fixture를 통과로 위장하지 않기 위해 명시한다.
    public let divergentPeers: [PeerID]
    /// 각 Peer의 결과가 도착 순서와 무관해야 하는지.
    ///
    /// `false`인 fixture는 순서 의존이 모델의 알려진 한계임을 뜻하며, 그 이유를
    /// `findings`에 남긴다.
    public let expectsOrderIndependentProjection: Bool
    /// 보고서에 옮길 사람이 읽는 결론.
    public let findings: [String]

    /// 이 fixture가 event에 실은 사람이 읽는 내용 원문.
    ///
    /// 출력에 이 문자열이 하나라도 남으면 익명화가 깨진 것이다. 목록을 손으로
    /// 관리하면 새 fixture가 검사에서 빠지므로 event에서 직접 뽑는다.
    public var contentLiterals: [String] {
        var literals: Set<String> = []
        for events in authored.values {
            for event in events {
                switch event.kind {
                case .roomCreated(let store, _):
                    literals.insert(store)
                case .menuRevision(let items, _, _, _, _):
                    literals.formUnion(items)
                default:
                    break
                }
            }
        }
        for phase in phases {
            guard case .deliver(_, let deliveries) = phase else { continue }
            for delivery in deliveries {
                switch delivery.event.kind {
                case .roomCreated(let store, _):
                    literals.insert(store)
                case .menuRevision(let items, _, _, _, _):
                    literals.formUnion(items)
                default:
                    break
                }
            }
        }
        return literals.sorted()
    }

    public init(
        name: String,
        question: String,
        traceIDs: [String],
        daySession: String,
        peers: [PeerID: DeviceID],
        authored: [PeerID: [LedgerEvent]],
        sharedRooms: [PeerID: Set<RoomID>] = [:],
        phases: [FixturePhase],
        convergentPeers: [PeerID],
        divergentPeers: [PeerID] = [],
        expectsOrderIndependentProjection: Bool = true,
        findings: [String]
    ) {
        self.name = name
        self.question = question
        self.traceIDs = traceIDs
        self.daySession = daySession
        self.peers = peers
        self.authored = authored
        self.sharedRooms = sharedRooms
        self.phases = phases
        self.convergentPeers = convergentPeers
        self.divergentPeers = divergentPeers
        self.expectsOrderIndependentProjection = expectsOrderIndependentProjection
        self.findings = findings
    }
}

/// 고정 seed에서 같은 순열을 만드는 생성기(splitmix64).
///
/// 순열이 실행마다 달라지면 "두 번 이상 서로 다른 순서로 돌려 hash가 같았다"는
/// 증거를 재현할 수 없다. seed와 순열 번호가 같으면 항상 같은 순서를 만든다.
struct SeededGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

/// 한 단계가 끝난 시점의 Peer별 projection hash.
public struct PhaseSnapshot: Sendable {
    public let label: String
    public let projectionHashes: [PeerID: String]
}

/// 한 순열 실행의 결과.
public struct PermutationRun: Sendable {
    public let permutation: Int
    public let peers: [PeerID: PeerState]
    public let projectionHashes: [PeerID: String]
    public let phaseSnapshots: [PhaseSnapshot]
}

/// fixture 실행기.
public enum FixtureRunner {
    /// 한 순열로 fixture를 끝까지 실행한다.
    ///
    /// 순열 0은 fixture가 선언한 순서 그대로다. 선언 순서를 한 번도 실행하지
    /// 않으면 "뒤섞은 순서에서만 통과하는" 모델을 잡지 못한다.
    public static func run(_ fixture: Fixture, permutation: Int, seed: UInt64) -> PermutationRun {
        var peers: [PeerID: PeerState] = [:]
        for (peer, device) in fixture.peers {
            var state = PeerState(id: peer, device: device)
            state.observation.sharedRooms = fixture.sharedRooms[peer] ?? []
            peers[peer] = state
        }

        // 자기가 만든 이벤트는 생성 순서대로 로컬 append한다. 이 구간은 순열
        // 대상이 아니다. 자신이 방금 만든 이벤트가 자기 기기에 뒤집혀 도착하는
        // 상황은 이 모델의 대상이 아니기 때문이다.
        for (peer, events) in fixture.authored.sorted(by: { $0.key < $1.key }) {
            for event in events.sorted(by: LedgerEvent.deterministicOrder) {
                peers[peer]?.ledger.receive(event)
            }
        }

        var generator = SeededGenerator(seed: seed &+ UInt64(permutation) &* 0x1000_0001)
        var snapshots: [PhaseSnapshot] = []
        for phase in fixture.phases {
            switch phase {
            case .deliver(_, let deliveries):
                let ordered = permutation == 0
                    ? deliveries
                    : shuffle(deliveries, using: &generator)
                for delivery in ordered {
                    peers[delivery.from]?.observation
                        .transportDelivered[delivery.event.id, default: []].insert(delivery.to)
                    guard delivery.reachesLedger, var receiver = peers[delivery.to] else { continue }
                    let outcome = receiver.ledger.receive(delivery.event)
                    peers[delivery.to] = receiver
                    guard delivery.acknowledgementReturns else { continue }
                    switch outcome {
                    case .appended, .duplicateIdempotent:
                        peers[delivery.from]?.observation
                            .storageAcknowledgements[delivery.event.id, default: []].insert(delivery.to)
                    case .pendingDependency, .rejected, .integrityConflict:
                        break
                    }
                }
            case .antiEntropy(_, let pairs, let limits):
                for pair in pairs {
                    guard var left = peers[pair.left], var right = peers[pair.right] else { continue }
                    AntiEntropy.reconcile(&left, &right, limits: limits)
                    peers[pair.left] = left
                    peers[pair.right] = right
                }
            }
            snapshots.append(PhaseSnapshot(label: phase.label, projectionHashes: hashes(of: peers, in: fixture)))
        }

        return PermutationRun(
            permutation: permutation,
            peers: peers,
            projectionHashes: hashes(of: peers, in: fixture),
            phaseSnapshots: snapshots
        )
    }

    private static func hashes(of peers: [PeerID: PeerState], in fixture: Fixture) -> [PeerID: String] {
        peers.reduce(into: [:]) { result, entry in
            result[entry.key] = ProjectionReducer
                .reduce(daySession: fixture.daySession, ledger: entry.value.ledger)
                .hash
        }
    }

    /// Fisher-Yates 셔플. `Array.shuffled(using:)` 대신 직접 구현한다.
    ///
    /// 표준 라이브러리 셔플의 내부 구현이 바뀌면 같은 seed에서 다른 순열이 나올
    /// 수 있다. 이 증거는 재현 가능해야 하므로 순열 생성 규칙을 저장소에 고정한다.
    private static func shuffle(_ deliveries: [Delivery], using generator: inout SeededGenerator) -> [Delivery] {
        var result = deliveries
        guard result.count > 1 else { return result }
        for index in stride(from: result.count - 1, to: 0, by: -1) {
            let pick = Int(generator.next() % UInt64(index + 1))
            result.swapAt(index, pick)
        }
        return result
    }
}
