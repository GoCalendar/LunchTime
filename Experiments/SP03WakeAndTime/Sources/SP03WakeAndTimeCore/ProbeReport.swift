import Foundation

/// 실기기에서 직접 관찰해야만 채울 수 있는 출시 gate 증거.
///
/// `false`는 실패라는 뜻이 아니라 아직 그 증거를 수집하지 않았다는 뜻이다.
/// 결정적 모델만 실행한 결과가 실기기 gate를 통과한 것처럼 보이면 안 된다.
public struct LiveGateEvidence: Codable, Equatable, Sendable {
    public let twoMacClockExchangeObserved: Bool
    /// 6.2절의 10회 양방향 행렬 전체가 후보 안전 기준을 통과했는지.
    public let clockCandidateMatrixPassed: Bool
    public let wakeObserved: Bool
    public let foregroundObserved: Bool
    public let networkChangeObserved: Bool
    /// 새 Peer가 실제로 발견되어 bounded 대조를 시작했는지.
    public let newPeerDiscoveryObserved: Bool
    public let boundedSessionObserved: Bool
    /// 정상 조건에서 실제 anti-entropy tick이 30초 안에 관찰됐는지.
    public let thirtySecondCadenceObserved: Bool
    /// system clock 변경으로 무효화된 뒤 새 표본으로 재검증됐는지.
    public let systemClockChangeRevalidationObserved: Bool
    /// 14:30에 깨어 있던 기기의 실제 finalization을 관찰했는지.
    public let awakeDeviceFinalizationObserved: Bool
    /// 14:30을 지나 잠든 뒤 복귀한 기기의 실제 finalization을 관찰했는지.
    public let sleepingDeviceFinalizationObserved: Bool
    public let resourceCostMeasured: Bool

    public init(
        twoMacClockExchangeObserved: Bool,
        clockCandidateMatrixPassed: Bool,
        wakeObserved: Bool,
        foregroundObserved: Bool,
        networkChangeObserved: Bool,
        newPeerDiscoveryObserved: Bool,
        boundedSessionObserved: Bool,
        thirtySecondCadenceObserved: Bool,
        systemClockChangeRevalidationObserved: Bool,
        awakeDeviceFinalizationObserved: Bool,
        sleepingDeviceFinalizationObserved: Bool,
        resourceCostMeasured: Bool
    ) {
        self.twoMacClockExchangeObserved = twoMacClockExchangeObserved
        self.clockCandidateMatrixPassed = clockCandidateMatrixPassed
        self.wakeObserved = wakeObserved
        self.foregroundObserved = foregroundObserved
        self.networkChangeObserved = networkChangeObserved
        self.newPeerDiscoveryObserved = newPeerDiscoveryObserved
        self.boundedSessionObserved = boundedSessionObserved
        self.thirtySecondCadenceObserved = thirtySecondCadenceObserved
        self.systemClockChangeRevalidationObserved =
            systemClockChangeRevalidationObserved
        self.awakeDeviceFinalizationObserved =
            awakeDeviceFinalizationObserved
        self.sleepingDeviceFinalizationObserved =
            sleepingDeviceFinalizationObserved
        self.resourceCostMeasured = resourceCostMeasured
    }

    public static let notRun = LiveGateEvidence(
        twoMacClockExchangeObserved: false,
        clockCandidateMatrixPassed: false,
        wakeObserved: false,
        foregroundObserved: false,
        networkChangeObserved: false,
        newPeerDiscoveryObserved: false,
        boundedSessionObserved: false,
        thirtySecondCadenceObserved: false,
        systemClockChangeRevalidationObserved: false,
        awakeDeviceFinalizationObserved: false,
        sleepingDeviceFinalizationObserved: false,
        resourceCostMeasured: false
    )

    /// 이슈 #4가 요구한 실기기 행렬은 부분 관찰로 완료 처리하지 않는다.
    public var complete: Bool {
        twoMacClockExchangeObserved
            && clockCandidateMatrixPassed
            && wakeObserved
            && foregroundObserved
            && networkChangeObserved
            && newPeerDiscoveryObserved
            && boundedSessionObserved
            && thirtySecondCadenceObserved
            && systemClockChangeRevalidationObserved
            && awakeDeviceFinalizationObserved
            && sleepingDeviceFinalizationObserved
            && resourceCostMeasured
    }
}

/// 두 Mac clock probe 한쪽 실행에서 나온 익명화된 round 증거.
///
/// 절대 wall-clock timestamp는 보존하지 않는다. 후보 판정에 필요한 상대 구간과
/// wall/monotonic 연속성 결과만 남긴다.
public struct ClockRoundLiveEvidence: Codable, Equatable, Sendable {
    public let round: Int
    public let sampleEligible: Bool
    public let wallMonotonicContinuous: Bool
    public let withinFiveHundredMillisecondSafetyMargin: Bool

    public init(
        round: Int,
        sampleEligible: Bool,
        wallMonotonicContinuous: Bool,
        withinFiveHundredMillisecondSafetyMargin: Bool
    ) {
        self.round = round
        self.sampleEligible = sampleEligible
        self.wallMonotonicContinuous = wallMonotonicContinuous
        self.withinFiveHundredMillisecondSafetyMargin =
            withinFiveHundredMillisecondSafetyMargin
    }
}

/// 10-pair 양방향 행렬에 넣을 두 Mac clock probe 한쪽의 typed artifact.
public struct ClockRunLiveEvidence: Codable, Equatable, Sendable {
    public enum Direction: String, Codable, Equatable, Sendable {
        case aToB
        case bToA
    }

    public let pairEvidenceID: String?
    public let direction: Direction?
    public let operatorConfirmedDistinctPhysicalMacs: Bool
    public let reciprocalPeerMatched: Bool
    public let crossHostEvidence: Bool
    public let candidateEligible: Bool
    public let failureObserved: Bool
    public let rounds: [ClockRoundLiveEvidence]

    public init(
        pairEvidenceID: String?,
        direction: Direction?,
        operatorConfirmedDistinctPhysicalMacs: Bool,
        reciprocalPeerMatched: Bool,
        crossHostEvidence: Bool,
        candidateEligible: Bool,
        failureObserved: Bool,
        rounds: [ClockRoundLiveEvidence]
    ) {
        self.pairEvidenceID = pairEvidenceID
        self.direction = direction
        self.operatorConfirmedDistinctPhysicalMacs =
            operatorConfirmedDistinctPhysicalMacs
        self.reciprocalPeerMatched = reciprocalPeerMatched
        self.crossHostEvidence = crossHostEvidence
        self.candidateEligible = candidateEligible
        self.failureObserved = failureObserved
        self.rounds = rounds
    }

    public init(report: ClockExchangeProbeReport) {
        if report.localLabel == "A", report.peerLabel == "B" {
            direction = .aToB
        } else if report.localLabel == "B", report.peerLabel == "A" {
            direction = .bToA
        } else {
            direction = nil
        }
        pairEvidenceID = report.pairEvidenceID
        operatorConfirmedDistinctPhysicalMacs =
            report.operatorConfirmedDistinctPhysicalMacs
        reciprocalPeerMatched = report.reciprocalPeerMatched
        crossHostEvidence = report.crossHostEvidence
        candidateEligible = report.candidateEvidenceEligible
        failureObserved = report.failure != nil
        rounds = report.roundResults.map { result in
            let interval = result.sample?.offsetInterval
            return ClockRoundLiveEvidence(
                round: result.round,
                sampleEligible: result.failure == nil && interval != nil,
                wallMonotonicContinuous: interval != nil,
                withinFiveHundredMillisecondSafetyMargin:
                    (interval?.maximumAbsoluteOffsetMilliseconds ?? .infinity)
                    <= 500
            )
        }
    }

    public var complete: Bool {
        guard let pairEvidenceID,
              pairEvidenceID.utf8.count == 64,
              pairEvidenceID.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
              }),
              direction != nil,
              operatorConfirmedDistinctPhysicalMacs,
              reciprocalPeerMatched,
              crossHostEvidence,
              candidateEligible,
              !failureObserved,
              rounds.count == ClockExchangeProbeOptions.requiredRounds,
              Set(rounds.map(\.round)) == Set(1...ClockExchangeProbeOptions.requiredRounds)
        else { return false }

        return rounds.allSatisfy {
            $0.sampleEligible
                && $0.wallMonotonicContinuous
                && $0.withinFiveHundredMillisecondSafetyMargin
        }
    }
}

/// 실제 lifecycle/network 관찰에서 얻은 trigger 횟수.
public struct SystemEventLiveEvidence: Codable, Equatable, Sendable {
    public let observationDurationMilliseconds: Int64
    public let wakeCount: Int
    public let foregroundCount: Int
    public let networkChangeCount: Int
    public let newPeerDiscoveryCount: Int

    public init(
        observationDurationMilliseconds: Int64,
        wakeCount: Int,
        foregroundCount: Int,
        networkChangeCount: Int,
        newPeerDiscoveryCount: Int
    ) {
        self.observationDurationMilliseconds = observationDurationMilliseconds
        self.wakeCount = wakeCount
        self.foregroundCount = foregroundCount
        self.networkChangeCount = networkChangeCount
        self.newPeerDiscoveryCount = newPeerDiscoveryCount
    }

    public var valid: Bool {
        observationDurationMilliseconds > 0
            && wakeCount >= 0
            && foregroundCount >= 0
            && networkChangeCount >= 0
            && newPeerDiscoveryCount >= 0
    }
}

public struct BoundedSessionLiveEvidence: Codable, Equatable, Sendable {
    public enum TerminalReason: String, Codable, Equatable, Sendable {
        case completed
        case attemptLimit
        case timeout
        case unresolved
    }

    public let elapsedMilliseconds: Int64
    public let attemptCount: Int
    public let peakConcurrentSessions: Int
    public let terminalReason: TerminalReason

    public init(
        elapsedMilliseconds: Int64,
        attemptCount: Int,
        peakConcurrentSessions: Int,
        terminalReason: TerminalReason
    ) {
        self.elapsedMilliseconds = elapsedMilliseconds
        self.attemptCount = attemptCount
        self.peakConcurrentSessions = peakConcurrentSessions
        self.terminalReason = terminalReason
    }

    public var complete: Bool {
        guard (0...30_000).contains(elapsedMilliseconds),
              (1...3).contains(attemptCount),
              peakConcurrentSessions == 1
        else { return false }

        switch terminalReason {
        case .completed:
            return true
        case .attemptLimit:
            return attemptCount == 3
        case .timeout:
            return elapsedMilliseconds == 30_000
        case .unresolved:
            return false
        }
    }
}

/// 정상 조건에서 실제로 연속 시작된 anti-entropy session의 최대 간격.
public struct CadenceLiveEvidence: Codable, Equatable, Sendable {
    public let observedSessionStartCount: Int
    public let maximumStartIntervalMilliseconds: Int64

    public init(
        observedSessionStartCount: Int,
        maximumStartIntervalMilliseconds: Int64
    ) {
        self.observedSessionStartCount = observedSessionStartCount
        self.maximumStartIntervalMilliseconds =
            maximumStartIntervalMilliseconds
    }

    public var complete: Bool {
        observedSessionStartCount >= 2
            && (1...30_000).contains(maximumStartIntervalMilliseconds)
    }
}

/// 시계 후보의 freshness·표본 수·불연속 경계를 명시적으로 보존한다.
public struct ClockBoundaryLiveEvidence: Codable, Equatable, Sendable {
    public let writeAllowedAt29999Milliseconds: Bool
    public let writeBlockedAt30000Milliseconds: Bool
    public let oneSampleBlocked: Bool
    public let twoSamplesBlocked: Bool
    public let threeSamplesValidated: Bool
    public let continuousWallMonotonicSampleAccepted: Bool
    public let discontinuousWallMonotonicSampleRejected: Bool

    public init(
        writeAllowedAt29999Milliseconds: Bool,
        writeBlockedAt30000Milliseconds: Bool,
        oneSampleBlocked: Bool,
        twoSamplesBlocked: Bool,
        threeSamplesValidated: Bool,
        continuousWallMonotonicSampleAccepted: Bool,
        discontinuousWallMonotonicSampleRejected: Bool
    ) {
        self.writeAllowedAt29999Milliseconds =
            writeAllowedAt29999Milliseconds
        self.writeBlockedAt30000Milliseconds =
            writeBlockedAt30000Milliseconds
        self.oneSampleBlocked = oneSampleBlocked
        self.twoSamplesBlocked = twoSamplesBlocked
        self.threeSamplesValidated = threeSamplesValidated
        self.continuousWallMonotonicSampleAccepted =
            continuousWallMonotonicSampleAccepted
        self.discontinuousWallMonotonicSampleRejected =
            discontinuousWallMonotonicSampleRejected
    }

    public var complete: Bool {
        writeAllowedAt29999Milliseconds
            && writeBlockedAt30000Milliseconds
            && oneSampleBlocked
            && twoSamplesBlocked
            && threeSamplesValidated
            && continuousWallMonotonicSampleAccepted
            && discontinuousWallMonotonicSampleRejected
    }
}

/// 절대 시각 대신 sleep 구간의 상대 경과만 남기는 clock 의미 증거.
public struct SleepWakeClockLiveEvidence: Codable, Equatable, Sendable {
    public let wakeNotificationObserved: Bool
    /// 실험자가 sleep 전에 정한 최소 sleep 구간. 정책 기준값이 아니다.
    public let plannedMinimumSleepMilliseconds: Int64
    public let wallElapsedMilliseconds: Int64
    public let continuousElapsedMilliseconds: Int64

    public init(
        wakeNotificationObserved: Bool,
        plannedMinimumSleepMilliseconds: Int64,
        wallElapsedMilliseconds: Int64,
        continuousElapsedMilliseconds: Int64
    ) {
        self.wakeNotificationObserved = wakeNotificationObserved
        self.plannedMinimumSleepMilliseconds =
            plannedMinimumSleepMilliseconds
        self.wallElapsedMilliseconds = wallElapsedMilliseconds
        self.continuousElapsedMilliseconds = continuousElapsedMilliseconds
    }

    public var complete: Bool {
        wakeNotificationObserved
            && plannedMinimumSleepMilliseconds > 0
            && wallElapsedMilliseconds >= plannedMinimumSleepMilliseconds
            && continuousElapsedMilliseconds >= plannedMinimumSleepMilliseconds
    }
}

/// `POL-02-R-08`의 local-only/shared 복구를 섞지 않는 typed artifact.
public struct ClockRecoveryLiveEvidence: Codable, Equatable, Sendable {
    public enum RoomHistory: String, Codable, Equatable, Sendable {
        case localOnly
        case shared
    }

    public let roomHistory: RoomHistory
    public let systemClockChangeDetected: Bool
    public let priorBaselineInvalidated: Bool
    public let invalidationSurvivedRestart: Bool
    public let macOSClockCheckedByUser: Bool
    public let manualRefreshObserved: Bool
    public let newWallMonotonicBaselineCaptured: Bool
    public let sensitiveWriteBlockedBeforeRecovery: Bool
    public let eligibleRoomPeerObserved: Bool?
    public let peerValidationAgeMilliseconds: Int64?
    public let consistentPeerSampleCount: Int?
    public let allApprovedPeerSamplesWithinTolerance: Bool?
    public let peerRevalidatedAfterNewBaseline: Bool?
    public let sensitiveWriteAllowedAfterRecovery: Bool

    public init(
        roomHistory: RoomHistory,
        systemClockChangeDetected: Bool,
        priorBaselineInvalidated: Bool,
        invalidationSurvivedRestart: Bool,
        macOSClockCheckedByUser: Bool,
        manualRefreshObserved: Bool,
        newWallMonotonicBaselineCaptured: Bool,
        sensitiveWriteBlockedBeforeRecovery: Bool,
        eligibleRoomPeerObserved: Bool? = nil,
        peerValidationAgeMilliseconds: Int64? = nil,
        consistentPeerSampleCount: Int? = nil,
        allApprovedPeerSamplesWithinTolerance: Bool? = nil,
        peerRevalidatedAfterNewBaseline: Bool? = nil,
        sensitiveWriteAllowedAfterRecovery: Bool
    ) {
        self.roomHistory = roomHistory
        self.systemClockChangeDetected = systemClockChangeDetected
        self.priorBaselineInvalidated = priorBaselineInvalidated
        self.invalidationSurvivedRestart = invalidationSurvivedRestart
        self.macOSClockCheckedByUser = macOSClockCheckedByUser
        self.manualRefreshObserved = manualRefreshObserved
        self.newWallMonotonicBaselineCaptured =
            newWallMonotonicBaselineCaptured
        self.sensitiveWriteBlockedBeforeRecovery =
            sensitiveWriteBlockedBeforeRecovery
        self.eligibleRoomPeerObserved = eligibleRoomPeerObserved
        self.peerValidationAgeMilliseconds =
            peerValidationAgeMilliseconds
        self.consistentPeerSampleCount = consistentPeerSampleCount
        self.allApprovedPeerSamplesWithinTolerance =
            allApprovedPeerSamplesWithinTolerance
        self.peerRevalidatedAfterNewBaseline =
            peerRevalidatedAfterNewBaseline
        self.sensitiveWriteAllowedAfterRecovery =
            sensitiveWriteAllowedAfterRecovery
    }

    public var complete: Bool {
        let common = systemClockChangeDetected
            && priorBaselineInvalidated
            && invalidationSurvivedRestart
            && macOSClockCheckedByUser
            && manualRefreshObserved
            && newWallMonotonicBaselineCaptured
            && sensitiveWriteBlockedBeforeRecovery
            && sensitiveWriteAllowedAfterRecovery
        guard common else { return false }

        switch roomHistory {
        case .localOnly:
            // local-only 복구에는 Peer를 필수 조건으로 끌어들이지 않는다.
            return eligibleRoomPeerObserved == nil
                && peerValidationAgeMilliseconds == nil
                && consistentPeerSampleCount == nil
                && allApprovedPeerSamplesWithinTolerance == nil
                && peerRevalidatedAfterNewBaseline == nil
        case .shared:
            guard eligibleRoomPeerObserved == true,
                  let age = peerValidationAgeMilliseconds,
                  (0..<30_000).contains(age),
                  let count = consistentPeerSampleCount,
                  count >= 3,
                  allApprovedPeerSamplesWithinTolerance == true,
                  peerRevalidatedAfterNewBaseline == true
            else { return false }
            return true
        }
    }
}

public struct FinalizationLiveEvidence: Codable, Equatable, Sendable {
    public enum DeviceState: String, Codable, Equatable, Sendable {
        case awakeAtBoundary
        case sleptPastBoundary
    }

    public enum Result: String, Codable, Equatable, Sendable {
        case completed
        case incomplete
    }

    public let deviceState: DeviceState
    public let wakeObservedBeforeFinalization: Bool
    public let terminalClosePersistedAfterRollback: Bool
    public let elapsedMilliseconds: Int64
    public let result: Result

    public init(
        deviceState: DeviceState,
        wakeObservedBeforeFinalization: Bool,
        terminalClosePersistedAfterRollback: Bool,
        elapsedMilliseconds: Int64,
        result: Result
    ) {
        self.deviceState = deviceState
        self.wakeObservedBeforeFinalization =
            wakeObservedBeforeFinalization
        self.terminalClosePersistedAfterRollback =
            terminalClosePersistedAfterRollback
        self.elapsedMilliseconds = elapsedMilliseconds
        self.result = result
    }

    public var complete: Bool {
        guard (0...120_000).contains(elapsedMilliseconds),
              terminalClosePersistedAfterRollback
        else { return false }
        switch deviceState {
        case .awakeAtBoundary:
            return true
        case .sleptPastBoundary:
            return wakeObservedBeforeFinalization
        }
    }
}

public struct ResourceMeasurementLiveEvidence: Codable, Equatable, Sendable {
    public enum MeasurementTool: String, Codable, Equatable, Sendable {
        case instruments
        case powermetrics
        case both
    }

    public let measurementTool: MeasurementTool
    public let observationDurationMilliseconds: Int64
    public let timerWakeups: Int
    public let transferredBytes: Int
    public let cpuTimeMilliseconds: Int64
    public let energySampleCount: Int

    public init(
        measurementTool: MeasurementTool,
        observationDurationMilliseconds: Int64,
        timerWakeups: Int,
        transferredBytes: Int,
        cpuTimeMilliseconds: Int64,
        energySampleCount: Int
    ) {
        self.measurementTool = measurementTool
        self.observationDurationMilliseconds = observationDurationMilliseconds
        self.timerWakeups = timerWakeups
        self.transferredBytes = transferredBytes
        self.cpuTimeMilliseconds = cpuTimeMilliseconds
        self.energySampleCount = energySampleCount
    }

    public var complete: Bool {
        observationDurationMilliseconds > 0
            && timerWakeups >= 0
            && transferredBytes >= 0
            && cpuTimeMilliseconds >= 0
            && energySampleCount > 0
    }
}

/// 여러 probe 출력에서 추출한 typed artifact 묶음.
///
/// 모든 collection은 비어 있을 수 있다. 빈 묶음이나 부분 묶음은 완료로
/// 판정되지 않는다.
public struct LiveEvidenceBundle: Codable, Equatable, Sendable {
    public var clockRuns: [ClockRunLiveEvidence]
    public var systemEvents: [SystemEventLiveEvidence]
    public var boundedSessions: [BoundedSessionLiveEvidence]
    public var cadenceObservations: [CadenceLiveEvidence]
    public var clockBoundaries: [ClockBoundaryLiveEvidence]
    public var sleepWakeClocks: [SleepWakeClockLiveEvidence]
    public var clockRecoveries: [ClockRecoveryLiveEvidence]
    public var finalizations: [FinalizationLiveEvidence]
    public var resourceMeasurements: [ResourceMeasurementLiveEvidence]

    public init(
        clockRuns: [ClockRunLiveEvidence] = [],
        systemEvents: [SystemEventLiveEvidence] = [],
        boundedSessions: [BoundedSessionLiveEvidence] = [],
        cadenceObservations: [CadenceLiveEvidence] = [],
        clockBoundaries: [ClockBoundaryLiveEvidence] = [],
        sleepWakeClocks: [SleepWakeClockLiveEvidence] = [],
        clockRecoveries: [ClockRecoveryLiveEvidence] = [],
        finalizations: [FinalizationLiveEvidence] = [],
        resourceMeasurements: [ResourceMeasurementLiveEvidence] = []
    ) {
        self.clockRuns = clockRuns
        self.systemEvents = systemEvents
        self.boundedSessions = boundedSessions
        self.cadenceObservations = cadenceObservations
        self.clockBoundaries = clockBoundaries
        self.sleepWakeClocks = sleepWakeClocks
        self.clockRecoveries = clockRecoveries
        self.finalizations = finalizations
        self.resourceMeasurements = resourceMeasurements
    }

    private enum CodingKeys: String, CodingKey {
        case clockRuns
        case systemEvents
        case boundedSessions
        case cadenceObservations
        case clockBoundaries
        case sleepWakeClocks
        case clockRecoveries
        case finalizations
        case resourceMeasurements
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        clockRuns = try values.decodeIfPresent(
            [ClockRunLiveEvidence].self,
            forKey: .clockRuns
        ) ?? []
        systemEvents = try values.decodeIfPresent(
            [SystemEventLiveEvidence].self,
            forKey: .systemEvents
        ) ?? []
        boundedSessions = try values.decodeIfPresent(
            [BoundedSessionLiveEvidence].self,
            forKey: .boundedSessions
        ) ?? []
        cadenceObservations = try values.decodeIfPresent(
            [CadenceLiveEvidence].self,
            forKey: .cadenceObservations
        ) ?? []
        clockBoundaries = try values.decodeIfPresent(
            [ClockBoundaryLiveEvidence].self,
            forKey: .clockBoundaries
        ) ?? []
        sleepWakeClocks = try values.decodeIfPresent(
            [SleepWakeClockLiveEvidence].self,
            forKey: .sleepWakeClocks
        ) ?? []
        clockRecoveries = try values.decodeIfPresent(
            [ClockRecoveryLiveEvidence].self,
            forKey: .clockRecoveries
        ) ?? []
        finalizations = try values.decodeIfPresent(
            [FinalizationLiveEvidence].self,
            forKey: .finalizations
        ) ?? []
        resourceMeasurements = try values.decodeIfPresent(
            [ResourceMeasurementLiveEvidence].self,
            forKey: .resourceMeasurements
        ) ?? []
    }

    public static func merging(_ bundles: [LiveEvidenceBundle]) -> Self {
        var result = LiveEvidenceBundle()
        for bundle in bundles {
            result.clockRuns.append(contentsOf: bundle.clockRuns)
            result.systemEvents.append(contentsOf: bundle.systemEvents)
            result.boundedSessions.append(contentsOf: bundle.boundedSessions)
            result.cadenceObservations.append(
                contentsOf: bundle.cadenceObservations
            )
            result.clockBoundaries.append(contentsOf: bundle.clockBoundaries)
            result.sleepWakeClocks.append(contentsOf: bundle.sleepWakeClocks)
            result.clockRecoveries.append(contentsOf: bundle.clockRecoveries)
            result.finalizations.append(contentsOf: bundle.finalizations)
            result.resourceMeasurements.append(
                contentsOf: bundle.resourceMeasurements
            )
        }
        return result
    }
}

/// aggregate mode가 출력하는 익명화된 최종 판정.
public struct LiveEvidenceAggregateReport: Codable, Equatable, Sendable {
    public let tool: String
    public let mode: String
    public let evidenceBundle: LiveEvidenceBundle
    public let liveGate: LiveGateEvidence
    public let missingEvidence: [String]
    public let anonymizationLeaks: [String]
    public let modelPassed: Bool
    public let anonymized: Bool
    public let complete: Bool
    public let policyToleranceMayBeApproved: Bool
    public let verdict: String
}

public enum LiveEvidenceAggregator {
    public static func aggregate(
        _ bundles: [LiveEvidenceBundle],
        sourceText: String = ""
    ) -> LiveEvidenceAggregateReport {
        let evidence = LiveEvidenceBundle.merging(bundles)
        let modelPassed = ScenarioRunner.run(ScenarioCatalog.all)
            .filter { $0.evidenceKind == .deterministicModel }
            .allSatisfy(\.passed)
        let validClockRunObserved =
            evidence.clockRuns.contains(where: \.complete)
        let clockMatrix = clockMatrixComplete(evidence.clockRuns)
        let validEvents = evidence.systemEvents.filter(\.valid)
        let wake = validEvents.contains { $0.wakeCount > 0 }
        let foreground = validEvents.contains { $0.foregroundCount > 0 }
        let network = validEvents.contains { $0.networkChangeCount > 0 }
        let newPeer = validEvents.contains { $0.newPeerDiscoveryCount > 0 }
        let bounded = evidence.boundedSessions.contains(where: \.complete)
        let cadence = evidence.cadenceObservations.contains(where: \.complete)
        let clockBoundary = evidence.clockBoundaries.contains(where: \.complete)
        let sleepWake = evidence.sleepWakeClocks.contains(where: \.complete)
        let localRecovery = evidence.clockRecoveries.contains {
            $0.roomHistory == .localOnly && $0.complete
        }
        let sharedRecovery = evidence.clockRecoveries.contains {
            $0.roomHistory == .shared && $0.complete
        }
        let awakeFinalization = evidence.finalizations.contains {
            $0.deviceState == .awakeAtBoundary && $0.complete
        }
        let sleepingFinalization = evidence.finalizations.contains {
            $0.deviceState == .sleptPastBoundary && $0.complete
        }
        let resource = evidence.resourceMeasurements.contains(where: \.complete)

        let gate = LiveGateEvidence(
            twoMacClockExchangeObserved: validClockRunObserved,
            clockCandidateMatrixPassed: clockMatrix,
            wakeObserved: wake,
            foregroundObserved: foreground,
            networkChangeObserved: network,
            newPeerDiscoveryObserved: newPeer,
            boundedSessionObserved: bounded,
            thirtySecondCadenceObserved: cadence,
            systemClockChangeRevalidationObserved:
                clockBoundary
                && sleepWake
                && localRecovery
                && sharedRecovery,
            awakeDeviceFinalizationObserved: awakeFinalization,
            sleepingDeviceFinalizationObserved: sleepingFinalization,
            resourceCostMeasured: resource
        )

        var missing: [String] = []
        if !validClockRunObserved {
            missing.append("two-mac-clock-exchange")
        }
        if !clockMatrix { missing.append("ten-pair-clock-matrix") }
        if !wake { missing.append("wake") }
        if !foreground { missing.append("foreground") }
        if !network { missing.append("network-change") }
        if !newPeer { missing.append("new-peer-discovery") }
        if !bounded { missing.append("bounded-session") }
        if !cadence { missing.append("cadence-within-30000") }
        if !clockBoundary {
            missing.append("clock-freshness-samples-continuity")
        }
        if !sleepWake { missing.append("sleep-wake-clock-semantics") }
        if !localRecovery { missing.append("local-only-clock-recovery") }
        if !sharedRecovery { missing.append("shared-clock-recovery") }
        if !awakeFinalization { missing.append("awake-finalization") }
        if !sleepingFinalization { missing.append("sleeping-finalization") }
        if !resource { missing.append("resource-measurement") }
        if !modelPassed { missing.append("deterministic-model") }

        let leaks = EvidenceSanitizer.exposedMarkers(in: sourceText).sorted()
        let anonymized = leaks.isEmpty
        let complete = anonymized && modelPassed && gate.complete
        let verdict: String
        if !anonymized {
            verdict = "evidence-not-anonymized"
        } else if !modelPassed {
            verdict = "deterministic-model-failed"
        } else if complete {
            verdict = "release-gate-evidence-complete"
        } else {
            verdict = "live-gate-pending"
        }

        return LiveEvidenceAggregateReport(
            tool: ProbeReport.tool,
            mode: "live-evidence-aggregate",
            evidenceBundle: evidence,
            liveGate: gate,
            missingEvidence: missing.sorted(),
            anonymizationLeaks: leaks,
            modelPassed: modelPassed,
            anonymized: anonymized,
            complete: complete,
            policyToleranceMayBeApproved: complete,
            verdict: verdict
        )
    }

    private static func clockMatrixComplete(
        _ runs: [ClockRunLiveEvidence]
    ) -> Bool {
        guard runs.count == 20, runs.allSatisfy(\.complete) else {
            return false
        }
        let groups = Dictionary(grouping: runs) { $0.pairEvidenceID! }
        guard groups.count == 10 else { return false }
        return groups.values.allSatisfy { pair in
            pair.count == 2 && Set(pair.compactMap(\.direction)) == [.aToB, .bToA]
        }
    }
}

/// 모델 실행에서 관측한 비용 대리 지표.
///
/// 이는 Instruments나 `powermetrics`의 에너지 측정값이 아니다. 실기기 비용
/// 측정 전에도 timer wake와 전송량이 무한히 증가하지 않는지 확인하는 값이다.
public struct ResourceCostSummary: Codable, Equatable, Sendable {
    public let sessionStarts: Int
    public let attempts: Int
    public let timerWakeups: Int
    public let transferredBytes: Int

    public init(
        sessionStarts: Int,
        attempts: Int,
        timerWakeups: Int,
        transferredBytes: Int
    ) {
        self.sessionStarts = sessionStarts
        self.attempts = attempts
        self.timerWakeups = timerWakeups
        self.transferredBytes = transferredBytes
    }
}

/// `sp03-probe`의 결정적이고 익명화된 JSON 보고서.
public struct ProbeReport: Codable, Equatable, Sendable {
    public static let tool = "sp03-probe"
    public static let candidateClockToleranceMilliseconds = 1_000
    public static let candidateValidationFreshnessMilliseconds = 30_000

    public let scenarios: [WakeTimeScenarioResult]
    public let resourceCost: ResourceCostSummary
    public let liveGate: LiveGateEvidence
    public let anonymizationLeaks: [String]

    public init(
        scenarios: [WakeTimeScenarioResult],
        resourceCost: ResourceCostSummary,
        liveGate: LiveGateEvidence = .notRun,
        anonymizationLeaks: [String] = []
    ) {
        self.scenarios = scenarios
        self.resourceCost = resourceCost
        self.liveGate = liveGate
        self.anonymizationLeaks = anonymizationLeaks
    }

    public var modelPassed: Bool {
        scenarios
            .filter { $0.evidenceKind == .deterministicModel }
            .allSatisfy(\.passed)
    }

    public var anonymized: Bool { anonymizationLeaks.isEmpty }

    /// 실기기 gate가 완료되기 전에는 후보 허용 오차를 Policy 확정값으로 쓰지 않는다.
    public var policyToleranceMayBeApproved: Bool {
        modelPassed && anonymized && liveGate.complete
    }

    public var verdict: String {
        if !anonymized { return "evidence-not-anonymized" }
        if !modelPassed { return "deterministic-model-failed" }
        if !liveGate.complete { return "model-passed-live-gate-pending" }
        return "release-gate-evidence-complete"
    }

    /// 최종 직렬화 결과를 검사해 익명화 누락을 보고서 안에 다시 넣는다.
    public static func make(
        scenarios: [WakeTimeScenarioResult],
        resourceCost: ResourceCostSummary,
        liveGate: LiveGateEvidence = .notRun
    ) -> ProbeReport {
        let draft = ProbeReport(
            scenarios: scenarios,
            resourceCost: resourceCost,
            liveGate: liveGate
        )
        let text = ProbeReportEncoder.json(draft)
        return ProbeReport(
            scenarios: scenarios,
            resourceCost: resourceCost,
            liveGate: liveGate,
            anonymizationLeaks: EvidenceSanitizer.exposedMarkers(in: text)
        )
    }
}

private struct EncodedProbeReport: Codable {
    let tool: String
    let candidateClockToleranceMilliseconds: Int
    let candidateValidationFreshnessMilliseconds: Int
    let thresholdStatus: String
    let modelPassed: Bool
    let anonymized: Bool
    let policyToleranceMayBeApproved: Bool
    let verdict: String
    let resourceCost: ResourceCostSummary
    let liveGate: LiveGateEvidence
    let anonymizationLeaks: [String]
    let scenarios: [WakeTimeScenarioResult]
}

public enum ProbeReportEncoder {
    public static func json(_ report: ProbeReport) -> String {
        let output = EncodedProbeReport(
            tool: ProbeReport.tool,
            candidateClockToleranceMilliseconds: ProbeReport.candidateClockToleranceMilliseconds,
            candidateValidationFreshnessMilliseconds: ProbeReport.candidateValidationFreshnessMilliseconds,
            thresholdStatus: report.liveGate.complete
                ? "eligible-for-product-owner-approval"
                : "candidate-awaiting-two-mac-live-evidence",
            modelPassed: report.modelPassed,
            anonymized: report.anonymized,
            policyToleranceMayBeApproved: report.policyToleranceMayBeApproved,
            verdict: report.verdict,
            resourceCost: report.resourceCost,
            liveGate: report.liveGate,
            anonymizationLeaks: report.anonymizationLeaks,
            scenarios: report.scenarios.sorted { $0.name < $1.name }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(output),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"report-encoding-failed\"}"
        }
        return text
    }
}

public enum EvidenceSanitizer {
    /// 결과에 로컬 절대 경로나 네트워크 식별자가 들어갔음을 시사하는 marker.
    ///
    /// IP 주소 전체를 정규식으로 찾지 않는다. 시나리오 수치가 우연히 주소처럼
    /// 보일 수 있어 오탐이 생기기 때문이다. 보고 계층은 애초에 주소 필드를 두지
    /// 않고, 이 검사는 대표적인 누출 표면을 마지막에 한 번 더 막는다.
    private static let forbiddenMarkers = [
        "/Users/",
        "\\Users\\",
        "\"hostname\"",
        "\"ssid\"",
        "\"ipAddress\"",
        ".local"
    ]

    public static func exposedMarkers(in text: String) -> [String] {
        forbiddenMarkers.filter { text.localizedCaseInsensitiveContains($0) }
    }
}
