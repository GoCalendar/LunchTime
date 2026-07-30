import Foundation

/// 이 값들은 `PRD-01-SP-03`의 **실기기 증거가 아직 없는 후보**다.
///
/// Direct test 통과만으로 `POL-02-R-08`의 확정 수치가 되지 않는다.
public struct UnconfirmedClockSafetyCandidate: Equatable, Sendable {
    public enum EvidenceStatus: String, Equatable, Sendable {
        case requiresRealDeviceEvidence
    }

    public let maxAbsoluteOffsetMilliseconds: Int64
    public let freshnessMilliseconds: Int64
    public let requiredConsistentSamples: Int
    public let evidenceStatus: EvidenceStatus

    public init(
        maxAbsoluteOffsetMilliseconds: Int64,
        freshnessMilliseconds: Int64,
        requiredConsistentSamples: Int,
        evidenceStatus: EvidenceStatus = .requiresRealDeviceEvidence
    ) {
        precondition(maxAbsoluteOffsetMilliseconds > 0)
        precondition(freshnessMilliseconds > 0)
        precondition(requiredConsistentSamples > 0)
        self.maxAbsoluteOffsetMilliseconds = maxAbsoluteOffsetMilliseconds
        self.freshnessMilliseconds = freshnessMilliseconds
        self.requiredConsistentSamples = requiredConsistentSamples
        self.evidenceStatus = evidenceStatus
    }

    /// 실기기 계측으로 지지되기 전에는 출시 계약으로 사용할 수 없다.
    public static let sp03RealDeviceUnconfirmed = UnconfirmedClockSafetyCandidate(
        maxAbsoluteOffsetMilliseconds: 1_000,
        freshnessMilliseconds: 30_000,
        requiredConsistentSamples: 3
    )
}

/// 로컬(A)과 Peer(B)가 교환한 NTP 방식 4 timestamp 표본.
///
/// - `T1`, `T4`: 로컬 wall clock
/// - `T2`, `T3`: Peer wall clock
/// - monotonic elapsed: 각 기기 안에서만 계산한 경과 시간
public struct ClockFourTimestampSample: Equatable, Sendable {
    /// 한 bounded probe에서 허용하는 단조 경과·처리·capture uncertainty 상한.
    public static let maximumMeasuredDurationMilliseconds: Int64 = 30_000

    /// Millisecond wall-clock capture quantization and normal clock slewing allowance.
    ///
    /// A larger unexplained difference is treated as a clock discontinuity instead of
    /// being folded into an apparently valid offset interval.
    public static let maximumUnexplainedWallClockDriftMilliseconds: Int64 = 10

    public let localSentWallTime: WallClockInstant
    public let peerReceivedWallTime: WallClockInstant
    public let peerSentWallTime: WallClockInstant
    public let localReceivedWallTime: WallClockInstant
    public let localElapsedMonotonicMilliseconds: Int64
    public let peerProcessingMonotonicMilliseconds: Int64
    public let captureUncertaintyMilliseconds: Int64

    public init(
        localSentWallTime: WallClockInstant,
        peerReceivedWallTime: WallClockInstant,
        peerSentWallTime: WallClockInstant,
        localReceivedWallTime: WallClockInstant,
        localElapsedMonotonicMilliseconds: Int64,
        peerProcessingMonotonicMilliseconds: Int64,
        captureUncertaintyMilliseconds: Int64 = 0
    ) {
        self.localSentWallTime = localSentWallTime
        self.peerReceivedWallTime = peerReceivedWallTime
        self.peerSentWallTime = peerSentWallTime
        self.localReceivedWallTime = localReceivedWallTime
        self.localElapsedMonotonicMilliseconds = localElapsedMonotonicMilliseconds
        self.peerProcessingMonotonicMilliseconds = peerProcessingMonotonicMilliseconds
        self.captureUncertaintyMilliseconds = captureUncertaintyMilliseconds
    }

    /// NTP offset와 비대칭 지연의 보수적 구간을 계산한다.
    ///
    /// `offset = ((T2 - T1) + (T3 - T4)) / 2`
    /// `uncertainty = network round-trip / 2 + capture uncertainty`
    public var offsetInterval: ClockOffsetInterval? {
        guard localElapsedMonotonicMilliseconds >= 0,
              localElapsedMonotonicMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds,
              peerProcessingMonotonicMilliseconds >= 0,
              peerProcessingMonotonicMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds,
              captureUncertaintyMilliseconds >= 0,
              captureUncertaintyMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds
        else { return nil }

        let localWallElapsed =
            Double(localReceivedWallTime.millisecondsSinceUnixEpoch)
            - Double(localSentWallTime.millisecondsSinceUnixEpoch)
        let peerWallElapsed =
            Double(peerSentWallTime.millisecondsSinceUnixEpoch)
            - Double(peerReceivedWallTime.millisecondsSinceUnixEpoch)
        let continuityAllowance =
            Double(captureUncertaintyMilliseconds)
            + Double(Self.maximumUnexplainedWallClockDriftMilliseconds)
        guard abs(localWallElapsed - Double(localElapsedMonotonicMilliseconds))
                <= continuityAllowance,
              abs(peerWallElapsed - Double(peerProcessingMonotonicMilliseconds))
                <= continuityAllowance
        else { return nil }

        let networkRoundTrip = localElapsedMonotonicMilliseconds
            - peerProcessingMonotonicMilliseconds
        guard networkRoundTrip >= 0 else { return nil }

        let t1 = Double(localSentWallTime.millisecondsSinceUnixEpoch)
        let t2 = Double(peerReceivedWallTime.millisecondsSinceUnixEpoch)
        let t3 = Double(peerSentWallTime.millisecondsSinceUnixEpoch)
        let t4 = Double(localReceivedWallTime.millisecondsSinceUnixEpoch)
        let offset = ((t2 - t1) + (t3 - t4)) / 2
        let uncertainty = Double(networkRoundTrip) / 2
            + Double(captureUncertaintyMilliseconds)
        return ClockOffsetInterval(
            lowerBoundMilliseconds: offset - uncertainty,
            upperBoundMilliseconds: offset + uncertainty
        )
    }
}

public struct ClockOffsetInterval: Equatable, Sendable {
    public let lowerBoundMilliseconds: Double
    public let upperBoundMilliseconds: Double

    public init(lowerBoundMilliseconds: Double, upperBoundMilliseconds: Double) {
        self.lowerBoundMilliseconds = lowerBoundMilliseconds
        self.upperBoundMilliseconds = upperBoundMilliseconds
    }

    public var maximumAbsoluteOffsetMilliseconds: Double {
        max(abs(lowerBoundMilliseconds), abs(upperBoundMilliseconds))
    }
}

public enum ClockUnverifiableReason: String, Equatable, Sendable {
    case normalPeerUnavailable
    case insufficientSamples
    case invalidSample
    case inconsistentSamples
    case uncertaintyCrossesTolerance
}

public enum ClockWriteBlockReason: Equatable, Sendable {
    case notValidated
    case offsetExceeded
    case unverifiable(ClockUnverifiableReason)
    case stale
    case systemClockChanged
}

public struct ValidClockObservation: Equatable, Sendable {
    public let offsetInterval: ClockOffsetInterval
    public let validatedAt: MonotonicInstant
    public let validThrough: MonotonicInstant
}

public enum ClockValidationState: Equatable, Sendable {
    case unverified
    case valid(ValidClockObservation)
    case blocked(ClockWriteBlockReason)
}

/// Clock gate가 구분하는 동작.
///
/// `POL-02-R-08`이 지정한 세 쓰기만 시계 상태로 차단한다. 열람·제한된
/// 동기화·수동 새로고침과 시계에 의존하지 않는 다른 쓰기는 이 gate가 막지
/// 않는다.
public enum ClockGatedOperation: String, Equatable, Sendable, CaseIterable {
    case participationAcceptance
    case orderDeadlineModification
    case orderStatusChange
    case read
    case limitedSynchronization
    case manualRefresh
    case otherWrite

    public var isClockSensitiveWrite: Bool {
        switch self {
        case .participationAcceptance, .orderDeadlineModification, .orderStatusChange:
            true
        case .read, .limitedSynchronization, .manualRefresh, .otherWrite:
            false
        }
    }
}

public enum ClockGateDecision: Equatable, Sendable {
    case allowed
    case blocked(ClockWriteBlockReason)
}

/// Peer 시계 검증 결과로 시간 경계 쓰기를 fail-closed하는 상태기계.
public struct ClockSkewGate: Equatable, Sendable {
    public let candidate: UnconfirmedClockSafetyCandidate
    public private(set) var state: ClockValidationState

    public init(
        candidate: UnconfirmedClockSafetyCandidate = .sp03RealDeviceUnconfirmed
    ) {
        self.candidate = candidate
        state = .unverified
    }

    /// 정상 응답 Peer와 얻은 표본을 검증한다.
    ///
    /// 표본마다 전체 불확실성 구간이 허용 범위 안에 있어야 하고, 모든 표본의
    /// 구간이 서로 겹쳐야 한다. 경계를 걸치는 표본은 허용으로 추측하지 않는다.
    @discardableResult
    public mutating func validate(
        samples: [ClockFourTimestampSample],
        normalPeerAvailable: Bool = true,
        at now: MonotonicInstant
    ) -> ClockValidationState {
        guard normalPeerAvailable else {
            state = .blocked(.unverifiable(.normalPeerUnavailable))
            return state
        }
        guard samples.count >= candidate.requiredConsistentSamples else {
            state = .blocked(.unverifiable(.insufficientSamples))
            return state
        }

        let intervals = samples.compactMap(\.offsetInterval)
        guard intervals.count == samples.count else {
            state = .blocked(.unverifiable(.invalidSample))
            return state
        }

        let tolerance = Double(candidate.maxAbsoluteOffsetMilliseconds)
        for interval in intervals {
            if interval.lowerBoundMilliseconds > tolerance
                || interval.upperBoundMilliseconds < -tolerance {
                state = .blocked(.offsetExceeded)
                return state
            }
            if interval.lowerBoundMilliseconds < -tolerance
                || interval.upperBoundMilliseconds > tolerance {
                state = .blocked(.unverifiable(.uncertaintyCrossesTolerance))
                return state
            }
        }

        let commonLowerBound = intervals
            .map(\.lowerBoundMilliseconds)
            .max()!
        let commonUpperBound = intervals
            .map(\.upperBoundMilliseconds)
            .min()!
        guard commonLowerBound <= commonUpperBound else {
            state = .blocked(.unverifiable(.inconsistentSamples))
            return state
        }

        let observation = ValidClockObservation(
            offsetInterval: ClockOffsetInterval(
                lowerBoundMilliseconds: commonLowerBound,
                upperBoundMilliseconds: commonUpperBound
            ),
            validatedAt: now,
            validThrough: now.advanced(by: candidate.freshnessMilliseconds)
        )
        state = .valid(observation)
        return state
    }

    /// macOS system-clock-change 신호는 기존 성공 검증을 즉시 무효화한다.
    public mutating func recordSystemClockChange() {
        state = .blocked(.systemClockChanged)
    }

    /// 동작을 시도한 시점의 gate 판정.
    @discardableResult
    public mutating func decision(
        for operation: ClockGatedOperation,
        at now: MonotonicInstant
    ) -> ClockGateDecision {
        expireValidationIfNeeded(at: now)
        guard operation.isClockSensitiveWrite else { return .allowed }

        switch state {
        case .valid:
            return .allowed
        case .unverified:
            return .blocked(.notValidated)
        case let .blocked(reason):
            return .blocked(reason)
        }
    }

    private mutating func expireValidationIfNeeded(at now: MonotonicInstant) {
        guard case let .valid(observation) = state else { return }
        if now.milliseconds < observation.validatedAt.milliseconds
            || now.milliseconds >= observation.validThrough.milliseconds {
            state = .blocked(.stale)
        }
    }
}

/// 늦게 도착한 이벤트의 14:30 이전 생성 여부.
public enum LateEventTimeEvidence: String, Equatable, Sendable {
    case verifiedBeforeCutoff
    case verifiedAtOrAfterCutoff
    case claimedBeforeCutoffButUnverifiable
}

/// 늦은 이벤트가 종료 결과에 줄 수 있는 영향.
public struct LateEventDisposition: Equatable, Sendable {
    public let includeInReadOnlySnapshot: Bool
    public let permitsAutomaticSuccessCorrection: Bool
    public let permitsAutomaticOrderCompletionCorrection: Bool
    public let permitsAutomaticSuccessHistoryCorrection: Bool
    public let requiresIncompleteFinalization: Bool
}

public enum LateEventClockSafety {
    /// `POL-02-R-08`의 늦은 이벤트 fail-closed 결과.
    public static func disposition(
        for evidence: LateEventTimeEvidence
    ) -> LateEventDisposition {
        switch evidence {
        case .verifiedBeforeCutoff:
            LateEventDisposition(
                includeInReadOnlySnapshot: true,
                permitsAutomaticSuccessCorrection: true,
                permitsAutomaticOrderCompletionCorrection: true,
                permitsAutomaticSuccessHistoryCorrection: true,
                requiresIncompleteFinalization: false
            )
        case .verifiedAtOrAfterCutoff:
            LateEventDisposition(
                includeInReadOnlySnapshot: false,
                permitsAutomaticSuccessCorrection: false,
                permitsAutomaticOrderCompletionCorrection: false,
                permitsAutomaticSuccessHistoryCorrection: false,
                requiresIncompleteFinalization: false
            )
        case .claimedBeforeCutoffButUnverifiable:
            LateEventDisposition(
                includeInReadOnlySnapshot: true,
                permitsAutomaticSuccessCorrection: false,
                permitsAutomaticOrderCompletionCorrection: false,
                permitsAutomaticSuccessHistoryCorrection: false,
                requiresIncompleteFinalization: true
            )
        }
    }
}
