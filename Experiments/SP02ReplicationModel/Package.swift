// swift-tools-version: 6.0
import PackageDescription

// SP-02 실험 도구는 앱 프로젝트와 분리된 SwiftPM 실행 파일이다.
// 이 스파이크는 `LunchTime.xcodeproj`와 `LunchTime/` 변경이 금지되어 있고,
// 실험 코드는 앱 번들에 실려서는 안 되므로 독립 패키지로 둔다.
//
// SP-01과 달리 이 스파이크는 네트워크를 측정하지 않는다. 검증 대상이
// "같은 이벤트 집합이 같은 projection으로 수렴하는가"이므로 실제 전송·시계에
// 의존하면 결론이 재현되지 않는다. 그래서 fake transport와 논리 시각만 쓰는
// 결정적 시뮬레이션으로 모델을 검증한다.
let package = Package(
    name: "SP02ReplicationModel",
    platforms: [
        // 앱과 같은 최소 지원 macOS를 사용해 실험 환경을 제품 대상과 맞춘다.
        .macOS(.v14)
    ],
    targets: [
        // 장부·projection·ACK 판정은 라이브러리로 분리해 결정적으로 테스트한다.
        // 실험 도구라도 판정이 틀리면 스파이크 결론 전체가 틀리기 때문이다.
        .target(
            name: "SP02ReplicationCore",
            path: "Sources/SP02ReplicationCore"
        ),
        .executableTarget(
            name: "sp02-replay",
            dependencies: ["SP02ReplicationCore"],
            path: "Sources/sp02-replay"
        ),
        .testTarget(
            name: "SP02ReplicationCoreTests",
            dependencies: ["SP02ReplicationCore"],
            path: "Tests/SP02ReplicationCoreTests"
        )
    ]
)
