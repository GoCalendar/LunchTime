import Foundation

public enum SyncStartCause: Equatable, Sendable {
    case trigger(SyncTrigger)
    case cadence
}

public enum SyncCoordinatorIgnoreReason: Equatable, Sendable {
    case clockChangeIsNotSyncTrigger
    case failedSessionRequiresMeaningfulTrigger
}

public enum SyncCoordinatorAction: Equatable, Sendable {
    case started(sessionID: Int, cause: SyncStartCause)
    case coalesced(sessionID: Int)
    case ignored(SyncCoordinatorIgnoreReason)
}

/// 비동기 callback이 자신을 만든 세션과만 결합되도록 하는 불투명 식별자.
public struct SyncSessionToken: Equatable, Hashable, Sendable {
    public let sessionID: Int
    private let identity: UUID

    fileprivate init(sessionID: Int) {
        self.sessionID = sessionID
        identity = UUID()
    }
}

/// 세션 안의 정확한 시도 하나를 식별하는 completion token.
public struct SyncAttemptToken: Equatable, Hashable, Sendable {
    public let session: SyncSessionToken
    public let attemptNumber: Int

    fileprivate init(session: SyncSessionToken, attemptNumber: Int) {
        self.session = session
        self.attemptNumber = attemptNumber
    }
}

/// 한 번의 시도 completion 또는 deadline 진행이 만든 상태 전이.
///
/// `finishActiveAttempt`가 `nil`을 반환하면 token이 이미 만료되어 callback을
/// 폐기했다는 뜻이다. 적용된 retry는 이 값이 존재하고 `sessionResult`가 `nil`인
/// 경우이므로 stale callback과 구분된다.
public struct SyncCoordinatorProgress: Equatable, Sendable {
    public let sessionResult: SyncSessionResult?
    public let followUpAction: SyncCoordinatorAction?

    fileprivate init(
        sessionResult: SyncSessionResult?,
        followUpAction: SyncCoordinatorAction?
    ) {
        self.sessionResult = sessionResult
        self.followUpAction = followUpAction
    }
}

/// 여러 trigger를 하나의 제한 세션으로 접는 coordinator.
///
/// 활성 세션을 optional 하나로만 보유하므로 동시에 둘 이상을 만들 수 없다.
/// 실패 뒤 cadence timer만으로는 재시작하지 않으며, 새 lifecycle/network/user
/// trigger가 들어와야 suppression이 풀린다.
public struct SyncCoordinator: Sendable {
    public let limits: SyncSessionLimits
    public private(set) var activeSession: BoundedSyncSession?
    public private(set) var activeSessionToken: SyncSessionToken?
    public private(set) var activeAttemptToken: SyncAttemptToken?
    public private(set) var activeSessionCause: SyncStartCause?
    public private(set) var pendingMeaningfulTrigger: SyncTrigger?
    public private(set) var sessionsStarted: Int
    public private(set) var coalescedTriggerCount: Int
    public private(set) var peakConcurrentSessionCount: Int
    public private(set) var lastResult: SyncSessionResult?
    public private(set) var cadenceSuppressedAfterFailure: Bool

    public init(limits: SyncSessionLimits = .policy) {
        self.limits = limits
        activeSession = nil
        activeSessionToken = nil
        activeAttemptToken = nil
        activeSessionCause = nil
        pendingMeaningfulTrigger = nil
        sessionsStarted = 0
        coalescedTriggerCount = 0
        peakConcurrentSessionCount = 0
        lastResult = nil
        cadenceSuppressedAfterFailure = false
    }

    public var activeSessionCount: Int { activeSession == nil ? 0 : 1 }
    public var activeSessionID: Int? { activeSessionToken?.sessionID }

    @discardableResult
    public mutating func handle(
        _ trigger: SyncTrigger,
        at now: MonotonicInstant
    ) -> SyncCoordinatorAction {
        guard trigger.startsBoundedSync else {
            return .ignored(.clockChangeIsNotSyncTrigger)
        }
        if let activeSessionToken {
            coalescedTriggerCount += 1
            // 아직 시작하지 않은 다음 attempt 또는 현재 진행 중 attempt가 이
            // trigger를 흡수한다. 여러 trigger는 첫 원인 하나로 병합한다.
            if pendingMeaningfulTrigger == nil {
                pendingMeaningfulTrigger = trigger
            }
            return .coalesced(sessionID: activeSessionToken.sessionID)
        }

        // 새 의미 있는 사건은 이전 실패의 cadence suppression을 해제한다.
        cadenceSuppressedAfterFailure = false
        return startSession(at: now, cause: .trigger(trigger))
    }

    /// 정상 anti-entropy cadence가 도래했을 때 호출한다.
    @discardableResult
    public mutating func handleCadenceTick(
        at now: MonotonicInstant
    ) -> SyncCoordinatorAction {
        if let activeSessionToken {
            return .coalesced(sessionID: activeSessionToken.sessionID)
        }
        guard !cadenceSuppressedAfterFailure else {
            return .ignored(.failedSessionRequiresMeaningfulTrigger)
        }
        return startSession(at: now, cause: .cadence)
    }

    @discardableResult
    public mutating func startActiveAttempt(
        at now: MonotonicInstant
    ) -> SyncAttemptToken? {
        guard var session = activeSession,
              let activeSessionToken
        else {
            return nil
        }
        let started = session.startAttempt(at: now)
        activeSession = session
        guard started else {
            _ = finalizeStoppedSessionIfNeeded(at: now)
            return nil
        }

        let token = SyncAttemptToken(
            session: activeSessionToken,
            attemptNumber: session.attemptsStarted
        )
        activeAttemptToken = token
        // attempt가 시작되기 전까지 합쳐진 trigger는 이 attempt가 흡수한다.
        pendingMeaningfulTrigger = nil
        return token
    }

    @discardableResult
    public mutating func finishActiveAttempt(
        _ token: SyncAttemptToken,
        at now: MonotonicInstant,
        outcome: SyncAttemptOutcome
    ) -> SyncCoordinatorProgress? {
        // 세션 timeout 뒤 늦게 도착한 callback은 새 세션의 상태를 절대로
        // 변경하지 않는다. 시각 관측도 하기 전에 정확한 token부터 확인한다.
        guard token == activeAttemptToken,
              var session = activeSession
        else {
            return nil
        }
        let result = session.finishAttempt(at: now, outcome: outcome)
        activeSession = session
        activeAttemptToken = nil
        let followUpAction = finalizeStoppedSessionIfNeeded(at: now)
        return SyncCoordinatorProgress(
            sessionResult: result,
            followUpAction: followUpAction
        )
    }

    /// deadline timer 자체는 새 세션을 만들지 않는다.
    ///
    /// 단, 활성 attempt 중 이미 도착해 병합된 의미 trigger가 남아 있다면 기존
    /// 세션을 먼저 종료한 뒤 그 trigger가 정확히 한 follow-up 세션을 연다.
    @discardableResult
    public mutating func advanceActiveSessionTime(
        to now: MonotonicInstant
    ) -> SyncCoordinatorProgress? {
        guard var session = activeSession else { return nil }
        let result = session.advanceTime(to: now)
        activeSession = session
        if result != nil {
            activeAttemptToken = nil
        }
        let followUpAction = finalizeStoppedSessionIfNeeded(at: now)
        return SyncCoordinatorProgress(
            sessionResult: result,
            followUpAction: followUpAction
        )
    }

    private mutating func startSession(
        at now: MonotonicInstant,
        cause: SyncStartCause
    ) -> SyncCoordinatorAction {
        precondition(activeSession == nil)
        sessionsStarted += 1
        activeSession = BoundedSyncSession(startedAt: now, limits: limits)
        activeSessionToken = SyncSessionToken(sessionID: sessionsStarted)
        activeAttemptToken = nil
        activeSessionCause = cause
        peakConcurrentSessionCount = max(peakConcurrentSessionCount, activeSessionCount)
        return .started(sessionID: sessionsStarted, cause: cause)
    }

    @discardableResult
    private mutating func finalizeStoppedSessionIfNeeded(
        at now: MonotonicInstant
    ) -> SyncCoordinatorAction? {
        guard let result = activeSession?.result else { return nil }
        let followUpTrigger = pendingMeaningfulTrigger
        lastResult = result
        cadenceSuppressedAfterFailure = !result.succeeded
        activeSession = nil
        activeSessionToken = nil
        activeAttemptToken = nil
        activeSessionCause = nil
        pendingMeaningfulTrigger = nil

        guard let followUpTrigger else { return nil }
        // 이 재시작은 timer가 아니라 세션 진행 중 실제로 수신한 trigger가
        // 소유한다. 이전 세션을 비운 뒤 시작하므로 동시성은 항상 1이다.
        cadenceSuppressedAfterFailure = false
        return startSession(at: now, cause: .trigger(followUpTrigger))
    }
}
