import Foundation

/// 실험 실행 옵션.
///
/// 네트워크 이름, SSID, IP와 호스트명은 옵션으로 받지 않는다. 운영자가 붙이는
/// `--label`은 `A`·`B`처럼 익명 식별자여야 하며, 이 값은 보고서에 그대로 남는다.
public struct ProbeOptions: Sendable {
    /// 이 기기를 가리키는 익명 라벨. 상대 Peer와 자신을 구분하는 데만 쓴다.
    public let label: String

    /// 측정할 상대의 익명 라벨.
    ///
    /// 상대를 고정하지 않으면 같은 구간에 세 대 이상이 있을 때 회차마다 다른 상대에
    /// 연결될 수 있다. 그 결과를 특정 조합 칸에 넣으면 측정하지 않은 구간을 측정한 것으로
    /// 보고하게 되므로, 상대 라벨을 필수로 받아 그 라벨만 매칭한다.
    public let peer: String

    /// 측정 반복 횟수. 무한 반복을 만들지 않기 위해 상한을 둔다.
    public let rounds: Int

    /// 한 회차에서 상대를 발견하고 연결까지 기다릴 최대 시간(초).
    public let roundTimeout: Double

    /// 회차를 세기 전에 상대를 처음 발견할 때까지 기다릴 최대 시간(초).
    ///
    /// 두 사람이 초 단위로 동시에 실행할 수는 없다. 이 대기가 없으면 늦게 시작한 쪽을
    /// 기다리는 동안 앞 회차가 실패하고, 그 실패가 `회차별 결과가 일관되지 않음`으로
    /// 보고되어 시작 시각 차이와 네트워크 경계 차단이 구분되지 않는다. 이 스파이크는
    /// 그 둘을 구분하는 것이 목적이므로 만남을 회차 측정에서 분리한다.
    public let rendezvous: Double

    /// 회차 사이 간격(초). 캐시된 발견 결과가 다음 회차에 섞이지 않게 한다.
    let cooldown: Double

    /// 모든 회차가 끝난 뒤 서비스 광고를 유지할 시간(초).
    ///
    /// 두 기기가 정확히 동시에 끝나지 않기 때문에, 먼저 끝난 쪽이 즉시 광고를 내리면
    /// 늦게 끝나는 쪽이 `Socket is not connected`를 기록한다. 그것은 네트워크 경계
    /// 문제가 아니라 측정 도구가 만든 잡음이므로 유예 시간으로 막는다.
    public let linger: Double

    public static let serviceType = "_lunchtime-sp01._tcp"
    static let maxRounds = 50
    static let maxRoundTimeout: Double = 120
    static let maxRendezvous: Double = 300

    static let usage = """
    사용법: swift run sp01-probe --label <익명 라벨> [옵션]

      --label <값>           필수. 이 기기의 익명 라벨(예: A). SSID·호스트명·IP를 넣지 않는다.
      --peer <값>            필수. 측정할 상대의 익명 라벨(예: B). 이 라벨만 매칭한다.
      --rounds <정수>        측정 반복 횟수. 기본 5, 최대 \(maxRounds).
      --round-timeout <초>   회차당 발견·연결 대기 상한. 기본 15, 최대 \(Int(maxRoundTimeout)).
      --rendezvous <초>      회차 측정 전 상대를 기다릴 상한. 기본 60, 최대 \(Int(maxRendezvous)).
      --cooldown <초>        회차 사이 간격. 기본 2.
      --linger <초>          회차 종료 뒤 광고 유지 시간. 기본 20, 최대 300.
      --help                 이 도움말을 출력한다.

    정확히 두 대의 Mac에서 서로 라벨을 맞바꿔 대략 같은 때에 실행한다. 한쪽이
    `--label A --peer B`면 다른 쪽은 `--label B --peer A`다. 회차는 양쪽이 서로를 처음
    발견한 뒤에 시작하므로 시작 시각이 몇십 초 어긋나도 결과가 오염되지 않는다.
    양쪽에 같은 `--rounds`를 사용해야 결과를 비교할 수 있다. 결과는 stdout에 JSON으로
    출력되며 네트워크 식별자를 포함하지 않는다.
    """

    public enum ParseError: Error, CustomStringConvertible {
        case helpRequested
        case missingLabel
        case missingPeer
        case labelNotAnonymous(String)
        case peerNotAnonymous(String)
        case peerEqualsLabel(String)
        case missingValue(String)
        case notANumber(String, String)
        case outOfRange(String, String)
        case unknownArgument(String)

        public var description: String {
            switch self {
            case .helpRequested:
                return ProbeOptions.usage
            case .missingLabel:
                return "`--label`은 필수입니다.\n\n\(ProbeOptions.usage)"
            case .missingPeer:
                return "`--peer`는 필수입니다. 측정할 상대의 라벨을 지정하십시오.\n\n\(ProbeOptions.usage)"
            case .peerNotAnonymous(let value):
                return """
                `--peer` 값 \"\(value)\"이 익명 식별자 형식이 아닙니다. 영문 대문자와 숫자 \
                1~8자만 사용하십시오.
                """
            case .peerEqualsLabel(let value):
                return """
                `--peer` 값 \"\(value)\"이 `--label`과 같습니다. 두 기기는 서로 다른 라벨을 \
                사용해야 하며, 같으면 서로를 자기 자신으로 보고 걸러냅니다.
                """
            case .labelNotAnonymous(let value):
                return """
                `--label` 값 \"\(value)\"이 익명 식별자 형식이 아닙니다. 영문 대문자와 숫자 \
                1~8자만 사용하십시오. SSID, 호스트명, 사용자 이름과 사내 구성값을 넣지 마십시오.
                """
            case .missingValue(let name):
                return "`\(name)`에 값이 필요합니다."
            case .notANumber(let name, let value):
                return "`\(name)` 값 \"\(value)\"를 숫자로 읽을 수 없습니다."
            case .outOfRange(let name, let value):
                return "`\(name)` 값 \"\(value)\"가 허용 범위를 벗어났습니다.\n\n\(ProbeOptions.usage)"
            case .unknownArgument(let name):
                return "알 수 없는 인자 `\(name)`입니다.\n\n\(ProbeOptions.usage)"
            }
        }
    }

    /// 익명 라벨은 대문자·숫자 1~8자로 제한한다. 사내 식별자가 실수로 들어가는 것을 막는다.
    ///
    /// 이 검사는 상대가 광고한 라벨에도 적용한다. 수신한 TXT record 값은 다른 호스트가
    /// 통제하는 임의 바이트이므로, 검사 없이 결과 파일과 로그에 넣으면 `anonymized: true`
    /// 파일에 임의 문자열이 들어가고 개행으로 로그 줄을 위조할 수도 있다.
    public static func isAnonymousLabel(_ value: String) -> Bool {
        guard (1...8).contains(value.count) else { return false }
        return value.allSatisfy { $0.isASCII && ($0.isUppercase || $0.isNumber) }
    }

    public static func parse(_ arguments: [String]) throws -> ProbeOptions {
        var label: String?
        var peer: String?
        var rounds = 5
        var roundTimeout: Double = 15
        var rendezvous: Double = 60
        var cooldown: Double = 2
        var linger: Double = 20

        var index = 1
        while index < arguments.count {
            let name = arguments[index]
            func nextValue() throws -> String {
                guard index + 1 < arguments.count else { throw ParseError.missingValue(name) }
                index += 1
                return arguments[index]
            }

            switch name {
            case "--help", "-h":
                throw ParseError.helpRequested
            case "--label":
                label = try nextValue()
            case "--peer":
                peer = try nextValue()
            case "--rounds":
                let raw = try nextValue()
                guard let parsed = Int(raw) else { throw ParseError.notANumber(name, raw) }
                guard (1...maxRounds).contains(parsed) else { throw ParseError.outOfRange(name, raw) }
                rounds = parsed
            case "--round-timeout":
                let raw = try nextValue()
                guard let parsed = Double(raw) else { throw ParseError.notANumber(name, raw) }
                guard parsed > 0, parsed <= maxRoundTimeout else { throw ParseError.outOfRange(name, raw) }
                roundTimeout = parsed
            case "--rendezvous":
                let raw = try nextValue()
                guard let parsed = Double(raw) else { throw ParseError.notANumber(name, raw) }
                guard parsed > 0, parsed <= maxRendezvous else { throw ParseError.outOfRange(name, raw) }
                rendezvous = parsed
            case "--linger":
                let raw = try nextValue()
                guard let parsed = Double(raw) else { throw ParseError.notANumber(name, raw) }
                guard parsed >= 0, parsed <= 300 else { throw ParseError.outOfRange(name, raw) }
                linger = parsed
            case "--cooldown":
                let raw = try nextValue()
                guard let parsed = Double(raw) else { throw ParseError.notANumber(name, raw) }
                guard parsed >= 0, parsed <= 60 else { throw ParseError.outOfRange(name, raw) }
                cooldown = parsed
            default:
                throw ParseError.unknownArgument(name)
            }
            index += 1
        }

        guard let label else { throw ParseError.missingLabel }
        guard isAnonymousLabel(label) else { throw ParseError.labelNotAnonymous(label) }
        guard let peer else { throw ParseError.missingPeer }
        guard isAnonymousLabel(peer) else { throw ParseError.peerNotAnonymous(peer) }
        guard peer != label else { throw ParseError.peerEqualsLabel(peer) }

        return ProbeOptions(
            label: label,
            peer: peer,
            rounds: rounds,
            roundTimeout: roundTimeout,
            rendezvous: rendezvous,
            cooldown: cooldown,
            linger: linger
        )
    }
}
