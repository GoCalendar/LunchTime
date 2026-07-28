import Foundation
import Testing

@testable import SP01ProbeCore

/// 측정 판정 계약.
///
/// `POL-03-R-01`은 지원 여부를 확인할 수 없는 환경에서 운영 데이터를 교환하지
/// 않도록 요구한다. 이 판정이 관대해지면 스파이크가 비지원 환경을 지원으로
/// 보고하게 되므로, 성공 판정은 전 회차 성공에서만 나와야 한다.
@Suite("SP-01 측정 판정")
struct ProbeReportTests {
    private func round(
        _ number: Int,
        discovered: Bool,
        discoveryMilliseconds: Int? = nil,
        connected: Bool,
        roundTripMilliseconds: Int? = nil,
        interfaceTypes: [String] = ["wifi"]
    ) -> RoundResult {
        RoundResult(
            round: number,
            discovered: discovered,
            discoveryMilliseconds: discoveryMilliseconds,
            peerLabels: discovered ? ["B"] : [],
            peerInterfaceTypes: discovered ? interfaceTypes : [],
            connected: connected,
            roundTripMilliseconds: roundTripMilliseconds,
            failure: connected ? nil : "제한 시간 안에 결과를 얻지 못했습니다"
        )
    }

    private func report(
        _ results: [RoundResult],
        rendezvousMilliseconds: Int? = 120,
        rendezvousInterfaceTypes: [String] = ["wifi"],
        rendezvousFailure: String? = nil,
        inboundEchoCount: Int = 0
    ) -> ProbeReport {
        ProbeReport(
            serviceType: ProbeOptions.serviceType,
            localLabel: "A",
            peerLabel: "B",
            rounds: results.count,
            roundTimeoutSeconds: 15,
            rendezvousMilliseconds: rendezvousMilliseconds,
            rendezvousInterfaceTypes: rendezvousInterfaceTypes,
            rendezvousFailure: rendezvousFailure,
            inboundEchoCount: inboundEchoCount,
            results: results
        )
    }

    @Test("전 회차가 발견·연결에 성공하면 성공으로 판정한다")
    func allRoundsSucceed() {
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 30, connected: true, roundTripMilliseconds: 8),
            round(2, discovered: true, discoveryMilliseconds: 12, connected: true, roundTripMilliseconds: 6)
        ])
        #expect(subject.verdict == "모든 회차에서 발견과 직접 연결 성공")
        #expect(subject.discoveredCount == 2)
        #expect(subject.connectedCount == 2)
    }

    @Test("한 번도 발견하지 못하면 지원 확인 불가로 판정한다")
    func neverDiscovered() {
        let subject = report([
            round(1, discovered: false, connected: false),
            round(2, discovered: false, connected: false)
        ])
        #expect(subject.verdict == "지원 확인 불가 — 상대를 한 번도 발견하지 못함")
        #expect(subject.medianDiscoveryMilliseconds == nil)
    }

    @Test("발견만 되고 연결이 없으면 발견 성공을 지원 판정으로 쓰지 않는다")
    func discoveredButNeverConnected() {
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 40, connected: false),
            round(2, discovered: true, discoveryMilliseconds: 20, connected: false)
        ])
        #expect(subject.verdict == "지원 확인 불가 — 발견은 되지만 직접 연결이 수립되지 않음")
        #expect(subject.connectedCount == 0)
        #expect(subject.medianRoundTripMilliseconds == nil)
    }

    @Test("한 회차라도 실패하면 성공으로 판정하지 않는다")
    func partialSuccessIsNotSupport() {
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 15, connected: true, roundTripMilliseconds: 5),
            round(2, discovered: true, discoveryMilliseconds: 18, connected: false)
        ])
        #expect(subject.verdict == "지원 확인 불가 — 회차별 결과가 일관되지 않음")
    }

    @Test("회차가 없으면 성공으로 판정하지 않는다")
    func emptyResultsAreNotSupport() {
        #expect(report([]).verdict != "모든 회차에서 발견과 직접 연결 성공")
    }

    @Test("상대를 만나지 못하면 지원 판정이 아니라 측정 실패로 구분한다")
    func missedRendezvousIsNotANetworkVerdict() {
        let subject = report(
            [],
            rendezvousMilliseconds: nil,
            rendezvousInterfaceTypes: [],
            rendezvousFailure: "제한 시간 안에 결과를 얻지 못했습니다"
        )
        #expect(subject.verdict == "측정 못함 — 제한 시간 안에 상대를 만나지 못함")
        #expect(subject.metPeer == false)
        #expect(subject.crossHostEvidence == false)
    }

    @Test("만남에 실패하면 회차 데이터가 있어도 지원 판정을 내리지 않는다")
    func missedRendezvousOverridesRoundData() {
        let subject = report(
            [round(1, discovered: true, discoveryMilliseconds: 10, connected: true, roundTripMilliseconds: 4)],
            rendezvousMilliseconds: nil,
            rendezvousFailure: "제한 시간 안에 결과를 얻지 못했습니다"
        )
        #expect(subject.verdict == "측정 못함 — 제한 시간 안에 상대를 만나지 못함")
    }

    @Test("loopback이 보이면 같은 기기 실행으로 표시한다")
    func loopbackMeansSameHost() {
        // 결과 파일에는 IP도 호스트명도 없다. 이 표시가 없으면 같은 기기에서 띄운 두
        // 프로세스의 측정값을 사내망 측정으로 오용하는 것을 막을 방법이 없다.
        let subject = report([
            round(
                1,
                discovered: true,
                discoveryMilliseconds: 4,
                connected: true,
                roundTripMilliseconds: 2,
                interfaceTypes: ["loopback", "wifi"]
            )
        ])
        #expect(subject.sameHostObserved)
        #expect(subject.crossHostEvidence == false)
        #expect(subject.observedInterfaceTypes == ["loopback", "wifi"])
        // 판정 자체는 네트워크 관측에 대한 것이므로 바뀌지 않는다.
        #expect(subject.verdict == "모든 회차에서 발견과 직접 연결 성공")
    }

    @Test("무선으로만 발견하면 같은 기기로 표시하지 않는다")
    func wifiOnlyIsNotSameHost() {
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 8, connected: true, roundTripMilliseconds: 42)
        ])
        #expect(subject.sameHostObserved == false)
        #expect(subject.crossHostEvidence)
        #expect(subject.observedInterfaceTypes == ["wifi"])
    }

    @Test("만남 뒤 첫 회차 실패는 시작 시각 차이로 설명되지 않는다")
    func failureAfterRendezvousStaysAFinding() {
        // 만남이 성공한 뒤의 실패는 상대가 이미 실행 중이었다는 뜻이므로 관측으로 남는다.
        let subject = report([
            round(1, discovered: false, connected: false),
            round(2, discovered: true, discoveryMilliseconds: 8, connected: true, roundTripMilliseconds: 20)
        ])
        #expect(subject.verdict == "지원 확인 불가 — 회차별 결과가 일관되지 않음")
        #expect(subject.metPeer)
    }

    @Test("중앙값은 성공 회차만 사용한다")
    func medianUsesSuccessfulRoundsOnly() {
        // 실패 회차가 0으로 섞이면 중앙값이 낙관적으로 내려간다. 표본에서 아예 빼야 한다.
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 10, connected: true, roundTripMilliseconds: 4),
            round(2, discovered: false, connected: false),
            round(3, discovered: true, discoveryMilliseconds: 30, connected: true, roundTripMilliseconds: 8),
            round(4, discovered: true, discoveryMilliseconds: 50, connected: true, roundTripMilliseconds: 12)
        ])
        // 표본 3개(10, 30, 50 / 4, 8, 12)의 중앙값.
        #expect(subject.medianDiscoveryMilliseconds == 30)
        #expect(subject.medianRoundTripMilliseconds == 8)
    }

    @Test("짝수 표본 중앙값은 두 중간값의 평균이다")
    func evenSampleMedianAveragesMiddleTwo() {
        // 시험 행렬이 "최소 10회"를 요구하므로 짝수 표본이 기본이다. 상위 중간값을 쓰면
        // `중앙값`이라는 이름과 값이 어긋난다.
        #expect(ProbeReport.median(of: [3, 3, 3, 3, 3, 5, 6, 8, 9, 1005]) == 4)
        #expect(ProbeReport.median(of: [10, 30]) == 20)
        #expect(ProbeReport.median(of: [7]) == 7)
        #expect(ProbeReport.median(of: []) == nil)
    }

    @Test("발견하지 못한 회차가 연결 성공으로 기록되면 성공 판정을 내리지 않는다")
    func successRequiresDiscoveryInvariant() {
        // 현재 측정 경로는 이런 값을 만들지 않지만, 불변식을 판정에서 강제해 두면
        // 나중에 생기는 모순된 회차가 조용히 성공으로 승격되지 않는다.
        let subject = report([
            RoundResult(
                round: 1,
                discovered: false,
                discoveryMilliseconds: nil,
                peerLabels: [],
                peerInterfaceTypes: [],
                connected: true,
                roundTripMilliseconds: 4,
                failure: nil
            )
        ])
        #expect(subject.verdict != "모든 회차에서 발견과 직접 연결 성공")
    }

    @Test("탐색 자체가 실패하면 시간 초과와 다른 판정을 낸다")
    func browserFailureIsNotATimeout() {
        // 권한 미승인은 밀리초 안에 실패한다. 그것을 "제한 시간을 기다렸다"로 적으면
        // 운영자가 권한을 의심할 단서를 잃는다.
        let subject = report(
            [],
            rendezvousMilliseconds: nil,
            rendezvousInterfaceTypes: [],
            rendezvousFailure: "서비스 탐색 실패: 권한이 없습니다"
        )
        #expect(subject.verdict.hasPrefix("측정 못함 — 탐색이 시작되지 못함"))
    }

    @Test("인터페이스 증거가 없으면 두 대 측정으로 인정하지 않는다")
    func crossHostNeedsPositiveEvidence() {
        // `sameHostObserved == false`는 음성 증거다. 회차가 전부 실패해 인터페이스를
        // 아무것도 관측하지 못한 실행이 그 조건만으로 행렬에 들어가면 안 된다.
        let subject = report(
            [round(1, discovered: false, connected: false)],
            rendezvousInterfaceTypes: []
        )
        #expect(subject.sameHostObserved == false)
        #expect(subject.crossHostEvidence == false)
    }

    @Test("만남 단계 인터페이스도 같은 기기 판별에 포함한다")
    func rendezvousInterfacesCountTowardSameHost() {
        // 회차가 전부 실패한 실행에서는 만남 단계가 유일한 인터페이스 증거다.
        let subject = report(
            [round(1, discovered: false, connected: false)],
            rendezvousInterfaceTypes: ["loopback", "wifi"]
        )
        #expect(subject.sameHostObserved)
        #expect(subject.crossHostEvidence == false)
    }

    @Test("반대 방향 도달 횟수를 결과에 남긴다")
    func inboundEchoIsRecorded() throws {
        // 회차 데이터는 모두 우리→상대 방향이다. 이 값이 없으면 한쪽 파일만으로는
        // 양방향을 말할 수 없다.
        let subject = report(
            [round(1, discovered: true, discoveryMilliseconds: 8, connected: true, roundTripMilliseconds: 20)],
            inboundEchoCount: 3
        )
        let parsed = try #require(
            try JSONSerialization.jsonObject(with: Data(subject.jsonString().utf8)) as? [String: Any]
        )
        #expect(parsed["inboundEchoCount"] as? Int == 3)
        #expect(parsed["peerLabel"] as? String == "B")
    }

    @Test("출력 JSON에 네트워크 식별자가 없고 익명 표시가 있다")
    func jsonStaysAnonymous() throws {
        let subject = report([
            round(1, discovered: true, discoveryMilliseconds: 10, connected: true, roundTripMilliseconds: 4)
        ])
        let json = subject.jsonString()
        let parsed = try #require(
            try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
        )
        #expect(parsed["anonymized"] as? Bool == true)
        #expect(parsed["localLabel"] as? String == "A")
        // 만남 단계를 결과 파일에서 감추지 않는다. 회차 수만 보고 판정할 수 없어야 한다.
        #expect(parsed["metPeer"] as? Bool == true)
        #expect(parsed["rendezvousMilliseconds"] as? Int == 120)
        // 인터페이스는 분류만 남긴다. `en0` 같은 이름이 들어가면 익명화가 깨진다.
        #expect(parsed["observedInterfaceTypes"] as? [String] == ["wifi"])
        #expect(parsed["sameHostObserved"] as? Bool == false)
        // IP, 호스트명, SSID를 담는 필드를 아예 만들지 않는다.
        for forbidden in ["ipAddress", "hostname", "ssid", "interfaceName", "endpoint"] {
            #expect(parsed[forbidden] == nil, "출력에 \(forbidden) 필드가 있어서는 안 된다")
        }
    }
}
