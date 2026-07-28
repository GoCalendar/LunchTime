// swift-tools-version: 6.0
import PackageDescription

// SP-01 실험 도구는 앱 프로젝트와 분리된 SwiftPM 실행 파일이다.
// 이 스파이크는 `LunchTime.xcodeproj` 변경이 금지되어 있고, 실험 코드는
// 앱 번들에 실려서는 안 되므로 독립 패키지로 둔다.
let package = Package(
    name: "SP01PeerDiscovery",
    platforms: [
        // 앱과 같은 최소 지원 macOS를 사용해 측정 환경을 제품 대상과 맞춘다.
        .macOS(.v14)
    ],
    targets: [
        // 측정 판정 로직은 라이브러리로 분리해 결정적으로 테스트한다.
        // 실험 도구라도 판정이 틀리면 스파이크 결론 전체가 틀리기 때문이다.
        .target(
            name: "SP01ProbeCore",
            path: "Sources/SP01ProbeCore"
        ),
        .executableTarget(
            name: "sp01-probe",
            dependencies: ["SP01ProbeCore"],
            path: "Sources/sp01-probe"
        ),
        .testTarget(
            name: "SP01ProbeCoreTests",
            dependencies: ["SP01ProbeCore"],
            path: "Tests/SP01ProbeCoreTests"
        )
    ]
)
