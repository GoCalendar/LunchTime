import Foundation
import SP02ReplicationCore

// SP-02 결정적 replay 실행기.
//
// 결과 JSON은 stdout으로, 진행 안내는 stderr로 나간다. SP-01과 같은 규칙이며,
// 리다이렉트로 원시 결과를 그대로 보관할 수 있게 하기 위해서다.

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
        사용법: sp02-replay [--fixture <이름>] [--permutations <2~\(ReplayRunner.maximumPermutations)>] [--seed <정수>] [--list]

        - `--fixture`를 생략하면 모든 fixture를 실행한다.
        - `--permutations`는 서로 다른 도착 순서를 몇 개 시험할지 정한다. 순열 0은 항상 선언 순서다.
        - `--seed`가 같으면 항상 같은 순열이 나온다. 증거를 재현하려면 같은 값을 쓴다.
        """)
    exit(2)
}

var selectedFixture: String?
var permutations = ReplayRunner.defaultPermutations
var seed = ReplayRunner.defaultSeed
var listOnly = false

var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--list":
        listOnly = true
    case "--fixture":
        guard let value = arguments.first else { failUsage("`--fixture` 값이 없습니다.") }
        arguments.removeFirst()
        selectedFixture = value
    case "--permutations":
        guard let value = arguments.first, let parsed = Int(value) else {
            failUsage("`--permutations` 값이 정수가 아닙니다.")
        }
        arguments.removeFirst()
        guard parsed >= 2, parsed <= ReplayRunner.maximumPermutations else {
            failUsage("`--permutations`는 2 이상 \(ReplayRunner.maximumPermutations) 이하여야 합니다. 받은 값: \(parsed)")
        }
        permutations = parsed
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
    for fixture in FixtureCatalog.all {
        writeStandardOutput("\(fixture.name)\t\(fixture.question)")
    }
    exit(0)
}

let fixtures: [Fixture]
if let selectedFixture {
    guard let fixture = FixtureCatalog.named(selectedFixture) else {
        failUsage("그런 이름의 fixture가 없습니다: \(selectedFixture). `--list`로 목록을 확인하십시오.")
    }
    fixtures = [fixture]
} else {
    fixtures = FixtureCatalog.all
}

log("seed \(seed), 순열 \(permutations)개로 fixture \(fixtures.count)개를 실행합니다.")
let report = ReplayRunner.run(fixtures: fixtures, permutations: permutations, seed: seed) { message in
    log(message)
}

// 결과 JSON을 먼저 내보낸다. 판정 문장을 먼저 쓰면 stdout이 순수 JSON이 아니게 된다.
writeStandardOutput(report.jsonString())
log(report.verdict)

// 기대와 다른 fixture가 있으면 종료 코드로 알린다. 사람이 로그를 읽지 않아도
// 스크립트가 실패를 놓치지 않게 하기 위해서다.
exit(report.fixtures.allSatisfy(\.passed) ? 0 : 1)
