/// 측정 중 관측한 사건.
///
/// 실행하는 사람이 "지금 통신이 되고 있는지"를 실시간으로 볼 수 있어야 한다. 결과
/// JSON은 모든 회차가 끝난 뒤에야 나오므로, 그때까지 화면이 조용하면 정상 대기와
/// 멈춘 상태가 구분되지 않는다. 그 구분이 안 되어 측정이 실패로 오판된 적이 있다.
///
/// 문장 생성을 이 타입에 고정하는 이유는 익명화다. 실시간 로그도 결과 파일과 같은
/// 계약을 지켜야 하므로, 사건이 담을 수 있는 값 자체를 익명 라벨과 밀리초로 제한한다.
/// endpoint, IP, 호스트명, 인터페이스 이름은 이 타입에 들어올 자리가 없다.
public enum ProbeProgress: Sendable {
    /// 회차 측정 전 상대를 기다리기 시작했다.
    case rendezvousStarted(limitSeconds: Double)
    /// 상한 안에 상대를 처음 만났다.
    case rendezvousMet(labels: [String], interfaceTypes: [String], milliseconds: Int)
    /// 상한 안에 상대를 만나지 못했다.
    ///
    /// 실제 경과 시간과 원인을 함께 싣는다. 탐색이 즉시 실패한 경우를 "상한을 기다렸다"로
    /// 적으면 권한 미승인과 경계 차단이 구분되지 않는다.
    case rendezvousMissed(limitSeconds: Double, elapsedMilliseconds: Int, failure: String)
    /// 한 회차의 탐색을 시작했다.
    case roundStarted(round: Int, total: Int)
    /// 발견과 왕복이 모두 성공했다.
    case roundSucceeded(
        round: Int,
        total: Int,
        labels: [String],
        interfaceTypes: [String],
        discoveryMilliseconds: Int,
        roundTripMilliseconds: Int
    )
    /// 발견은 됐으나 직접 연결이나 왕복이 실패했다.
    case roundDiscoveredOnly(
        round: Int,
        total: Int,
        labels: [String],
        interfaceTypes: [String],
        discoveryMilliseconds: Int,
        failure: String
    )
    /// 발견 자체가 실패했다.
    case roundFailed(round: Int, total: Int, failure: String)
    /// 상대가 우리에게 연결해 보낸 바이트를 그대로 돌려줬다.
    ///
    /// 위 회차 사건은 우리가 상대에게 건 것이다. 이 사건은 반대 방향이므로, 둘이 함께
    /// 보이면 양방향으로 통신이 성립했다는 뜻이다.
    case echoedToPeer(bytes: Int)
    /// 모든 회차가 끝나고 광고를 유지하는 중이다.
    case lingering(seconds: Double)

    public var message: String {
        switch self {
        case .rendezvousStarted(let limit):
            return "만남: 상대를 기다립니다. 최대 \(Self.seconds(limit))초 동안 조용한 것은 정상입니다."
        case .rendezvousMet(let labels, let interfaceTypes, let milliseconds):
            return """
            만남: 상대 \(Self.labels(labels)) 발견 (\(milliseconds)ms, \
            \(Self.interfaces(interfaceTypes))). 이제 회차를 셉니다.
            """
        case .rendezvousMissed(let limit, let elapsed, let failure):
            if failure.hasPrefix("제한 시간") {
                return "만남: \(Self.seconds(limit))초 안에 상대를 만나지 못했습니다. 회차를 측정하지 않습니다."
            }
            return """
            만남: 탐색이 \(elapsed)ms 만에 실패했습니다 — \(failure). \
            상한 \(Self.seconds(limit))초를 기다린 것이 아닙니다. 로컬 네트워크 권한을 확인하십시오.
            """
        case .roundStarted(let round, let total):
            return "회차 \(round)/\(total): 상대를 찾습니다"
        case .roundSucceeded(let round, let total, let labels, let interfaces, let discovery, let roundTrip):
            return """
            회차 \(round)/\(total): 발견 \(discovery)ms \
            (상대 \(Self.labels(labels)), \(Self.interfaces(interfaces))) \
            → 왕복 \(roundTrip)ms 성공
            """
        case .roundDiscoveredOnly(let round, let total, let labels, let interfaces, let discovery, let failure):
            return """
            회차 \(round)/\(total): 발견 \(discovery)ms \
            (상대 \(Self.labels(labels)), \(Self.interfaces(interfaces))) \
            → 직접 연결 실패: \(failure)
            """
        case .roundFailed(let round, let total, let failure):
            return "회차 \(round)/\(total): 발견 실패: \(failure)"
        case .echoedToPeer(let bytes):
            return "수신: 상대가 우리에게 연결했고 \(bytes)바이트를 그대로 돌려줬습니다"
        case .lingering(let seconds):
            return "회차 종료. \(Self.seconds(seconds))초 동안 광고를 유지합니다. 상대가 끝날 때까지 종료하지 마십시오."
        }
    }

    private static func labels(_ values: [String]) -> String {
        values.isEmpty ? "라벨 없음" : values.joined(separator: ", ")
    }

    /// 인터페이스 종류 표기. `loopback`은 같은 기기라는 뜻이므로 눈에 띄게 적는다.
    private static func interfaces(_ values: [String]) -> String {
        guard !values.isEmpty else { return "인터페이스 미확인" }
        let joined = values.joined(separator: "+")
        return values.contains("loopback") ? "\(joined) — 같은 기기입니다" : joined
    }

    /// 소수점 없는 초 표기. `60.0초`처럼 읽히지 않게 정수로 줄인다.
    ///
    /// 실행 안내와 진행 로그가 같은 값을 다르게 적으면 읽는 사람이 두 값을 다른 것으로
    /// 오해한다. 그래서 표기를 한 곳에 두고 양쪽이 같이 쓴다.
    public static func seconds(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}
