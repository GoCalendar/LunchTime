import XCTest

/// 앱 골격이 실제로 실행되는지 확인하는 최소 UI 검증.
///
/// 이 target은 UI 테스트 실행 기반만 확보하며 제품 동작은 검증하지 않는다.
/// 사용자 흐름 E2E는
/// [BDD/ATDD 테스트 표준](../../docs/development/02_testing_standard.md)의 도입
/// 조건을 충족한 뒤 별도 이슈에서 평가하므로 여기에 시나리오를 늘리지 않는다.
///
/// 이 target은 기본 scheme `LunchTime`의 테스트 대상에서 제외되어 있고 전용
/// scheme `LunchTimeUITests`로 실행한다. UI 실행은 automation mode 권한과 앱 실행
/// 타이밍에 의존해 결정적이지 않으며, 한 번 실패하면 테스트 데몬 상태가 남아 이후
/// 실행까지 막는 것을 확인했다. 같은 표준도 E2E를 MVP 필수 게이트로 두지 않는다.
/// CI는 기본 scheme에 `-skip-testing`을 더해 이중으로 제외하지만 target은 계속
/// 빌드하므로 컴파일 회귀는 잡는다.
final class AppLaunchUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func test_앱을_실행하면_전면_상태가_된다() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 30),
            "앱 골격이 전면 실행 상태에 도달하지 못했다. 실행 기반이 깨지면 후속 화면 작업도 검증할 수 없다."
        )
    }
}
