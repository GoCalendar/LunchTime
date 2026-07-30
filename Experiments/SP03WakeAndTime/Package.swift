// swift-tools-version: 6.0
import PackageDescription

// SP-03은 앱 프로젝트와 분리된 macOS 실험 패키지다. 시간·trigger·세션
// 판정은 Core에 두어 결정적으로 시험하고, 실제 환경 관측은 실행 파일이 맡는다.
let package = Package(
    name: "SP03WakeAndTime",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .target(
            name: "SP03WakeAndTimeCore",
            path: "Sources/SP03WakeAndTimeCore"
        ),
        .executableTarget(
            name: "sp03-probe",
            dependencies: ["SP03WakeAndTimeCore"],
            path: "Sources/sp03-probe"
        ),
        .testTarget(
            name: "SP03WakeAndTimeCoreTests",
            dependencies: ["SP03WakeAndTimeCore"],
            path: "Tests/SP03WakeAndTimeCoreTests"
        )
    ]
)
