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
    public let maximumUnexplainedWallClockDriftMilliseconds: Int64
    public let evidenceStatus: EvidenceStatus

    public init(
        maxAbsoluteOffsetMilliseconds: Int64,
        freshnessMilliseconds: Int64,
        requiredConsistentSamples: Int,
        maximumUnexplainedWallClockDriftMilliseconds: Int64,
        evidenceStatus: EvidenceStatus = .requiresRealDeviceEvidence
    ) {
        precondition(maxAbsoluteOffsetMilliseconds > 0)
        precondition(freshnessMilliseconds > 0)
        precondition(requiredConsistentSamples > 0)
        precondition(maximumUnexplainedWallClockDriftMilliseconds >= 0)
        self.maxAbsoluteOffsetMilliseconds = maxAbsoluteOffsetMilliseconds
        self.freshnessMilliseconds = freshnessMilliseconds
        self.requiredConsistentSamples = requiredConsistentSamples
        self.maximumUnexplainedWallClockDriftMilliseconds =
            maximumUnexplainedWallClockDriftMilliseconds
        self.evidenceStatus = evidenceStatus
    }

    /// 실기기 계측으로 지지되기 전에는 출시 계약으로 사용할 수 없다.
    public static let sp03RealDeviceUnconfirmed = UnconfirmedClockSafetyCandidate(
        maxAbsoluteOffsetMilliseconds: 1_000,
        freshnessMilliseconds: 30_000,
        requiredConsistentSamples: 3,
        maximumUnexplainedWallClockDriftMilliseconds: 10
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
    public static let unconfirmedMaximumUnexplainedWallClockDriftMilliseconds: Int64 =
        UnconfirmedClockSafetyCandidate.sp03RealDeviceUnconfirmed
            .maximumUnexplainedWallClockDriftMilliseconds

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
        offsetInterval(
            maximumUnexplainedWallClockDriftMilliseconds:
                Self.unconfirmedMaximumUnexplainedWallClockDriftMilliseconds
        )
    }

    /// 주어진 **후보** wall/monotonic 불연속 허용치로 표본을 계산한다.
    ///
    /// 허용치가 실기기에서 승인되기 전에는 이 결과 역시 출시 승인이 아니라
    /// 후보 판정에만 사용할 수 있다.
    public func offsetInterval(
        maximumUnexplainedWallClockDriftMilliseconds: Int64
    ) -> ClockOffsetInterval? {
        guard localElapsedMonotonicMilliseconds >= 0,
              localElapsedMonotonicMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds,
              peerProcessingMonotonicMilliseconds >= 0,
              peerProcessingMonotonicMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds,
              captureUncertaintyMilliseconds >= 0,
              captureUncertaintyMilliseconds
                <= Self.maximumMeasuredDurationMilliseconds,
              maximumUnexplainedWallClockDriftMilliseconds >= 0
        else { return nil }

        let localWallElapsed =
            Double(localReceivedWallTime.millisecondsSinceUnixEpoch)
            - Double(localSentWallTime.millisecondsSinceUnixEpoch)
        let peerWallElapsed =
            Double(peerSentWallTime.millisecondsSinceUnixEpoch)
            - Double(peerReceivedWallTime.millisecondsSinceUnixEpoch)
        let continuityAllowance =
            Double(captureUncertaintyMilliseconds)
            + Double(maximumUnexplainedWallClockDriftMilliseconds)
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

/// 현재 검증 session에서 Room 데이터를 보유하고 정상 응답한 Peer의 표본.
public struct EligibleRoomPeerClockSamples: Equatable, Sendable {
    public let peerID: String
    public let samples: [ClockFourTimestampSample]

    public init(peerID: String, samples: [ClockFourTimestampSample]) {
        self.peerID = peerID
        self.samples = samples
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
    public let eligiblePeerIDs: [String]
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

/// 실기기에서 후보값이 승인되기 전의 출시 판정.
///
/// `candidateDecision`이 성공해도 공유 이력이 있는 Room은 별도의
/// `blockedPendingRealDeviceApproval`로 남아 후보 판정과 출시 판정을 혼동하지
/// 않는다.
public enum ClockReleaseGateDecision: Equatable, Sendable {
    case allowed
    case blocked(ClockWriteBlockReason)
    case blockedPendingRealDeviceApproval
}

/// Room이 outbound/remote event/StorageACK 중 하나라도 관찰한 이력.
public enum RoomClockSharingHistory: String, Equatable, Sendable {
    case localOnly
    case everShared
}

/// 앱 재실행으로 해제해서는 안 되는 로컬 안전 상태.
public enum DurableClockRecoveryState: String, Equatable, Sendable {
    case clear
    case recoveryRequired
}

public struct WallMonotonicClockBaseline: Equatable, Sendable {
    public let wallTime: WallClockInstant
    public let monotonicTime: MonotonicInstant

    public init(wallTime: WallClockInstant, monotonicTime: MonotonicInstant) {
        self.wallTime = wallTime
        self.monotonicTime = monotonicTime
    }
}

public enum ClockBaselineState: Equatable, Sendable {
    case missing
    case valid(WallMonotonicClockBaseline)
    case recoveryRequired
}

/// macOS baseline과 Room별 Peer 대조를 분리해 시간 경계 쓰기를 fail-closed한다.
public struct ClockSkewGate: Equatable, Sendable {
    public let candidate: UnconfirmedClockSafetyCandidate
    public private(set) var sharingHistory: RoomClockSharingHistory
    public private(set) var durableRecoveryState: DurableClockRecoveryState
    public private(set) var baselineState: ClockBaselineState
    public private(set) var state: ClockValidationState

    public init(
        candidate: UnconfirmedClockSafetyCandidate = .sp03RealDeviceUnconfirmed,
        sharingHistory: RoomClockSharingHistory = .localOnly,
        durableRecoveryState: DurableClockRecoveryState = .clear
    ) {
        self.candidate = candidate
        self.sharingHistory = sharingHistory
        self.durableRecoveryState = durableRecoveryState
        baselineState = durableRecoveryState == .recoveryRequired
            ? .recoveryRequired
            : .missing
        state = .unverified
    }

    /// 현재 process의 macOS wall/monotonic 기준점을 만든다.
    ///
    /// durable 복구 필요 상태는 단순 재실행이나 초기화로 지울 수 없다.
    @discardableResult
    public mutating func establishProcessBaseline(
        wallTime: WallClockInstant,
        monotonicTime: MonotonicInstant
    ) -> Bool {
        guard durableRecoveryState == .clear else { return false }
        baselineState = .valid(
            WallMonotonicClockBaseline(
                wallTime: wallTime,
                monotonicTime: monotonicTime
            )
        )
        state = .unverified
        return true
    }

    /// 최초 공유 관찰을 durable하게 기록하는 모델.
    ///
    /// `everShared`에서 `localOnly`로 되돌리는 API는 의도적으로 제공하지 않는다.
    public mutating func recordRoomShared() {
        guard sharingHistory == .localOnly else { return }
        sharingHistory = .everShared
        state = .unverified
    }

    /// eligible Room Peer별 표본을 검증한다.
    ///
    /// 각 Peer가 최소 표본 수를 따로 충족해야 한다. 응답한 모든 Peer의 모든
    /// 표본 구간이 허용 범위 안에서 서로 겹쳐야 하며, 특정 Peer 선택·평균·
    /// 다수결로 충돌을 성공 처리하지 않는다.
    @discardableResult
    public mutating func validate(
        eligiblePeers: [EligibleRoomPeerClockSamples],
        at now: MonotonicInstant
    ) -> ClockValidationState {
        // Peer 교환 probe는 baseline 생성과 별도로 후보 표본 자체를 평가할 수
        // 있다. 다만 durable 복구 중에는 새 baseline보다 먼저 Peer 결과를
        // 되살릴 수 없다. 실제 쓰기 판정은 아래 candidate/release gate가
        // baseline 유효성을 별도로 요구한다.
        guard durableRecoveryState == .clear else {
            state = .blocked(.systemClockChanged)
            return state
        }
        guard !eligiblePeers.isEmpty else {
            state = .blocked(.unverifiable(.normalPeerUnavailable))
            return state
        }
        let peerIDs = eligiblePeers.map(\.peerID)
        guard peerIDs.allSatisfy({ !$0.isEmpty }),
              Set(peerIDs).count == peerIDs.count
        else {
            state = .blocked(.unverifiable(.invalidSample))
            return state
        }
        guard eligiblePeers.allSatisfy({
            $0.samples.count >= candidate.requiredConsistentSamples
        }) else {
            state = .blocked(.unverifiable(.insufficientSamples))
            return state
        }

        let samples = eligiblePeers.flatMap(\.samples)
        let intervals = samples.compactMap {
            $0.offsetInterval(
                maximumUnexplainedWallClockDriftMilliseconds:
                    candidate.maximumUnexplainedWallClockDriftMilliseconds
            )
        }
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
            validThrough: now.advanced(by: candidate.freshnessMilliseconds),
            eligiblePeerIDs: peerIDs.sorted()
        )
        state = .valid(observation)
        return state
    }

    /// 기존 단일 Peer 호출부가 Peer별 검증 모델을 사용하도록 연결한다.
    @discardableResult
    public mutating func validate(
        samples: [ClockFourTimestampSample],
        normalPeerAvailable: Bool = true,
        at now: MonotonicInstant
    ) -> ClockValidationState {
        validate(
            eligiblePeers: normalPeerAvailable
                ? [
                    EligibleRoomPeerClockSamples(
                        peerID: "eligible-room-peer",
                        samples: samples
                    )
                ]
                : [],
            at: now
        )
    }

    /// macOS system-clock-change 신호는 기준점과 Peer 검증을 모두 무효화한다.
    public mutating func recordSystemClockChange() {
        invalidateForClockDiscontinuity()
    }

    /// wall clock과 monotonic 진행의 불연속도 같은 durable 복구를 요구한다.
    public mutating func recordWallMonotonicDiscontinuity() {
        invalidateForClockDiscontinuity()
    }

    /// 사용자 시각 점검과 수동 새로고침을 함께 완료해 새 기준점을 만든다.
    ///
    /// local-only Room은 이 단계로 복구되지만 공유 Room은 이후 fresh한 eligible
    /// Room Peer 검증도 통과해야 후보 판정이 성공한다.
    public mutating func recoverAfterUserClockCheckAndManualRefresh(
        wallTime: WallClockInstant,
        monotonicTime: MonotonicInstant
    ) {
        durableRecoveryState = .clear
        baselineState = .valid(
            WallMonotonicClockBaseline(
                wallTime: wallTime,
                monotonicTime: monotonicTime
            )
        )
        state = .unverified
    }

    private mutating func invalidateForClockDiscontinuity() {
        durableRecoveryState = .recoveryRequired
        baselineState = .recoveryRequired
        state = .blocked(.systemClockChanged)
    }

    /// 실기기 미승인 후보값으로만 계산한 판정.
    ///
    /// 공유 Room 출시 허용 근거로 사용해서는 안 되며, 실제 출시 판정에는
    /// `releaseDecision`을 사용한다.
    @discardableResult
    public mutating func candidateDecision(
        for operation: ClockGatedOperation,
        at now: MonotonicInstant
    ) -> ClockGateDecision {
        expireValidationIfNeeded(at: now)
        guard operation.isClockSensitiveWrite else { return .allowed }

        switch baselineState {
        case .missing:
            return .blocked(.notValidated)
        case .recoveryRequired:
            return .blocked(.systemClockChanged)
        case .valid:
            break
        }

        if sharingHistory == .localOnly {
            return .allowed
        }

        switch state {
        case .valid:
            return .allowed
        case .unverified:
            return .blocked(.notValidated)
        case let .blocked(reason):
            return .blocked(reason)
        }
    }

    /// 후보 판정과 분리된 출시 판정.
    ///
    /// 실기기 증거가 없는 현재 후보로 공유 Room의 시간 의존 쓰기를 허용했다고
    /// 주장하지 않는다. local-only Room은 유효한 macOS 기준점만으로 허용한다.
    @discardableResult
    public mutating func releaseDecision(
        for operation: ClockGatedOperation,
        at now: MonotonicInstant
    ) -> ClockReleaseGateDecision {
        let candidateResult = candidateDecision(for: operation, at: now)
        switch candidateResult {
        case let .blocked(reason):
            return .blocked(reason)
        case .allowed:
            guard operation.isClockSensitiveWrite,
                  sharingHistory == .everShared
            else {
                return .allowed
            }
            return .blockedPendingRealDeviceApproval
        }
    }

    /// 기존 probe 호출부를 위한 후보 판정 alias.
    @available(
        *,
        deprecated,
        message: "후보 판정은 candidateDecision, 출시 판정은 releaseDecision을 사용하세요."
    )
    @discardableResult
    public mutating func decision(
        for operation: ClockGatedOperation,
        at now: MonotonicInstant
    ) -> ClockGateDecision {
        candidateDecision(for: operation, at: now)
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
