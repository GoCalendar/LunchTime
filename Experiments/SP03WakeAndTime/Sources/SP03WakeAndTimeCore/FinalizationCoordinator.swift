import Foundation

/// `POL-01-R-04`와 `POL-02-R-02`가 승인한 finalization 상한.
public struct FinalizationLimits: Equatable, Sendable {
    public static let policyMaximumOuterMilliseconds: Int64 = 120_000
    public static let policyMaximumInnerAttempts = 3
    public static let policyMaximumInnerElapsedMilliseconds: Int64 = 30_000

    public let outerMilliseconds: Int64
    public let innerMaxAttempts: Int
    public let innerMaxElapsedMilliseconds: Int64

    public init(
        outerMilliseconds: Int64 = 120_000,
        innerMaxAttempts: Int = 3,
        innerMaxElapsedMilliseconds: Int64 = 30_000
    ) {
        precondition(
            Self.isWithinPolicyBounds(
                outerMilliseconds: outerMilliseconds,
                innerMaxAttempts: innerMaxAttempts,
                innerMaxElapsedMilliseconds: innerMaxElapsedMilliseconds
            ),
            "finalization limits must be positive and no greater than policy maxima"
        )
        self.outerMilliseconds = outerMilliseconds
        self.innerMaxAttempts = innerMaxAttempts
        self.innerMaxElapsedMilliseconds = innerMaxElapsedMilliseconds
    }

    public static func isWithinPolicyBounds(
        outerMilliseconds: Int64,
        innerMaxAttempts: Int,
        innerMaxElapsedMilliseconds: Int64
    ) -> Bool {
        outerMilliseconds > 0
            && outerMilliseconds <= policyMaximumOuterMilliseconds
            && innerMaxAttempts > 0
            && innerMaxAttempts <= policyMaximumInnerAttempts
            && innerMaxElapsedMilliseconds > 0
            && innerMaxElapsedMilliseconds <= policyMaximumInnerElapsedMilliseconds
    }
}

/// Finalization 안에서 수행한 제한 동기화 세션 하나의 관측 결과.
public struct FinalizationSessionResult: Equatable, Sendable {
    public let attemptsUsed: Int
    public let elapsedMilliseconds: Int64
    public let latestRevisionConfirmed: Bool

    public init(
        attemptsUsed: Int,
        elapsedMilliseconds: Int64,
        latestRevisionConfirmed: Bool
    ) {
        self.attemptsUsed = attemptsUsed
        self.elapsedMilliseconds = elapsedMilliseconds
        self.latestRevisionConfirmed = latestRevisionConfirmed
    }

    public init(
        syncSessionResult: SyncSessionResult,
        latestRevisionConfirmed: Bool
    ) {
        self.init(
            attemptsUsed: syncSessionResult.attemptsUsed,
            elapsedMilliseconds: syncSessionResult.elapsedMilliseconds,
            latestRevisionConfirmed: latestRevisionConfirmed
        )
    }
}

public enum FinalizationIncompleteReason: String, Equatable, Sendable {
    case latestRevisionUnconfirmedAtOuterLimit
    case innerSessionLimitViolated
    case monotonicTimeInvalid
}

/// Finalization의 terminal 상태.
public enum FinalizationState: Equatable, Sendable {
    case notStarted
    case running
    case complete
    case incomplete(FinalizationIncompleteReason)

    public var isTerminal: Bool {
        switch self {
        case .complete, .incomplete:
            true
        case .notStarted, .running:
            false
        }
    }
}

/// 벽시계 변경과 무관하게 120초 바깥 한도를 지키는 finalization 모델.
///
/// 실패한 inner session을 자동으로 재시작하는 기능은 의도적으로 제공하지
/// 않는다. 호출자가 새 의미 있는 트리거를 받은 경우에만 다음 session 결과를
/// 전달할 수 있다.
public struct FinalizationCoordinator: Equatable, Sendable {
    public let limits: FinalizationLimits
    public private(set) var state: FinalizationState
    public private(set) var startedAt: MonotonicInstant?
    public private(set) var sessionsObserved: Int

    public init(limits: FinalizationLimits = FinalizationLimits()) {
        self.limits = limits
        state = .notStarted
        startedAt = nil
        sessionsObserved = 0
    }

    /// Finalization을 한 번만 시작한다. 완료·불완전 상태는 다시 열리지 않는다.
    @discardableResult
    public mutating func start(at now: MonotonicInstant) -> FinalizationState {
        guard state == .notStarted else { return state }
        startedAt = now
        state = .running
        return state
    }

    /// 제한 세션 결과를 반영한다.
    ///
    /// 최신 리비전을 확인하지 못한 세션은 outer deadline까지 기다릴 뿐 스스로
    /// 다음 세션을 만들지 않는다.
    @discardableResult
    public mutating func record(
        _ result: FinalizationSessionResult,
        at now: MonotonicInstant
    ) -> FinalizationState {
        guard state == .running else { return state }
        expireIfNeeded(at: now)
        guard state == .running else { return state }

        guard result.attemptsUsed >= 0,
              result.elapsedMilliseconds >= 0,
              result.attemptsUsed <= limits.innerMaxAttempts,
              result.elapsedMilliseconds <= limits.innerMaxElapsedMilliseconds
        else {
            state = .incomplete(.innerSessionLimitViolated)
            return state
        }

        sessionsObserved += 1
        if result.latestRevisionConfirmed {
            state = .complete
        }
        return state
    }

    /// 현재 monotonic 시각까지 outer deadline을 진행한다.
    @discardableResult
    public mutating func advance(to now: MonotonicInstant) -> FinalizationState {
        guard state == .running else { return state }
        expireIfNeeded(at: now)
        return state
    }

    private mutating func expireIfNeeded(at now: MonotonicInstant) {
        guard let startedAt else { return }
        let (elapsed, overflow) = now.milliseconds.subtractingReportingOverflow(
            startedAt.milliseconds
        )
        if overflow || elapsed < 0 {
            state = .incomplete(.monotonicTimeInvalid)
        } else if elapsed >= limits.outerMilliseconds {
            state = .incomplete(.latestRevisionUnconfirmedAtOuterLimit)
        }
    }
}
