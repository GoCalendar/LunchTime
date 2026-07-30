// swift-tools-version: 6.0
import PackageDescription

// SP-04 실험 도구는 앱 프로젝트와 분리된 SwiftPM 실행 파일이다.
// 이 스파이크는 `LunchTime.xcodeproj`와 `LunchTime/Core/**` 변경이 금지되어
// 있고, 실험 코드는 앱 번들에 실려서는 안 되므로 독립 패키지로 둔다.
//
// SP-02가 논리 프로토콜을 결정적 시뮬레이션으로 검증했다면, 이 스파이크는
// **실제 암호 연산**을 쓴다. CryptoKit의 Curve25519·HKDF·ChaChaPoly·AES-GCM을
// 그대로 호출하고, 그 위에서 위조·재전송·중간자·범위 밖 Peer를 실제로
// 시도한다. 판정을 흉내내면 "무엇이 막혔는지"가 증거가 되지 못하기 때문이다.
//
// 다만 난수는 기본적으로 seed에서 유도한다(`DeterministicEntropy`). 같은
// seed가 같은 바이트를 만들어야 캡처한 wire 증거를 다시 만들 수 있기
// 때문이며, 이 선택은 **모델 전용**이다. 제품 구현은 반드시 시스템 CSPRNG를
// 써야 한다. `--system-entropy`로 같은 시나리오를 실제 난수에서도 실행해
// 판정이 동일한지 확인한다.
let package = Package(
    name: "SP04Security",
    platforms: [
        // 앱과 같은 최소 지원 macOS를 사용해 실험 환경을 제품 대상과 맞춘다.
        .macOS(.v14)
    ],
    targets: [
        // 신원·핸드셰이크·채널·저장 판정은 라이브러리로 분리해 결정적으로
        // 테스트한다. 실험 도구라도 판정이 틀리면 스파이크 결론 전체가 틀리다.
        .target(
            name: "SP04SecurityCore",
            path: "Sources/SP04SecurityCore"
        ),
        .executableTarget(
            name: "sp04-probe",
            dependencies: ["SP04SecurityCore"],
            path: "Sources/sp04-probe"
        ),
        .testTarget(
            name: "SP04SecurityCoreTests",
            dependencies: ["SP04SecurityCore"],
            path: "Tests/SP04SecurityCoreTests"
        )
    ]
)
