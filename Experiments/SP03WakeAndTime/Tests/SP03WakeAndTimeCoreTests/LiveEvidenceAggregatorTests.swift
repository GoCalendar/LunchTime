import Foundation
import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 실기기 evidence aggregator")
struct LiveEvidenceAggregatorTests {
    private func clockRun(
        pair: Int,
        direction: ClockRunLiveEvidence.Direction
    ) -> ClockRunLiveEvidence {
        ClockRunLiveEvidence(
            pairEvidenceID: String(format: "%064x", pair),
            direction: direction,
            operatorConfirmedDistinctPhysicalMacs: true,
            reciprocalPeerMatched: true,
            crossHostEvidence: true,
            candidateEligible: true,
            failureObserved: false,
            rounds: (1...3).map {
                ClockRoundLiveEvidence(
                    round: $0,
                    sampleEligible: true,
                    wallMonotonicContinuous: true,
                    withinFiveHundredMillisecondSafetyMargin: true
                )
            }
        )
    }

    private func recovery(
        _ history: ClockRecoveryLiveEvidence.RoomHistory,
        age: Int64? = 29_999,
        samples: Int? = 3
    ) -> ClockRecoveryLiveEvidence {
        ClockRecoveryLiveEvidence(
            roomHistory: history,
            systemClockChangeDetected: true,
            priorBaselineInvalidated: true,
            invalidationSurvivedRestart: true,
            macOSClockCheckedByUser: true,
            manualRefreshObserved: true,
            newWallMonotonicBaselineCaptured: true,
            sensitiveWriteBlockedBeforeRecovery: true,
            eligibleRoomPeerObserved: history == .shared ? true : nil,
            peerValidationAgeMilliseconds: history == .shared ? age : nil,
            consistentPeerSampleCount: history == .shared ? samples : nil,
            allApprovedPeerSamplesWithinTolerance:
                history == .shared ? true : nil,
            peerRevalidatedAfterNewBaseline:
                history == .shared ? true : nil,
            sensitiveWriteAllowedAfterRecovery: true
        )
    }

    private func completeBundle() -> LiveEvidenceBundle {
        let clockRuns = (1...10).flatMap { pair in
            [
                clockRun(pair: pair, direction: .aToB),
                clockRun(pair: pair, direction: .bToA)
            ]
        }
        return LiveEvidenceBundle(
            clockRuns: clockRuns,
            systemEvents: [
                SystemEventLiveEvidence(
                    observationDurationMilliseconds: 120_000,
                    wakeCount: 1,
                    foregroundCount: 1,
                    networkChangeCount: 1,
                    newPeerDiscoveryCount: 1
                )
            ],
            boundedSessions: [
                BoundedSessionLiveEvidence(
                    elapsedMilliseconds: 30_000,
                    attemptCount: 3,
                    peakConcurrentSessions: 1,
                    terminalReason: .attemptLimit
                )
            ],
            cadenceObservations: [
                CadenceLiveEvidence(
                    observedSessionStartCount: 3,
                    maximumStartIntervalMilliseconds: 30_000
                )
            ],
            clockBoundaries: [
                ClockBoundaryLiveEvidence(
                    writeAllowedAt29999Milliseconds: true,
                    writeBlockedAt30000Milliseconds: true,
                    oneSampleBlocked: true,
                    twoSamplesBlocked: true,
                    threeSamplesValidated: true,
                    continuousWallMonotonicSampleAccepted: true,
                    discontinuousWallMonotonicSampleRejected: true
                )
            ],
            sleepWakeClocks: [
                SleepWakeClockLiveEvidence(
                    wakeNotificationObserved: true,
                    plannedMinimumSleepMilliseconds: 30_000,
                    wallElapsedMilliseconds: 60_000,
                    continuousElapsedMilliseconds: 60_000
                )
            ],
            clockRecoveries: [
                recovery(.localOnly),
                recovery(.shared)
            ],
            finalizations: [
                FinalizationLiveEvidence(
                    deviceState: .awakeAtBoundary,
                    wakeObservedBeforeFinalization: false,
                    terminalClosePersistedAfterRollback: true,
                    elapsedMilliseconds: 120_000,
                    result: .incomplete
                ),
                FinalizationLiveEvidence(
                    deviceState: .sleptPastBoundary,
                    wakeObservedBeforeFinalization: true,
                    terminalClosePersistedAfterRollback: true,
                    elapsedMilliseconds: 120_000,
                    result: .completed
                )
            ],
            resourceMeasurements: [
                ResourceMeasurementLiveEvidence(
                    measurementTool: .both,
                    observationDurationMilliseconds: 120_000,
                    timerWakeups: 4,
                    transferredBytes: 4_096,
                    cpuTimeMilliseconds: 50,
                    energySampleCount: 2
                )
            ]
        )
    }

    @Test("빈 입력과 부분 입력은 live 완료를 주장하지 않는다")
    func emptyEvidenceIsPending() throws {
        let decoded = try JSONDecoder().decode(
            LiveEvidenceBundle.self,
            from: Data("{}".utf8)
        )
        let report = LiveEvidenceAggregator.aggregate([decoded])

        #expect(!report.liveGate.complete)
        #expect(!report.complete)
        #expect(!report.policyToleranceMayBeApproved)
        #expect(report.verdict == "live-gate-pending")
        #expect(report.missingEvidence.contains("ten-pair-clock-matrix"))
        #expect(report.missingEvidence.contains("local-only-clock-recovery"))
        #expect(report.missingEvidence.contains("shared-clock-recovery"))
    }

    @Test("10개 익명 pair의 정확한 A/B 20개 결과만 clock 행렬을 통과한다")
    func clockMatrixRequiresTenReciprocalPairs() {
        let complete = LiveEvidenceAggregator.aggregate([completeBundle()])
        #expect(complete.liveGate.clockCandidateMatrixPassed)
        #expect(complete.complete)

        var duplicateDirection = completeBundle()
        duplicateDirection.clockRuns[1] = clockRun(
            pair: 1,
            direction: .aToB
        )
        let duplicate = LiveEvidenceAggregator.aggregate([duplicateDirection])
        #expect(!duplicate.liveGate.clockCandidateMatrixPassed)
        #expect(!duplicate.complete)

        var missingRound = completeBundle()
        let original = missingRound.clockRuns[0]
        missingRound.clockRuns[0] = ClockRunLiveEvidence(
            pairEvidenceID: original.pairEvidenceID,
            direction: original.direction,
            operatorConfirmedDistinctPhysicalMacs: true,
            reciprocalPeerMatched: true,
            crossHostEvidence: true,
            candidateEligible: true,
            failureObserved: false,
            rounds: Array(original.rounds.dropLast())
        )
        let incomplete = LiveEvidenceAggregator.aggregate([missingRound])
        #expect(!incomplete.liveGate.clockCandidateMatrixPassed)
    }

    @Test("freshness 29999/30000과 표본 1·2/3 경계를 그대로 판정한다")
    func clockBoundariesRemainExplicit() {
        let boundary = ClockBoundaryLiveEvidence(
            writeAllowedAt29999Milliseconds: true,
            writeBlockedAt30000Milliseconds: true,
            oneSampleBlocked: true,
            twoSamplesBlocked: true,
            threeSamplesValidated: true,
            continuousWallMonotonicSampleAccepted: true,
            discontinuousWallMonotonicSampleRejected: true
        )
        #expect(boundary.complete)

        #expect(recovery(.shared, age: 29_999, samples: 3).complete)
        #expect(!recovery(.shared, age: 30_000, samples: 3).complete)
        #expect(!recovery(.shared, age: 29_999, samples: 1).complete)
        #expect(!recovery(.shared, age: 29_999, samples: 2).complete)
    }

    @Test("bounded session terminal 원인별 횟수·시간 조건을 바꾸지 않는다")
    func boundedSessionTerminalReasonsAreStrict() {
        #expect(
            BoundedSessionLiveEvidence(
                elapsedMilliseconds: 10_000,
                attemptCount: 1,
                peakConcurrentSessions: 1,
                terminalReason: .completed
            ).complete
        )
        #expect(
            BoundedSessionLiveEvidence(
                elapsedMilliseconds: 10_000,
                attemptCount: 3,
                peakConcurrentSessions: 1,
                terminalReason: .attemptLimit
            ).complete
        )
        #expect(
            BoundedSessionLiveEvidence(
                elapsedMilliseconds: 30_000,
                attemptCount: 1,
                peakConcurrentSessions: 1,
                terminalReason: .timeout
            ).complete
        )
        #expect(
            !BoundedSessionLiveEvidence(
                elapsedMilliseconds: 10_000,
                attemptCount: 2,
                peakConcurrentSessions: 1,
                terminalReason: .attemptLimit
            ).complete
        )
        #expect(
            !BoundedSessionLiveEvidence(
                elapsedMilliseconds: 29_999,
                attemptCount: 1,
                peakConcurrentSessions: 1,
                terminalReason: .timeout
            ).complete
        )
        #expect(
            !BoundedSessionLiveEvidence(
                elapsedMilliseconds: 1,
                attemptCount: 1,
                peakConcurrentSessions: 1,
                terminalReason: .unresolved
            ).complete
        )
    }

    @Test("cadence는 실제 start 간격으로, sleep 의미는 계획 구간 포함으로 판정한다")
    func cadenceAndSleepSemanticsUseMeasuredDurations() {
        #expect(
            CadenceLiveEvidence(
                observedSessionStartCount: 2,
                maximumStartIntervalMilliseconds: 30_000
            ).complete
        )
        #expect(
            !CadenceLiveEvidence(
                observedSessionStartCount: 1,
                maximumStartIntervalMilliseconds: 30_000
            ).complete
        )
        #expect(
            !CadenceLiveEvidence(
                observedSessionStartCount: 2,
                maximumStartIntervalMilliseconds: 30_001
            ).complete
        )

        #expect(
            SleepWakeClockLiveEvidence(
                wakeNotificationObserved: true,
                plannedMinimumSleepMilliseconds: 30_000,
                wallElapsedMilliseconds: 60_000,
                continuousElapsedMilliseconds: 60_000
            ).complete
        )
        #expect(
            !SleepWakeClockLiveEvidence(
                wakeNotificationObserved: true,
                plannedMinimumSleepMilliseconds: 30_000,
                wallElapsedMilliseconds: 60_000,
                continuousElapsedMilliseconds: 1
            ).complete
        )
    }

    @Test("local-only는 새 baseline으로, shared는 새 baseline과 fresh Peer로 복구한다")
    func recoveryContractsStaySeparate() {
        let local = recovery(.localOnly)
        let shared = recovery(.shared)
        #expect(local.complete)
        #expect(shared.complete)

        let localWithPeerRequirement = ClockRecoveryLiveEvidence(
            roomHistory: .localOnly,
            systemClockChangeDetected: true,
            priorBaselineInvalidated: true,
            invalidationSurvivedRestart: true,
            macOSClockCheckedByUser: true,
            manualRefreshObserved: true,
            newWallMonotonicBaselineCaptured: true,
            sensitiveWriteBlockedBeforeRecovery: true,
            eligibleRoomPeerObserved: true,
            peerValidationAgeMilliseconds: 1,
            consistentPeerSampleCount: 3,
            allApprovedPeerSamplesWithinTolerance: true,
            peerRevalidatedAfterNewBaseline: true,
            sensitiveWriteAllowedAfterRecovery: true
        )
        #expect(!localWithPeerRequirement.complete)

        var withoutLocal = completeBundle()
        withoutLocal.clockRecoveries = [shared]
        let missingLocal = LiveEvidenceAggregator.aggregate([withoutLocal])
        #expect(!missingLocal.liveGate.systemClockChangeRevalidationObserved)
        #expect(
            missingLocal.missingEvidence.contains("local-only-clock-recovery")
        )

        var withoutShared = completeBundle()
        withoutShared.clockRecoveries = [local]
        let missingShared = LiveEvidenceAggregator.aggregate([withoutShared])
        #expect(!missingShared.liveGate.systemClockChangeRevalidationObserved)
        #expect(
            missingShared.missingEvidence.contains("shared-clock-recovery")
        )
    }

    @Test("여러 JSON fragment를 합치되 입력 식별자와 경로 값은 출력하지 않는다")
    func fragmentsMergeAndLeaksAreReportedWithoutEcho() throws {
        let complete = completeBundle()
        let fragments = [
            LiveEvidenceBundle(
                clockRuns: complete.clockRuns,
                systemEvents: complete.systemEvents
            ),
            LiveEvidenceBundle(
                boundedSessions: complete.boundedSessions,
                cadenceObservations: complete.cadenceObservations,
                clockBoundaries: complete.clockBoundaries,
                sleepWakeClocks: complete.sleepWakeClocks,
                clockRecoveries: complete.clockRecoveries,
                finalizations: complete.finalizations,
                resourceMeasurements: complete.resourceMeasurements
            )
        ]
        #expect(LiveEvidenceAggregator.aggregate(fragments).complete)

        let secret = "private-host.local"
        let leakingInput =
            "{\"hostname\":\"\(secret)\",\"path\":\"/Users/example/evidence.json\"}"
        let rejected = LiveEvidenceAggregator.aggregate(
            fragments,
            sourceText: leakingInput
        )
        #expect(!rejected.anonymized)
        #expect(!rejected.complete)
        #expect(rejected.verdict == "evidence-not-anonymized")

        let output = try String(
            decoding: JSONEncoder().encode(rejected),
            as: UTF8.self
        )
        #expect(!output.contains(secret))
        #expect(!output.contains("/Users/example/evidence.json"))
    }
}
