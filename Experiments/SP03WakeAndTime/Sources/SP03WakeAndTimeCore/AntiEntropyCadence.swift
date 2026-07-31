/// anti-entropy를 실행할 수 있는 현재 조건.
///
/// `dailyWriteClosed`는 wall clock 경계 판정기가 만든 terminal 상태를 입력받는다.
/// cadence 자체는 wall clock을 읽지 않고 `MonotonicInstant`만 사용한다.
public struct AntiEntropyConditions: Equatable, Sendable {
    public let hasData: Bool
    public let hasHealthyPeer: Bool
    public let dailyWriteClosed: Bool

    public init(
        hasData: Bool,
        hasHealthyPeer: Bool,
        dailyWriteClosed: Bool
    ) {
        self.hasData = hasData
        self.hasHealthyPeer = hasHealthyPeer
        self.dailyWriteClosed = dailyWriteClosed
    }

    public static let normal = AntiEntropyConditions(
        hasData: true,
        hasHealthyPeer: true,
        dailyWriteClosed: false
    )
}

public enum AntiEntropySuspensionReason: String, Equatable, Sendable {
    case noData
    case noHealthyPeer
    case dailyWriteClosed
}

public enum AntiEntropyCadenceDecision: Equatable, Sendable {
    case due
    case waiting(remainingMilliseconds: Int64)
    case suspended(AntiEntropySuspensionReason)
}

/// 정상 조건에서 최대 30초 간격으로 anti-entropy를 요청하는 단조 scheduler.
public struct AntiEntropyCadence: Equatable, Sendable {
    public static let maximumIntervalMilliseconds: Int64 = 30_000

    public let intervalMilliseconds: Int64
    public private(set) var lastSessionStartedAt: MonotonicInstant?

    public init(
        intervalMilliseconds: Int64 = maximumIntervalMilliseconds,
        lastSessionStartedAt: MonotonicInstant? = nil
    ) {
        precondition(
            intervalMilliseconds > 0
                && intervalMilliseconds <= Self.maximumIntervalMilliseconds,
            "normal anti-entropy cadence must not exceed \(Self.maximumIntervalMilliseconds) ms"
        )
        self.intervalMilliseconds = intervalMilliseconds
        self.lastSessionStartedAt = lastSessionStartedAt
    }

    public func decision(
        at now: MonotonicInstant,
        conditions: AntiEntropyConditions
    ) -> AntiEntropyCadenceDecision {
        if conditions.dailyWriteClosed {
            return .suspended(.dailyWriteClosed)
        }
        guard conditions.hasData else {
            return .suspended(.noData)
        }
        guard conditions.hasHealthyPeer else {
            return .suspended(.noHealthyPeer)
        }
        guard let lastSessionStartedAt else { return .due }

        let elapsed = now.elapsedMilliseconds(since: lastSessionStartedAt)
        let remaining = intervalMilliseconds - elapsed
        return remaining <= 0 ? .due : .waiting(remainingMilliseconds: remaining)
    }

    public mutating func recordSessionStarted(at now: MonotonicInstant) {
        if let lastSessionStartedAt {
            precondition(now >= lastSessionStartedAt, "monotonic time must not move backwards")
        }
        lastSessionStartedAt = now
    }
}
