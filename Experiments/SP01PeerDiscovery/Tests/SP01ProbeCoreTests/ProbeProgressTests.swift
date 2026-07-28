import Testing

@testable import SP01ProbeCore

/// 실시간 진행 로그 계약.
///
/// 이 스파이크의 `작업 범위`는 "실제 네트워크 식별자 또는 사내 구성값의 저장소 기록"을
/// 제외한다. 결과 JSON은 필드 자체를 만들지 않아 그 경계를 지키지만, 화면 로그는 사람이
/// 복사해 붙일 수 있어 같은 계약이 필요하다. 사건이 담을 수 있는 값을 익명 라벨과
/// 밀리초로 제한했는지 여기서 고정한다.
@Suite("SP-01 진행 로그")
struct ProbeProgressTests {
    /// 회차 사건이 만들 수 있는 모든 문장.
    private static let allEvents: [ProbeProgress] = [
        .rendezvousStarted(limitSeconds: 60),
        .rendezvousMet(labels: ["B"], interfaceTypes: ["wifi"], milliseconds: 25_473),
        .rendezvousMissed(limitSeconds: 60, elapsedMilliseconds: 60_000, failure: "제한 시간 안에 결과를 얻지 못했습니다"),
        .roundStarted(round: 1, total: 10),
        .roundSucceeded(
            round: 2,
            total: 10,
            labels: ["B"],
            interfaceTypes: ["wifi"],
            discoveryMilliseconds: 8,
            roundTripMilliseconds: 42
        ),
        .roundDiscoveredOnly(
            round: 3,
            total: 10,
            labels: ["B"],
            interfaceTypes: ["wifi"],
            discoveryMilliseconds: 8,
            failure: "직접 연결 실패: 연결이 거부되었습니다"
        ),
        .roundFailed(round: 4, total: 10, failure: "제한 시간 안에 결과를 얻지 못했습니다"),
        .echoedToPeer(bytes: 16),
        .lingering(seconds: 20)
    ]

    @Test("모든 사건이 비어 있지 않은 한 줄 문장을 만든다")
    func everyEventProducesOneLine() {
        for event in Self.allEvents {
            let message = event.message
            #expect(!message.isEmpty)
            // 여러 줄이면 로그 한 줄에 시각을 붙이는 규칙이 깨진다.
            #expect(!message.contains("\n"), "여러 줄 문장이 나왔다: \(message)")
        }
    }

    @Test("회차 성공 문장에 발견 지연과 왕복 지연이 함께 남는다")
    func successLineCarriesBothTimings() {
        let message = ProbeProgress.roundSucceeded(
            round: 2,
            total: 10,
            labels: ["B"],
            interfaceTypes: ["wifi"],
            discoveryMilliseconds: 8,
            roundTripMilliseconds: 42
        ).message
        #expect(message.contains("2/10"))
        #expect(message.contains("8ms"))
        #expect(message.contains("42ms"))
        #expect(message.contains("B"))
        #expect(message.contains("wifi"))
    }

    @Test("같은 기기 실행이면 회차 줄에 그 사실을 적는다")
    func sameHostIsCalledOutInTheLog() {
        // 화면만 보고 두 대 측정이라고 착각하면 행렬에 잘못된 값이 들어간다.
        let message = ProbeProgress.roundSucceeded(
            round: 1,
            total: 3,
            labels: ["B"],
            interfaceTypes: ["loopback", "wifi"],
            discoveryMilliseconds: 4,
            roundTripMilliseconds: 2
        ).message
        #expect(message.contains("같은 기기입니다"))
    }

    @Test("상대가 우리에게 연결한 사건을 별도 문장으로 남긴다")
    func inboundEchoIsVisible() {
        // 회차 사건은 우리가 건 방향뿐이다. 반대 방향이 보이지 않으면 양방향 통신을
        // 관측했다고 말할 수 없다.
        let message = ProbeProgress.echoedToPeer(bytes: 16).message
        #expect(message.contains("상대가 우리에게 연결"))
        #expect(message.contains("16"))
    }

    @Test("초 표기에 불필요한 소수점을 남기지 않는다")
    func wholeSecondsStayWhole() {
        #expect(ProbeProgress.lingering(seconds: 20).message.contains("20초"))
        #expect(!ProbeProgress.lingering(seconds: 20).message.contains("20.0"))
    }

    @Test("만남 실패 문장이 지원 판정으로 읽히지 않는다")
    func missedRendezvousReadsAsProcedure() {
        let message = ProbeProgress.rendezvousMissed(
            limitSeconds: 60,
            elapsedMilliseconds: 60_000,
            failure: "제한 시간 안에 결과를 얻지 못했습니다"
        ).message
        #expect(message.contains("만나지 못했습니다"))
        #expect(!message.contains("지원"))

        // 탐색이 즉시 실패한 경우는 "상한을 기다렸다"로 적지 않는다.
        let immediate = ProbeProgress.rendezvousMissed(
            limitSeconds: 60,
            elapsedMilliseconds: 12,
            failure: "서비스 탐색 실패: 권한이 없습니다"
        ).message
        #expect(immediate.contains("12ms"))
        #expect(immediate.contains("권한"))
    }
}
