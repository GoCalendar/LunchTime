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
        var gate = ClockSkewGate()
        gate.validate(samples: [sample(offset: 400), sample(offset: 400), sample(offset: 400)], at: now)
        return gate
    }

    @Test("후보 수치는 실기기 증거가 필요하다고 타입에 남는다")
    func candidateIsNotPolicyEvidence() {
        let candidate = UnconfirmedClockSafetyCandidate.sp03RealDeviceUnconfirmed
        #expect(candidate.maxAbsoluteOffsetMilliseconds == 1_000)
        #expect(candidate.freshnessMilliseconds == 30_000)
        #expect(candidate.requiredConsistentSamples == 3)
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
        var gate = ClockSkewGate()
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
        var gate = ClockSkewGate()
        let samples = [
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0),
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0),
            sample(offset: 1_000, outbound: 0, processing: 1, inbound: 0)
        ]

        gate.validate(samples: samples, at: MonotonicInstant(milliseconds: 0))
        #expect(
            gate.decision(
                for: .participationAcceptance,
                at: MonotonicInstant(milliseconds: 0)
            ) == .allowed
        )
    }

    @Test("1000ms를 넘는 확정 offset은 차단한다")
    func blocksExceededOffset() {
        var gate = ClockSkewGate()
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
        var gate = ClockSkewGate()
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
        var gate = ClockSkewGate()
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
        var gate = ClockSkewGate()
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
            gate.decision(
                for: .orderDeadlineModification,
                at: MonotonicInstant(milliseconds: 29_999)
            ) == .allowed
        )
        #expect(
            gate.decision(
                for: .orderDeadlineModification,
                at: MonotonicInstant(milliseconds: 30_000)
            ) == .blocked(.stale)
        )
    }

    @Test("system clock change는 성공 검증을 즉시 무효화하고 재검증만 복구한다")
    func systemClockChangeInvalidatesUntilRevalidation() {
        var gate = validatedGate()
        gate.recordSystemClockChange()
        #expect(
            gate.decision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 1)
            ) == .blocked(.systemClockChanged)
        )

        gate.validate(
            samples: [sample(offset: 0), sample(offset: 0), sample(offset: 0)],
            at: MonotonicInstant(milliseconds: 2)
        )
        #expect(
            gate.decision(
                for: .orderStatusChange,
                at: MonotonicInstant(milliseconds: 2)
            ) == .allowed
        )
    }

    @Test("시계 gate는 세 시간의존 쓰기만 차단하고 복구 동작은 허용한다")
    func blocksOnlyThreeSensitiveWrites() {
        var gate = ClockSkewGate()
        let now = MonotonicInstant(milliseconds: 0)

        for operation in ClockGatedOperation.allCases {
            let decision = gate.decision(for: operation, at: now)
            if operation.isClockSensitiveWrite {
                #expect(decision == .blocked(.notValidated), "\(operation)")
            } else {
                #expect(decision == .allowed, "\(operation)")
            }
        }
    }
}
