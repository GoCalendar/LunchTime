import Foundation

/// 한 회차의 관측 결과.
///
/// 어떤 필드에도 IP, 호스트명, SSID, 인터페이스 이름을 담지 않는다. 상대 Peer는
/// 상대가 광고한 익명 라벨로만 식별한다.
struct RoundResult: Encodable, Sendable {
    let round: Int
    /// 상대 Peer를 발견했는지.
    let discovered: Bool
    /// 회차 시작부터 첫 발견까지 걸린 시간(밀리초). 발견하지 못하면 `nil`.
    let discoveryMilliseconds: Int?
    /// 이 회차에 관측한 익명 라벨 전체. `--peer` 고정 대상이 아닌 라벨도 환경 정보로 담는다.
    ///
    /// 원소가 둘 이상이면 같은 구간에 세 대 이상이 있었다는 뜻이다. 측정 대상은
    /// `ProbeReport.peerLabel`이고 이 목록은 그것과 같은 의미가 아니다.
    let peerLabels: [String]
    /// 상대를 발견한 인터페이스 종류(`wifi`, `loopback` 등). 이름과 주소는 담지 않는다.
    let peerInterfaceTypes: [String]
    /// 발견 뒤 직접 연결을 수립했는지.
    let connected: Bool
    /// 연결 시작부터 왕복 확인까지 걸린 시간(밀리초). 실패하면 `nil`.
    let roundTripMilliseconds: Int?
    /// 실패 원인을 사람이 읽을 수 있게 정리한 값. 성공하면 `nil`.
    let failure: String?
}

/// 실험 전체 결과.
public struct ProbeReport: Sendable {
    static let tool = "sp01-probe"
    let serviceType: String
    let localLabel: String
    /// 측정 대상으로 고정한 상대 라벨.
    let peerLabel: String
    let rounds: Int
    let roundTimeoutSeconds: Double
    /// 회차 측정 전 상대를 처음 발견하기까지 걸린 시간(밀리초).
    ///
    /// 상한 안에 만나지 못하면 `nil`이고 회차는 하나도 측정하지 않는다. 만남 실패와
    /// 회차 실패를 같은 값으로 뭉개면 시작 시각 차이가 네트워크 차단으로 읽힌다.
    let rendezvousMilliseconds: Int?
    /// 만남 단계에서 관측한 인터페이스 종류.
    ///
    /// 회차가 하나도 성공하지 못한 실행에서는 이 값이 유일한 인터페이스 증거다. 이 값을
    /// 버리면 같은 기기 실행이 인터페이스 증거 없이 두 대 측정으로 통과할 수 있다.
    let rendezvousInterfaceTypes: [String]
    /// 만남이 실패한 원인. 성공했으면 `nil`.
    ///
    /// 시간 초과와 탐색 자체의 실패(권한 미승인 등)는 후속 조치가 다르다. 원인을 버리면
    /// 밀리초 안에 실패한 실행도 "제한 시간을 기다렸다"로 기록된다.
    let rendezvousFailure: String?
    /// 누군가 우리에게 연결해 바이트를 돌려받은 횟수.
    ///
    /// 회차 데이터는 모두 우리→상대 방향이므로 이 값이 반대 방향의 유일한 관측이다. 다만
    /// listener는 연결한 쪽을 식별하지 않고 TCP 스트림에는 라벨이 없다. 그래서 이 값이
    /// 보증하는 것은 "어떤 Peer가 우리에게 도달했다"까지이며, `--peer`로 고정한 그 상대라고
    /// 단정할 수 없다. 세 대 이상이 같은 구간에 있으면 양방향 근거로 쓰지 않는다.
    let inboundEchoCount: Int
    let results: [RoundResult]

    /// 회차 측정 전에 상대를 만났는지.
    var metPeer: Bool { rendezvousMilliseconds != nil }

    /// 관측한 인터페이스 종류 전체. 만남 단계와 회차를 모두 포함한다.
    var observedInterfaceTypes: [String] {
        Set(rendezvousInterfaceTypes + results.flatMap(\.peerInterfaceTypes)).sorted()
    }

    /// 같은 기기의 다른 프로세스를 상대로 측정했는지.
    ///
    /// 도구 동작 확인에는 같은 기기 실행이 유용하지만, 그 값을 네트워크 측정으로 쓰면
    /// 경계를 넘지 못하는 조합을 지원으로 보고하게 된다. 결과 파일에는 IP도 호스트명도
    /// 없으므로 사람 기억 말고는 둘을 구분할 방법이 없었다. 이 값이 그 구분을 데이터로
    /// 만든다.
    var sameHostObserved: Bool {
        observedInterfaceTypes.contains("loopback")
    }

    /// 두 기기 사이 측정이라는 양성 증거가 있는지.
    ///
    /// `sameHostObserved == false`만으로는 부족하다. 그것은 음성 증거이므로 인터페이스를
    /// 아무것도 관측하지 못한 실행까지 통과시킨다. 시험 행렬의 칸은 이 값이 `true`인
    /// 실행으로만 채운다.
    ///
    /// 이 값은 **두 기기 사이라는 사실만** 증명하고 어느 구간이었는지는 증명하지 않는다.
    /// `wiredEthernet`만 관측된 실행도 `true`가 되므로, 칸의 구간 라벨은 운영자 진술로
    /// 남는다. 구간까지 데이터로 묶으려면 `observedInterfaceTypes`를 칸별로 함께 확인한다.
    var crossHostEvidence: Bool {
        guard !sameHostObserved else { return false }
        return observedInterfaceTypes.contains("wifi")
            || observedInterfaceTypes.contains("wiredEthernet")
    }

    /// 발견에 성공한 회차 수.
    var discoveredCount: Int { results.filter(\.discovered).count }
    /// 직접 연결에 성공한 회차 수.
    var connectedCount: Int { results.filter(\.connected).count }

    /// 발견 지연의 중앙값. 성공 회차가 없으면 `nil`.
    var medianDiscoveryMilliseconds: Int? {
        Self.median(of: results.compactMap(\.discoveryMilliseconds))
    }

    /// 왕복 지연의 중앙값. 성공 회차가 없으면 `nil`.
    var medianRoundTripMilliseconds: Int? {
        Self.median(of: results.compactMap(\.roundTripMilliseconds))
    }

    /// 표본의 중앙값. 짝수 표본에서는 두 중간값의 평균이다.
    ///
    /// 시험 행렬이 "최소 10회"를 요구하므로 짝수 표본이 기본이다. 상위 중간값을 그대로
    /// 쓰면 `중앙값`이라는 이름과 값이 어긋난다.
    static func median(of samples: [Int]) -> Int? {
        let sorted = samples.sorted()
        guard !sorted.isEmpty else { return nil }
        let middle = sorted.count / 2
        if sorted.count.isMultiple(of: 2) {
            return (sorted[middle - 1] + sorted[middle]) / 2
        }
        return sorted[middle]
    }

    /// 사용자에게 보여줄 판정.
    ///
    /// `POL-03-R-01`은 지원 여부를 확인할 수 없는 환경에서 운영 데이터를 교환하지
    /// 않도록 요구한다. 이 도구는 그 판정에 필요한 관측만 제공하고, 한 회차라도
    /// 양방향 연결에 실패하면 `지원 확인 불가`로 보고한다.
    ///
    /// 만남 실패는 별도 판정으로 분리한다. 상대가 아직 실행되지 않은 것과 네트워크가
    /// Peer 통신을 막는 것은 원인과 후속 조치가 다르므로 한 문장으로 합치지 않는다.
    public var verdict: String {
        guard metPeer else {
            if let rendezvousFailure, !rendezvousFailure.hasPrefix("제한 시간") {
                return "측정 못함 — 탐색이 시작되지 못함: \(rendezvousFailure)"
            }
            return "측정 못함 — 제한 시간 안에 상대를 만나지 못함"
        }
        guard !results.isEmpty else {
            return "측정 못함 — 측정한 회차가 없음"
        }
        if connectedCount == results.count && discoveredCount == results.count {
            return "모든 회차에서 발견과 직접 연결 성공"
        }
        if discoveredCount == 0 {
            return "지원 확인 불가 — 상대를 한 번도 발견하지 못함"
        }
        if connectedCount == 0 {
            return "지원 확인 불가 — 발견은 되지만 직접 연결이 수립되지 않음"
        }
        return "지원 확인 불가 — 회차별 결과가 일관되지 않음"
    }

    private struct Output: Encodable {
        let tool: String
        let serviceType: String
        let localLabel: String
        let peerLabel: String
        let rounds: Int
        let roundTimeoutSeconds: Double
        let anonymized: Bool
        let metPeer: Bool
        let rendezvousMilliseconds: Int?
        let rendezvousFailure: String?
        let observedInterfaceTypes: [String]
        let sameHostObserved: Bool
        let crossHostEvidence: Bool
        let inboundEchoCount: Int
        let discoveredCount: Int
        let connectedCount: Int
        let medianDiscoveryMilliseconds: Int?
        let medianRoundTripMilliseconds: Int?
        let verdict: String
        let results: [RoundResult]
    }

    public func jsonString() -> String {
        let output = Output(
            tool: Self.tool,
            serviceType: serviceType,
            localLabel: localLabel,
            peerLabel: peerLabel,
            rounds: rounds,
            roundTimeoutSeconds: roundTimeoutSeconds,
            // 이 파일에 네트워크 식별자가 없다는 사실을 기계적으로 표시한다.
            anonymized: true,
            metPeer: metPeer,
            rendezvousMilliseconds: rendezvousMilliseconds,
            rendezvousFailure: rendezvousFailure,
            observedInterfaceTypes: observedInterfaceTypes,
            sameHostObserved: sameHostObserved,
            crossHostEvidence: crossHostEvidence,
            inboundEchoCount: inboundEchoCount,
            discoveredCount: discoveredCount,
            connectedCount: connectedCount,
            medianDiscoveryMilliseconds: medianDiscoveryMilliseconds,
            medianRoundTripMilliseconds: medianRoundTripMilliseconds,
            verdict: verdict,
            results: results
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(output),
              let text = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"결과를 JSON으로 직렬화할 수 없습니다\"}"
        }
        return text
    }
}
