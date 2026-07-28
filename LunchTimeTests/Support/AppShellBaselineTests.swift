import Foundation
import Testing

@testable import LunchTime

/// 앱 골격과 테스트 실행 기반이 연결되어 있는지 확인하는 기준선.
///
/// 이 suite가 고정하는 계약은 두 가지뿐이다.
///
/// - 단위 테스트 대상이 앱 번들을 test host로 로드한다.
/// - `LunchTimeTests` 폴더에 추가한 소스가 프로젝트 manifest 수정 없이
///   컴파일된다. 이 suite가 실행된다는 사실 자체가 후자의 증거다.
///
/// 제품 동작은 검증하지 않는다. `PRD-01-FR-01`의 일일 라이프사이클과
/// `POL-04-R-01`의 Surface 동작은 해당 동작을 구현하는 후속 작업의 테스트가
/// 소유한다.
///
/// 공통 테스트 fixture는 이 `Support` 폴더에 둔다. 후속 작업은 fake clock,
/// fake transport와 결정적 fixture를 같은 위치에 추가하고 프로젝트 manifest는
/// 수정하지 않는다.
@Suite("앱 골격 기준선")
struct AppShellBaselineTests {
    @Test("단위 테스트 대상이 앱 번들을 test host로 로드한다")
    func loadsHostApplicationBundle() throws {
        let hostBundleIdentifier = try #require(
            Bundle.main.bundleIdentifier,
            "test host 앱 번들이 로드되지 않았다. TEST_HOST 배선이 깨지면 후속 도메인 테스트도 실행 기반을 잃는다."
        )

        #expect(
            hostBundleIdentifier == "com.gocalendar.LunchTime",
            """
            test host가 LunchTime 앱이 아니다: \(hostBundleIdentifier).
            테스트 번들이 host 앱 없이 실행되면 앱 코드를 검증할 수 없다.
            """
        )
    }
}
