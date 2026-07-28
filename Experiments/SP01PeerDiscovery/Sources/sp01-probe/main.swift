import Foundation
import SP01ProbeCore

/// SP-01 실험 진입점.
///
/// 결과는 stdout에 JSON으로만 출력하고 진행 안내는 stderr로 보낸다. 그래서
/// `swift run sp01-probe --label A > result-A.json`으로 원시 결과를 그대로 보관할 수 있다.
func note(_ message: String) {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
}

/// 진행 로그에 붙일 시각.
///
/// 두 사람이 각자 화면을 보며 "몇 회차에서 어긋났는지"를 맞춰야 하므로 경과 시간이
/// 아니라 벽시계 시각을 쓴다. 로케일에 따라 표기가 흔들리지 않게 형식을 고정한다.
let clock: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "HH:mm:ss"
    return formatter
}()

func progress(_ event: ProbeProgress) {
    note("[\(clock.string(from: Date()))] \(event.message)")
}

let options: ProbeOptions
do {
    options = try ProbeOptions.parse(CommandLine.arguments)
} catch let error as ProbeOptions.ParseError {
    if case .helpRequested = error {
        note(error.description)
        exit(0)
    }
    note(error.description)
    exit(2)
} catch {
    note("옵션을 해석할 수 없습니다")
    exit(2)
}

let seconds = ProbeProgress.seconds

note("라벨 \(options.label)로 광고하고 상대 \(options.peer)를 \(ProbeOptions.serviceType)에서 찾습니다.")
note("먼저 최대 \(seconds(options.rendezvous))초 동안 상대를 기다립니다. 회차는 서로를 발견한 뒤에 셉니다.")
note("회차 \(options.rounds)회, 회차당 상한 \(seconds(options.roundTimeout))초씩 발견·왕복에 각각 적용(회차 최악 \(seconds(options.roundTimeout * 2))초). 상대 Mac에서 --label \(options.peer) --peer \(options.label)로 실행하십시오.")
note("모든 회차 뒤 \(seconds(options.linger))초 동안 광고를 유지합니다. 상대가 끝날 때까지 종료하지 마십시오.")
note("macOS가 로컬 네트워크 접근을 처음 요청하면 허용해야 측정이 진행됩니다.")
note("아래에 진행 상황이 한 줄씩 나옵니다. `수신:` 줄은 상대가 우리에게 연결했다는 뜻입니다.")

let probe = DiscoveryProbe(options: options, progress: progress)

let report: ProbeReport
do {
    report = try await probe.measure()
} catch {
    probe.stop()
    note("측정을 완료하지 못했습니다: \(error)")
    exit(1)
}

// 유예 대기 전에 결과를 먼저 내보낸다. 그리고 `print`가 아니라 stdout에 직접 쓴다.
// `print`는 파일로 리다이렉트되면 버퍼에 쌓이므로, 대기 중에 강제 종료되면 성공한
// 측정 결과가 버퍼째로 사라진다. 실제로 그렇게 잃은 실행이 있었다.
FileHandle.standardOutput.write(Data((report.jsonString() + "\n").utf8))
note("판정: \(report.verdict)")
note("결과를 저장했습니다. 아래 대기 중에 종료해도 결과 파일은 남습니다.")

await probe.holdAdvertisement()
probe.stop()
// 측정 자체가 끝났으면 성공으로 종료한다. 발견·연결 실패는 결과 데이터로 남긴다.
exit(0)
