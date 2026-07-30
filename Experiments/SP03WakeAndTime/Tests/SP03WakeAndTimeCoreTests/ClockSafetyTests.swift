import Foundation
import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 시계 차이 fail-closed gate")
struct ClockSafetyTests {
    private func sample(
        offset: Int64,
        outbound: Int64 = 50,
        processing: Int64 = 10,
        inbound: Int64 = 50,
        captureUncertainty: Int64 = 0
    ) -> ClockFourTimestampSample {
        let t1: Int64 = 100_000
        let t2 = t1 + outbound + offset
        let t3 = t2 + processing
        let t4 = t1 + outbound + processing + inbound
        return ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t1),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t2),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t3),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: t4),
            localElapsedMonotonicMilliseconds: outbound + processing + inbound,
            peerProcessingMonotonicMilliseconds: processing,
            captureUncertaintyMilliseconds: captureUncertainty
        )
    }

    private func validatedGate(
        at now: MonotonicInstant = MonotonicInstant(milliseconds: 0)
    ) -> ClockSkewGate {
        var gate = baselineGate(sharingHistory: .everShared)
        gate.validate(samples: [sample(offset: 400), sample(offset: 400), sample(offset: 400)], at: now)
        return gate
    }

    private func baselineGate(
        sharingHistory: RoomClockSharingHistory = .localOnly
    ) -> ClockSkewGate {
        var gate = ClockSkewGate(sharingHistory: sharingHistory)
        let established = gate.establishProcessBaseline(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 0)
        )
        #expect(established)
        return gate
    }

    @Test("후보 수치는 실기기 증거가 필요하다고 타입에 남는다")
    func candidateIsNotPolicyEvidence() {
        let candidate = UnconfirmedClockSafetyCandidate.sp03RealDeviceUnconfirmed
        #expect(candidate.maxAbsoluteOffsetMilliseconds == 1_000)
        #expect(candidate.freshnessMilliseconds == 30_000)
        #expect(candidate.requiredConsistentSamples == 3)
        #expect(candidate.maximumUnexplainedWallClockDriftMilliseconds == 10)
        #expect(candidate.evidenceStatus == .requiresRealDeviceEvidence)
    }

    @Test("4 timestamp 표본은 offset과 네트워크 불확실성 구간을 계산한다")
    func computesNTPStyleInterval() {
        let interval = sample(
            offset: 400,
            outbound: 40,
            processing: 10,
            inbound: 60
        ).offsetInterval

        #expect(interval?.lowerBoundMilliseconds == 340)
        #expect(interval?.upperBoundMilliseconds == 440)
    }

    @Test("교환 중 wall clock이 단조 경과와 불일치하면 표본을 폐기한다")
    func rejectsWallClockDiscontinuity() {
        let localJump = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_050),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_060),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 101_110),
            localElapsedMonotonicMilliseconds: 110,
            peerProcessingMonotonicMilliseconds: 10,
            captureUncertaintyMilliseconds: 2
        )
        let peerJump = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_050),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 101_060),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 100_110),
            localElapsedMonotonicMilliseconds: 110,
            peerProcessingMonotonicMilliseconds: 10,
            captureUncertaintyMilliseconds: 2
        )

        #expect(localJump.offsetInterval == nil)
        #expect(peerJump.offsetInterval == nil)
    }

    @Test("30초 상한을 넘거나 Int64 최대인 timing은 crash 없이 폐기한다")
    func rejectsUnboundedTimingValues() {
        for invalid in [
            ClockFourTimestampSample(
                localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                localElapsedMonotonicMilliseconds: 30_001,
                peerProcessingMonotonicMilliseconds: 0
            ),
            ClockFourTimestampSample(
                localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
                localElapsedMonotonicMilliseconds: 0,
                peerProcessingMonotonicMilliseconds: 0,
                captureUncertaintyMilliseconds: Int64.max
            )
        ] {
            #expect(invalid.offsetInterval == nil)
        }
    }

    @Test("일관된 3개 표본이 허용 구간 안이면 검증된다")
    func acceptsThreeConsistentSamples() {
        var gate = baselineGate(sharingHistory: .everShared)
        let state = gate.validate(
            samples: [
                sample(offset: 400, outbound: 40, inbound: 60),
                sample(offset: 400, outbound: 50, inbound: 50),
                sample(offset: 400, outbound: 60, inbound: 40)
            ],
            at: MonotonicInstant(milliseconds: 2_000)
        )

        guard case let .valid(observation) = state else {
            Issue.record("검증 성공 상태가 아니다: \(state)")
            return
        }
        // 각 표본은 경로 비대칭만큼 폭을 가진다. 세 구간의 교집합은
        // 400ms를 포함하되 근거 없이 점 추정으로 좁혀서는 안 된다.
        #expect(observation.offsetInterval.lowerBoundMilliseconds == 360)
        #expect(observation.offsetInterval.upperBoundMilliseconds == 440)
        #expect(observation.validThrough == MonotonicInstant(milliseconds: 32_000))
    }

    @Test("offset과 uncertainty 합의 정확한 1000ms 경계는 포함한다")
    func toleranceBoundaryIsInclusive() {
        var gate = baselineGate(sharingHistory: .everShared)
        let samples = [
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0),
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0),
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0)
        ]

        gate.validate(samples: samples, at: MonotonicInstant(milliseconds: 0))
        #expect(
            gate.candidateDecision(
                for: .participationAcceptance,
                at: MonotonicInstant(milliseconds: 0)
            ) == .allowed
        )
    }

    @Test("1000ms를 넘는 확정 offset은 차단한다")
    func blocksExceededOffset() {
        var gate = baselineGate(sharingHistory: .everShared)
        let samples = Array(
            repeating: sample(offset: 1_001, outbound: 0, processing: 1, inbound: 0),
            count: 3
        )

        #expect(
            gate.validate(samples: samples, at: MonotonicInstant(milliseconds: 0))
                == .blocked(.offsetExceeded)
        )
    }

    @Test("불확실성 구간이 1000ms 경계를 걸치면 허용으로 추측하지 않는다")
    func blocksUncertaintyCrossingTolerance() {
        var gate = baselineGate(sharingHistory: .everShared)
        let samples = Array(
            repeating: sample(offset: 900, outbound: 200, inbound: 200),
            count: 3
        )

        #expect(
            gate.validate(samples: samples, at: MonotonicInstant(milliseconds: 0))
                == .blocked(.unverifiable(.uncertaintyCrossesTolerance))
        )
    }

    @Test("표본 부족·잘못된 duration·불일치는 모두 검증 불가다")
    func rejectsUnverifiableSamples() {
        var gate = baselineGate(sharingHistory: .everShared)
        #expect(
            gate.validate(
                samples: [sample(offset: 0), sample(offset: 0)],
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.insufficientSamples))
        )

        let invalid = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 0),
            localElapsedMonotonicMilliseconds: 1,
            peerProcessingMonotonicMilliseconds: 2
        )
        #expect(
            gate.validate(
                samples: [invalid, invalid, invalid],
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.invalidSample))
        )

        #expect(
            gate.validate(
                samples: [
                    sample(offset: 400, outbound: 10, inbound: 10),
                    sample(offset: -400, outbound: 10, inbound: 10),
                    sample(offset: 400, outbound: 10, inbound: 10)
                ],
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.inconsistentSamples))
        )
    }

    @Test("정상 응답 Peer가 없으면 검증 불가로 차단한다")
    func blocksWhenNormalPeerIsUnavailable() {
        var gate = baselineGate(sharingHistory: .everShared)
        #expect(
            gate.validate(
                samples: [],
                normalPeerAvailable: false,
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.normalPeerUnavailable))
        )
    }

    @Test("검증 freshness는 30000ms 반열린 구간이고 경계부터 stale이다")
    func validationFreshnessBoundary() {
        var gate = validatedGate()
        #expect(
            gate.candidateDecision(
                for: .orderDeadlineModification,
                at: MonotonicInstant(milliseconds: 29_999)
            ) == .allowed
        )
        #expect(
            gate.candidateDecision(
                for: .orderDeadlineModification,
                at: MonotonicInstant(milliseconds: 30_000)
            ) == .blocked(.stale)
        )
    }

    @Test("local-only Room은 유효한 macOS baseline이면 Peer 없이 허용된다")
    func localOnlyRoomUsesValidProcessBaseline() {
        var gate = baselineGate()

        #expect(gate.sharingHistory == .localOnly)
        #expect(
            gate.releaseDecision(
                for: .participationAcceptance,
                at: MonotonicInstant(milliseconds: 1)
            ) == .allowed
        )
    }

    @Test("공유 이력은 되돌아가지 않고 eligible Room Peer 검증을 요구한다")
    func sharedHistoryIsIrreversibleAndRequiresPeerValidation() {
        var gate = baselineGate()
        gate.recordRoomShared()
        gate.recordRoomShared()

        #expect(gate.sharingHistory == .everShared)
        #expect(
            gate.candidateDecision(
                for: .orderDeadlineModification,
                at: MonotonicInstant(milliseconds: 1)
            ) == .blocked(.notValidated)
        )

        let relaunched = ClockSkewGate(sharingHistory: gate.sharingHistory)
        #expect(relaunched.sharingHistory == .everShared)
    }

    @Test("각 eligible Peer가 최소 표본 수를 따로 충족해야 한다")
    func everyEligiblePeerRequiresMinimumSamples() {
        var gate = baselineGate(sharingHistory: .everShared)
        let full = Array(repeating: sample(offset: 100), count: 3)
        let short = Array(repeating: sample(offset: 100), count: 2)

        #expect(
            gate.validate(
                eligiblePeers: [
                    EligibleRoomPeerClockSamples(peerID: "peer-a", samples: full),
                    EligibleRoomPeerClockSamples(peerID: "peer-b", samples: short)
                ],
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.insufficientSamples))
        )
    }

    @Test("다중 eligible Peer의 모든 표본이 충돌 없이 허용 범위 안이어야 한다")
    func allEligiblePeerSamplesMustAgree() {
        var gate = baselineGate(sharingHistory: .everShared)

        #expect(
            gate.validate(
                eligiblePeers: [
                    EligibleRoomPeerClockSamples(
                        peerID: "peer-a",
                        samples: Array(
                            repeating: sample(
                                offset: 400,
                                outbound: 10,
                                inbound: 10
                            ),
                            count: 3
                        )
                    ),
                    EligibleRoomPeerClockSamples(
                        peerID: "peer-b",
                        samples: Array(
                            repeating: sample(
                                offset: -400,
                                outbound: 10,
                                inbound: 10
                            ),
                            count: 3
                        )
                    )
                ],
                at: MonotonicInstant(milliseconds: 0)
            ) == .blocked(.unverifiable(.inconsistentSamples))
        )
    }

    @Test("공유 Room 후보 성공과 출시 gate는 명시적으로 분리된다")
    func candidateSuccessDoesNotOpenSharedReleaseGate() {
        var gate = validatedGate()

        #expect(
            gate.candidateDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 1)
            ) == .allowed
        )
        #expect(
            gate.releaseDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 1)
            ) == .blockedPendingRealDeviceApproval
        )
    }

    @Test("system clock change는 durable 복구 상태로 남고 local-only는 명시적 복구로 해제한다")
    func localOnlyClockRecoverySurvivesRelaunch() {
        var gate = baselineGate()
        gate.recordSystemClockChange()

        var relaunched = ClockSkewGate(
            sharingHistory: gate.sharingHistory,
            durableRecoveryState: gate.durableRecoveryState
        )
        #expect(relaunched.baselineState == .recoveryRequired)
        let initialBaselineWasRejected = !relaunched.establishProcessBaseline(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 2_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 0)
        )
        #expect(initialBaselineWasRejected)
        #expect(
            relaunched.releaseDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 1)
            ) == .blocked(.systemClockChanged)
        )

        relaunched.recoverAfterUserClockCheckAndManualRefresh(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 2_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 2)
        )
        #expect(relaunched.durableRecoveryState == .clear)
        #expect(
            relaunched.releaseDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 2)
            ) == .allowed
        )
    }

    @Test("공유 Room은 새 baseline 뒤에도 fresh Peer 검증이 필요하다")
    func sharedClockRecoveryRequiresFreshPeerValidation() {
        var gate = validatedGate()
        gate.recordWallMonotonicDiscontinuity()
        #expect(
            gate.candidateDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 1)
            ) == .blocked(.systemClockChanged)
        )

        gate.recoverAfterUserClockCheckAndManualRefresh(
            wallTime: WallClockInstant(millisecondsSinceUnixEpoch: 2_000_000),
            monotonicTime: MonotonicInstant(milliseconds: 2)
        )
        #expect(
            gate.candidateDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 2)
            ) == .blocked(.notValidated)
        )

        gate.validate(
            samples: [sample(offset: 0), sample(offset: 0), sample(offset: 0)],
            at: MonotonicInstant(milliseconds: 3)
        )
        #expect(
            gate.candidateDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 3)
            ) == .allowed
        )
        #expect(
            gate.releaseDecision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 3)
            ) == .blockedPendingRealDeviceApproval
        )
    }

    @Test("시계 gate는 세 시간의존 쓰기만 차단하고 복구 동작은 허용한다")
    func blocksOnlyThreeSensitiveWrites() {
        var gate = ClockSkewGate()
        let now = MonotonicInstant(milliseconds: 0)

        for operation in ClockGatedOperation.allCases {
            let decision = gate.candidateDecision(for: operation, at: now)
            if operation.isClockSensitiveWrite {
                #expect(decision == .blocked(.notValidated), "\(operation)")
            } else {
                #expect(decision == .allowed, "\(operation)")
            }
        }
    }
}
