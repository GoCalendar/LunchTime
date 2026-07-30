import Foundation
import Testing

@testable import SP03WakeAndTimeCore

@Suite("SP-03 clock exchange options")
struct ClockExchangeProbeOptionsTests {
    @Test("A와 B를 반대로 지정한 정확히 3회·30초 이하 probe만 만든다")
    func acceptsBoundedAnonymousPair() throws {
        let a = try ClockExchangeProbeOptions(localLabel: "A", peerLabel: "B")
        let b = try ClockExchangeProbeOptions(localLabel: "B", peerLabel: "A")

        #expect(a.localLabel == "A")
        #expect(b.localLabel == "B")
        #expect(ClockExchangeProbeOptions.requiredRounds == 3)
        #expect(a.totalTimeoutSeconds == 30)
        #expect(a.roundTimeoutSeconds * 3 <= a.totalTimeoutSeconds)
        #expect(ClockExchangeProbeOptions.serviceType == "_lt-sp03._tcp")
        #expect(!a.operatorConfirmedDistinctPhysicalMacs)

        let attested = try ClockExchangeProbeOptions(
            localLabel: "A",
            peerLabel: "B",
            operatorConfirmedDistinctPhysicalMacs: true
        )
        #expect(attested.operatorConfirmedDistinctPhysicalMacs)
    }

    @Test(
        "익명 A/B가 아닌 라벨을 거부한다",
        arguments: [
            ("device-name", "B"),
            ("A", "wifi-name"),
            ("192.0.2.1", "B"),
            ("a", "B")
        ]
    )
    func rejectsIdentifyingLabels(local: String, peer: String) {
        #expect(throws: ClockExchangeProbeOptions.ValidationError.self) {
            _ = try ClockExchangeProbeOptions(
                localLabel: local,
                peerLabel: peer
            )
        }
    }

    @Test("같은 라벨은 자기 자신과의 측정을 만들 수 있어 거부한다")
    func rejectsSameLabel() {
        do {
            _ = try ClockExchangeProbeOptions(localLabel: "A", peerLabel: "A")
            Issue.record("같은 라벨이 허용되면 안 된다")
        } catch let error as ClockExchangeProbeOptions.ValidationError {
            #expect(error == .labelsMustDiffer)
        } catch {
            Issue.record("예상하지 않은 오류: \(error)")
        }
    }

    @Test(
        "유한한 30초 전체 상한과 3회 안에 들어오는 round 상한만 허용한다",
        arguments: [
            (31.0, 6.0),
            (0.0, 1.0),
            (Double.infinity, 1.0),
            (30.0, 0.0),
            (30.0, 11.0),
            (30.0, Double.nan)
        ]
    )
    func rejectsUnboundedTimeouts(total: Double, round: Double) {
        #expect(throws: ClockExchangeProbeOptions.ValidationError.self) {
            _ = try ClockExchangeProbeOptions(
                localLabel: "A",
                peerLabel: "B",
                totalTimeoutSeconds: total,
                roundTimeoutSeconds: round
            )
        }
    }
}

@Suite("SP-03 clock exchange wire")
struct ClockExchangeWireTests {
    private let instanceA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    private let instanceB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    private let request = ClockExchangeWireMessage.request(
        requestID: "00112233445566778899aabbccddeeff",
        round: 1,
        fromLabel: "A",
        toLabel: "B",
        fromInstanceID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toInstanceID: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        localSentWallMilliseconds: 1_700_000_000_000
    )

    @Test("한 byte씩 잘린 TCP 입력도 완전한 frame 전에는 decode하지 않는다")
    func decodesBytewisePartialFrame() throws {
        let frame = try ClockExchangeWireCodec.encode(request)
        var decoder = ClockExchangeFrameDecoder()

        for byte in frame.dropLast() {
            try decoder.append(Data([byte]))
            #expect(try decoder.nextMessage() == nil)
        }
        try decoder.append(Data([frame.last!]))

        #expect(try decoder.nextMessage() == request)
        #expect(decoder.bufferedByteCount == 0)
    }

    @Test("한 receive에 합쳐진 두 frame도 경계를 보존한다")
    func decodesCoalescedFrames() throws {
        let response = ClockExchangeWireMessage.response(
            to: request,
            fromLabel: "B",
            toLabel: "A",
            fromInstanceID: instanceB,
            toInstanceID: instanceA,
            peerReceivedWallMilliseconds: 1_700_000_000_005,
            peerSentWallMilliseconds: 1_700_000_000_007,
            peerProcessingMonotonicMilliseconds: 2,
            peerCaptureUncertaintyMilliseconds: 1
        )
        var bytes = try ClockExchangeWireCodec.encode(request)
        bytes.append(try ClockExchangeWireCodec.encode(response))
        var decoder = ClockExchangeFrameDecoder()
        try decoder.append(bytes)

        #expect(try decoder.nextMessage() == request)
        #expect(try decoder.nextMessage() == response)
        #expect(try decoder.nextMessage() == nil)
    }

    @Test("길이 prefix만 있고 payload가 덜 왔으면 안전하게 기다린다")
    func truncatedFrameStaysPending() throws {
        let frame = try ClockExchangeWireCodec.encode(request)
        let split = frame.count - 3
        var decoder = ClockExchangeFrameDecoder()
        try decoder.append(frame.prefix(split))

        #expect(try decoder.nextMessage() == nil)
        #expect(decoder.bufferedByteCount == split)

        try decoder.append(frame.suffix(3))
        #expect(try decoder.nextMessage() == request)
    }

    @Test("0과 상한 초과 길이를 payload로 할당하지 않고 거부한다")
    func rejectsInvalidLengths() throws {
        for prefix in [
            Data([0, 0, 0, 0]),
            Data([0, 0, 8, 1])
        ] {
            var bytes = prefix
            #expect(throws: ClockExchangeWireError.self) {
                _ = try ClockExchangeWireCodec.decodeNext(from: &bytes)
            }
        }
    }

    @Test("완전한 길이의 malformed JSON과 구조 위반 message를 거부한다")
    func rejectsMalformedAndInvalidPayload() throws {
        let malformedPayload = Data("{not-json}".utf8)
        var malformed = prefixed(malformedPayload)
        #expect(throws: ClockExchangeWireError.self) {
            _ = try ClockExchangeWireCodec.decodeNext(from: &malformed)
        }

        let invalid = ClockExchangeWireMessage.request(
            requestID: "not-a-32-byte-hex-request-id",
            round: 1,
            fromLabel: "A",
            toLabel: "B",
            fromInstanceID: instanceA,
            toInstanceID: instanceB,
            localSentWallMilliseconds: 0
        )
        #expect(throws: ClockExchangeWireError.self) {
            _ = try ClockExchangeWireCodec.encode(invalid)
        }
    }

    @Test("wire timing은 30초 경계만 허용하고 그 이상은 reportingOverflow다")
    func boundsWireMeasurements() throws {
        let boundary = ClockExchangeWireMessage.response(
            to: request,
            fromLabel: "B",
            toLabel: "A",
            fromInstanceID: instanceB,
            toInstanceID: instanceA,
            peerReceivedWallMilliseconds: 10,
            peerSentWallMilliseconds: 20,
            peerProcessingMonotonicMilliseconds: 30_000,
            peerCaptureUncertaintyMilliseconds: 30_000
        )
        #expect(throws: Never.self) {
            _ = try ClockExchangeWireCodec.encode(boundary)
        }

        for contaminated in [Int64(30_001), Int64.max] {
            let response = ClockExchangeWireMessage.response(
                to: request,
                fromLabel: "B",
                toLabel: "A",
                fromInstanceID: instanceB,
                toInstanceID: instanceA,
                peerReceivedWallMilliseconds: 10,
                peerSentWallMilliseconds: 20,
                peerProcessingMonotonicMilliseconds: contaminated,
                peerCaptureUncertaintyMilliseconds: 0
            )
            do {
                _ = try ClockExchangeWireCodec.encode(response)
                Issue.record("상한 초과 timing이 wire에 들어갔다")
            } catch let error as ClockExchangeWireError {
                #expect(error == .reportingOverflow)
            }
        }
    }

    @Test("음수 capture uncertainty는 malformed로 닫고 합산 overflow는 별도 분류한다")
    func rejectsInvalidAndOverflowingUncertainty() throws {
        let negative = ClockExchangeWireMessage.response(
            to: request,
            fromLabel: "B",
            toLabel: "A",
            fromInstanceID: instanceB,
            toInstanceID: instanceA,
            peerReceivedWallMilliseconds: 10,
            peerSentWallMilliseconds: 20,
            peerProcessingMonotonicMilliseconds: 0,
            peerCaptureUncertaintyMilliseconds: -1
        )
        #expect(throws: ClockExchangeWireError.self) {
            _ = try ClockExchangeWireCodec.encode(negative)
        }

        #expect(
            try ClockExchangeMeasurementBounds.checkedSum(15_000, 15_000)
                == 30_000
        )
        for values in [
            [Int64(30_000), 1],
            [Int64.max, 1]
        ] {
            do {
                _ = try ClockExchangeMeasurementBounds.checkedSum(
                    values[0],
                    values[1]
                )
                Issue.record("오염된 합산이 허용됐다")
            } catch let failure as ClockExchangeProbeFailure {
                #expect(failure == .reportingOverflow)
            }
        }
    }

    @Test("instance ID는 익명 lowercase 32-hex만 wire에 들어간다")
    func validatesEphemeralInstanceIDs() {
        for invalidID in [
            "A",
            String(repeating: "g", count: 32),
            String(repeating: "A", count: 32),
            String(repeating: "a", count: 31)
        ] {
            let invalid = ClockExchangeWireMessage.request(
                requestID: "00112233445566778899aabbccddeeff",
                round: 1,
                fromLabel: "A",
                toLabel: "B",
                fromInstanceID: invalidID,
                toInstanceID: instanceB,
                localSentWallMilliseconds: 0
            )
            #expect(throws: ClockExchangeWireError.self) {
                _ = try ClockExchangeWireCodec.encode(invalid)
            }
        }
    }

    private func prefixed(_ payload: Data) -> Data {
        let length = UInt32(payload.count)
        var output = Data([
            UInt8((length >> 24) & 0xff),
            UInt8((length >> 16) & 0xff),
            UInt8((length >> 8) & 0xff),
            UInt8(length & 0xff)
        ])
        output.append(payload)
        return output
    }
}

@Suite("SP-03 clock exchange run safety")
struct ClockExchangeRunSafetyTests {
    private let instanceA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    private let instanceB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    private let instanceC = "cccccccccccccccccccccccccccccccc"

    @Test("A/B 방향이 바뀌어도 같은 privacy-safe pair evidence를 만든다")
    func pairEvidenceIsSymmetricAndAnonymous() {
        var a = ClockReciprocalEvidenceState(localInstanceID: instanceA)
        var b = ClockReciprocalEvidenceState(localInstanceID: instanceB)
        let aSelected = a.selectDiscoveredPeer(instanceID: instanceB)
        let bSelected = b.selectDiscoveredPeer(instanceID: instanceA)
        #expect(aSelected)
        #expect(bSelected)

        for round in 1...3 {
            let aCompleted = a.completeInboundRound(
                round,
                peerInstanceID: instanceB,
                targetInstanceID: instanceA
            )
            let bCompleted = b.completeInboundRound(
                round,
                peerInstanceID: instanceA,
                targetInstanceID: instanceB
            )
            #expect(aCompleted)
            #expect(bCompleted)
        }

        #expect(a.reciprocalPeerMatched)
        #expect(b.reciprocalPeerMatched)
        #expect(a.pairEvidenceID == b.pairEvidenceID)
        #expect(a.pairEvidenceID?.count == 64)
        #expect(a.pairEvidenceID?.contains(instanceA) == false)
        #expect(a.pairEvidenceID?.contains(instanceB) == false)
    }

    @Test("같은 label의 제3 instance inbound는 outbound 증거와 섞이지 않는다")
    func thirdPeerCannotMixWithDiscoveredPeer() {
        var state = ClockReciprocalEvidenceState(
            localInstanceID: instanceA
        )
        let selected = state.selectDiscoveredPeer(instanceID: instanceB)
        let thirdAccepted = state.validateInboundPeer(
            instanceID: instanceC,
            targetInstanceID: instanceA
        )
        #expect(selected)
        #expect(!thirdAccepted)

        for round in 1...3 {
            let completed = state.completeInboundRound(
                round,
                peerInstanceID: instanceB,
                targetInstanceID: instanceA
            )
            #expect(completed)
        }

        #expect(!state.reciprocalPeerMatched)
        #expect(state.pairEvidenceID == nil)
    }

    @Test("먼저 온 제3 Peer가 있으면 다른 outbound Peer를 선택하지 않는다")
    func inboundFirstStillPinsOnePeer() {
        var state = ClockReciprocalEvidenceState(
            localInstanceID: instanceA
        )
        let inboundAccepted = state.validateInboundPeer(
            instanceID: instanceC,
            targetInstanceID: instanceA
        )
        let differentOutboundSelected =
            state.selectDiscoveredPeer(instanceID: instanceB)
        let sameOutboundSelected =
            state.selectDiscoveredPeer(instanceID: instanceC)
        #expect(inboundAccepted)
        #expect(!differentOutboundSelected)
        #expect(sameOutboundSelected)
    }

    @Test("local target instance가 다르면 reciprocal evidence가 될 수 없다")
    func wrongTargetInstanceFailsClosed() {
        var state = ClockReciprocalEvidenceState(
            localInstanceID: instanceA
        )
        let selected = state.selectDiscoveredPeer(instanceID: instanceB)
        let completed = state.completeInboundRound(
            1,
            peerInstanceID: instanceB,
            targetInstanceID: instanceC
        )
        #expect(selected)
        #expect(!completed)
        #expect(!state.reciprocalPeerMatched)
    }

    @Test("listener는 한 run에서 inbound connection 하나만 admit한다")
    func connectionFloodIsBoundedToOne() {
        var admission = ClockInboundAdmissionState()
        let decisions = (0..<100).map { _ in admission.admit() }

        #expect(decisions.filter { $0 }.count == 1)
        #expect(admission.admittedConnections == 1)
        #expect(
            admission.admittedConnections
                == ClockInboundAdmissionState.maximumConnections
        )
    }

    @Test("stop 요청 뒤 old run finish 전에는 새 run을 열지 않는다")
    func stoppingRunBlocksRestartUntilFinish() {
        var lifecycle = ClockProbeLifecycleState()
        let oldToken = lifecycle.begin()
        #expect(oldToken != nil)
        let stoppedToken = lifecycle.requestStop()
        let beginWhileStopping = lifecycle.begin()
        let wrongFinish = lifecycle.finish(token: (oldToken ?? 0) + 1)
        let beginAfterWrongFinish = lifecycle.begin()
        let correctFinish = lifecycle.finish(token: oldToken ?? 0)
        #expect(stoppedToken == oldToken)
        #expect(beginWhileStopping == nil)
        #expect(!wrongFinish)
        #expect(beginAfterWrongFinish == nil)
        #expect(correctFinish)

        let newToken = lifecycle.begin()
        #expect(newToken != nil)
        #expect(newToken != oldToken)
    }
}

@Suite("SP-03 clock exchange evidence")
struct ClockExchangeProbeReportTests {
    @Test("Wi-Fi에서 양방향 3회 유효 표본만 후보 gate 판정에 들어간다")
    func threeCrossHostSamplesAreCandidateEligible() {
        let report = makeReport(interfaces: [.wifi])

        #expect(report.samples.count == 3)
        #expect(report.loopbackObserved == false)
        #expect(report.crossHostEvidence)
        #expect(report.candidateEligibility == .eligible)
        #expect(report.candidateEvidenceEligible)

        let state = report.validateCandidate(
            at: MonotonicInstant(milliseconds: 10_000)
        )
        guard case .valid = state else {
            Issue.record("유효한 3회 cross-host 표본이 candidate gate를 통과하지 못했다")
            return
        }
    }

    @Test("loopback이 함께 관측되면 Wi-Fi가 있어도 같은 host evidence다")
    func loopbackNeverBecomesPolicyEvidence() {
        let report = makeReport(interfaces: [.wifi, .loopback])

        #expect(report.loopbackObserved)
        #expect(report.crossHostEvidence == false)
        #expect(report.candidateEligibility == .ineligible(.sameHost))
        #expect(report.candidateEvidenceEligible == false)

        let state = report.validateCandidate(
            at: MonotonicInstant(milliseconds: 10_000)
        )
        #expect(state == .blocked(.unverifiable(.normalPeerUnavailable)))
    }

    @Test("loopback이 없다는 음성 증거만으로 두 Mac이라고 추정하지 않는다")
    func missingPositiveInterfaceEvidenceIsIneligible() {
        let report = makeReport(interfaces: [.other])

        #expect(!report.loopbackObserved)
        #expect(!report.crossHostEvidence)
        #expect(
            report.candidateEligibility
                == .ineligible(.crossHostInterfaceNotObserved)
        )
    }

    @Test("Wi-Fi 관측만으로는 부족하고 물리 Mac 2대 운영자 확인이 필요하다")
    func physicalMacAttestationIsRequired() {
        let report = makeReport(
            interfaces: [.wifi],
            operatorConfirmedDistinctPhysicalMacs: false
        )

        #expect(!report.crossHostEvidence)
        #expect(
            report.candidateEligibility
                == .ineligible(.distinctPhysicalMacsNotConfirmed)
        )
        #expect(!report.candidateEvidenceEligible)
    }

    @Test("outbound 또는 inbound 3회가 빠지면 정확한 교환 evidence가 아니다")
    func requiresExactlyThreeBothDirections() {
        let outboundMissing = makeReport(
            interfaces: [.ethernet],
            results: Array(validRoundResults.prefix(2))
        )
        #expect(
            outboundMissing.candidateEligibility
                == .ineligible(.exactlyThreeOutboundSamplesRequired)
        )

        let inboundMissing = makeReport(
            interfaces: [.ethernet],
            inboundRounds: [1, 2]
        )
        #expect(
            inboundMissing.candidateEligibility
                == .ineligible(.exactlyThreeInboundResponsesRequired)
        )
    }

    @Test("형식상 3개여도 monotonic timing이 불가능한 표본은 후보가 아니다")
    func invalidTimingSampleIsIneligible() {
        let invalid = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_005),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_007),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_012),
            localElapsedMonotonicMilliseconds: 2,
            peerProcessingMonotonicMilliseconds: 3
        )
        var results = validRoundResults
        results[2] = ClockExchangeRoundResult(
            round: 3,
            sample: invalid,
            failure: nil
        )
        let report = makeReport(interfaces: [.wifi], results: results)

        #expect(
            report.candidateEligibility == .ineligible(.invalidClockSample)
        )
    }

    @Test("공통 10ms 허용치는 통과하고 그보다 큰 wall clock jump는 차단한다")
    func wallAndMonotonicElapsedMustAgree() {
        let withinAllowance = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_005),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_017),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_022),
            localElapsedMonotonicMilliseconds: 12,
            peerProcessingMonotonicMilliseconds: 2
        )
        #expect(withinAllowance.offsetInterval != nil)

        let jumped = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_005),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_007),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_023),
            localElapsedMonotonicMilliseconds: 12,
            peerProcessingMonotonicMilliseconds: 2
        )
        #expect(jumped.offsetInterval == nil)

        var results = validRoundResults
        results[0] = ClockExchangeRoundResult(
            round: 1,
            sample: jumped,
            failure: nil
        )
        let report = makeReport(interfaces: [.wifi], results: results)
        #expect(
            report.candidateEligibility == .ineligible(.invalidClockSample)
        )
    }

    @Test("Peer wall elapsed jump도 local과 동일하게 fail-closed다")
    func peerWallClockJumpIsDetected() {
        let peerJumped = ClockFourTimestampSample(
            localSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_000),
            peerReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_005),
            peerSentWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_100),
            localReceivedWallTime: WallClockInstant(millisecondsSinceUnixEpoch: 1_012),
            localElapsedMonotonicMilliseconds: 12,
            peerProcessingMonotonicMilliseconds: 2
        )
        #expect(peerJumped.offsetInterval == nil)
    }

    @Test("단위 테스트 보고서는 live network 성공을 스스로 만들지 않는다")
    func failureCannotBePromotedBySyntheticSamples() {
        let report = makeReport(
            interfaces: [.wifi],
            failure: .peerNotFound
        )

        #expect(report.crossHostEvidence)
        #expect(report.candidateEligibility == .ineligible(.probeFailed))
        #expect(report.candidateEvidenceEligible == false)
    }

    @Test("reciprocal peer match가 없으면 3회 양방향처럼 보여도 후보가 아니다")
    func reciprocalPeerMatchIsRequired() {
        let report = makeReport(
            interfaces: [.wifi],
            reciprocalPeerMatched: false,
            pairEvidenceID: nil
        )

        #expect(
            report.candidateEligibility
                == .ineligible(.reciprocalPeerNotMatched)
        )
        #expect(!report.candidateEvidenceEligible)
    }

    private var validRoundResults: [ClockExchangeRoundResult] {
        (1...3).map { round in
            let base = Int64(round * 100_000)
            return ClockExchangeRoundResult(
                round: round,
                sample: ClockFourTimestampSample(
                    localSentWallTime: WallClockInstant(
                        millisecondsSinceUnixEpoch: base
                    ),
                    peerReceivedWallTime: WallClockInstant(
                        millisecondsSinceUnixEpoch: base + 5
                    ),
                    peerSentWallTime: WallClockInstant(
                        millisecondsSinceUnixEpoch: base + 7
                    ),
                    localReceivedWallTime: WallClockInstant(
                        millisecondsSinceUnixEpoch: base + 12
                    ),
                    localElapsedMonotonicMilliseconds: 12,
                    peerProcessingMonotonicMilliseconds: 2,
                    captureUncertaintyMilliseconds: 1
                ),
                failure: nil
            )
        }
    }

    private func makeReport(
        interfaces: [ClockExchangeInterfaceType],
        operatorConfirmedDistinctPhysicalMacs: Bool = true,
        inboundRounds: [Int] = [1, 2, 3],
        results: [ClockExchangeRoundResult]? = nil,
        reciprocalPeerMatched: Bool = true,
        pairEvidenceID: String? = String(repeating: "c", count: 64),
        failure: ClockExchangeProbeFailure? = nil
    ) -> ClockExchangeProbeReport {
        ClockExchangeProbeReport(
            localLabel: "A",
            peerLabel: "B",
            operatorConfirmedDistinctPhysicalMacs:
                operatorConfirmedDistinctPhysicalMacs,
            totalTimeoutMilliseconds: 20,
            observedInterfaceTypes: interfaces,
            inboundCompletedRounds: inboundRounds,
            reciprocalPeerMatched: reciprocalPeerMatched,
            pairEvidenceID: pairEvidenceID,
            roundResults: results ?? validRoundResults,
            failure: failure
        )
    }
}
