import Foundation

/// 제한 동기화 세션의 한도.
///
/// 값의 정본은 `POL-02-R-02`다("최대 3회, 총 30초"). 모델은 그 값을 새로 정하지
/// 않고 상한이 실제로 작동하는지만 확인한다. `recordsPerAttempt`는 한 번의
/// 교환으로 옮길 수 있는 record 수의 상한이며, 대용량 교환의 batching 방식은
/// 아키텍처 `04`의 미결정 기술이므로 여기서 고르지 않는다.
public struct SessionLimits: Equatable, Sendable {
    public let maxAttempts: Int
    public let maxElapsedMilliseconds: Int
    public let millisecondsPerAttempt: Int
    public let recordsPerAttempt: Int

    public init(
        maxAttempts: Int = 3,
        maxElapsedMilliseconds: Int = 30_000,
        millisecondsPerAttempt: Int = 4_000,
        recordsPerAttempt: Int = 64
    ) {
        self.maxAttempts = maxAttempts
        self.maxElapsedMilliseconds = maxElapsedMilliseconds
        self.millisecondsPerAttempt = millisecondsPerAttempt
        self.recordsPerAttempt = recordsPerAttempt
    }
}

/// 세션이 멈춘 이유.
public enum SessionStopReason: String, Equatable, Sendable {
    case summariesMatched = "비교한 scope의 요약이 일치"
    case attemptLimitReached = "시도 횟수 한도 소진"
    case timeLimitReached = "총 시간 한도 소진"
}

/// 한 제한 세션의 결과.
public struct SyncSessionResult: Equatable, Sendable {
    public let attemptsUsed: Int
    public let elapsedMilliseconds: Int
    public let transferredRecordCount: Int
    public let stopReason: SessionStopReason
    public var converged: Bool { stopReason == .summariesMatched }
}

/// 시뮬레이션에 참여하는 Peer 하나의 상태.
public struct PeerState: Sendable {
    public let id: PeerID
    /// 이 Peer가 쓰는 기기 ID.
    ///
    /// 복제본 수를 세려면 "이 event를 만든 기기가 나인가"를 알아야 한다. 남이
    /// 만든 event를 내가 보유하고 있으면 그 자체로 복제본이 둘이다.
    public let device: DeviceID
    public var ledger: Ledger
    public var observation: LocalObservation

    public init(
        id: PeerID,
        device: DeviceID,
        ledger: Ledger = Ledger(),
        observation: LocalObservation = LocalObservation()
    ) {
        self.id = id
        self.device = device
        self.ledger = ledger
        self.observation = observation
    }

    /// 이 Peer의 장부·관측으로 계산한 사용자 표시 상태.
    public func localProjection(daySession: String) -> LocalObservationProjection {
        LocalObservationProjection(
            device: device,
            ledger: ledger,
            observation: observation,
            structured: ProjectionReducer.reduce(daySession: daySession, ledger: ledger)
        )
    }
}

/// 두 Peer 사이의 제한된 반엔트로피 대조.
///
/// 아키텍처 `04`의 대칭 교환을 따른다. 양쪽이 요약을 주고받고, 서로 없는
/// record와 pending의 dependency ID를 요청해 채운 뒤, **갱신한 요약을 다시
/// 교환해** 비교한 scope의 일치를 확인해야 대조가 끝난다.
///
/// 한도를 넘으면 조용히 계속하지 않고 멈춘다. 실패한 세션을 타이머로 다시
/// 시작하지 않는다는 `POL-02-R-02`의 요구를 코드 구조로 강제하기 위해 이
/// 함수에는 재시작 경로가 없다.
public enum AntiEntropy {
    @discardableResult
    public static func reconcile(
        _ left: inout PeerState,
        _ right: inout PeerState,
        limits: SessionLimits
    ) -> SyncSessionResult {
        var attempts = 0
        var elapsed = 0
        var transferred = 0

        while true {
            let leftSummary = LedgerSummary(ledger: left.ledger)
            let rightSummary = LedgerSummary(ledger: right.ledger)
            if leftSummary.matchesEveryScope(of: rightSummary),
               left.ledger.missingDependencyIDs.isEmpty,
               right.ledger.missingDependencyIDs.isEmpty {
                markReconciled(&left, &right)
                return SyncSessionResult(
                    attemptsUsed: attempts,
                    elapsedMilliseconds: elapsed,
                    transferredRecordCount: transferred,
                    stopReason: .summariesMatched
                )
            }

            if attempts >= limits.maxAttempts {
                markUnreconciled(&left, &right)
                return SyncSessionResult(
                    attemptsUsed: attempts,
                    elapsedMilliseconds: elapsed,
                    transferredRecordCount: transferred,
                    stopReason: .attemptLimitReached
                )
            }
            if elapsed + limits.millisecondsPerAttempt > limits.maxElapsedMilliseconds {
                markUnreconciled(&left, &right)
                return SyncSessionResult(
                    attemptsUsed: attempts,
                    elapsedMilliseconds: elapsed,
                    transferredRecordCount: transferred,
                    stopReason: .timeLimitReached
                )
            }

            attempts += 1
            elapsed += limits.millisecondsPerAttempt
            transferred += exchange(from: &right, to: &left, budget: limits.recordsPerAttempt)
            transferred += exchange(from: &left, to: &right, budget: limits.recordsPerAttempt)
        }
    }

    /// `source`가 가진 record 중 `destination`에 없는 것을 예산만큼 옮긴다.
    private static func exchange(from source: inout PeerState, to destination: inout PeerState, budget: Int) -> Int {
        let sourceSummary = LedgerSummary(ledger: source.ledger)
        let destinationSummary = LedgerSummary(ledger: destination.ledger)
        var wanted = destinationSummary.missing(comparedTo: sourceSummary)
        // pending event의 의존 record를 같은 세션에서 함께 요청한다.
        let dependencies = destination.ledger.missingDependencyIDs.filter { source.ledger.validated[$0] != nil }
        wanted = Array(Set(wanted + dependencies)).sorted()

        var moved = 0
        for eventID in wanted.prefix(budget) {
            guard let event = source.ledger.validated[eventID] else { continue }
            let outcome = destination.ledger.receive(event)
            source.observation.transportDelivered[eventID, default: []].insert(destination.id)
            moved += 1
            // StorageACK는 정확한 event·revision을 영속 저장했을 때만 돌려준다.
            // pending·rejected·격리는 ACK 대상이 아니다(아키텍처 `03`).
            switch outcome {
            case .appended, .duplicateIdempotent:
                source.observation.storageAcknowledgements[eventID, default: []].insert(destination.id)
            case .pendingDependency, .rejected, .integrityConflict:
                break
            }
        }
        return moved
    }

    private static func markReconciled(_ left: inout PeerState, _ right: inout PeerState) {
        let scopes = comparedScopes(left, right)
        // 이 대조가 실제로 덮은 event만 기록한다. scope만 누적하면 대조가 끝난
        // 뒤 로컬 append한 event까지 `동기화됨`으로 승격된다.
        let reconciled = Set(left.ledger.validated.keys).intersection(right.ledger.validated.keys)
        left.observation.reconciledScopes.formUnion(scopes)
        right.observation.reconciledScopes.formUnion(scopes)
        left.observation.reconciledEventIDs.formUnion(reconciled)
        right.observation.reconciledEventIDs.formUnion(reconciled)
        left.observation.unreconciledAdvertisedScopes.subtract(scopes)
        right.observation.unreconciledAdvertisedScopes.subtract(scopes)
    }

    /// 대조가 끝나지 않은 scope는 `동기화됨`에서 빼고 차이가 남았다고 표시한다.
    private static func markUnreconciled(_ left: inout PeerState, _ right: inout PeerState) {
        let leftSummary = LedgerSummary(ledger: left.ledger)
        let rightSummary = LedgerSummary(ledger: right.ledger)
        var differing: Set<EventScope> = []
        for scope in comparedScopes(left, right)
        where leftSummary.scopes[scope]?.digest != rightSummary.scopes[scope]?.digest {
            differing.insert(scope)
        }
        // 의존 record가 남은 Peer는 자신의 scope 완결성을 주장할 수 없다.
        for event in left.ledger.pending.values { differing.insert(event.scope) }
        for event in right.ledger.pending.values { differing.insert(event.scope) }

        left.observation.reconciledScopes.subtract(differing)
        right.observation.reconciledScopes.subtract(differing)
        left.observation.unreconciledAdvertisedScopes.formUnion(differing)
        right.observation.unreconciledAdvertisedScopes.formUnion(differing)
    }

    private static func comparedScopes(_ left: PeerState, _ right: PeerState) -> Set<EventScope> {
        Set(LedgerSummary(ledger: left.ledger).scopes.keys)
            .union(LedgerSummary(ledger: right.ledger).scopes.keys)
    }
}
