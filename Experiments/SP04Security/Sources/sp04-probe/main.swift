import Foundation
import SP04SecurityCore

// SP-04 보안 시나리오 실행기.
//
// 결과 JSON은 stdout으로, 진행 안내는 stderr로 나간다. SP-01·SP-02와 같은
// 규칙이며, 리다이렉트로 원시 결과를 그대로 보관할 수 있게 하기 위해서다.

/// stderr에 즉시 한 줄 출력한다.
///
/// 버퍼를 거치면 강제 종료 시 진행 기록이 사라진다.
func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func writeStandardOutput(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

func failUsage(_ message: String) -> Never {
    log(message)
    log("""
        사용법: sp04-probe [--scenario <이름>] [--seed <정수>] [--system-entropy] [--environment] [--keep-artifacts] [--list] [--key-custody]

        - `--scenario`를 생략하면 모든 시나리오를 실행한다.
        - `--seed`가 같으면 항상 같은 키와 nonce가 나온다. 증거를 재현하려면 같은 값을 쓴다.
        - `--system-entropy`는 시스템 CSPRNG로 실행한다. 판정이 seed와 무관함을 확인하는 용도다.
        - `--environment`는 실제 Keychain·Secure Enclave 가능 여부를 추가로 관측한다.
        - `--keep-artifacts`는 저장소 파일 사본을 지우지 않고 남긴다.
        - `--key-custody`는 키 보관 후보 비교표를 출력하고 끝낸다.
        """)
    exit(2)
}

let defaultSeed: UInt64 = 20_260_730

var selectedScenario: String?
var seed = defaultSeed
var useSystemEntropy = false
var includeEnvironment = false
var keepArtifacts = false
var listOnly = false
var keyCustodyOnly = false

var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--list":
        listOnly = true
    case "--key-custody":
        keyCustodyOnly = true
    case "--system-entropy":
        useSystemEntropy = true
    case "--environment":
        includeEnvironment = true
    case "--keep-artifacts":
        keepArtifacts = true
    case "--scenario":
        guard let value = arguments.first else { failUsage("`--scenario` 값이 없습니다.") }
        arguments.removeFirst()
        selectedScenario = value
    case "--seed":
        guard let value = arguments.first, let parsed = UInt64(value) else {
            failUsage("`--seed` 값이 부호 없는 정수가 아닙니다.")
        }
        arguments.removeFirst()
        seed = parsed
    default:
        failUsage("알 수 없는 인자입니다: \(argument)")
    }
}

if listOnly {
    for scenario in ScenarioCatalog.all {
        writeStandardOutput("\(scenario.name)\t\(scenario.question)")
    }
    exit(0)
}

if keyCustodyOnly {
    for option in KeyCustodyCatalog.options {
        let marker = option.id == KeyCustodyCatalog.recommendedOptionID ? "*" : " "
        writeStandardOutput(
            "\(marker) \(option.id) [\(option.curve.rawValue), \(option.extractability.rawValue)]"
        )
        writeStandardOutput("    수명: \(option.lifetime)")
        writeStandardOutput("    보관: \(option.custodyBoundary)")
        writeStandardOutput("    회전: \(option.rotation)")
        writeStandardOutput("    재설치: \(option.reinstall)")
        writeStandardOutput("    대가: \(option.cost)")
        if !option.requires.isEmpty {
            writeStandardOutput("    전제: \(option.requires.joined(separator: " / "))")
        }
    }
    writeStandardOutput("* 표시가 권고안이다. 전제가 성립하는지는 `--environment`로 확인한다.")
    exit(0)
}

let scenarios: [SecurityScenario]
if let selectedScenario {
    guard let scenario = ScenarioCatalog.named(selectedScenario) else {
        failUsage("그런 이름의 시나리오가 없습니다: \(selectedScenario). `--list`로 목록을 확인하십시오.")
    }
    scenarios = [scenario]
} else {
    scenarios = ScenarioCatalog.all
}

// 파일 산출물은 임시 디렉터리에 만든다. 저장소 안에 쓰면 추적 대상이 오염된다.
let workingDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("sp04-probe-\(ProcessInfo.processInfo.processIdentifier)")
do {
    try FileManager.default.createDirectory(at: workingDirectory, withIntermediateDirectories: true)
} catch {
    log("작업 디렉터리를 만들지 못했습니다.")
    exit(2)
}

log("entropy=\(useSystemEntropy ? "system" : "deterministic(seed=\(seed))"), 시나리오 \(scenarios.count)개를 실행합니다.")

let report = ScenarioRunner.run(
    scenarios: scenarios,
    seed: seed,
    useSystemEntropy: useSystemEntropy,
    includeEnvironmentProbe: includeEnvironment,
    workingDirectory: workingDirectory,
    progress: { log($0) }
)

// 결과 JSON을 먼저 내보낸다. 판정 문장을 먼저 쓰면 stdout이 순수 JSON이 아니게 된다.
writeStandardOutput(ProbeReportEncoder.json(report))
log(report.verdict)

if keepArtifacts {
    log("산출물을 남깁니다: \(workingDirectory.path)")
} else {
    try? FileManager.default.removeItem(at: workingDirectory)
}

// 기대와 다른 시나리오가 있으면 종료 코드로 알린다. 사람이 로그를 읽지 않아도
// 스크립트가 실패를 놓치지 않게 하기 위해서다.
exit(report.allPassed ? 0 : 1)
