/// 한 동기화 세션이 절대로 넘을 수 없는 정책 상한.
public struct SyncSessionLimits: Equatable, Sendable {
    public static let policyMaximumAttempts = 3
    public static let policyMaximumElapsedMilliseconds: Int64 = 30_000
    public static let policy = SyncSessionLimits()

    public let maxAttempts: Int
    public let maxElapsedMilliseconds: Int64

    public init(
        maxAttempts: Int = policyMaximumAttempts,
        maxElapsedMilliseconds: Int64 = policyMaximumElapsedMilliseconds
    ) {
        precondition(
            (1...Self.policyMaximumAttempts).contains(maxAttempts),
            "a sync session may attempt at most \(Self.policyMaximumAttempts) times"
        )
        precondition(
            maxElapsedMilliseconds > 0
                && maxElapsedMilliseconds <= Self.policyMaximumElapsedMilliseconds,
            "a sync session may run for at most \(Self.policyMaximumElapsedMilliseconds) ms"
        )
        self.maxAttempts = maxAttempts
        self.maxElapsedMilliseconds = maxElapsedMilliseconds
    }
}

/// 한 번의 대조 시도 결과.
public enum SyncAttemptOutcome: Equatable, Sendable {
    case converged
    case retryableFailure
    case terminalFailure
}

/// 제한 세션이 멈춘 이유.
public enum SyncSessionStopReason: String, Equatable, Sendable {
    case converged
    case attemptLimitReached
    case timeLimitReached
    case terminalFailure

    public var succeeded: Bool { self == .converged }
}

/// 종료된 제한 세션의 측정값.
public struct SyncSessionResult: Equatable, Sendable {
    public let startedAt: MonotonicInstant
    public let endedAt: MonotonicInstant
    public let attemptsUsed: Int
    public let elapsedMilliseconds: Int64
    public let stopReason: SyncSessionStopReason

    public var succeeded: Bool { stopReason.succeeded }
}

public enum BoundedSyncSessionState: Equatable, Sendable {
    case waitingForAttempt
    case attemptInFlight
    case stopped(SyncSessionResult)
}

/// 횟수와 단조 시간 상한을 함께 적용하는 세션 상태 기계.
///
/// 이 타입에는 restart API가 없다. 종료 뒤 새 세션을 만들 수 있는 주체는 외부
/// coordinator뿐이다.
public struct BoundedSyncSession: Equatable, Sendable {
    public let startedAt: MonotonicInstant
    public let limits: SyncSessionLimits
    public private(set) var attemptsStarted: Int
    public private(set) var state: BoundedSyncSessionState

    private var lastObservedAt: MonotonicInstant

    public init(
        startedAt: MonotonicInstant,
        limits: SyncSessionLimits = .policy
    ) {
        self.startedAt = startedAt
        self.limits = limits
        attemptsStarted = 0
        state = .waitingForAttempt
        lastObservedAt = startedAt
    }

    public var deadline: MonotonicInstant {
        startedAt.advanced(by: limits.maxElapsedMilliseconds)
    }

    public var result: SyncSessionResult? {
        guard case .stopped(let result) = state else { return nil }
        return result
    }

    /// 다음 시도를 시작한다. 종료·진행 중·시간 소진 상태에서는 `false`다.
    @discardableResult
    public mutating func startAttempt(at now: MonotonicInstant) -> Bool {
        observe(now)
        guard result == nil else { return false }
        guard now < deadline else {
            stop(at: deadline, reason: .timeLimitReached)
            return false
        }
        guard state == .waitingForAttempt else { return false }
        guard attemptsStarted < limits.maxAttempts else {
            stop(at: now, reason: .attemptLimitReached)
            return false
        }

        attemptsStarted += 1
        state = .attemptInFlight
        return true
    }

    /// 진행 중인 시도를 끝내고, 세션이 함께 끝났다면 결과를 반환한다.
    @discardableResult
    public mutating func finishAttempt(
        at now: MonotonicInstant,
        outcome: SyncAttemptOutcome
    ) -> SyncSessionResult? {
        observe(now)
        if let result { return result }
        guard state == .attemptInFlight else { return nil }

        guard now < deadline else {
            stop(at: deadline, reason: .timeLimitReached)
            return result
        }

        switch outcome {
        case .converged:
            stop(at: now, reason: .converged)
        case .terminalFailure:
            stop(at: now, reason: .terminalFailure)
        case .retryableFailure:
            if attemptsStarted >= limits.maxAttempts {
                stop(at: now, reason: .attemptLimitReached)
            } else {
                state = .waitingForAttempt
            }
        }
        return result
    }

    /// 단조 deadline timer가 전진했음을 반영한다. 이 호출은 새 세션을 만들지 않는다.
    @discardableResult
    public mutating func advanceTime(to now: MonotonicInstant) -> SyncSessionResult? {
        observe(now)
        if result == nil, now >= deadline {
            stop(at: deadline, reason: .timeLimitReached)
        }
        return result
    }

    private mutating func observe(_ now: MonotonicInstant) {
        precondition(now >= lastObservedAt, "monotonic time must not move backwards")
        lastObservedAt = now
    }

    private mutating func stop(
        at endedAt: MonotonicInstant,
        reason: SyncSessionStopReason
    ) {
        let result = SyncSessionResult(
            startedAt: startedAt,
            endedAt: endedAt,
            attemptsUsed: attemptsStarted,
            elapsedMilliseconds: endedAt.elapsedMilliseconds(since: startedAt),
            stopReason: reason
        )
        state = .stopped(result)
    }
}
